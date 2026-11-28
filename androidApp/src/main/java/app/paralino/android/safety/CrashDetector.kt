package app.paralino.android.safety

import kotlin.math.sin
import kotlin.math.cos
import kotlin.math.sqrt
import kotlin.math.atan2

/**
 * Crash detection state machine. Pure — feed it samples, it emits one verdict
 * per incident via [onSuspectedCrash].
 *
 * Designed against the false-positive patterns the major implementations
 * (Google Personal Safety, Apple crash detection) filter for:
 *
 *  - ARMED only while driving: sustained GPS speed above the arm threshold.
 *    A phone dropped at home or on stairs is never armed.
 *  - IMPACT: accelerometer magnitude leaving the normal driving band
 *    (far above 1g or in free-fall). A single sample never qualifies —
 *    confirmation needs velocity change + stillness.
 *  - DELTA-V: GPS speed must drop sharply across the impact. A roller
 *    coaster produces big G-forces but keeps moving fast afterwards —
 *    no velocity drop, no crash.
 *  - STILLNESS: after the impact the device must stay near-stationary.
 *    Coasters keep moving; hard braking keeps driving — both rejected.
 *  - HUMAN CONFIRMATION: the caller shows a countdown; escalation only
 *    happens if the user does not respond.
 *
 * Feed [onLocationSample] with GPS speed/position (20s poll cadence is fine)
 * and [onAccelerometerSample] with |a| including gravity (~9.81 at rest).
 * All thresholds live in [Companion] — tune with the tests.
 */
class CrashDetector(
    private val onSuspectedCrash: () -> Unit,
) {
    // arming
    private var drivingSince = 0L
    private var armed = false
    private var lastAbovePark = 0L

    // impact in progress
    private var impactAt = 0L
    private var impactLat = Double.NaN
    private var impactLng = Double.NaN
    private var speedBeforeImpact = 0f

    private var escalated = false

    /** GPS speed + position sample. Drives arming, delta-v and stillness. */
    fun onLocationSample(speedMps: Float, lat: Double, lng: Double, timeMs: Long) {
        if (escalated) return

        // impact pending: confirm via delta-v + stillness
        if (impactAt != 0L) {
            val sinceImpact = timeMs - impactAt
            if (sinceImpact > CONFIRM_WINDOW_MS) {
                resetImpact()
                return
            }

            if (!impactLat.isNaN()) {
                val drift = distanceMeters(impactLat, impactLng, lat, lng)
                if (drift > STILLNESS_DRIFT_M) {
                    // still moving away — not a crash site (braking, coaster)
                    resetImpact()
                    return
                }
            }

            if (sinceImpact >= DELTA_V_DELAY_MS) {
                val deltaV = speedBeforeImpact - speedMps
                if (deltaV < DELTA_V_MIN_MPS) {
                    // speed did not collapse — coaster / braking / fender bender
                    resetImpact()
                    return
                }
            }

            if (impactLat.isNaN()) {
                impactLat = lat
                impactLng = lng
            }

            if (sinceImpact >= STILLNESS_WINDOW_MS) {
                escalated = true
                onSuspectedCrash()
            }
            return
        }

        // no impact pending: arming + drift bookkeeping
        if (speedMps >= PARK_SPEED_MPS) lastAbovePark = timeMs

        if (armed) {
            // disarm when clearly parked for a while
            if (speedMps < PARK_SPEED_MPS && timeMs - lastAbovePark > PARK_DURATION_MS) {
                disarm()
            }
            return
        }

        if (speedMps >= ARM_SPEED_MPS) {
            if (drivingSince == 0L) drivingSince = timeMs
            if (timeMs - drivingSince >= ARM_DURATION_MS) {
                armed = true
                drivingSince = 0L
            }
        } else {
            drivingSince = 0L
        }
    }

    /**
     * Accelerometer magnitude (m/s²) including gravity, ~20-50Hz.
     * A sample far outside the driving band opens an impact window;
     * [onLocationSample] then confirms or rejects it.
     */
    fun onAccelerometerSample(magnitude: Float, timeMs: Long) {
        if (escalated || !armed || impactAt != 0L) return

        if (magnitude >= IMPACT_G * GRAVITY || magnitude <= FREEFALL_G * GRAVITY) {
            impactAt = timeMs
            speedBeforeImpact = lastSpeed
            impactLat = Double.NaN
            impactLng = Double.NaN
        }
    }

    /** Latest speed, kept to measure delta-v across an impact. */
    fun onSpeedSample(speedMps: Float) {
        lastSpeed = speedMps
    }

    fun disarm() {
        armed = false
        drivingSince = 0L
        lastAbovePark = 0L
        resetImpact()
    }

    fun resetAfterEscalation() {
        escalated = false
        disarm()
    }

    val isArmed: Boolean get() = armed
    val hasEscalated: Boolean get() = escalated

    private var lastSpeed = 0f

    private fun resetImpact() {
        impactAt = 0L
        impactLat = Double.NaN
        impactLng = Double.NaN
        speedBeforeImpact = 0f
    }

    private fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Float {
        // haversine — pure math so the detector stays JVM-unit-testable
        val r = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLng / 2) * sin(dLng / 2)
        return (2 * r * atan2(sqrt(a), sqrt(1 - a))).toFloat()
    }

    companion object {
        // arming
        const val ARM_SPEED_MPS = 8f          // ~29 km/h — driving, not cycling
        const val ARM_DURATION_MS = 30_000L   // sustained driving before armed
        const val PARK_SPEED_MPS = 2f         // below this = not driving
        const val PARK_DURATION_MS = 60_000L

        // impact
        const val IMPACT_G = 3.5f             // |a| >= 3.5g — well above potholes/curbs
        const val FREEFALL_G = 0.4f           // brief weightlessness (tumble)
        const val DELTA_V_MIN_MPS = 5f        // ~18 km/h velocity drop across impact
        const val DELTA_V_DELAY_MS = 1_500L
        const val CONFIRM_WINDOW_MS = 10_000L

        // stillness
        const val STILLNESS_WINDOW_MS = 6_000L
        const val STILLNESS_DRIFT_M = 25f

        const val GRAVITY = 9.81f
    }
}
