package com.lzpresence.kikkerassistant

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Kikker Assistant: the web app full screen, plus native reminders, a hand-off to the Clock app,
 *  and read-only sleep and activity from Health Connect. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView

    /* Health Connect permission screen; the result goes back to the page as kikkerHealthPermission(n). */
    private val healthAsk = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        js("window.kikkerHealthPermission && window.kikkerHealthPermission(${granted.intersect(Health.PERMISSIONS).size}, ${Health.PERMISSIONS.size})")
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null

    private fun hasLocation() =
        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Reminders.ensureChannel(this)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.setGeolocationEnabled(true)
        web.addJavascriptInterface(Bridge(), "KikkerApp")

        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                deliverTasks()
                deliverTab()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (e: Exception) { /* no browser */ }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasLocation()) {
                    callback.invoke(origin, true, false)
                } else {
                    geoCallback = callback
                    geoOrigin = origin
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_LOCATION)
                }
            }
        }

        takeTasks(intent)
        takeTab(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(URL)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    /* Briefing hand-off: kikkerassistant://add?t=...&t=... puts those tasks in today's plan. */
    private var pageReady = false
    private var pendingTasks: List<String> = emptyList()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeTasks(intent)
        deliverTasks()
        takeTab(intent)
        deliverTab()
    }

    /* A Focus nudge opens the app on the Focus tab. */
    private var pendingTab: String? = null

    private fun takeTab(i: Intent?) {
        if (i == null) return
        val t = i.getStringExtra("tab") ?: return
        if (t.matches(Regex("[a-z]{1,12}"))) pendingTab = t
        i.removeExtra("tab")
    }

    private fun deliverTab(attempt: Int = 0) {
        val t = pendingTab ?: return
        if (!pageReady) return
        web.evaluateJavascript("typeof window.kikkerOpenTab === 'function' ? (window.kikkerOpenTab('$t'), 1) : -1") { result ->
            if (result == "-1" || result == "null") { if (attempt < 20) web.postDelayed({ deliverTab(attempt + 1) }, 500) }
            else pendingTab = null
        }
    }

    private var gotEmptyLink = false

    /** Reads tasks from kikkerassistant://add/<base64 JSON>?t=...&t=... — whichever part survived the
     *  app that opened the link (some apps drop the query or the path). */
    private fun takeTasks(i: Intent?) {
        val data = i?.data ?: return
        if (data.scheme != "kikkerassistant" || data.host != "add") return
        val found = mutableListOf<String>()
        try { found += data.getQueryParameters("t") } catch (e: Exception) { /* opaque or odd uri */ }
        if (found.isEmpty()) {
            val seg = data.pathSegments.firstOrNull() ?: data.fragment
            if (!seg.isNullOrBlank()) found += decodeList(seg)
        }
        val list = found.map { it.trim().take(200) }.filter { it.isNotEmpty() }.distinct().take(20)
        if (list.isEmpty()) gotEmptyLink = true else pendingTasks = list
        i?.setData(null) // handle each link once, even if the activity is recreated
    }

    private fun decodeList(seg: String): List<String> = try {
        val json = String(android.util.Base64.decode(seg, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING), Charsets.UTF_8)
        val arr = org.json.JSONArray(json)
        (0 until arr.length()).map { arr.optString(it) }
    } catch (e: Exception) { emptyList() }

    /** Tasks copied by the briefing's "Send to Kikker" button (clipboard text starting with this tag). */
    private fun takeClipboard() {
        val cm = getSystemService(android.content.ClipboardManager::class.java) ?: return
        val text = try { cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString() } catch (e: Exception) { null } ?: return
        if (!text.startsWith(CLIP_TAG)) return
        val list = text.removePrefix(CLIP_TAG).lines().map { it.trim().take(200) }.filter { it.isNotEmpty() }.distinct().take(20)
        if (list.isNotEmpty()) pendingTasks = (pendingTasks + list).distinct()
        try { if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip() else cm.setPrimaryClip(android.content.ClipData.newPlainText("", "")) } catch (e: Exception) { /* ignore */ }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Android only lets the focused app read the clipboard, so check once we have focus.
        if (hasFocus) { takeClipboard(); deliverTasks() }
    }

    /** Hands pending tasks to the web app, retrying until its page has loaded. */
    private fun deliverTasks(attempt: Int = 0) {
        if (pendingTasks.isEmpty()) {
            if (gotEmptyLink && pageReady) {
                gotEmptyLink = false
                Toast.makeText(this, "Kikker opened, but no tasks came with the link. Use Copy list on the briefing.", Toast.LENGTH_LONG).show()
            }
            return
        }
        if (!pageReady) return
        val list = pendingTasks
        web.evaluateJavascript("typeof window.kikkerAddTasks === 'function' ? window.kikkerAddTasks(${org.json.JSONArray(list)}) : -1") { result ->
            if (result == "-1" || result == "null") {
                if (attempt < 20) web.postDelayed({ deliverTasks(attempt + 1) }, 500)
                else Toast.makeText(this, "Couldn't add the tasks yet. Try Send again.", Toast.LENGTH_LONG).show()
            } else {
                pendingTasks = pendingTasks - list.toSet()
                gotEmptyLink = false
            }
        }
    }

    /** What the web app can call as window.KikkerApp. */
    inner class Bridge {
        @JavascriptInterface
        fun setReminders(json: String) {
            Reminders.schedule(this@MainActivity, json)
        }

        @JavascriptInterface
        fun setAlarm(hour: Int, minute: Int, label: String) {
            runOnUiThread {
                val i = Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, hour)
                    .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, label)
                try {
                    startActivity(i)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Couldn't open the Clock app", Toast.LENGTH_SHORT).show()
                }
            }
        }

        /** "ok", "needs_update" or "unavailable" (no Health Connect on this phone). */
        @JavascriptInterface
        fun healthStatus(): String = Health.sdkStatus(this@MainActivity)

        /** Opens the Health Connect permission screen for Kikker's read permissions. */
        @JavascriptInterface
        fun healthConnect() {
            runOnUiThread {
                when (Health.sdkStatus(this@MainActivity)) {
                    "ok" -> healthAsk.launch(Health.PERMISSIONS)
                    "needs_update" -> openHealthConnectStore()
                    else -> Toast.makeText(this@MainActivity, "Health Connect isn't available on this phone", Toast.LENGTH_LONG).show()
                }
            }
        }

        /** Opens Health Connect's own settings (data sources, permissions, what's stored). */
        @JavascriptInterface
        fun healthSettings() {
            runOnUiThread {
                try { startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) } catch (e: Exception) { openHealthConnectStore() }
            }
        }

        /** Reads the last [days] days in the background and hands the JSON to window.kikkerHealthData(). */
        @JavascriptInterface
        fun healthFetch(days: Int) {
            lifecycleScope.launch {
                val json = withContext(Dispatchers.IO) {
                    try {
                        if (Health.sdkStatus(this@MainActivity) != "ok") JSONObject().put("ok", false).put("error", "Health Connect isn't available")
                        else Health.fetch(this@MainActivity, days.coerceIn(1, 30))
                    } catch (e: Exception) {
                        JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName)
                    }
                }
                js("window.kikkerHealthData && window.kikkerHealthData($json)")
            }
        }

        /* ---------- Focus (screen time and nudges) ---------- */

        @JavascriptInterface
        fun usageAccess(): Boolean = Focus.hasAccess(this@MainActivity)

        /** Opens Android's Usage access screen, where Kikker can be switched on. */
        @JavascriptInterface
        fun usageSettings() {
            runOnUiThread {
                val pkg = android.net.Uri.parse("package:$packageName")
                try { startActivity(Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS, pkg)) } catch (e: Exception) {
                    try { startActivity(Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS)) } catch (e2: Exception) {
                        Toast.makeText(this@MainActivity, "Open Settings > Apps > Special access > Usage access", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        /** Reads the last [days] days of app usage in the background and hands it to window.kikkerUsageData(). */
        @JavascriptInterface
        fun usageFetch(days: Int) {
            lifecycleScope.launch {
                val json = withContext(Dispatchers.IO) {
                    try { Focus.fetch(this@MainActivity, days.coerceIn(1, 28)) } catch (e: Exception) {
                        JSONObject().put("ok", false).put("access", Focus.hasAccess(this@MainActivity)).put("error", e.message ?: e.javaClass.simpleName)
                    }
                }
                js("window.kikkerUsageData && window.kikkerUsageData($json)")
            }
        }

        /** Saves the nudge rules (drain apps, minutes, ideas) and starts or stops the background check. */
        @JavascriptInterface
        fun focusConfig(json: String) = Focus.saveConfig(this@MainActivity, json)

        @JavascriptInterface
        fun focusTest() = Focus.test(this@MainActivity)

        /** "What you're watching" needs Notification access (we only read media sessions). */
        @JavascriptInterface
        fun mediaAccess(): Boolean = Media.hasAccess(this@MainActivity)

        @JavascriptInterface
        fun mediaSettings() {
            runOnUiThread {
                val cn = android.content.ComponentName(this@MainActivity, MediaWatch::class.java)
                val detail = Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, cn.flattenToString())
                try { startActivity(if (Build.VERSION.SDK_INT >= 30) detail else Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) } catch (e: Exception) {
                    try { startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) } catch (e2: Exception) {
                        Toast.makeText(this@MainActivity, "Open Settings > Notifications > Device & app notifications", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        /** Kikker's App info page (for "Allow restricted settings" on Android 13+). */
        @JavascriptInterface
        fun appInfo() {
            runOnUiThread {
                try { startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) } catch (e: Exception) { /* no settings app */ }
            }
        }

        /** Limits need "Display over other apps" so the pause screen can cover the app. */
        @JavascriptInterface
        fun overlayAccess(): Boolean = android.provider.Settings.canDrawOverlays(this@MainActivity)

        @JavascriptInterface
        fun overlaySettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:$packageName")))
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Open Settings > Apps > Special access > Display over other apps", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun testReminder() {
            Reminders.show(this@MainActivity, 999, "Hi from Kikker", "Reminders are working.")
        }
    }

    private fun openHealthConnectStore() {
        val uri = android.net.Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding")
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (e: Exception) {
            Toast.makeText(this, "Install Health Connect from the Play Store", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Location and notification prompts still use the classic callback")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) {
            geoCallback?.invoke(geoOrigin, hasLocation(), false)
            geoCallback = null
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Still the simplest back handling for a plain Activity")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    companion object {
        private const val CLIP_TAG = "kikker-tasks:\n"
        private const val HOST = "lzpresence.github.io"
        private const val URL = "https://lzpresence.github.io/kikker-assistant/"
        private const val REQ_LOCATION = 1
        private const val REQ_NOTIFY = 2
    }
}
