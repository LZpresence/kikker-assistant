package com.lzpresence.kikkerassistant

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Soft limits. While the screen is on, a small service watches which app is in front. When an app
 * passes its daily limit (or a drain app passes the daily drain budget), Kikker covers it with a
 * pause screen. You can close the app, or change today's limit after a short breather.
 *
 * Settings come from the web app through Focus.saveConfig:
 *   "pause": true, "pauseBudget": true, "limits": {"com.google.android.youtube": 45}, "budget": 60, "drain": [...]
 */
object Guard {
    private const val BUDGET = "_budget"

    fun limits(c: JSONObject): Map<String, Int> {
        val o = c.optJSONObject("limits") ?: return emptyMap()
        return o.keys().asSequence().associateWith { o.optInt(it) }.filterValues { it > 0 }
    }

    fun wanted(ctx: Context): Boolean {
        val c = Focus.config(ctx)
        if (!c.optBoolean("pause") || !Focus.hasAccess(ctx) || !Settings.canDrawOverlays(ctx)) return false
        return limits(c).isNotEmpty() || (c.optBoolean("pauseBudget") && c.optInt("budget") > 0 && Focus.drainSet(ctx).isNotEmpty())
    }

    /** Starts or stops the watcher to match the settings. */
    fun sync(ctx: Context) {
        val i = Intent(ctx, GuardService::class.java)
        try { if (wanted(ctx)) ContextCompat.startForegroundService(ctx, i) else ctx.stopService(i) } catch (e: Exception) { /* not allowed right now */ }
    }

    /* Extra minutes granted today, per app (or BUDGET), reset each day. */
    private fun extras(ctx: Context): JSONObject {
        val p = Focus.prefs(ctx)
        val o = try { JSONObject(p.getString("extra", "{}")!!) } catch (e: Exception) { JSONObject() }
        return if (o.optString("date") == Focus.ymd(System.currentTimeMillis())) o else JSONObject().put("date", Focus.ymd(System.currentTimeMillis()))
    }
    fun extra(ctx: Context, key: String) = extras(ctx).optInt(key, 0)

    fun grant(ctx: Context, key: String, pkg: String, minutes: Int, kind: String) {
        val o = extras(ctx).apply { put(key, optInt(key, 0) + minutes) }
        val p = Focus.prefs(ctx)
        val log = try { JSONArray(p.getString("passes", "[]")) } catch (e: Exception) { JSONArray() }
        log.put(JSONObject().put("at", System.currentTimeMillis()).put("pkg", pkg).put("add", minutes).put("kind", kind).put("budget", key == BUDGET))
        val trimmed = JSONArray(); for (i in maxOf(0, log.length() - 80) until log.length()) trimmed.put(log.get(i))
        p.edit().putString("extra", o.toString()).putString("passes", trimmed.toString()).apply()
    }

    /** Times you changed a limit (or closed the app at the pause screen), since [from]. */
    fun passes(ctx: Context, from: Long): JSONArray {
        val log = try { JSONArray(Focus.prefs(ctx).getString("passes", "[]")) } catch (e: Exception) { JSONArray() }
        val out = JSONArray()
        for (i in 0 until log.length()) { val x = log.getJSONObject(i); if (x.optLong("at") >= from) out.put(x) }
        return out
    }

    class Over(val key: String, val pkg: String, val used: Int, val limit: Int, val budget: Boolean)

    /** Is [pkg] over its limit (or the drain budget)? [today] maps each app to today's minutes. */
    fun over(ctx: Context, c: JSONObject, pkg: String, today: Map<String, Double>): Over? {
        limits(c)[pkg]?.let { lim ->
            val used = today[pkg] ?: 0.0
            val allowed = lim + extra(ctx, pkg)
            if (used >= allowed) return Over(pkg, pkg, used.toInt(), allowed, false)
        }
        val budget = c.optInt("budget")
        if (c.optBoolean("pauseBudget") && budget > 0) {
            val drain = Focus.drainSet(ctx)
            if (pkg in drain) {
                val used = today.filterKeys { it in drain }.values.sum()
                val allowed = budget + extra(ctx, BUDGET)
                if (used >= allowed) return Over(BUDGET, pkg, used.toInt(), allowed, true)
            }
        }
        return null
    }
}

class GuardService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private var cur: String? = null
    private var since = 0L        // when `cur` came to the front
    private var last = 0L         // events read up to here
    private var cache: Map<String, Double> = emptyMap()
    private var cacheAt = 0L
    private var cacheDay = ""
    private var shownAt = 0L
    private var running = false

    private val tick = object : Runnable {
        override fun run() {
            try { check() } catch (e: Exception) { /* keep watching */ }
            if (running) h.postDelayed(this, 4000)
        }
    }

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action == Intent.ACTION_SCREEN_OFF) stop() else start()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Limits watcher", NotificationManager.IMPORTANCE_MIN)
                .apply { description = "Shown while Kikker keeps your app limits. You can hide this channel." })
        }
        val open = PendingIntent.getActivity(this, 7101,
            Intent(this, MainActivity::class.java).putExtra("tab", "focus").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Kikker is keeping your limits")
            .setContentText("Tap to see your screen time")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        ServiceCompat.startForeground(this, NOTE_ID, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON) }
        ContextCompat.registerReceiver(this, screen, f, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Guard.wanted(this)) { stopSelf(); return START_NOT_STICKY }
        cacheAt = 0L // settings may have changed
        start()
        return START_STICKY
    }

    private fun start() { if (!running) { running = true; h.removeCallbacks(tick); h.post(tick) } }
    private fun stop() { running = false; h.removeCallbacks(tick) }

    override fun onDestroy() {
        stop()
        try { unregisterReceiver(screen) } catch (e: Exception) { /* not registered */ }
        super.onDestroy()
    }

    private fun check() {
        val now = System.currentTimeMillis()
        val usm = getSystemService(UsageStatsManager::class.java) ?: return
        val ev = usm.queryEvents(if (last == 0L) now - 3 * 3600_000L else last - 2000, now)
        val e = UsageEvents.Event()
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) { if (cur != e.packageName) { cur = e.packageName; since = e.timeStamp } }
            else if (e.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND && cur == e.packageName) cur = null
        }
        last = now
        val p = cur ?: return
        if (p == packageName || now - shownAt < 5000) return
        val c = Focus.config(this)
        if (Guard.limits(c)[p] == null && p !in Focus.drainSet(this)) return

        // Today's minutes per app: re-read at most once a minute, plus the time the current app has been in front since then.
        val day = Focus.ymd(now)
        if (now - cacheAt > 60_000L || day != cacheDay) {
            cache = Focus.spans(this, Focus.midnight(now), now).groupBy { it.pkg }.mapValues { (_, v) -> v.sumOf { it.e - it.s } / Focus.MIN.toDouble() }
            cacheAt = now; cacheDay = day
        }
        val today = cache.toMutableMap()
        today[p] = (today[p] ?: 0.0) + (now - maxOf(cacheAt, since)).coerceAtLeast(0L) / Focus.MIN.toDouble()

        val o = Guard.over(this, c, p, today) ?: return
        shownAt = now
        startActivity(Intent(this, PauseActivity::class.java)
            .putExtra("key", o.key).putExtra("pkg", o.pkg).putExtra("used", o.used).putExtra("limit", o.limit).putExtra("budget", o.budget)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }

    companion object {
        private const val CHANNEL = "guard"
        private const val NOTE_ID = 7100
    }
}

/** The pause screen over an app that's past its limit. */
class PauseActivity : Activity() {
    private var timer: CountDownTimer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val key = intent.getStringExtra("key") ?: run { finish(); return }
        val pkg = intent.getStringExtra("pkg") ?: key
        val used = intent.getIntExtra("used", 0)
        val limit = intent.getIntExtra("limit", 0)
        val budget = intent.getBooleanExtra("budget", false)
        val name = Focus.label(this, pkg)

        val fg = Color.parseColor("#eaf1f7"); val dim = Color.parseColor("#8fa6ba"); val accent = Color.parseColor("#f0a24c")
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
        fun text(s: String, size: Float, color: Int = fg, bold: Boolean = false) = TextView(this).apply {
            text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(6), 0, dp(6))
        }
        fun button(s: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = s; isAllCaps = false; textSize = 16f
            setTextColor(if (primary) Color.parseColor("#14202b") else fg)
            background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(if (primary) accent else Color.parseColor("#16283a")); if (!primary) setStroke(dp(1), Color.parseColor("#223241")) }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(10) }
            setOnClickListener { onClick() }
        }

        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(56), dp(24), dp(32)) }
        col.addView(text(if (budget) "That's your drain time for today" else "Time's up for $name", 28f, bold = true))
        col.addView(text(if (budget) "You set $limit minutes a day for your drain apps, and you've had $used. You're on $name."
            else "You set $limit minutes a day for $name, and you've had $used.", 17f))
        val idea = try { Focus.idea(this, Focus.config(this)) } catch (e: Exception) { "" }
        if (idea.isNotBlank()) {
            col.addView(TextView(this).apply {
                text = idea; textSize = 17f; setTextColor(fg)
                setPadding(dp(16), dp(14), dp(16), dp(14))
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.parseColor("#3a2a17")) }
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14); bottomMargin = dp(6) }
            })
        }
        col.addView(button("Close $name", true) { Guard.grant(this, key, pkg, 0, "closed"); goHome() })

        col.addView(text("Still want it? Change today's limit:", 15f, dim).apply { setPadding(0, dp(28), 0, 0) })
        val wait = text("", 14f, dim)
        col.addView(wait)
        val extras = listOf(
            button("10 more minutes", false) { grant(key, pkg, 10, "extend") },
            button("30 more minutes", false) { grant(key, pkg, 30, "extend") },
            button("Just listening (30 minutes)", false) { grant(key, pkg, 30, "listening") },
        )
        extras.forEach { it.isEnabled = false; it.alpha = 0.4f; col.addView(it) }
        col.addView(text("Only listening? Lock your screen. Kikker doesn't count time with the screen off.", 13f, dim).apply { setPadding(0, dp(18), 0, 0) })

        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#0d1720")); addView(col) })

        // A short breather before the limit can be changed.
        timer = object : CountDownTimer(10_000L, 250L) {
            override fun onTick(left: Long) { wait.text = "Take a breath… ${(left + 999) / 1000}" }
            override fun onFinish() { wait.text = "Your call."; extras.forEach { it.isEnabled = true; it.alpha = 1f } }
        }.start()
    }

    private fun grant(key: String, pkg: String, minutes: Int, kind: String) {
        Guard.grant(this, key, pkg, minutes, kind)
        finish() // back to the app
    }

    private fun goHome() {
        try { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { /* no launcher */ }
        finish()
    }

    @Deprecated("Back on the pause screen goes home, not back into the app")
    override fun onBackPressed() {
        goHome()
        @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() { timer?.cancel(); super.onDestroy() }
}
