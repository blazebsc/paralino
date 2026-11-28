package app.paralino.android.safety

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import app.paralino.android.tracking.LocationInitHandler
import app.paralino.core.db.AppPrefs
import app.paralino.core.logg
import app.paralino.core.provider.ICoroutineScopeProvider
import app.paralino.core.repo.api.IFunctionsApi
import app.paralino.core.repo.api.ServerFunction
import app.paralino.core.repo.api.runAndWait
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.sqrt

/**
 * Safety monitoring for the direct (de-Googled) flavor.
 *
 * Feeds the [CrashDetector] with accelerometer + GPS samples from the app's
 * own location pipeline, runs the "are you OK?" countdown on a suspected
 * crash, and escalates to SOS (in-app alerts to every group member + optional
 * SMS to user-configured numbers) when the countdown expires or the panic
 * button is pressed.
 */
class SafetyManager(
    private val context: Context,
    private val locationInitHandler: LocationInitHandler,
    private val functionsApi: IFunctionsApi,
    private val appPrefs: AppPrefs,
    private val scope: ICoroutineScopeProvider,
) : ISafetyManager, SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private var escalationReason: SosReason? = null

    private val _countdownState = MutableStateFlow<SosCountdown?>(null)
    override val countdownState: StateFlow<SosCountdown?> = _countdownState

    private var countdownJob: Job? = null

    private val detector = CrashDetector { onSuspectedCrash() }

    private var lastLat = Double.NaN
    private var lastLng = Double.NaN

    init {
        // accelerometer for impact detection
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }

        // GPS speed + position from the app's own tracking pipeline
        scope.defaultIOScope.launch {
            locationInitHandler.currentLocation.collect { payload ->
                val loc = (payload as? app.paralino.core.models.Payload.Success)?.data ?: return@collect
                val speed = loc.speed ?: 0f
                lastLat = loc.lat
                lastLng = loc.lng
                detector.onSpeedSample(speed)
                detector.onLocationSample(speed, loc.lat, loc.lng, System.currentTimeMillis())
            }
        }
    }

    // ---- CrashDetector callbacks ----

    override fun onSensorChanged(event: SensorEvent) {
        val magnitude = sqrt(event.values[0] * event.values[0] + event.values[1] * event.values[1] + event.values[2] * event.values[2])
        detector.onAccelerometerSample(magnitude, event.timestamp / 1_000_000) // ns → ms
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun onSuspectedCrash() {
        if (_countdownState.value != null) return
        logg.i("safety", "Suspected crash — starting countdown")
        startCountdown(SosReason.CRASH)
    }

    // ---- countdown ----

    private fun startCountdown(reason: SosReason, seconds: Int = CRASH_COUNTDOWN_SECONDS) {
        countdownJob?.cancel()
        escalationReason = reason
        countdownJob = scope.defaultIOScope.launch {
            for (left in seconds downTo 1) {
                _countdownState.value = SosCountdown(secondsLeft = left, reason = reason)
                delay(1_000)
            }
            escalate()
        }
    }

    override fun cancelCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        _countdownState.value = null
        escalationReason = null
        detector.resetAfterEscalation()
        logg.i("safety", "Crash countdown cancelled by user")
    }

    // ---- escalation ----

    override fun triggerSos() {
        if (_countdownState.value != null) return // crash countdown already escalating
        escalationReason = SosReason.MANUAL
        scope.defaultIOScope.launch { escalate() }
    }

    private suspend fun escalate() {
        val reason = escalationReason ?: SosReason.MANUAL
        _countdownState.value = SosCountdown(secondsLeft = 0, reason = reason)

        logg.i("safety", "Escalating SOS ($reason)")

        // 1. in-app alerts to every group member
        try {
            functionsApi.runAndWait(function = ServerFunction.SOS, data = null)
        } catch (e: Exception) {
            logg.w("safety", "SOS call failed: ${e.message}")
        }

        // 2. SMS to the user's configured emergency numbers
        sendEmergencySms(reason)

        _countdownState.value = null
        escalationReason = null
        detector.resetAfterEscalation()
    }

    private fun sendEmergencySms(reason: SosReason) {
        val numbers = appPrefs.sosSmsNumbers.split(",", ";").map { it.trim() }.filter { it.isNotBlank() }
        if (numbers.isEmpty()) return

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            logg.w("safety", "SEND_SMS not granted — skipping emergency SMS")
            return
        }

        val label = when (reason) {
            SosReason.CRASH -> "possible car crash detected"
            SosReason.MANUAL -> "SOS triggered"
        }
        val locationLink = if (lastLat.isNaN()) "" else {
            " Location: https://www.openstreetmap.org/?mlat=$lastLat&mlon=$lastLng#map=16/$lastLat/$lastLng"
        }
        val text = "Whereabouts SOS: $label.$locationLink"

        val smsManager = context.getSystemService(SmsManager::class.java)
        for (number in numbers) {
            try {
                val parts = smsManager.divideMessage(text)
                if (parts.size == 1) {
                    smsManager.sendTextMessage(number, null, text, null, null)
                } else {
                    smsManager.sendMultipartTextMessage(number, null, parts, null, null)
                }
                logg.i("safety", "Emergency SMS sent to $number")
            } catch (e: Exception) {
                logg.w("safety", "Emergency SMS to $number failed: ${e.message}")
            }
        }
    }

    companion object {
        const val CRASH_COUNTDOWN_SECONDS = 45
    }
}
