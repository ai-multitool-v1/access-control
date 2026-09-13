package org.setbd.control.pairing

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.setbd.control.R
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.ui.Clay
import org.setbd.control.ui.DashboardActivity
import org.setbd.control.util.ServiceLauncher

/** Child enters the one-time code from the parent dashboard. */
class PairingActivity : AppCompatActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pairing)

        val input = findViewById<EditText>(R.id.pairingInput)
        val button = findViewById<Button>(R.id.btnConnect)
        val error = findViewById<TextView>(R.id.pairingError)
        val progress = findViewById<ProgressBar>(R.id.pairingProgress)
        val success = findViewById<TextView>(R.id.pairingSuccess)

        Clay.applyPressAnimation(button)

        // ALREADY PAIRED? Never show the code input a second time — jump
        // straight to the dashboard. Pairing credentials live until the
        // parent unpairs the device.
        if (SecureStore.isPaired) {
            input.visibility = View.GONE
            button.text = getString(R.string.pairing_continue_dash)
            button.setOnClickListener {
                startActivity(Intent(this, DashboardActivity::class.java))
                finish()
            }
            return
        }

        button.setOnClickListener {
            val code = input.text.toString()
            error.visibility = View.GONE
            progress.visibility = View.VISIBLE
            button.isEnabled = false

            scope.launch {
                val result = withContext(Dispatchers.IO) { PairingRepository.claim(this@PairingActivity, code) }
                progress.visibility = View.GONE
                button.isEnabled = true
                if (result.ok) {
                    success.text = getString(R.string.pairing_success)
                    success.visibility = View.VISIBLE
                    Prefs.termsAccepted = true
                    ServiceLauncher.startAll(this@PairingActivity)
                    button.postDelayed({
                        startActivity(Intent(this@PairingActivity, DashboardActivity::class.java))
                        finish()
                    }, 900)
                } else {
                    error.text = result.message
                    error.visibility = View.VISIBLE
                }
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
