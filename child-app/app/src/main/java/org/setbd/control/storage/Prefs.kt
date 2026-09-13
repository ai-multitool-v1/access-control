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
}
