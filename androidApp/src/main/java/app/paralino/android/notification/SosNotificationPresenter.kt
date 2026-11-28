package app.paralino.android.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.TaskStackBuilder
import app.paralino.android.R
import app.paralino.android.ui.main.MainActivity
import app.paralino.core.domain.notifications.ISosNotificationPresenter
import app.paralino.core.logg
import app.paralino.core.provider.InAppLogger

/**
 * SOS notifications: alarm channel (sound + vibration), never grouped,
 * CATEGORY_ALARM so they bypass Do-Not-Disturb when the user allows it.
 */
class SosNotificationPresenter(
    private val context: Context,
    inAppLogger: InAppLogger
) : ISosNotificationPresenter(inAppLogger) {

    private val channelId = "sos_channel"

    override fun showPushNotification(payload: Payload) {
        if (ActivityCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            logg.w("sos_notification", "Missing push notification permission!")
            return
        }

        val notificationManager = NotificationManagerCompat.from(context)
        registerNotificationChannel()

        val intent = Intent(context, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        val pendingIntent = TaskStackBuilder.create(context)
            .apply { addNextIntentWithParentStack(intent) }
            .getPendingIntent(
                200,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        val notification = NotificationCompat.Builder(context, channelId)
            .setContentTitle(payload.title)
            .setContentText(payload.message ?: "Tap to open Whereabouts")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(pendingIntent)
            .setSmallIcon(R.drawable.ic_notification_icon)
            .setOngoing(true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .build()

        notificationManager.notify(payload.notificationId, notification)
    }

    private fun registerNotificationChannel() {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        if (notificationManager?.getNotificationChannel(channelId) != null) {
            return
        }

        val channel = NotificationChannel(
            channelId,
            "SOS alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            setBypassDnd(true)
        }
        notificationManager?.createNotificationChannel(channel)
    }
}
