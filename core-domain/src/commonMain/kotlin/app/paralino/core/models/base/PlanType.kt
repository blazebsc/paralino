package app.paralino.core.models.base

import app.paralino.core.resources.moko.*
import app.paralino.core.provider.localizedString
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

sealed class PlanType {
    abstract val key: String
    val name: String get() = key
    abstract val order: Int

    data object FREE : PlanType() {
        override val key: String = "free"
        override val order: Int = 10
    }

    data object SILVER : PlanType() {
        override val key: String = "silver"
        override val order: Int = 50
    }

    data object STANDARD : PlanType() {
        override val key: String = "standard"
        override val order: Int = 1000
    }

    data object PRO : PlanType() {
        override val key: String = "pro"
        override val order: Int = 2000
    }

    data object MAX : PlanType() {
        override val key: String = "max"
        override val order: Int = 3000
    }

    data class UNKNOWN(override val key: String, override val order: Int = -1) : PlanType()

    override fun hashCode(): Int {
        var result = key.hashCode()
        result = 31 * result + order
        return result
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other == null || this::class != other::class) return false

        if (other !is PlanType) return false
        if (key != other.key) return false
        if (order != other.order) return false

        return true
    }

    companion object {
        fun fromKey(
            key: String,
            order: Int = -1
        ): PlanType {
            return when (key) {
                FREE.key -> FREE
                SILVER.key -> SILVER
                STANDARD.key -> STANDARD
                PRO.key -> PRO
                MAX.key -> MAX
                else -> UNKNOWN(key = key, order = order)
            }
        }
    }
}

enum class PlanBillingPeriod(val key: String) {
    WEEKLY(key = "weekly"),
    MONTHLY(key = "monthly"),
    ANNUALLY(key = "annually"),
    ONETIME(key = "oneTime");

    val isRenewalBased: Boolean get() = this != PlanBillingPeriod.ONETIME

    companion object {
        fun fromKey(key: String): PlanBillingPeriod? {
            return values().firstOrNull { it.key == key }
        }
    }
}

enum class PlanProvider(val key: String) {
    APPLE_APP_STORE(key = "app_store"),
    GOOGLE_PLAY_STORE(key = "play_store"),
    WEB_POLAR(key = "web_polar"),
    PARALINO(key = "paralino");

    companion object {
        fun fromKey(key: String?): PlanProvider {
            return values().firstOrNull { it.key == key } ?: PARALINO
        }
    }
}

@Serializable
data class PlanConfig(
    val planType: String,
    val planOrder: Int,
    val planName: String,
    val groupsLimit: Int,
    val membersLimit: Int,
    val devicesLimit: Int,
    val personalDevicesLimit: Int,
    val placesLimit: Int,
    val personalPlacesLimit: Int,
    val privacyZonesLimit: Int,
    val historyDaysLimit: Int,
    val personalHistoryDaysLimit: Int,
    val paralinoIdsLimit: Int,
    val hasLocationRequests: Boolean,
    val hasOngoingRealtime: Boolean,
    val hasBestLocationPerformance: Boolean,
    val hasPremiumMapStyles: Boolean,
    val hasSharingAlerts: Boolean,
    val hasLowBatteryAlerts: Boolean,
    val hasPersonalSpace: Boolean,
    val isPaid: Boolean,
    val isPremium: Boolean,
    val isActive: Boolean,
    val productIds: List<String> = emptyList(),
    val productPlanIds: List<String> = emptyList(),
) {

    @Transient val planTypeEnum: PlanType = PlanType.fromKey(key = planType, order = planOrder)
    val hasUnlimitedPersonalHistory: Boolean = hasPersonalSpace && personalHistoryDaysLimit < 0
    val hasUnlimitedGroupHistory: Boolean = historyDaysLimit < 0
    val isPersonalHistoryEnabled: Boolean = hasPersonalSpace && personalHistoryDaysLimit != 0
    val isGroupHistoryEnabled: Boolean = historyDaysLimit != 0


    // hasPersonalSpace should only apply if there are no created devices/places
    // that is why we are checking for currentCount == 0
    // if device/place is already created, it should still stay active
    fun personalDevicesLimitForDisplay(currentCount: Int): Int? {
        if (!hasPersonalSpace && currentCount == 0) return null
        return personalDevicesLimit
    }

    fun personalPlacesLimitForDisplay(currentCount: Int): Int? {
        if (!hasPersonalSpace && currentCount == 0) return null
        return personalPlacesLimit.takeIf { it >= 0 }
    }

    val adjustedPlanName: String = when (planTypeEnum) {
        PlanType.SILVER -> MR.strings.paywall_silver_plan_name.localizedString()
        PlanType.FREE -> MR.strings.paywall_free_plan_name.localizedString()
        else -> planName
    }

    companion object {
        /**
         * Fork fallback plan: everything unlocked. Used when the server config
         * provides no plans. The self-hosted backend serves the same unlimited
         * plan via /config, so no limit ever trips.
         */
        val default = PlanConfig(
            planType = PlanType.FREE.key,
            planOrder = PlanType.FREE.order,
            planName = PlanType.FREE.name,
            groupsLimit = 999999,
            membersLimit = 999999,
            devicesLimit = 999999,
            personalDevicesLimit = 999999,
            placesLimit = 999999,
            personalPlacesLimit = 999999,
            privacyZonesLimit = 999999,
            historyDaysLimit = -1,
            personalHistoryDaysLimit = -1,
            paralinoIdsLimit = 999999,
            hasLocationRequests = true,
            hasOngoingRealtime = true,
            hasBestLocationPerformance = true,
            hasPremiumMapStyles = true,
            hasSharingAlerts = true,
            hasLowBatteryAlerts = true,
            hasPersonalSpace = true,
            isPaid = false,
            isPremium = false,
            isActive = true,
            productIds = listOf("free"),
            productPlanIds = listOf("free")
        )
    }
}