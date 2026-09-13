package org.setbd.control.controls

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.R
import org.setbd.control.monitoring.UsageStatsProvider

/** Full-screen friendly overlay shown when a policy blocks the current app. */
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

        findViewById<Button>(R.id.btnClose).setOnClickListener {
            finish()
        }
    }
}
