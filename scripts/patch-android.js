import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const androidAppDir = path.resolve(__dirname, "../src-tauri/gen/android/app");
const manifestPath = path.resolve(androidAppDir, "src/main/AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) {
  console.log(`[patch-android] AndroidManifest.xml not found at ${manifestPath}. Run 'tauri android init' first.`);
  process.exit(0);
}

// 1. Create network_security_config.xml to allow cleartext HTTP media
const xmlDir = path.resolve(androidAppDir, "src/main/res/xml");
if (!fs.existsSync(xmlDir)) {
  fs.mkdirSync(xmlDir, { recursive: true });
}
const netSecConfigPath = path.resolve(xmlDir, "network_security_config.xml");
const netSecConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
fs.writeFileSync(netSecConfigPath, netSecConfigContent, "utf-8");
console.log("[patch-android] Created network_security_config.xml");

// 2. Configure AndroidManifest.xml
let content = fs.readFileSync(manifestPath, "utf-8");

if (content.includes("${usesCleartextTraffic}")) {
  content = content.replace("${usesCleartextTraffic}", "true");
} else if (!content.includes("android:usesCleartextTraffic=")) {
  content = content.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
}

if (!content.includes("android:networkSecurityConfig=")) {
  content = content.replace("<application", '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
}

if (!content.includes("android:requestLegacyExternalStorage=")) {
  content = content.replace("<application", '<application\n        android:requestLegacyExternalStorage="true"');
}

// Add extra permissions cleanly before <application
const extraPermissions = [
  '    <uses-permission android:name="android.permission.INTERNET" />',
  '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />',
  '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
];

const needed = extraPermissions.filter((p) => !content.includes(p.trim()));
if (needed.length > 0) {
  content = content.replace("<application", needed.join("\n") + "\n\n    <application");
}

// Add MusicService declaration inside <application>
const serviceDeclaration = `
        <service
            android:name=".MusicService"
            android:foregroundServiceType="mediaPlayback"
            android:exported="false" />`;

if (!content.includes("android:name=\".MusicService\"")) {
  content = content.replace("</application>", `${serviceDeclaration}\n    </application>`);
}

if (!content.includes("android:windowSoftInputMode=")) {
  content = content.replace("<activity", '<activity\n            android:windowSoftInputMode="adjustResize"');
}

fs.writeFileSync(manifestPath, content, "utf-8");
console.log("[patch-android] Successfully patched AndroidManifest.xml!");

// 3. Patch build.gradle.kts for signing and manifest placeholders
const gradlePath = path.resolve(androidAppDir, "build.gradle.kts");

if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, "utf-8");
  if (!gradle.includes('signingConfigs.getByName("debug")') && gradle.includes('getByName("release") {')) {
    gradle = gradle.replace(
      'getByName("release") {',
      'getByName("release") {\n            signingConfig = signingConfigs.getByName("debug")',
    );
  }
  if (!gradle.includes('manifestPlaceholders["usesCleartextTraffic"] = "true"') && gradle.includes("defaultConfig {")) {
    gradle = gradle.replace(
      "defaultConfig {",
      'defaultConfig {\n        manifestPlaceholders["usesCleartextTraffic"] = "true"',
    );
  }
  fs.writeFileSync(gradlePath, gradle, "utf-8");
  console.log("[patch-android] Successfully configured build.gradle.kts!");
}

// 4. Helper to locate files recursively
function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

const mainActivityPath = findFileRecursive(path.resolve(androidAppDir, "src/main/java"), "MainActivity.kt");
if (mainActivityPath) {
  console.log("[patch-android] Found MainActivity at:", mainActivityPath);
  const pkgDir = path.dirname(mainActivityPath);

  // 5. Create MusicService.kt for foreground media playback service & CPU wakelock
  const musicServicePath = path.resolve(pkgDir, "MusicService.kt");
  const musicServiceContent = `package com.museek.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class MusicService : Service() {
    companion object {
        const val CHANNEL_ID = "museek_media_channel"
        const val NOTIFICATION_ID = 1002
        const val ACTION_START = "com.museek.app.ACTION_START"
        const val ACTION_STOP = "com.museek.app.ACTION_STOP"
        private var wakeLock: PowerManager.WakeLock? = null
        @Volatile
        private var isRunning = false

        fun start(context: Context) {
            if (isRunning) return
            try {
                val intent = Intent(context, MusicService::class.java).apply {
                    action = ACTION_START
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                isRunning = true
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        fun stop(context: Context) {
            if (!isRunning) return
            try {
                val intent = Intent(context, MusicService::class.java).apply {
                    action = ACTION_STOP
                }
                context.startService(intent)
                isRunning = false
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Museek:PlaybackWakeLock")
            wakeLock?.setReferenceCounted(false)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            releaseWakeLock()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()

        try {
            val notification = createNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return START_STICKY
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(12 * 60 * 60 * 1000L) // 12 hours max safety
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "后台播放服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持音乐在后台或锁屏时持续流畅播放"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
            )
        } else null

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder.setContentTitle("Museek")
            .setContentText("正在后台播放音乐")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent)
        }

        return builder.build()
    }
}
`;
  fs.writeFileSync(musicServicePath, musicServiceContent, "utf-8");
  console.log("[patch-android] Successfully created MusicService.kt at:", musicServicePath);

  // 6. Patch MainActivity.kt to hook AndroidBridge and resume timers onPause
  const mainActivityContent = `package com.museek.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView

class AndroidBridge(private val context: Context) {
    @JavascriptInterface
    fun setPlaybackActive(active: Boolean) {
        if (active) {
            MusicService.start(context)
        } else {
            MusicService.stop(context)
        }
    }
}

class MainActivity : TauriActivity() {
    private var webView: WebView? = null
    private var bridgeAdded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        applyWebViewSettings()
        webView?.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        // Ensure webview timers keep running so audio playback and next-track scheduling work in background
        webView?.resumeTimers()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyWebViewSettings()
    }

    private fun applyWebViewSettings() {
        window.decorView.post {
            configureViews(window.decorView)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureViews(view: View) {
        if (view is WebView) {
            this.webView = view
            view.settings.apply {
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                javaScriptEnabled = true
            }
            if (!bridgeAdded) {
                view.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")
                bridgeAdded = true
            }
        } else if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                configureViews(view.getChildAt(i))
            }
        }
    }
}
`;
  fs.writeFileSync(mainActivityPath, mainActivityContent, "utf-8");
  console.log("[patch-android] Successfully configured MainActivity.kt with AndroidBridge and background timer persistence!");
} else {
  console.log("[patch-android] MainActivity.kt not found yet, will be generated during init.");
}
