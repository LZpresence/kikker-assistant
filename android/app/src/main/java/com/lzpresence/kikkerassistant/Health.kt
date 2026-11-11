package com.lzpresence.kikkerassistant

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId

/**
 * Reads sleep and activity from Health Connect (Android's on-phone health store, which the
 * Fitbit app writes to). Read-only: Kikker never writes health data, and nothing leaves the phone.
 * The result is one JSON object the web app keeps in its own storage.
 */
object Health {
    val PERMISSIONS = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
    )

    /** "ok", "needs_update" (Health Connect must be installed or updated) or "unavailable". */
    fun sdkStatus(ctx: Context): String = when (HealthConnectClient.getSdkStatus(ctx)) {
        HealthConnectClient.SDK_AVAILABLE -> "ok"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "needs_update"
        else -> "unavailable"
    }

    suspend fun granted(ctx: Context): Set<String> =
        HealthConnectClient.getOrCreate(ctx).permissionController.getGrantedPermissions()

    /** Daily totals, sleep sessions and workouts for the last [days] days, plus today's heart rate. */
    suspend fun fetch(ctx: Context, days: Int): JSONObject {
        val hc = HealthConnectClient.getOrCreate(ctx)
        val have = granted(ctx)
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val first = today.minusDays((days - 1).toLong())
        val out = JSONObject().put("ok", true).put("at", System.currentTimeMillis())
        val errors = JSONArray()
        fun can(c: kotlin.reflect.KClass<out androidx.health.connect.client.records.Record>) =
            HealthPermission.getReadPermission(c) in have
        out.put("granted", JSONArray(have.map { it.substringAfterLast('.') }))

        // daily totals
        val dayRows = sortedMapOf<String, JSONObject>()
        for (i in 0 until days) dayRows[first.plusDays(i.toLong()).toString()] = JSONObject()
        val metrics = buildSet<androidx.health.connect.client.aggregate.AggregateMetric<*>> {
            if (can(StepsRecord::class)) add(StepsRecord.COUNT_TOTAL)
            if (can(ActiveCaloriesBurnedRecord::class)) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
            if (can(DistanceRecord::class)) add(DistanceRecord.DISTANCE_TOTAL)
            if (can(ExerciseSessionRecord::class)) add(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL)
            if (can(RestingHeartRateRecord::class)) add(RestingHeartRateRecord.BPM_AVG)
            if (can(HeartRateRecord::class)) { add(HeartRateRecord.BPM_AVG); add(HeartRateRecord.BPM_MIN); add(HeartRateRecord.BPM_MAX) }
        }
        if (metrics.isNotEmpty()) {
            try {
                val groups = hc.aggregateGroupByPeriod(
                    AggregateGroupByPeriodRequest(
                        metrics = metrics,
                        timeRangeFilter = TimeRangeFilter.between(first.atStartOfDay(), today.plusDays(1).atStartOfDay()),
                        timeRangeSlicer = Period.ofDays(1),
                    ),
                )
                for (g in groups) {
                    val row = dayRows[g.startTime.toLocalDate().toString()] ?: continue
                    val r = g.result
                    r[StepsRecord.COUNT_TOTAL]?.let { row.put("steps", it) }
                    r[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { row.put("kcal", Math.round(it.inKilocalories)) }
                    r[DistanceRecord.DISTANCE_TOTAL]?.let { row.put("km", Math.round(it.inKilometers * 10) / 10.0) }
                    r[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.let { row.put("exMin", it.toMinutes()) }
                    r[RestingHeartRateRecord.BPM_AVG]?.let { row.put("rhr", it) }
                    r[HeartRateRecord.BPM_AVG]?.let { row.put("hrAvg", it) }
                    r[HeartRateRecord.BPM_MIN]?.let { row.put("hrMin", it) }
                    r[HeartRateRecord.BPM_MAX]?.let { row.put("hrMax", it) }
                }
            } catch (e: Exception) { errors.put("daily totals: ${e.message}") }
        }
        out.put("days", JSONArray(dayRows.map { (d, o) -> o.put("date", d) }))

        val start = first.minusDays(1).atStartOfDay(zone).toInstant()
        val end = Instant.now()

        // sleep: one entry per session, with minutes in each stage
        val sleep = JSONArray()
        if (can(SleepSessionRecord::class)) {
            try {
                for (s in readAll(hc, SleepSessionRecord::class, start, end)) {
                    val stage = mutableMapOf("deep" to 0L, "rem" to 0L, "light" to 0L, "awake" to 0L, "asleep" to 0L)
                    for (st in s.stages) {
                        val m = Duration.between(st.startTime, st.endTime).toMinutes()
                        val k = when (st.stage) {
                            SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
                            SleepSessionRecord.STAGE_TYPE_REM -> "rem"
                            SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
                            SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "awake"
                            else -> "asleep"
                        }
                        stage[k] = stage.getValue(k) + m
                    }
                    val total = Duration.between(s.startTime, s.endTime).toMinutes()
                    val asleep = if (s.stages.isEmpty()) total else total - stage.getValue("awake")
                    sleep.put(
                        JSONObject().put("s", s.startTime.toEpochMilli()).put("e", s.endTime.toEpochMilli())
                            .put("min", asleep).put("inBed", total)
                            .put("deep", stage["deep"]).put("rem", stage["rem"]).put("light", stage["light"]).put("awake", stage["awake"])
                            .put("src", s.metadata.dataOrigin.packageName),
                    )
                }
            } catch (e: Exception) { errors.put("sleep: ${e.message}") }
        }
        out.put("sleep", sleep)

        // workouts
        val ex = JSONArray()
        if (can(ExerciseSessionRecord::class)) {
            try {
                for (s in readAll(hc, ExerciseSessionRecord::class, start, end)) {
                    ex.put(
                        JSONObject().put("s", s.startTime.toEpochMilli()).put("e", s.endTime.toEpochMilli())
                            .put("type", exerciseName(s.exerciseType)).put("title", s.title ?: "")
                            .put("src", s.metadata.dataOrigin.packageName),
                    )
                }
            } catch (e: Exception) { errors.put("workouts: ${e.message}") }
        }
        out.put("exercise", ex)

        // today's heart rate, averaged into 10-minute buckets for a small chart
        val hr = JSONArray()
        if (can(HeartRateRecord::class)) {
            try {
                val buckets = sortedMapOf<Long, MutableList<Long>>()
                val dayStart = today.atStartOfDay(zone).toInstant()
                for (r in readAll(hc, HeartRateRecord::class, dayStart, end)) {
                    for (smp in r.samples) {
                        val b = smp.time.toEpochMilli() / 600_000L * 600_000L
                        buckets.getOrPut(b) { mutableListOf() }.add(smp.beatsPerMinute)
                    }
                }
                for ((t, v) in buckets) hr.put(JSONArray().put(t).put(v.average().toLong()))
            } catch (e: Exception) { errors.put("heart rate: ${e.message}") }
        }
        out.put("hr", hr)
        out.put("errors", errors)
        return out
    }

    private suspend fun <T : androidx.health.connect.client.records.Record> readAll(
        hc: HealthConnectClient, type: kotlin.reflect.KClass<T>, start: Instant, end: Instant,
    ): List<T> {
        val all = mutableListOf<T>()
        var token: String? = null
        do {
            val resp = hc.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(start, end), pageToken = token))
            all += resp.records
            token = resp.pageToken
        } while (token != null && all.size < 5000)
        return all
    }

    private fun exerciseName(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "Bike ride"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Indoor bike"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "Run"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Treadmill"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walk"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hike"
        ExerciseSessionRecord.EXERCISE_TYPE_MARTIAL_ARTS -> "Martial arts"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "Strength"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Weights"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Swim"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
        else -> "Workout"
    }
}
