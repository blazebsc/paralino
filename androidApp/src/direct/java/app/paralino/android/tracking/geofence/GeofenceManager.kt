package app.paralino.android.tracking.geofence

import android.app.Application
import android.app.PendingIntent
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.annotation.RequiresPermission
import app.paralino.core.logg
import app.paralino.core.models.places.GroupPlaceGeofenceData
import app.paralino.android.tracking.geofence.GeofenceBroadcastReceiver.Companion.ACTION_PROXIMITY_ALERT
import app.paralino.core.repo.location.IGeofenceManager

/**
 * De-Googled place monitoring via AOSP proximity alerts
 * (LocationManager.addProximityAlert) — no Play Services involved.
 *
 * The GeofenceRegistrationMonitor calls [registerGeofences] whenever the
 * place list, sharing contracts or the "all the time" location permission
 * change, and [deleteAllGeofences] when monitoring should stop.
 *
 * AOSP proximity alerts fire a broadcast on enter/exit transitions; the
 * transitions are then processed by the same PlacesActivityProcessor the
 * location pipeline uses, so dedup and sensitivity delays all apply.
 */
class GeofenceManager(
    private val application: Application
) : IGeofenceManager {

    private val locationManager = application.getSystemService(Application.LOCATION_SERVICE) as LocationManager

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(application, GeofenceBroadcastReceiver::class.java).apply {
            action = ACTION_PROXIMITY_ALERT
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            flags = flags or PendingIntent.FLAG_MUTABLE

        PendingIntent.getBroadcast(
            application,
            0,
            intent,
            flags
        )
    }

    @RequiresPermission("android.permission.ACCESS_FINE_LOCATION")
    override fun registerGeofences(places: List<GroupPlaceGeofenceData>) {
        // one PendingIntent for all places — removing it clears every alert,
        // then we re-add the current set
        removeGeofences()

        places.forEach { place ->
            try {
                locationManager.addProximityAlert(
                    place.lat,
                    place.lng,
                    place.radiusMeters.toFloat(),
                    EXPIRATION_MS,
                    geofencePendingIntent
                )
                logg.tag("place_activity_geofence")
                    .d("Proximity alert registered for ${place.placeId} (${place.radiusMeters}m)")
            } catch (e: Exception) {
                logg.tag("place_activity_geofence")
                    .w("Error registering proximity alert for ${place.placeId}: ${e.message}")
            }
        }
        logg.tag("place_activity_geofence").i("Registered ${places.size} proximity alerts")
    }

    override fun deleteAllGeofences() {
        removeGeofences()
        logg.tag("place_activity_geofence").v("All proximity alerts removed")
    }

    @RequiresPermission("android.permission.ACCESS_FINE_LOCATION")
    private fun removeGeofences() {
        try {
            locationManager.removeProximityAlert(geofencePendingIntent)
        } catch (e: Exception) {
            logg.tag("place_activity_geofence").w("Error removing proximity alerts: ${e.message}")
        }
    }

    override fun distanceBetweenPoints(
        lat1: Double,
        lng1: Double,
        lat2: Double,
        lng2: Double
    ): Float {
        val result = FloatArray(1)
        Location.distanceBetween(lat1, lng1, lat2, lng2, result)
        return result.first()
    }

    companion object {
        // re-registered every 20h by the GeofenceRegistrationMonitor anyway;
        // a day matches the old play-store behaviour
        private const val EXPIRATION_MS = 24L * 60 * 60 * 1000
    }
}
