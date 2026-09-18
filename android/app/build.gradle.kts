import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Login do 7Eventos: vem de android/secrets.properties (fora do git)
val secrets = Properties().apply {
    val f = rootProject.file("secrets.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun secret(k: String, def: String = "") = (secrets.getProperty(k) ?: def).replace("\\", "\\\\").replace("\"", "\\\"")

android {
    namespace = "com.mike.videoteam"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mike.videoteam"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "VT_USER", "\"${secret("user")}\"")
        buildConfigField("String", "VT_PASSWORD", "\"${secret("password")}\"")
        buildConfigField("String", "VT_SEARCH", "\"${secret("search", "video")}\"")
    }

    sourceSets["main"].assets.srcDirs("src/main/assets", "../../shared")

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

kotlin {
    jvmToolchain(11)
}
