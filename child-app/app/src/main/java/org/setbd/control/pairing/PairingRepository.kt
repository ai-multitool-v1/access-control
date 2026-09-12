package org.setbd.control.pairing

import android.content.Context
import android.os.Build
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.Http

/** Exchanges a one-time pairing code for a device credential (single call). */
object PairingRepository {

    data class ClaimResult(val ok: Boolean, val message: String)

    fun claim(context: Context, code: String): ClaimResult {
        val cleaned = code.trim().uppercase().replace(Regex("[^0-9A-Z]"), "")
        if (cleaned.length != 8) return ClaimResult(false, "The code has 8 characters, e.g. 7K4P-92XM")
        val normalized = cleaned.chunked(4).joinToString("-")
        val body = JSONObject().apply {
            put("code", normalized)
            put("device", JSONObject().apply {
                put("name", Build.MODEL ?: "Child device")
                put("model", Build.MODEL ?: "")
                put("brand", Build.BRAND ?: "")
                put("androidVersion", Build.VERSION.RELEASE ?: "")
                put("appVersion", BuildConfig.VERSION_NAME)
            })
        }
        return try {
            val text = Http.post(
                "${BuildConfig.API_BASE}/api/pairing/claim",
                null, body.toString()
            )
            val res = JSONObject(text)
            SecureStore.deviceId = res.getString("deviceId")
            SecureStore.deviceToken = res.getString("deviceToken")
            SecureStore.parentId = res.optString("parentId", null)
            ClaimResult(true, "Paired successfully")
        } catch (e: Http.HttpException) {
            val msg = when (e.code) {
                "invalid_code" -> "This code is invalid or already used"
                "expired_code" -> "This code has expired. Ask your parent for a new one."
                "rate_limited" -> "Too many attempts. Please wait an hour."
                else -> "Pairing failed. Please try again."
            }
            ClaimResult(false, msg)
        } catch (e: Exception) {
            ClaimResult(false, "Cannot reach the server. Check the connection.")
        }
    }
}
