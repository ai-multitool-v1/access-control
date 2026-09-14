// GSAP animation kit — neo-brutalism motion language.
//
// Everything here is centralized so both apps (parent dashboard + SETBD
// admin console) share the same cubic-bezier eases and reveal patterns.
// Respects prefers-reduced-motion: users who ask for less motion get none.

import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

// Cubic-bezier signature eases (tuned for the hard-edged brutalist feel —
// fast start, long confident settle).
export const EASE = {
  snap: CustomEase.create('ac-snap', 'M0,0 C0.19,1 0.22,1 1,1'), // cubic-bezier(0.19,1,0.22,1)
  punch: CustomEase.create('ac-punch', 'M0,0 C0.34,1.56 0.64,1 1,1'), // overshoot
  swipe: CustomEase.create('ac-swipe', 'M0,0 C0.65,0.05 0.36,1 1,1'),
};

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const noopTl = { kill: () => {}, from: () => {}, to: () => {}, fromTo: () => {} };

/** Safe timeline — returns a no-op when the user prefers reduced motion. */
export function tl(target, vars) {
  if (prefersReducedMotion()) {
    gsap.set(target, { clearProps: 'all' });
    return noopTl;
  }
  return gsap.timeline({ ...(vars || {}), defaults: { ease: EASE.snap, ...(vars?.defaults || {}) } });
}

/**
 * Staggered reveal for a container's direct children (cards, rows, panels).
 * Usage: const ref = useRef(); useReveal(ref);  — or call revealChildren(el).
 */
export function revealChildren(el, { y = 18, duration = 0.55, stagger = 0.055, selector } = {}) {
  if (!el) return null;
  const targets = selector ? el.querySelectorAll(selector) : el.children;
  if (!targets || targets.length === 0) return null;
  if (prefersReducedMotion()) return null;
  const t = gsap.from(targets, {
    y,
    opacity: 0,
    duration,
    stagger,
    ease: EASE.snap,
    clearProps: 'transform,opacity',
  });
  return t;
}

/** React hook flavor of revealChildren — runs once after mount. */
import { useEffect, useRef } from 'react';

export function useReveal(selector, deps = []) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const t = revealChildren(el, selector ? { selector } : {});
    return () => t && t.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Modal pop-in (scale + rise, punchy overshoot). Returns a cleanup fn. */
export function modalIn(el) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(
    el,
    { scale: 0.92, y: 26, opacity: 0 },
    { scale: 1, y: 0, opacity: 1, duration: 0.42, ease: EASE.punch, clearProps: 'transform,opacity' }
  );
  return () => t.kill();
}

/** Modal / overlay exit — resolves after the animation ends. */
export function modalOut(el, { duration = 0.22 } = {}) {
  if (!el || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(el, {
      scale: 0.94,
      y: 14,
      opacity: 0,
      duration,
      ease: 'power2.in',
      onComplete: resolve,
    });
  });
}

/** Overlay backdrop fade. */
export function backdropIn(el) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out', clearProps: 'opacity' });
  return () => t.kill();
}

/** Tab strip slide-in (admin header tabs, bottom nav). */
export function slideIn(el, { x = 24, delay = 0 } = {}) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(
    el,
    { x, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.5, delay, ease: EASE.swipe, clearProps: 'transform,opacity' }
  );
  return () => t.kill();
}

/** Route transition: page content keyed by location re-runs this. */
export function pageIn(el) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(
    el,
    { y: 16, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.45, ease: EASE.snap, clearProps: 'transform,opacity' }
  );
  return () => t.kill();
}

/** Toast slide + settle (bottom-right stack). */
export function toastIn(el, fromRight = true) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(
    el,
    fromRight ? { x: 60, opacity: 0 } : { y: 40, opacity: 0 },
    { x: 0, y: 0, opacity: 1, duration: 0.5, ease: EASE.punch, clearProps: 'transform,opacity' }
  );
  return () => t.kill();
}

/** Number/counter punch for stat tiles. */
export function popIn(el) {
  if (!el || prefersReducedMotion()) return () => {};
  const t = gsap.fromTo(
    el,
    { scale: 0.85, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.45, ease: EASE.punch, clearProps: 'transform,opacity' }
  );
  return () => t.kill();
}

export { gsap };
