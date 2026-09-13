package org.setbd.control.onboarding

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.R
import org.setbd.control.storage.Prefs

/** Terms & Conditions with an explicit "I Agree" control. */
class TermsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_terms)

        findViewById<TextView>(R.id.termsBody).text = getString(R.string.terms_body)

        findViewById<Button>(R.id.btnAgree).setOnClickListener {
            Prefs.termsAccepted = true
            startActivity(Intent(this, PermissionsActivity::class.java))
            finish()
        }

        findViewById<Button>(R.id.btnDecline).setOnClickListener {
            finishAffinity() // no consent → no monitoring, app closes
        }
    }
}
