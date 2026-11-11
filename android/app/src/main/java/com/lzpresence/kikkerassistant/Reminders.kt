package com.lzpresence.kikkerassistant

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray

/**
 * Reminders for each part of the day. The web app computes them (7 days ahead) and hands the list
 * over as JSON; we keep a copy so they can be re-armed after a reboot or an app update.
 * Uses inexact alarms (a few minutes of slack), so no special "exact alarm" permission is needed.
 */
object Reminders {
    private const val PREFS = "kikker"
    private const val CHANNEL = "daily"

    fun schedule(ctx: Context, json: String) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        // cancel everything we set last time
        prefs.getString("ids", "")!!.split(',').filter { it.isNotBlank() }.forEach { id ->
            am.cancel(pending(ctx, id.toInt(), "", "", ""))
        }
        val list = try { JSONArray(json) } catch (e: Exception) { JSONArray() }
        val ids = mutableListOf<Int>()
        val now = System.currentTimeMillis()
        for (i in 0 until list.length()) {
            val r = list.getJSONObject(i)
            val at = r.getLong("at")
            if (at <= now) continue
            val id = r.getInt("id")
            am.setWindow(AlarmManager.RTC_WAKEUP, at, 5 * 60_000L, pending(ctx, id, r.optString("title"), r.optString("body"), r.optString("url")))
            ids += id
        }
        prefs.edit().putString("json", json).putString("ids", ids.joinToString(",")).apply()
    }

    /** After a reboot: re-arm whatever is still in the future. */
    fun rearm(ctx: Context) {
        val json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("json", null) ?: return
        schedule(ctx, json)
    }

    private fun pending(ctx: Context, id: Int, title: String, body: String, url: String): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java).putExtra("id", id).putExtra("title", title).putExtra("body", body).putExtra("url", url)
        return PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Morning, after work, project hour and bedtime nudges from Kikker" },
            )
        }
    }

    /** Shows a reminder. With a [url] (the morning briefing), tapping it opens that page instead of the app. */
    fun show(ctx: Context, id: Int, title: String, body: String, url: String = "") {
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(ctx)
        val target = if (url.startsWith("https://")) {
            Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } else {
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val open = PendingIntent.getActivity(ctx, id, target, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
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
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (e: SecurityException) { /* permission revoked */ }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.show(
            context, intent.getIntExtra("id", 0), intent.getStringExtra("title") ?: "Kikker",
            intent.getStringExtra("body") ?: "", intent.getStringExtra("url") ?: "",
        )
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.rearm(context)
        Focus.arm(context)
    }
}
