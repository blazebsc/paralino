package app.paralino.android.ui.settings

import android.widget.Toast
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import app.paralino.android.BuildConfig
import app.paralino.android.ui.main.MainAppState
import app.paralino.android.ui.navigation.AppScreen
import app.paralino.android.utils.extensions.contactSupport
import app.paralino.core.resources.moko.*
import app.paralino.core.presentation.settings.general.GeneralInfoViewModel
import app.paralino.core.resources.CoreAppIcons
import app.paralino.core.resources.CoreAppIcons.asPainterResource
import app.paralino.core.ui.components.DefaultToolbar
import app.paralino.core.ui.components.SettingsActionItem
import app.paralino.core.ui.components.ToolbarButtons
import app.paralino.core.ui.settings.GeneralInfoScreenCore
import app.paralino.core.presentation.settings.SettingsActionItemType
import dev.icerock.moko.resources.compose.stringResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.koin.androidx.compose.koinViewModel
import java.util.concurrent.TimeUnit

// Fork-specific: the self-hosted fork ships APKs from GitHub releases, not a
// store, so updates are a manual check against the repo's releases.
private const val RELEASES_LATEST_URL = "https://api.github.com/repos/blazebsc/whereabouts/releases/latest"
private const val RELEASES_PAGE_URL = "https://github.com/blazebsc/whereabouts/releases"

/** Parses "v2.7.1" / "2.7.1" into comparable ints. Returns null when unparsable. */
internal fun parseVersion(raw: String): List<Int>? {
    val parts = raw.trim().removePrefix("v").split(".")
    if (parts.isEmpty() || parts.size > 4 || parts.any { it.toIntOrNull() == null }) return null
    return parts.map { it.toInt() }
}

/** -1 when remote is older, 0 when equal, 1 when remote is newer. Unparsable remote -> -1 (stay put). */
internal fun compareVersions(local: String, remote: String): Int {
    val l = parseVersion(local) ?: return -1
    val r = parseVersion(remote) ?: return -1
    for (i in 0 until maxOf(l.size, r.size)) {
        val a = l.getOrElse(i) { 0 }
        val b = r.getOrElse(i) { 0 }
        if (a != b) return if (b > a) 1 else -1
    }
    return 0
}

/** Fetches the latest release tag from the fork's GitHub repo. Runs on IO. */
private suspend fun fetchLatestVersion(): String? = withContext(Dispatchers.IO) {
    val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()
    try {
        client.newCall(
            Request.Builder()
                .url(RELEASES_LATEST_URL)
                .header("Accept", "application/vnd.github+json")
                .get()
                .build()
        ).execute().use { response ->
            if (!response.isSuccessful) return@withContext null
            JSONObject(response.body?.string().orEmpty()).optString("tag_name").takeIf { it.isNotBlank() }
        }
    } catch (e: Exception) {
        null
    }
}

@Composable
fun GeneralInfoScreen(
    appState: MainAppState,
    vm: GeneralInfoViewModel = koinViewModel()
) {
    Scaffold(
        modifier = Modifier.safeDrawingPadding().fillMaxSize(),
        topBar = {
            DefaultToolbar(
                title = stringResource(resource = MR.strings.settings_section_general_title),
                navigationIcon = { ToolbarButtons.Back { appState.navController.popBackStack() } }
            )
        },
    ) {
        val context = LocalContext.current
        val uriHandler = LocalUriHandler.current
        val scope = rememberCoroutineScope()
        var isCheckingUpdate by remember { mutableStateOf(false) }

        GeneralInfoScreenCore(
            appState = appState,
            vm = vm,
            paddingValues = it,
            onLicencesClick = {
                appState.navController.navigate(AppScreen.Settings.Licences)
            },
            onShowOnboarding = {
                appState.navController.navigate(AppScreen.Settings.WelcomeOnboarding)
            },
            onContactSupport = {
                context.contactSupport()
            },
            extraItems = {
                // hardcoded copy: fork-only row, base-locale only by design
                SettingsActionItem(
                    name = "Check for updates",
                    description = "Latest APK: github.com/blazebsc/whereabouts/releases",
                    icon = CoreAppIcons.DownloadArrow.asPainterResource(),
                    type = if (isCheckingUpdate) SettingsActionItemType.Loading else SettingsActionItemType.Link
                ) {
                    if (isCheckingUpdate) return@SettingsActionItem
                    isCheckingUpdate = true
                    scope.launch {
                        val remote = fetchLatestVersion()
                        isCheckingUpdate = false
                        when {
                            remote == null -> Toast.makeText(context, "Couldn't reach GitHub. Check your connection.", Toast.LENGTH_SHORT).show()
                            compareVersions(BuildConfig.VERSION_NAME, remote) > 0 -> {
                                Toast.makeText(context, "Update available: $remote. Opening releases page.", Toast.LENGTH_LONG).show()
                                uriHandler.openUri(RELEASES_PAGE_URL)
                            }
                            else -> Toast.makeText(context, "You're on the latest version (${BuildConfig.VERSION_NAME}).", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        )
    }
}
