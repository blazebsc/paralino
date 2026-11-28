package app.paralino.android.safety

import kotlinx.coroutines.flow.StateFlow

enum class SosReason { MANUAL, CRASH }

data class SosCountdown(val secondsLeft: Int, val reason: SosReason)

interface ISafetyManager {
    /**
     * Emits a countdown while a suspected crash is pending user confirmation.
     * Null = idle. When it reaches 0 without [cancelCountdown], SOS escalates.
     */
    val countdownState: StateFlow<SosCountdown?>

    /** Manual panic trigger — skips the countdown. */
    fun triggerSos()

    /** User confirmed they're fine — cancels a pending crash escalation. */
    fun cancelCountdown()
}
