package app.paralino.core.db

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.russhwolf.settings.Settings
import com.russhwolf.settings.SharedPreferencesSettings

actual class AppPrefsProvider(context: Context) {
    // commit = true: synchronous writes. The fork restarts the process right
    // after onboarding server-config changes; async apply() loses them.
    actual val userSettings: Settings = SharedPreferencesSettings(
        EncryptedSharedPreferences(context, "paralino_prefs_user", MasterKey(context)),
        commit = true
    )
    actual val appSettings: Settings = SharedPreferencesSettings(
        EncryptedSharedPreferences(context, "paralino_prefs_app", MasterKey(context)),
        commit = true
    )
}