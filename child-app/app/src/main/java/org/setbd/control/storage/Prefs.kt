package org.setbd.control.storage

import android.content.Context
import android.content.SharedPreferences

/** Non-sensitive preferences: onboarding flags, icon state, cached policies. */
object Prefs {
    private const val FILE = "ac_prefs"
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    var termsAccepted: Boolean
        get() = prefs.getBoolean("terms_accepted", false)
        set(v) = prefs.edit().putBoolean("terms_accepted", v).apply()

    var permissionsShown: Boolean
        get() = prefs.getBoolean("permissions_shown", false)
        set(v) = prefs.edit().putBoolean("permissions_shown", v).apply()

    var iconHidden: Boolean
        get() = prefs.getBoolean("icon_hidden", false)
        set(v) = prefs.edit().putBoolean("icon_hidden", v).apply()

    var fcmToken: String?
        get() = prefs.getString("fcm_token", null)
        set(v) = prefs.edit().putString("fcm_token", v).apply()

    var cachedPoliciesJson: String?
        get() = prefs.getString("cached_policies", null)
        set(v) = prefs.edit().putString("cached_policies", v).apply()

    var cachedRestrictionsJson: String?
        get() = prefs.getString("cached_restrictions", null)
        set(v) = prefs.edit().putString("cached_restrictions", v).apply()

    var cachedZonesJson: String?
        get() = prefs.getString("cached_zones", null)
        set(v) = prefs.edit().putString("cached_zones", v).apply()

    /** Parent's location-monitoring toggle, synced from /api/child/policies. */
    var locationEnabled: Boolean
        get() = prefs.getBoolean("location_enabled", false)
        set(v) = prefs.edit().putBoolean("location_enabled", v).apply()

    /** Last FCM token successfully POSTed to the worker (avoid duplicate syncs). */
    var fcmSyncedToken: String?
        get() = prefs.getString("fcm_synced_token", null)
        set(v) = prefs.edit().putString("fcm_synced_token", v).apply()

    /** Epoch ms until which uninstalling is allowed (parent-approved window). */
    var uninstallGraceUntil: Long
        get() = prefs.getLong("uninstall_grace_until", 0L)
        set(v) = prefs.edit().putLong("uninstall_grace_until", v).apply()

    /**
     * Epoch ms of the last "protection expired" notification. One nag per
     * grace window only — never repeat the same allow prompt on broadcasts.
     */
    var uninstallReArmNotifiedAt: Long
        get() = prefs.getLong("uninstall_rearm_notified_at", 0L)
        set(v) = prefs.edit().putLong("uninstall_rearm_notified_at", v).apply()

    // ---------- browser history capture (BrowserCapture) ----------

    /** Capped JSON queue of captured URLs / search terms awaiting upload. */
    var browserQueueJson: String?
        get() = prefs.getString("browser_queue", null)
        set(v) = prefs.edit().putString("browser_queue", v).apply()

    fun browserQueueCount(): Int = browserQueueJson?.let {
        try { org.json.JSONArray(it).length() } catch (e: Exception) { 0 }
    } ?: 0

    /** Parent config: flag adult/NSFW sites in the browsing view. */
    var nsfwEnabled: Boolean
        get() = prefs.getBoolean("nsfw_enabled", true)
        set(v) = prefs.edit().putBoolean("nsfw_enabled", v).apply()

    /** Parent config: hard-block adult/NSFW sites with the block screen. */
    var nsfwBlock: Boolean
        get() = prefs.getBoolean("nsfw_block", false)
        set(v) = prefs.edit().putBoolean("nsfw_block", v).apply()

    /** Parent config: extra comma/line separated NSFW domains. */
    var nsfwDomains: String?
        get() = prefs.getString("nsfw_domains", null)
        set(v) = prefs.edit().putString("nsfw_domains", v).apply()
}
