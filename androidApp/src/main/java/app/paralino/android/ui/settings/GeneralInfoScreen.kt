package app.paralino.android.ui.settings

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.Button
import androidx.compose.material.MaterialTheme
import androidx.compose.material.OutlinedTextField
import androidx.compose.material.Scaffold
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.paralino.android.BuildConfig
import app.paralino.android.safety.ISafetyManager
import app.paralino.android.safety.SosReason
import app.paralino.android.ui.main.MainAppState
import app.paralino.android.ui.navigation.AppScreen
import app.paralino.android.utils.extensions.contactSupport
import app.paralino.core.app_update.AppUpdateStatus
import app.paralino.core.app_update.IAppUpdateManager
import app.paralino.core.db.AppPrefs
import app.paralino.core.models.base.ConfigData
import app.paralino.core.resources.CoreAppIcons
import app.paralino.core.resources.CoreAppIcons.asPainterResource
import app.paralino.core.resources.moko.*
import app.paralino.core.presentation.settings.SettingsActionItemType
import app.paralino.core.presentation.settings.general.GeneralInfoViewModel
import app.paralino.core.ui.components.DefaultToolbar
import app.paralino.core.ui.components.SettingsActionItem
import app.paralino.core.ui.components.ToolbarButtons
import app.paralino.core.ui.settings.GeneralInfoScreenCore
import dev.icerock.moko.resources.compose.stringResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.koin.androidx.compose.koinViewModel
import org.koin.core.context.GlobalContext
import java.util.concurrent.TimeUnit

// Fork-specific: the self-hosted fork ships APKs from GitHub releases, not a
// store, so updates are a manual check against the repo's releases.
private const val RELEASES_LATEST_URL = "https://api.github.com/repos/blazebsc/whereabouts/releases/latest"
private const val RELEASES_PAGE_URL = "https://github.com/blazebsc/whereabouts/releases"
// stable asset name — every release carries an apk asset under this name
private const val LATEST_APK_URL = "https://github.com/blazebsc/whereabouts/releases/latest/download/Whereabouts-latest.apk"

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
        modifier = Modifier.safeDrawingPadding().fillMaxSize().background(MaterialTheme.colors.background),
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
        val appUpdateManager = remember { GlobalContext.get().get<IAppUpdateManager>() }
        val safetyManager = remember { GlobalContext.get().get<ISafetyManager>() }
        val appPrefs = remember { GlobalContext.get().get<AppPrefs>() }
        val updateStatus by appUpdateManager.updateState.collectAsState()
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
                // crash countdown banner: when active, SOS escalates unless cancelled
                val countdown by safetyManager.countdownState.collectAsState()
                countdown?.let { cd ->
                    SosCountdownBanner(
                        secondsLeft = cd.secondsLeft,
                        reason = cd.reason,
                        onImOk = { safetyManager.cancelCountdown() }
                    )
                }

                // hardcoded copy: fork-only rows, base-locale only by design
                val rowName = when (val status = updateStatus) {
                    is AppUpdateStatus.Downloading -> {
                        val pct = status.progress
                        if (pct != null) "Downloading… ${(pct * 100).toInt()}%"
                        else "Downloading… ${status.mb ?: ""}"
                    }
                    AppUpdateStatus.Installing -> "Installing…"
                    else -> "Check for updates"
                }
                SettingsActionItem(
                    name = rowName,
                    description = "Latest APK: github.com/blazebsc/whereabouts/releases",
                    icon = CoreAppIcons.DownloadArrow.asPainterResource(),
                    type = if (isCheckingUpdate || updateStatus !is AppUpdateStatus.Idle) {
                        SettingsActionItemType.Loading
                    } else {
                        SettingsActionItemType.Link
                    }
                ) {
                    if (isCheckingUpdate || updateStatus !is AppUpdateStatus.Idle) return@SettingsActionItem
                    isCheckingUpdate = true
                    scope.launch {
                        val remote = fetchLatestVersion()
                        isCheckingUpdate = false
                        when {
                            remote == null ->
                                Toast.makeText(context, "Couldn't reach GitHub. Check your connection.", Toast.LENGTH_SHORT).show()

                            compareVersions(BuildConfig.VERSION_NAME, remote) > 0 -> {
                                Toast.makeText(context, "Downloading update $remote…", Toast.LENGTH_SHORT).show()
                                // reuse the app's own self-update path: download with progress,
                                // then hand the apk to the system installer (PackageInstaller)
                                appUpdateManager.startUpdateProcess(
                                    ConfigData(defaultPremiumPlan = "free", androidAppUrl = LATEST_APK_URL)
                                )
                            }

                            else ->
                                Toast.makeText(context, "You're on the latest version (${BuildConfig.VERSION_NAME}).", Toast.LENGTH_SHORT).show()
                        }
                    }
                }

                SosSmsSettingsRow(
                    appPrefs = appPrefs,
                    context = context,
                    scope = scope
                )
            }
        )
    }
}

/** Red banner shown while a crash countdown is running. */
@Composable
private fun SosCountdownBanner(secondsLeft: Int, reason: SosReason, onImOk: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp)
            .background(Color(0xFFD14B28).copy(alpha = 0.12f), RoundedCornerShape(12.dp))
            .padding(16.dp)
    ) {
        Text(
            text = if (reason == SosReason.CRASH) {
                "Crash detected — SOS in ${secondsLeft}s"
            } else {
                "SOS in ${secondsLeft}s"
            },
            color = Color(0xFFD14B28),
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.subtitle1
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = if (reason == SosReason.CRASH) {
                "You haven't responded after a possible crash. Your group members will be alerted."
            } else {
                "All your group members are being alerted."
            },
            style = MaterialTheme.typography.body2
        )
        Spacer(modifier = Modifier.height(10.dp))
        Button(onClick = onImOk) {
            Text("I'm OK")
        }
    }
}

/** SOS & emergency SMS numbers editor (comma-separated), stored locally. */
@Composable
private fun SosSmsSettingsRow(appPrefs: AppPrefs, context: android.content.Context, scope: kotlinx.coroutines.CoroutineScope) {
    var showEditor by remember { mutableStateOf(false) }
    var numbers by remember { mutableStateOf(appPrefs.sosSmsNumbers) }

    SettingsActionItem(
        name = "SOS & emergency SMS",
        description = if (appPrefs.sosSmsNumbers.isBlank()) {
            "No emergency contacts set"
        } else {
            "Texts: ${appPrefs.sosSmsNumbers}"
        },
        icon = CoreAppIcons.Warning.asPainterResource(),
        type = SettingsActionItemType.Link
    ) {
        showEditor = true
    }

    if (showEditor) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { showEditor = false }) {
            Column(
                modifier = Modifier
                    .background(MaterialTheme.colors.surface, RoundedCornerShape(16.dp))
                    .padding(22.dp)
            ) {
                Text("Emergency SMS numbers", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.subtitle1)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "Comma-separated phone numbers. On SOS or a confirmed crash, each number gets a text with your location.",
                    style = MaterialTheme.typography.body2,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = numbers,
                    onValueChange = { numbers = it },
                    placeholder = { Text("+15551234567, +15557654321") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(14.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.End) {
                    TextButton(onClick = { showEditor = false }) { Text("Cancel") }
                    Spacer(modifier = Modifier.size(8.dp))
                    Button(onClick = {
                        appPrefs.sosSmsNumbers = numbers
                        showEditor = false
                        // ask for SEND_SMS so escalation can actually text
                        val activity = context as? Activity
                        if (activity != null && numbers.isNotBlank()) {
                            activity.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
                            )
                        }
                    }) { Text("Save") }
                }
            }
        }
    }
}
