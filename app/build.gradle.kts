plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val appVersionName = providers.gradleProperty("VERSION_NAME").get()
val appVersionCode = providers.gradleProperty("VERSION_CODE").get().toInt()

android {
    namespace = "io.github.nik2208.fotoflash"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.nik2208.fotoflash"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        // Keystore di debug del progetto, committato apposta: gli APK di debug della CI
        // hanno sempre la stessa firma e si aggiornano senza disinstallare.
        getByName("debug") {
            storeFile = rootProject.file("signing/debug.p12")
            storeType = "pkcs12"
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        // Firma di release: solo da variabili d'ambiente (secret della CI). Se mancano,
        // la release resta non firmata e il workflow di release fallisce: niente ripiego sul debug.
        val releaseStore = System.getenv("SIGNING_KEYSTORE_FILE")
        if (!releaseStore.isNullOrBlank()) {
            create("release") {
                storeFile = file(releaseStore)
                storeType = "pkcs12"
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
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
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core-thermal"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.exifinterface)
    implementation(libs.kotlinx.coroutines.android)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
}
