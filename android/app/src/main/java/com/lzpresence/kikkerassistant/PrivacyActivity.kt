package com.lzpresence.kikkerassistant

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/** Shown by Health Connect when you ask why Kikker wants health data (required for the permission screen). */
class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setPadding(pad, pad, pad, pad)
            textSize = 17f
            text = "How Kikker Assistant uses your health data\n\n" +
                "Kikker reads your sleep, steps, heart rate, active calories, distance and workouts from Health Connect " +
                "to show how your sleep and activity are going, and to tick off goals like \"in bed on time\" and " +
                "\"morning exercise\" for you.\n\n" +
                "It only reads. It never writes or changes health data.\n\n" +
                "Everything stays on this phone. Kikker has no account and no server, and doesn't send your health " +
                "data anywhere.\n\n" +
                "You can turn access off at any time in Health Connect > App permissions > KikkerAssistant."
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
