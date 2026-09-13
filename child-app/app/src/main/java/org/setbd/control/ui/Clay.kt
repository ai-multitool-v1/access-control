package org.setbd.control.ui

import android.view.View
import android.view.animation.AnimationUtils

/** Claymorphism helpers: tactile press animations (scale down, spring back). */
object Clay {

    fun applyPressAnimation(view: View) {
        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> v.animate()
                    .scaleX(0.95f).scaleY(0.94f).setDuration(90).start()
                android.view.MotionEvent.ACTION_UP,
                android.view.MotionEvent.ACTION_CANCEL -> v.animate()
                    .scaleX(1f).scaleY(1f).setDuration(140)
                    .setInterpolator(android.view.animation.OvershootInterpolator(1.6f))
                    .start()
            }
            // Don't consume — onClick still fires.
            false
        }
    }

    fun applyLoadAnimation(view: View, delayOffset: Int = 0) {
        val ctx = view.context
        val anim = AnimationUtils.loadAnimation(ctx, android.R.anim.fade_in)
        anim.startOffset = delayOffset.toLong()
        view.startAnimation(anim)
    }
}
