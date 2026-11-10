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

/** Kikker Assistant: the web app full screen, plus native reminders and a hand-off to the Clock app. */
class MainActivity : Activity() {
    private lateinit var web: WebView
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

        @JavascriptInterface
        fun testReminder() {
            Reminders.show(this@MainActivity, 999, "Hi from Kikker", "Reminders are working.")
        }
    }

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
