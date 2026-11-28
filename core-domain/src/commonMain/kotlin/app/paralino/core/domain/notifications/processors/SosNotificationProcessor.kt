package app.paralino.core.domain.notifications.processors

import app.paralino.core.db.AppPrefs
import app.paralino.core.domain.notifications.IPushNotificationPresenter
import app.paralino.core.models.base.asGroupOrSpaceId
import app.paralino.core.models.raw.PushNotificationRaw
import app.paralino.core.provider.localizedString
import app.paralino.core.repo.base.AccessLogDataSource
import app.paralino.core.repo.group.UserGroupLocalDataSource
import app.paralino.core.resources.moko.*
import app.paralino.core.utils.extensions.tryParseFromJson
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.minutes

/**
 * "sos" push docs — someone triggered the panic button or a crash was
 * detected and unconfirmed. Rendered with an alarm notification.
 */
class SosNotificationProcessor(
    private val groupRepo: UserGroupLocalDataSource,
    private val accessLogSource: AccessLogDataSource,
    private val appPrefs: AppPrefs,
) : BaseNotificationProcessor(accessLogSource) {

    override suspend fun constructPushPayload(
        push: PushNotificationRaw,
        groupRefreshHook: (suspend (GroupRefreshHookPayload) -> Unit)?
    ): IPushNotificationPresenter.Payload? {

        val payload = push.content?.tryParseFromJson<SosNotificationPayload>()
            ?: return null

        // pull fresh state so the map shows where they are right now
        try {
            groupRefreshHook?.invoke(
                GroupRefreshHookPayload(
                    groupId = payload.groupId.asGroupOrSpaceId(),
                    cacheTimeDuration = 0.minutes
                )
            )
        } catch (_: Exception) {
        }

        var name: String? = null
        try {
            name = groupRepo.getMemberNameOnce(groupId = payload.groupId, userId = payload.memberUserId)
        } catch (_: Exception) {
        }

        val title = if (name.isNullOrBlank()) {
            MR.strings.place_notification_default.localizedString()
        } else {
            MR.strings.sos_notification_title.localizedString(name)
        }

        return IPushNotificationPresenter.Payload(
            notificationId = ("sos_${payload.memberUserId}").hashCode(),
            // never grouped — SOS must stand alone and be seen
            notificationGroupId = null,
            title = title,
            message = null,
            timeMillis = push.createdAt.toEpochMilliseconds(),
            timeInfo = null,
            loggerTag = "sos_notification"
        )
    }

    @Serializable
    private data class SosNotificationPayload constructor(
        val memberUserId: String,
        val groupId: String,
        val triggerAt: String? = null
    )
}
