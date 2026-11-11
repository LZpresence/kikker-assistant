plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.lzpresence.kikkerassistant"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lzpresence.kikkerassistant"
        minSdk = 26
        targetSdk = 34
        versionCode = runNumber
        versionName = "1.0.$runNumber"
    }

    // One fixed key so each new build installs over the last one.
    // The CI workflow creates kikker.p12 on its first run and commits it.
    signingConfigs {
        create("shared") {
            storeFile = file("kikker.p12")
            storePassword = "kikker"
            keyAlias = "kikker"
            keyPassword = "kikker"
            storeType = "pkcs12"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        getByName("debug") {
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // Health Connect (sleep and activity from the Fitbit app, read on the phone).
    // 1.1.0-alpha07 is the newest that builds with compileSdk 34 / Kotlin 1.9.
    implementation("androidx.health.connect:connect-client:1.1.0-alpha07")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
