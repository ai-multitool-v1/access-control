import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // google-services is applied ONLY when google-services.json exists.
    // Drop your Firebase config file into child-app/app/ to enable FCM push wake-ups.
    // The app builds and runs without it (WebSocket-first; FCM is optional).
}

// Real deployed endpoints are the DEFAULT so every build (CI, Termux, local)
// produces a working APK. Override with -PAC_API_BASE=... / -PAC_WS_BASE=...
// or env vars AC_API_BASE / AC_WS_BASE if you redeploy under a different name.
val DEFAULT_API_BASE = "https://access-control-api.ai-multitools.workers.dev"
val apiBase: String = (project.findProperty("AC_API_BASE") as String?)
    ?: System.getenv("AC_API_BASE")
    ?: DEFAULT_API_BASE
val wsBase: String = (project.findProperty("AC_WS_BASE") as String?)
    ?: System.getenv("AC_WS_BASE")
    ?: apiBase.replace("https://", "wss://")

android {
    namespace = "org.setbd.control"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.setbd.control"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "1.1.1"
        buildConfigField("String", "API_BASE", "\"$apiBase\"")
        buildConfigField("String", "WS_BASE", "\"$wsBase\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
        viewBinding = false
    }
    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Maintained Google-WebRTC prebuilt (unified plan, Camera2, screen capture)
    implementation("io.getstream:stream-webrtc-android:1.1.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // FCM (optional at runtime — activated by google-services.json presence)
    implementation("com.google.firebase:firebase-messaging:24.0.0")
}

// Apply the google-services plugin last, only if the config file exists.
val googleServicesFile = file("google-services.json")
if (googleServicesFile.exists()) {
    apply(plugin = "com.google.gms.google-services")
    logger.lifecycle("FCM enabled: google-services.json found.")
} else {
    logger.lifecycle("FCM disabled: google-services.json not found (WebSocket-first mode).")
}
