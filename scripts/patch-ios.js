import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appleDir = path.resolve(__dirname, "../src-tauri/gen/apple");

if (!fs.existsSync(appleDir)) {
  console.log(`[patch-ios] Apple dir not found at ${appleDir}. Run 'tauri ios init' first.`);
  process.exit(0);
}

console.log("[patch-ios] Scanning generated Apple project files in:", appleDir);

// 1. Recursive finder helper
function findFiles(dir, matchFileName) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(findFiles(fullPath, matchFileName));
    } else if (item === matchFileName || item.endsWith(matchFileName)) {
      results.push(fullPath);
    }
  }
  return results;
}

// 2. Patch Info.plist files
const plistFiles = findFiles(appleDir, "Info.plist");
console.log(`[patch-ios] Found ${plistFiles.length} Info.plist file(s).`);

for (const plistPath of plistFiles) {
  let content = fs.readFileSync(plistPath, "utf-8");
  let modified = false;

  // Add UIBackgroundModes (audio)
  if (!content.includes("UIBackgroundModes")) {
    const bgModes = `
	<key>UIBackgroundModes</key>
	<array>
		<string>audio</string>
	</array>`;
    content = content.replace("</dict>", `${bgModes}\n</dict>`);
    modified = true;
    console.log(`[patch-ios] Added UIBackgroundModes to ${plistPath}`);
  }

  // Add NSAppTransportSecurity (arbitrary loads)
  if (!content.includes("NSAppTransportSecurity")) {
    const ats = `
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>`;
    content = content.replace("</dict>", `${ats}\n</dict>`);
    modified = true;
    console.log(`[patch-ios] Added NSAppTransportSecurity to ${plistPath}`);
  }

  // Set CFBundleDisplayName if needed
  if (!content.includes("CFBundleDisplayName")) {
    const nameEntry = `
	<key>CFBundleDisplayName</key>
	<string>Museek</string>`;
    content = content.replace("</dict>", `${nameEntry}\n</dict>`);
    modified = true;
    console.log(`[patch-ios] Added CFBundleDisplayName to ${plistPath}`);
  }

  if (modified) {
    fs.writeFileSync(plistPath, content, "utf-8");
    console.log(`[patch-ios] Saved ${plistPath}`);
  }
}

// 3. Patch project.yml if present
const projectYmlPath = path.resolve(appleDir, "project.yml");
if (fs.existsSync(projectYmlPath)) {
  let yml = fs.readFileSync(projectYmlPath, "utf-8");
  let ymlModified = false;

  // Ensure cargo path is in any script phases
  if (!yml.includes('export PATH="$HOME/.cargo/bin')) {
    yml = yml.replace(
      /script:\s*\|/g,
      'script: |\n        export PATH="$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"'
    );
    ymlModified = true;
    console.log("[patch-ios] Injected PATH into build scripts in project.yml");
  }

  // Ensure code signing is disabled for unsigned CI build
  if (!yml.includes("CODE_SIGNING_ALLOWED: NO")) {
    if (yml.includes("settings:")) {
      yml = yml.replace(
        "settings:\n",
        "settings:\n    base:\n      CODE_SIGNING_ALLOWED: NO\n      CODE_SIGNING_REQUIRED: NO\n      CODE_SIGN_IDENTITY: \"\"\n"
      );
      ymlModified = true;
      console.log("[patch-ios] Added unsigned build settings to project.yml");
    }
  }

  if (ymlModified) {
    fs.writeFileSync(projectYmlPath, yml, "utf-8");
    console.log("[patch-ios] Saved project.yml");

    // Re-run xcodegen if available
    try {
      execSync(`xcodegen generate --spec "${projectYmlPath}" --project "${appleDir}"`, {
        stdio: "inherit",
      });
      console.log("[patch-ios] Successfully regenerated Xcode project using xcodegen!");
    } catch (e) {
      console.log("[patch-ios] xcodegen re-run note:", e.message);
    }
  }
}

// 4. Patch project.pbxproj files directly with lint validation
const pbxFiles = findFiles(appleDir, "project.pbxproj");
console.log(`[patch-ios] Found ${pbxFiles.length} project.pbxproj file(s).`);

for (const pbxPath of pbxFiles) {
  const original = fs.readFileSync(pbxPath, "utf-8");
  let pbx = original;
  let pbxModified = false;

  // Fix objectVersion 77 -> 60 for Xcode 15/16 universal compatibility
  if (pbx.includes("objectVersion = 77;")) {
    pbx = pbx.replace(/objectVersion = 77;/g, "objectVersion = 60;");
    pbx = pbx.replace(/compatibilityVersion = "Xcode 16.0";/g, 'compatibilityVersion = "Xcode 15.0";');
    pbxModified = true;
    console.log(`[patch-ios] Adjusted objectVersion from 77 to 60 in ${pbxPath}`);
  }

  // Inject PATH and CONFIGURATION fallback into shellScript phases if not present
  if (pbx.includes("shellScript = ") && !pbx.includes('.cargo/bin')) {
    pbx = pbx.replace(
      /shellScript = "(.*?)";/g,
      (match, scriptContent) => {
        if (!scriptContent.includes(".cargo/bin")) {
          return `shellScript = "export PATH=\\"$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH\\"\\nexport CONFIGURATION=\\"\\\${CONFIGURATION:-release}\\"\\n${scriptContent}";`;
        }
        return match;
      }
    );
    pbxModified = true;
    console.log(`[patch-ios] Injected PATH and CONFIGURATION into shellScript in ${pbxPath}`);
  }

  // Disable code signing requirements
  if (!pbx.includes("CODE_SIGNING_ALLOWED = NO;")) {
    pbx = pbx.replace(/CODE_SIGN_STYLE = Automatic;/g, "CODE_SIGN_STYLE = Manual;");
    pbx = pbx.replace(/CODE_SIGN_IDENTITY = ".*?";/g, 'CODE_SIGN_IDENTITY = "";');
    pbx = pbx.replace(
      /buildSettings = \{/g,
      'buildSettings = {\n\t\t\t\tCODE_SIGNING_ALLOWED = NO;\n\t\t\t\tCODE_SIGNING_REQUIRED = NO;\n\t\t\t\tCODE_SIGN_IDENTITY = "";'
    );
    pbxModified = true;
    console.log(`[patch-ios] Relaxed signing requirements in ${pbxPath}`);
  }

  if (pbxModified) {
    fs.writeFileSync(pbxPath, pbx, "utf-8");
    try {
      execSync(`plutil -lint "${pbxPath}"`, { stdio: "ignore" });
      console.log(`[patch-ios] Verified ${pbxPath} syntax with plutil: OK`);
    } catch (e) {
      console.warn(`[patch-ios] Warning: plutil lint failed on modified ${pbxPath}, reverting to original...`);
      fs.writeFileSync(pbxPath, original, "utf-8");
    }
  }
}

console.log("[patch-ios] iOS patching completed successfully!");
