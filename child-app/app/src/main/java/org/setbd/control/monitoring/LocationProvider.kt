package org.setbd.control.monitoring

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Location via the framework LocationManager (no Play Services dependency).
 * Never runs silently: callers must check permission + policy first.
 */
object LocationProvider {

    private fun lm(ctx: Context): LocationManager =
        ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    fun providerAvailable(ctx: Context): Boolean {
        val lm = lm(ctx)
        return lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ||
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
    }

    fun hasPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Returns a fresh-ish fix: last known if < 5 min old, else a single update (25s cap). */
    suspend fun getCurrent(ctx: Context): Location? {
        if (!hasPermission(ctx)) return null
        val lm = lm(ctx)

        val now = System.currentTimeMillis()
        val freshMs = TimeUnit.MINUTES.toMillis(5)
        val providers = listOfNotNull(
            LocationManager.NETWORK_PROVIDER,
            LocationManager.GPS_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )
        var best: Location? = null
        for (p in providers) {
            try {
                @Suppress("MissingPermission")
                val loc = lm.getLastKnownLocation(p) ?: continue
                if (now - loc.time < freshMs && (best == null || loc.accuracy < best!!.accuracy)) {
                    best = loc
                }
            } catch (e: Exception) {
                // provider unavailable on this OEM
            }
        }
        if (best != null) return best

        return withTimeoutOrNull(25_000) { requestSingle(ctx, lm) }
    }

    @Suppress("MissingPermission")
    private suspend fun requestSingle(ctx: Context, lm: LocationManager): Location? =
        suspendCancellableCoroutine { cont ->
            val listener = LocationListener { loc ->
                if (cont.isActive) cont.resume(loc)
            }
            var registered = false
            try {
                val providers = listOfNotNull(
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.GPS_PROVIDER
                )
                for (p in providers) {
                    if (lm.isProviderEnabled(p)) {
                        lm.requestSingleUpdate(p, listener, Looper.getMainLooper())
                        registered = true
                    }
                }
            } catch (e: Exception) {
                if (cont.isActive && !registered) cont.resume(null)
            }
            cont.invokeOnCancellation { try { lm.removeUpdates(listener) } catch (e: Exception) {} }
            if (!registered && cont.isActive) cont.resume(null)
        }

    suspend fun reportJson(ctx: Context): JSONObject? {
        val loc = getCurrent(ctx) ?: return null
        val iso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(java.util.Date(loc.time))
        return JSONObject()
            .put("latitude", loc.latitude)
            .put("longitude", loc.longitude)
            .put("accuracy", if (loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
            .put("recordedAt", iso)
    }
}
