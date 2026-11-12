package com.lzpresence.kikkerassistant

import android.Manifest
import android.app.AlarmManager
import android.app.AppOpsManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Focus: how long each app is on screen (Android's usage access), and gentle nudges when a
 * "drain" app has had you for a while. Everything is read and kept on this phone.
 *
 * The web app labels apps and writes the rules with [saveConfig]:
 *   {"on":true, "drain":["pkg",...], "nudgeMin":20, "budget":60, "ideas":["Play guitar for 15 min", ...]}
 * A repeating alarm (every ~15 min, plus a one-off when a nudge is close) runs [check].
 */
object Focus {
    private const val PREFS = "kikker_focus"
    private const val CHANNEL = "focus"
    private const val WINDOW_MIN = 45L   // look-back for "a while on drain apps"
    private const val COOLDOWN_MIN = 40L // at most one nudge per this many minutes
    const val MIN = 60_000L

    fun hasAccess(ctx: Context): Boolean {
        val ops = ctx.getSystemService(AppOpsManager::class.java) ?: return false
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= 29) ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        else ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /* ---------- reading usage ---------- */

    class Span(val pkg: String, val s: Long, val e: Long)

    /** Foreground spans of launchable apps (not Kikker) between [from] and [to], plus app opens. */
    fun spans(ctx: Context, from: Long, to: Long, opens: MutableList<Pair<String, Long>>? = null): List<Span> {
        val usm = ctx.getSystemService(UsageStatsManager::class.java) ?: return emptyList()
        // Start a little early so an app already open at `from` is counted from `from`.
        val ev = usm.queryEvents(from - 3 * 60 * MIN, to)
        val e = UsageEvents.Event()
        val out = mutableListOf<Span>()
        val lastEnd = HashMap<String, Long>()
        var cur: String? = null
        var start = 0L
        fun close(t: Long) {
            val p = cur ?: return
            val s = maxOf(start, from); val en = minOf(t, to, start + 3 * 60 * MIN) // cap runaway spans at 3 h
            if (en > s) out += Span(p, s, en)
            lastEnd[p] = t
            cur = null
        }
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            val t = e.timeStamp
            when (e.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    val p = e.packageName
                    if (cur == p) continue
                    close(t)
                    if (opens != null && t >= from && t - (lastEnd[p] ?: 0L) > MIN) opens += p to t
                    cur = p; start = t
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> if (cur == e.packageName) close(t)
                else -> if (e.eventType == SCREEN_OFF || e.eventType == KEYGUARD_SHOWN || e.eventType == SHUTDOWN) close(t)
            }
        }
        if (cur != null) close(to)
        val keep = HashMap<String, Boolean>()
        fun launchable(p: String) = keep.getOrPut(p) { p != ctx.packageName && ctx.packageManager.getLaunchIntentForPackage(p) != null }
        opens?.retainAll { launchable(it.first) }
        return out.filter { launchable(it.pkg) }
    }

    private const val SCREEN_OFF = 16      // UsageEvents.Event.SCREEN_NON_INTERACTIVE (API 28)
    private const val KEYGUARD_SHOWN = 17  // UsageEvents.Event.KEYGUARD_SHOWN (API 28)
    private const val SHUTDOWN = 26        // UsageEvents.Event.DEVICE_SHUTDOWN (API 29)

    fun label(ctx: Context, p: String): String = try {
        ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(p, 0)).toString()
    } catch (e: Exception) { p }

    fun midnight(t: Long): Long = Calendar.getInstance().apply {
        timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    fun ymd(t: Long): String = Calendar.getInstance().run {
        timeInMillis = t; "%04d-%02d-%02d".format(get(Calendar.YEAR), get(Calendar.MONTH) + 1, get(Calendar.DAY_OF_MONTH))
    }

    /**
     * The last [days] days: per day, minutes and opens per app and minutes per hour of the day;
     * app names; and the nudges sent, each with how much drain-app time followed in the next 10 min.
     */
    fun fetch(ctx: Context, days: Int): JSONObject {
        if (!hasAccess(ctx)) return JSONObject().put("ok", false).put("access", false)
        val now = System.currentTimeMillis()
        val from = midnight(now) - (days - 1) * 24 * 60 * MIN
        val opens = mutableListOf<Pair<String, Long>>()
        val list = spans(ctx, from, now, opens)

        class Day { val min = HashMap<String, Double>(); val opens = HashMap<String, Int>(); val hours = DoubleArray(24) }
        val byDay = LinkedHashMap<String, Day>()
        var d = from
        while (d <= now) { byDay[ymd(d)] = Day(); d = midnight(d + 26 * 60 * MIN) }
        val cal = Calendar.getInstance()
        for (sp in list) {
            var s = sp.s
            while (s < sp.e) { // split at hour boundaries (and so at midnight)
                cal.timeInMillis = s
                val hourEnd = cal.apply { set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis + 60 * MIN
                val e = minOf(sp.e, hourEnd)
                val day = byDay[ymd(s)] ?: Day().also { byDay[ymd(s)] = it }
                val m = (e - s) / MIN.toDouble()
                day.min[sp.pkg] = (day.min[sp.pkg] ?: 0.0) + m
                cal.timeInMillis = s
                day.hours[cal.get(Calendar.HOUR_OF_DAY)] += m
                s = e
            }
        }
        for ((p, t) in opens) { val day = byDay[ymd(t)] ?: continue; day.opens[p] = (day.opens[p] ?: 0) + 1 }

        val names = JSONObject()
        val dayArr = JSONArray()
        for ((k, day) in byDay) {
            val apps = JSONObject()
            for (p in day.min.keys + day.opens.keys) {
                val m = day.min[p] ?: 0.0
                if (m < 0.5 && (day.opens[p] ?: 0) == 0) continue
                apps.put(p, JSONArray().put(Math.round(m * 10) / 10.0).put(day.opens[p] ?: 0))
                if (!names.has(p)) names.put(p, label(ctx, p))
            }
            dayArr.put(JSONObject().put("date", k).put("apps", apps).put("hours", JSONArray(day.hours.map { Math.round(it * 10) / 10.0 })))
        }

        // How each nudge went: drain-app minutes in the 10 minutes after it.
        val drain = drainSet(ctx)
        val nudges = JSONArray()
        val log = try { JSONArray(prefs(ctx).getString("nudges", "[]")) } catch (e: Exception) { JSONArray() }
        for (i in 0 until log.length()) {
            val n = log.getJSONObject(i)
            val t = n.getLong("at")
            if (t < from) continue
            val after = if (now - t >= 10 * MIN) list.filter { it.pkg in drain && it.e > t && it.s < t + 10 * MIN }
                .sumOf { minOf(it.e, t + 10 * MIN) - maxOf(it.s, t) } / MIN.toDouble() else -1.0
            nudges.put(JSONObject(n.toString()).put("after", Math.round(after * 10) / 10.0))
        }
        return JSONObject().put("ok", true).put("access", true).put("at", now).put("days", dayArr).put("names", names).put("nudges", nudges)
            .put("passes", Guard.passes(ctx, from)).put("overlay", android.provider.Settings.canDrawOverlays(ctx))
    }

    /* ---------- nudges ---------- */

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun config(ctx: Context): JSONObject = try { JSONObject(prefs(ctx).getString("config", "{}")!!) } catch (e: Exception) { JSONObject() }
    fun drainSet(ctx: Context): Set<String> {
        val a = config(ctx).optJSONArray("drain") ?: return emptySet()
        return (0 until a.length()).map { a.optString(it) }.toSet()
    }

    fun saveConfig(ctx: Context, json: String) {
        val c = try { JSONObject(json) } catch (e: Exception) { return }
        prefs(ctx).edit().putString("config", c.toString()).apply()
        arm(ctx)
        Guard.sync(ctx)
    }

    /** Starts (or stops) the repeating check, matching the saved settings. */
    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = checkIntent(ctx, REQ_REPEAT)
        am.cancel(pi)
        if (!config(ctx).optBoolean("on") || !hasAccess(ctx)) return
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 15 * MIN, AlarmManager.INTERVAL_FIFTEEN_MINUTES, pi)
    }

    private fun checkIntent(ctx: Context, req: Int) =
        PendingIntent.getBroadcast(ctx, req, Intent(ctx, FocusReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Called by the alarm: nudge if drain apps have had you for a while, or you just passed your daily budget. */
    fun check(ctx: Context) {
        val c = config(ctx)
        if (!c.optBoolean("on") || !hasAccess(ctx)) return
        val drain = drainSet(ctx)
        if (drain.isEmpty()) return
        val now = System.currentTimeMillis()
        val p = prefs(ctx)
        val recent = spans(ctx, now - WINDOW_MIN * MIN, now)
        val drainRecent = recent.filter { it.pkg in drain }
        val recentMin = drainRecent.sumOf { it.e - it.s } / MIN.toDouble()
        val last = recent.maxByOrNull { it.e }
        val onDrainNow = last != null && last.pkg in drain && now - last.e < 3 * MIN
        val nudgeMin = c.optInt("nudgeMin", 20).coerceIn(5, 120)

        // Daily budget: one heads-up the first time today's drain total passes it.
        val budget = c.optInt("budget", 0)
        val today = ymd(now)
        if (budget > 0 && p.getString("budgetDay", "") != today && onDrainNow) {
            val dayMin = spans(ctx, midnight(now), now).filter { it.pkg in drain }.sumOf { it.e - it.s } / MIN.toDouble()
            if (dayMin >= budget) {
                p.edit().putString("budgetDay", today).putLong("lastNudge", now).apply()
                notify(ctx, last!!.pkg, "You're past your ${budget} minutes for today",
                    "${Math.round(dayMin)} min on your drain apps so far. ${idea(ctx, c)}", now, Math.round(dayMin).toInt(), "budget")
                return
            }
        }

        if (!onDrainNow) return
        if (now - p.getLong("lastNudge", 0L) < COOLDOWN_MIN * MIN) return
        if (recentMin >= nudgeMin) {
            val top = drainRecent.groupBy { it.pkg }.maxByOrNull { (_, v) -> v.sumOf { it.e - it.s } }!!.key
            p.edit().putLong("lastNudge", now).apply()
            notify(ctx, top, "${Math.round(recentMin)} minutes on ${label(ctx, top)}", idea(ctx, c), now, Math.round(recentMin).toInt(), "session")
        } else if (recentMin >= nudgeMin - 15) {
            // Close: check again right when it would cross, instead of waiting for the next 15-minute tick.
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            am.setWindow(AlarmManager.RTC_WAKEUP, now + ((nudgeMin - recentMin) * MIN).toLong() + 30_000L, 2 * MIN, checkIntent(ctx, REQ_ONCE))
        }
    }

    /** The next idea from the list the web app sent (goals behind, project steps, hobbies), rotating. */
    fun idea(ctx: Context, c: JSONObject): String {
        val ideas = c.optJSONArray("ideas")
        if (ideas == null || ideas.length() == 0) return "Up for something better? Kikker has your goals and projects ready."
        val p = prefs(ctx)
        val i = p.getInt("ideaIdx", 0)
        p.edit().putInt("ideaIdx", i + 1).apply()
        return ideas.optString(i % ideas.length())
    }

    private fun notify(ctx: Context, pkg: String, title: String, body: String, now: Long, minutes: Int, kind: String) {
        // Keep a log (last 60) so the Focus tab can show how nudges went.
        val p = prefs(ctx)
        val log = try { JSONArray(p.getString("nudges", "[]")) } catch (e: Exception) { JSONArray() }
        log.put(JSONObject().put("at", now).put("pkg", pkg).put("min", minutes).put("kind", kind).put("text", body))
        val trimmed = JSONArray(); for (i in maxOf(0, log.length() - 60) until log.length()) trimmed.put(log.get(i))
        p.edit().putString("nudges", trimmed.toString()).apply()
        show(ctx, title, body)
    }

    fun show(ctx: Context, title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Focus nudges", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "When a drain app has had you for a while, Kikker suggests something you'd rather be doing" })
        }
        val open = PendingIntent.getActivity(ctx, REQ_OPEN,
            Intent(ctx, MainActivity::class.java).putExtra("tab", "focus").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(0xFF2F625F.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(NOTE_ID, n) } catch (e: SecurityException) { /* permission revoked */ }
    }

    /** A sample nudge, so you can see what they look like. */
    fun test(ctx: Context) {
        show(ctx, "25 minutes on your drain apps", idea(ctx, config(ctx)))
    }

    private const val REQ_REPEAT = 7001
    private const val REQ_ONCE = 7002
    private const val REQ_OPEN = 7003
    private const val NOTE_ID = 7000
}

class FocusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val r = goAsync()
        Thread {
            try { Focus.check(context) } catch (e: Exception) { /* never crash in the background */ } finally { r.finish() }
        }.start()
    }
}
