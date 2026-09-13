package org.setbd.control.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted storage for the device credential issued at pairing.
 * Falls back to plain preferences on devices where the Keystore is broken,
 * so the app never becomes unusable (documented trade-off).
 */
object SecureStore {
    private const val FILE = "ac_secure"
    private const val K_TOKEN = "device_token"
    private const val K_DEVICE = "device_id"
    private const val K_PARENT = "parent_id"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context, FILE, masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            context.getSharedPreferences("${FILE}_fallback", Context.MODE_PRIVATE)
        }
    }

    var deviceToken: String?
        get() = prefs.getString(K_TOKEN, null)
        set(v) = prefs.edit().putString(K_TOKEN, v).apply()

    var deviceId: String?
        get() = prefs.getString(K_DEVICE, null)
        set(v) = prefs.edit().putString(K_DEVICE, v).apply()

    var parentId: String?
        get() = prefs.getString(K_PARENT, null)
        set(v) = prefs.edit().putString(K_PARENT, v).apply()

    val isPaired: Boolean
        get() = !deviceToken.isNullOrBlank() && !deviceId.isNullOrBlank()

    fun clear() {
        prefs.edit().clear().apply()
    }
}
