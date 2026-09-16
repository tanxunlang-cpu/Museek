import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(
  __dirname,
  "../src-tauri/gen/android/app/src/main/AndroidManifest.xml",
);

if (!fs.existsSync(manifestPath)) {
  console.log(`[patch-android] AndroidManifest.xml not found at ${manifestPath}. Run 'tauri android init' first.`);
  process.exit(0);
}

let content = fs.readFileSync(manifestPath, "utf-8");

// 1. Configure usesCleartextTraffic safely without creating duplicate XML attributes
if (content.includes("${usesCleartextTraffic}")) {
  content = content.replace("${usesCleartextTraffic}", "true");
} else if (!content.includes("android:usesCleartextTraffic=")) {
  content = content.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
}

// 2. Add extra permissions cleanly before <application
const extraPermissions = [
  '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
];

const needed = extraPermissions.filter((p) => !content.includes(p.trim()));
if (needed.length > 0) {
  content = content.replace("<application", needed.join("\n") + "\n\n    <application");
}

fs.writeFileSync(manifestPath, content, "utf-8");
console.log("[patch-android] Successfully patched AndroidManifest.xml! Content:\n", content);

// 3. Patch build.gradle.kts for signing and manifest placeholders
const gradlePath = path.resolve(
  __dirname,
  "../src-tauri/gen/android/app/build.gradle.kts",
);

if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, "utf-8");
  if (!gradle.includes("signingConfigs.getByName(\"debug\")") && gradle.includes('getByName("release") {')) {
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
