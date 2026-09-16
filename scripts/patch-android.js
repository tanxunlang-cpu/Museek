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

const permissions = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
];

for (const perm of permissions) {
  if (!content.includes(perm)) {
    content = content.replace("<application", `    ${perm}\n    <application`);
  }
}

// Add usesCleartextTraffic="true" to <application>
if (!content.includes('android:usesCleartextTraffic="true"')) {
  content = content.replace(
    "<application",
    '<application\n        android:usesCleartextTraffic="true"',
  );
}

fs.writeFileSync(manifestPath, content, "utf-8");
console.log("[patch-android] Successfully patched AndroidManifest.xml with network & media playback permissions!");
