package org.setbd.control.monitoring

import android.content.Context
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

/**
 * OPTIONAL communications monitoring (contacts / call log / SMS), matching
 * the AirDroid Kids feature set. Every call site MUST verify the matching
 * runtime permission first (CommandProcessor does). The child grants these
 * explicitly in onboarding and can revoke them any time in system settings.
 */
object CommunicationsProvider {

    fun contactsJson(ctx: Context): JSONObject {
        val arr = JSONArray()
        try {
            ctx.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                null, null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            )?.use { c ->
                while (c.moveToNext() && arr.length() < 500) {
                    arr.put(
                        JSONObject()
                            .put("name", c.getString(0) ?: "")
                            .put("phone", c.getString(1) ?: "")
                    )
                }
            }
        } catch (e: SecurityException) {
            return JSONObject().put("error", "missing_permission")
        }
        return JSONObject().put("contacts", arr)
    }

    fun callLogsJson(ctx: Context): JSONObject {
        val arr = JSONArray()
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE,
                    CallLog.Calls.DATE,
                    CallLog.Calls.DURATION
                ),
                null, null,
                CallLog.Calls.DATE + " DESC"
            )?.use { c ->
                while (c.moveToNext() && arr.length() < 200) {
                    arr.put(
                        JSONObject()
                            .put("number", c.getString(0) ?: "")
                            .put("name", c.getString(1) ?: "")
                            .put("type", c.getInt(2))
                            .put("date", c.getLong(3))
                            .put("duration", c.getLong(4))
                    )
                }
            }
        } catch (e: SecurityException) {
            return JSONObject().put("error", "missing_permission")
        }
        return JSONObject().put("calls", arr)
    }

    fun smsJson(ctx: Context): JSONObject {
        val arr = JSONArray()
        try {
            ctx.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf(
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE,
                    Telephony.Sms.TYPE
                ),
                null, null,
                Telephony.Sms.DATE + " DESC"
            )?.use { c ->
                while (c.moveToNext() && arr.length() < 100) {
                    arr.put(
                        JSONObject()
                            .put("address", c.getString(0) ?: "")
                            .put("body", c.getString(1) ?: "")
                            .put("date", c.getLong(2))
                            .put("type", c.getInt(3))
                    )
                }
            }
        } catch (e: SecurityException) {
            return JSONObject().put("error", "missing_permission")
        }
        return JSONObject().put("sms", arr)
    }
}
