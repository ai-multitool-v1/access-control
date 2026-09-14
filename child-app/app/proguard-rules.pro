# ─── Access Control child app — R8 / ProGuard rules ─────────────────────────
# GOAL: source protection. The distributed APK ships with class names,
# method names and package structure obfuscated ("org.setbd.control.a.b.c"),
# unused code stripped and the repackage step flattening everything into the
# root package — so decompiled code no longer reveals the app's architecture
# (pairing, policy engine, capture pipeline, allowlisted command set).
# mapping.txt (uploaded as a CI artifact) is the ONLY de-obfuscation key.

# Obfuscation hardening
-repackageclasses ''
-allowaccessmodification
# Strip source-file metadata that would reveal original file names
-keepattributes *Annotation*
-keepattributes Signature,InnerClasses,EnclosingMethod
-dontwarn org.slf4j.**

# ─── WebRTC native bindings — reflection-heavy, keep everything ────────────
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# ─── Firebase messaging (optional at runtime) ──────────────────────────────
# ChildMessagingService is a manifest component, so AGP auto-generates its
# keep rule; the SDK's own consumer rules cover the rest. No blanket keeps
# for our own packages — R8 must be free to rename ALL app code.

# Kotlin coroutines + OkHttp + security-crypto ship consumer rules of their
# own; nothing app-side is ever reached through reflection (commands are a
# Kotlin `when` over string constants), so no other keeps are needed.
