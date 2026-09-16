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

// Add extra permissions cleanly before <application
const extraPermissions = [
  '    <uses-permission android:name="android.permission.INTERNET" />',
  '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
];

const needed = extraPermissions.filter((p) => !content.includes(p.trim()));
if (needed.length > 0) {
  content = content.replace("<application", needed.join("\n") + "\n\n    <application");
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

// 4. Patch MainActivity.kt to configure WebView for media playback
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
  const mainActivityContent = `package com.museek.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        applyWebViewSettings()
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
            view.settings.apply {
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                javaScriptEnabled = true
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
  console.log("[patch-android] Successfully configured MainActivity.kt with media autoplay and mixed content!");
} else {
  console.log("[patch-android] MainActivity.kt not found yet, will be generated during init.");
}
