# Keep Firebase messaging service entries when minifying
-keep class org.setbd.control.notifications.** { *; }
-keep class org.setbd.control.diagnostics.** { *; }
-dontwarn org.slf4j.**

# WebRTC native bindings — reflection-heavy, keep everything
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
