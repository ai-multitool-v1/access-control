package org.setbd.control.onboarding

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.ui.DashboardActivity

/**
 * Splash: branding + animation + developer credit dialog (Telegram button).
 * Routes to the next onboarding step based on saved state.
 */
class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        val logo = findViewById<ImageView>(R.id.splashLogo)
        val title = findViewById<TextView>(R.id.splashTitle)
        val tagline = findViewById<TextView>(R.id.splashTagline)
        val credit = findViewById<TextView>(R.id.splashCredit)
        val version = findViewById<TextView>(R.id.splashVersion)

        credit.setOnClickListener { showDeveloperCredit() }
        version.text = "v${BuildConfig.VERSION_NAME}"

        AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(logo, View.ALPHA, 0f, 1f),
                ObjectAnimator.ofFloat(logo, View.SCALE_X, 0.6f, 1f),
                ObjectAnimator.ofFloat(logo, View.SCALE_Y, 0.6f, 1f),
                ObjectAnimator.ofFloat(title, View.ALPHA, 0f, 1f).setDuration(700),
                ObjectAnimator.ofFloat(tagline, View.ALPHA, 0f, 1f).setDuration(900)
            )
            duration = 900
            start()
        }

        logo.postDelayed({ route() }, 1800)
    }

    private fun route() {
        val next = when {
            !Prefs.termsAccepted -> TermsActivity::class.java
            !SecureStore.isPaired -> PairingActivity::class.java
            else -> DashboardActivity::class.java
        }
        startActivity(Intent(this, next))
        finish()
    }

    private fun showDeveloperCredit() {
        val view = layoutInflater.inflate(R.layout.dialog_developer_credit, null)
        AlertDialog.Builder(this, R.style.Theme_AccessControl)
            .setView(view)
            .setTitle(R.string.developer_credit)
            .setPositiveButton(android.R.string.ok, null)
            .show()
            .also { dialog ->
                view.findViewById<View>(R.id.btnTelegram)?.setOnClickListener {
                    runCatching {
                        startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(getString(R.string.telegram_support_url)))
                        )
                    }
                    dialog.dismiss()
                }
            }
    }
}
