package app.paralino.android.tracking.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import app.paralino.core.logg
import app.paralino.core.repo.places.PlaceActivityTriggerType
import app.paralino.core.repo.places.PlacesActivityProcessor
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

/**
 * Receives AOSP proximity alerts (LocationManager.addProximityAlert) for
 * monitored places and feeds the same place-activity pipeline the location
 * trigger uses. De-Googled replacement for the Play Services geofence.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    private val receiver: GeofenceReceiver by lazy { GeofenceReceiver() }

    override fun onReceive(context: Context?, intent: Intent?) {
        intent ?: return
        context ?: return

        if (intent.action != ACTION_PROXIMITY_ALERT) {
            logg.v("place_activity_geofence", "Not a proximity alert: ${intent.action}")
            return
        }

        val placeIds = intent.getStringArrayExtra(EXTRA_PLACE_IDS)?.toList().orEmpty()
        if (placeIds.isEmpty()) {
            logg.v("place_activity_geofence", "Proximity alert without place ids")
            return
        }

        val isEntering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)

        logg.i("place_activity_geofence", "Proximity alert: ${if (isEntering) "enter" else "exit"} ${placeIds.size} places")

        val pending = goAsync()
        try {
            if (isEntering) {
                receiver.notifyPlaceEnter(placeIds)
            } else {
                receiver.notifyPlaceExit(placeIds)
            }
        } finally {
            // the processor runs on its own scope — finish the broadcast immediately
            pending.finish()
        }
    }

    companion object {
        const val EXTRA_PLACE_IDS = "place_ids"
        const val ACTION_PROXIMITY_ALERT = "android.location.PROXIMITY_ALERT"
    }
}

class GeofenceReceiver : KoinComponent {
    private val geofenceProcessor: PlacesActivityProcessor by inject()

    fun notifyPlaceEnter(placeIds: List<String>) {
        geofenceProcessor.placesEnter(
            placesIds = placeIds,
            trigger = PlaceActivityTriggerType.GOEFENCE
        )
    }

    fun notifyPlaceExit(placeIds: List<String>) {
        geofenceProcessor.placesExit(
            placesIds = placeIds,
            trigger = PlaceActivityTriggerType.GOEFENCE
        )
    }
}
