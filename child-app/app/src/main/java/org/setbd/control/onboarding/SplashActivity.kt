package org.setbd.control.onboarding

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.pairing.PairingActivity
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.ui.DashboardActivity

/**
 * Splash: cyber-branded intro (developer credit + Telegram) with route-on-state.
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
        val creditBox = findViewById<View>(R.id.splashCreditBox)
        val tgButton = findViewById<View>(R.id.btnTelegram)

        val openTelegram = {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(getString(R.string.telegram_support_url)))) }
            Unit
        }
        credit.setOnClickListener { openTelegram() }
        creditBox.setOnClickListener { openTelegram() }
        tgButton.setOnClickListener { openTelegram() }
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
}
