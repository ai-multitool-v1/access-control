package org.setbd.control.controls

import android.content.Intent
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
 *
 * HARD BLOCK (v1.11): the only exit is the HOME screen. Tapping OK (or
 * pressing Back / swiping the overlay away) NEVER returns the child into the
 * blocked app — the previous "finish()" put the restricted app right back in
 * the foreground, so the child could keep using it with the restriction
 * active. Now the button sends the child to the launcher and the enforcer
 * re-blocks instantly if the app is opened again. Only the parent can lift a
 * restriction, from the dashboard.
 */
class BlockActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_block)
        visible = true
        applyIntentExtras()

        findViewById<Button>(R.id.btnClose).setOnClickListener {
            // Leave the blocked app for GOOD: go to the launcher, not back
            // into the app behind this screen.
            exitToHome()
        }
    }

    private fun applyIntentExtras() {
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

        // Parent-pushed overlay (force_overlay command) overrides the app label
        // and "used today" line with the parent's own text.
        val customTitle = intent.getStringExtra("custom_text")
        if (!customTitle.isNullOrBlank()) {
            findViewById<TextView>(R.id.blockApp).text = customTitle.take(300)
            findViewById<TextView>(R.id.blockStats).visibility = View.GONE
        } else {
            val used = UsageStatsProvider.minutesForPackage(this, pkg)
            findViewById<TextView>(R.id.blockStats).text = getString(R.string.block_used_today, used)
        }

        // Parent's custom picture (text + photo overlay from the dashboard).
        // Priority: extras pushed with the force_overlay command, then the
        // saved restriction record for the blocked package.
        val img = findViewById<ImageView>(R.id.blockImage)
        val b64 = intent.getStringExtra("custom_image_b64")
            ?: PolicyEngine.restrictionFor(pkg)?.optString("overlay_image").orEmpty()
        val decoded = decodeDataImage(b64)
        if (decoded != null) {
            img.setImageBitmap(decoded)
            img.visibility = View.VISIBLE
            findViewById<TextView>(R.id.blockTitle).visibility = View.GONE
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Reordered to front for a different blocked app — refresh the texts.
        setIntent(intent)
        applyIntentExtras()
    }

    override fun onBackPressed() {
        // Same hard rule for the Back gesture/button — never drop the child
        // back into the restricted app.
        exitToHome()
    }

    override fun onResume() {
        super.onResume()
        visible = true
    }

    override fun onPause() {
        visible = false
        super.onPause()
        // Tell the enforcer the block screen is gone so a still-foreground
        // blocked app is re-blocked on the next loop tick (no 12 s wait for
        // the natural state change).
        PolicyEnforcerService.notifyBlockDismissed()
    }

    override fun onDestroy() {
        if (visible) visible = false
        super.onDestroy()
    }

    /** Send the child to the launcher — the blocked app stays in the background. */
    private fun exitToHome() {
        try {
            val home = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            }
            startActivity(home)
        } catch (_: Exception) {
            // No launcher resolved — finish() is the only remaining option.
        }
        PolicyEnforcerService.notifyBlockDismissed()
        finish()
    }

    companion object {
        /** True while the block screen is on screen (read by PolicyEnforcerService). */
        @Volatile
        var visible: Boolean = false
            private set
    }
}
