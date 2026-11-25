package app.paralino.android.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Button
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.MaterialTheme
import androidx.compose.material.OutlinedTextField
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.paralino.core.db.AppPrefs
import app.paralino.core.models.ApiServerConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Fork onboarding step: the user points the app at their own self-hosted
 * backend by entering its public URL. The backend's GET /config returns the
 * Appwrite endpoint + project id + plan config, so one URL configures
 * everything. On save the config is written to AppPrefs and the process
 * restarts so every client (Appwrite SDK, function calls) rewires to it.
 */
@Composable
fun ServerSetupScreen(
    appPrefs: AppPrefs,
    onConfigured: () -> Unit
) {
    var url by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<SetupStatus>(SetupStatus.Idle) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Connect to your server",
            style = MaterialTheme.typography.h5,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.size(8.dp))
        Text(
            text = "Enter the URL of your Whereabouts backend. " +
                "Everything else (endpoint, project, plans) is detected automatically.",
            style = MaterialTheme.typography.body2,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.size(24.dp))

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Server URL") },
            placeholder = { Text("https://your-server.example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            enabled = status !is SetupStatus.Working
        )
        Spacer(modifier = Modifier.size(16.dp))

        when (val s = status) {
            is SetupStatus.Working -> {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }

            is SetupStatus.Error -> {
                Text(
                    text = s.message,
                    color = MaterialTheme.colors.error,
                    style = MaterialTheme.typography.body2,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.size(16.dp))
                Button(
                    onClick = {
                        scope.launch {
                            status = SetupStatus.Working
                            status = connect(url, appPrefs, onConfigured)
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Retry")
                }
            }

            else -> {
                Button(
                    onClick = {
                        scope.launch {
                            status = SetupStatus.Working
                            status = connect(url, appPrefs, onConfigured)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = url.isNotBlank()
                ) {
                    Text("Connect")
                }
            }
        }
    }
}

private sealed interface SetupStatus {
    data object Idle : SetupStatus
    data object Working : SetupStatus
    data class Error(val message: String) : SetupStatus
}

/**
 * Fetches {url}/config, validates the response and persists the server
 * config. Runs on IO; must be called from a coroutine.
 */
private suspend fun connect(rawUrl: String, appPrefs: AppPrefs, onConfigured: () -> Unit): SetupStatus {
    return withContext(Dispatchers.IO) {
        val normalized = rawUrl.trim()
            .removeSuffix("/")
            .removeSuffix("/v1")
            .let { if (it.startsWith("http")) it else "https://$it" }

        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()

        try {
            val response = client.newCall(
                Request.Builder().url("$normalized/config").get().build()
            ).execute()

            response.use {
                if (!it.isSuccessful) {
                    return@withContext SetupStatus.Error(
                        "Server responded with HTTP ${it.code}. Check the URL and that your backend is running."
                    )
                }
                val body = it.body?.string().orEmpty()
                val data = JSONObject(body).optJSONObject("data")
                    ?: return@withContext SetupStatus.Error("Unexpected response from server (missing data).")

                val serverUrl = data.optString("serverUrl", "")
                val projectId = data.optString("projectId", "")
                if (serverUrl.isBlank() || projectId.isBlank()) {
                    return@withContext SetupStatus.Error(
                        "Server reachable but did not report its endpoint/project. " +
                            "Update your backend deployment to the latest version."
                    )
                }

                appPrefs.selfHostServerUrl = serverUrl
                appPrefs.selfHostProjectId = projectId
                appPrefs.selfHostPublicUrl = normalized
                // prefs write synchronously (commit=true), safe to restart now
                onConfigured()
                SetupStatus.Working // process is restarting; keep UI stable
            }
        } catch (e: Exception) {
            SetupStatus.Error("Could not reach server: ${e.message ?: "connection failed"}")
        }
    }
}
