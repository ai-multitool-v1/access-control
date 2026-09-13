package org.setbd.control.controls

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.R
import org.setbd.control.monitoring.UsageStatsProvider

/**
 * Full-screen overlay shown when a policy blocks the current app. When the
 * parent attached a custom picture to the restriction, it is displayed above
 * the message (base64 JPEG/PNG, decoded defensively).
 */
class BlockActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_block)

        val pkg = intent.getStringExtra("package") ?: ""
        val reason = intent.getStringExtra("reason").orEmpty()

        val pm = packageManager
        val label = try {
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: Exception) {
            "this app"
        }

        findViewById<TextView>(R.id.blockApp).text = label
        findViewById<TextView>(R.id.blockReason).text =
            if (reason.isBlank()) getString(R.string.block_subtitle) else "$reason — ${getString(R.string.block_subtitle)}"

        val used = UsageStatsProvider.minutesForPackage(this, pkg)
        findViewById<TextView>(R.id.blockStats).text = getString(R.string.block_used_today, used)

        // Parent's custom picture (text + photo overlay from the dashboard).
        val img = findViewById<ImageView>(R.id.blockImage)
        val b64 = PolicyEngine.restrictionFor(pkg)?.optString("overlay_image").orEmpty()
        val decoded = decodeDataImage(b64)
        if (decoded != null) {
            img.setImageBitmap(decoded)
            img.visibility = View.VISIBLE
            findViewById<TextView>(R.id.blockTitle).visibility = View.GONE
        }

        findViewById<Button>(R.id.btnClose).setOnClickListener {
            finish()
        }
    }

    private fun decodeDataImage(dataUri: String): Bitmap? {
        if (!dataUri.startsWith("data:image/")) return null
        val comma = dataUri.indexOf(',')
        if (comma <= 0 || comma >= dataUri.length - 1) return null
        return try {
            val raw = Base64.decode(dataUri.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(raw, 0, raw.size)
        } catch (e: Exception) {
            null
        }
    }
}
