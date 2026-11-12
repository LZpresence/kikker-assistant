package com.lzpresence.kikkerassistant

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * "Now playing": with Notification access on, Android lets Kikker see the media sessions that
 * YouTube, podcast and music apps publish (title and channel of what's playing, the same info as
 * the lock screen). We only read those; notifications themselves are ignored.
 * Each play is kept as {p: app, t: title, c: channel, s, e, off: screen was off} for 21 days, on this phone.
 */
class MediaWatch : NotificationListenerService() {
    private val h = Handler(Looper.getMainLooper())
    private var msm: MediaSessionManager? = null
    private val watched = HashMap<SessionKey, Pair<MediaController, MediaController.Callback>>()

    private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> update(list ?: emptyList()) }

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = Media.screenChanged(c)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        val m = getSystemService(MediaSessionManager::class.java) ?: return
        msm = m
        val me = ComponentName(this, MediaWatch::class.java)
        try {
            m.addOnActiveSessionsChangedListener(sessions, me, h)
            update(m.getActiveSessions(me))
        } catch (e: SecurityException) { return }
        val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON) }
        ContextCompat.registerReceiver(this, screen, f, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onListenerDisconnected() {
        try { msm?.removeOnActiveSessionsChangedListener(sessions) } catch (e: Exception) { /* gone */ }
        try { unregisterReceiver(screen) } catch (e: Exception) { /* not registered */ }
        watched.values.forEach { (c, cb) -> try { c.unregisterCallback(cb) } catch (e: Exception) { /* gone */ } }
        watched.clear()
        Media.closeAll(this)
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) { /* not used: we only read media sessions */ }

    private fun update(list: List<MediaController>) {
        val keys = list.map { SessionKey(it) }.toSet()
        for (k in watched.keys.filter { it !in keys }) {
            watched.remove(k)?.let { (c, cb) -> try { c.unregisterCallback(cb) } catch (e: Exception) { /* gone */ }; Media.stop(this, c.packageName) }
        }
        for (c in list) {
            val k = SessionKey(c)
            if (k in watched) continue
            val cb = object : MediaController.Callback() {
                override fun onPlaybackStateChanged(state: PlaybackState?) = Media.state(this@MediaWatch, c)
                override fun onMetadataChanged(metadata: MediaMetadata?) = Media.state(this@MediaWatch, c)
                override fun onSessionDestroyed() = Media.stop(this@MediaWatch, c.packageName)
            }
            try { c.registerCallback(cb, h) } catch (e: Exception) { continue }
            watched[k] = c to cb
            Media.state(this, c)
        }
    }
}

/** A media session, as a map key. */
data class SessionKey(val pkg: String, val token: Int) {
    constructor(c: MediaController) : this(c.packageName, c.sessionToken.hashCode())
}

object Media {
    private const val FILE = "media.json"
    private const val KEEP_MS = 21L * 24 * 3600_000L
    private class Open(val pkg: String, val title: String, val channel: String, val start: Long, val off: Boolean)
    private val open = HashMap<String, Open>()

    fun hasAccess(ctx: Context) = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    private fun screenOff(ctx: Context) = ctx.getSystemService(PowerManager::class.java)?.isInteractive == false

    @Synchronized
    fun state(ctx: Context, c: MediaController) {
        val pkg = c.packageName
        val playing = c.playbackState?.state == PlaybackState.STATE_PLAYING
        val md = c.metadata
        val title = (md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)).orEmpty().trim()
        val channel = (md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
            ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)).orEmpty().trim()
        val now = System.currentTimeMillis()
        val cur = open[pkg]
        if (playing && title.isNotEmpty()) {
            if (cur != null && cur.title == title.take(200) && cur.channel == channel.take(100)) return
            if (cur != null) close(ctx, pkg, now)
            open[pkg] = Open(pkg, title.take(200), channel.take(100), now, screenOff(ctx))
        } else if (cur != null) close(ctx, pkg, now)
    }

    @Synchronized
    fun stop(ctx: Context, pkg: String) = close(ctx, pkg, System.currentTimeMillis())

    /** Screen on/off: split what's playing, so we can tell watching from listening. */
    @Synchronized
    fun screenChanged(ctx: Context) {
        val now = System.currentTimeMillis(); val off = screenOff(ctx)
        for (o in open.values.toList()) {
            if (o.off == off) continue
            close(ctx, o.pkg, now)
            open[o.pkg] = Open(o.pkg, o.title, o.channel, now, off)
        }
    }

    @Synchronized
    fun closeAll(ctx: Context) { val now = System.currentTimeMillis(); open.keys.toList().forEach { close(ctx, it, now) } }

    private fun close(ctx: Context, pkg: String, now: Long) {
        val o = open.remove(pkg) ?: return
        if (now - o.start < 15_000L) return // skip blips
        val all = read(ctx)
        all.put(item(o, now))
        val kept = JSONArray()
        for (i in 0 until all.length()) { val x = all.getJSONObject(i); if (x.optLong("e") > now - KEEP_MS) kept.put(x) }
        try { File(ctx.filesDir, FILE).writeText(kept.toString()) } catch (e: Exception) { /* storage full */ }
    }

    private fun item(o: Open, end: Long) = JSONObject().put("p", o.pkg).put("t", o.title).put("c", o.channel).put("s", o.start).put("e", end).put("off", o.off)

    private fun read(ctx: Context): JSONArray = try { JSONArray(File(ctx.filesDir, FILE).readText()) } catch (e: Exception) { JSONArray() }

    /** Plays since [from], including whatever is playing right now. */
    @Synchronized
    fun list(ctx: Context, from: Long): JSONArray {
        val out = JSONArray()
        val all = read(ctx)
        for (i in 0 until all.length()) { val x = all.getJSONObject(i); if (x.optLong("e") >= from) out.put(x) }
        val now = System.currentTimeMillis()
        open.values.filter { now - it.start >= 15_000L }.forEach { out.put(item(it, now).put("now", true)) }
        return out
    }

    /** The topic of what [pkg] is playing now, if it matches one (for nudges). */
    @Synchronized
    fun nowTopic(c: JSONObject, pkg: String): String? {
        val o = open[pkg] ?: return null
        return classify(c, o.title, o.channel)
    }

    private val notWord = Regex("[^\\p{L}\\p{N}&']+")
    private fun norm(s: String) = " " + s.lowercase().replace(notWord, " ").trim() + " "

    /** Same rules as the web app: your channel choice first, else the topic whose words match most. */
    fun classify(c: JSONObject, title: String, channel: String): String? {
        c.optJSONObject("channels")?.optString(channel)?.takeIf { it.isNotEmpty() }?.let { return if (it == "_other") null else it }
        val topics = c.optJSONArray("topics") ?: return null
        val text = norm("$title $channel")
        var best: String? = null; var bestN = 0
        for (i in 0 until topics.length()) {
            val t = topics.optJSONObject(i) ?: continue
            val words = t.optJSONArray("words") ?: continue
            var n = 0
            for (j in 0 until words.length()) {
                val w = norm(words.optString(j)).trim()
                if (w.isNotEmpty() && (text.contains(" $w ") || text.contains(" ${w}s "))) n++
            }
            if (n > bestN) { bestN = n; best = t.optString("name") }
        }
        return best
    }
}
