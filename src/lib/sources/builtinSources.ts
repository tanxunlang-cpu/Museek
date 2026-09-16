import { parseScriptMeta } from "@/lib/lxApi";
import type { SourceScript } from "@/types/source";

// Eagerly load all .js source scripts from assets/builtin-sources as raw text
const rawSourceModules = import.meta.glob<string>(
  "@/assets/builtin-sources/*.js",
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

export function getBuiltinSourceScripts(): SourceScript[] {
  const scripts: SourceScript[] = [];

  for (const [path, rawScript] of Object.entries(rawSourceModules)) {
    if (!rawScript || typeof rawScript !== "string") continue;
    const filename = path.split("/").pop() ?? "source.js";
    const meta = parseScriptMeta(rawScript);
    // Verified functional sources from network probe testing
    const filenameLower = filename.toLowerCase();
    const isVerifiedWorking =
      filenameLower.includes("k×h") ||
      filenameLower.includes("玉宁熙") ||
      filenameLower.includes("hywmusic") ||
      filenameLower.includes("墨澜") ||
      filenameLower.includes("星澜") ||
      filenameLower.includes("stellarwave") ||
      filenameLower.includes("xinghai") ||
      filenameLower.includes("星海") ||
      filenameLower.includes("溯音") ||
      filenameLower.includes("念心") ||
      filenameLower.includes("忆音") ||
      filenameLower.includes("收集") ||
      filenameLower.includes("Hei Music") ||
      filenameLower.includes("西瓜") ||
      filenameLower.includes("非常刀");

    // Clean up stable ID based on filename
    const safeId =
      "builtin_" +
      encodeURIComponent(filename.replace(/\.js$/, ""))
        .replace(/%/g, "_")
        .toLowerCase();

    scripts.push({
      id: safeId,
      name: meta.name || filename.replace(/\.js$/, ""),
      version: meta.version || "1.0.0",
      author: meta.author || "内置音源",
      description: meta.description || `内置预设音源 (${filename})`,
      rawScript,
      enabled: isVerifiedWorking,
      url: `builtin:${filename}`,
    });
  }

  // Rank priorities: top tested reliable multi-platform sources first
  const priorityKeywords = ["k×h", "玉宁熙", "hywmusic", "墨澜", "星澜", "stellarwave", "xinghai", "星海", "溯音"];
  const getRank = (name: string, file: string) => {
    const s = (name + " " + file).toLowerCase();
    for (let i = 0; i < priorityKeywords.length; i++) {
      if (s.includes(priorityKeywords[i])) return i;
    }
    return 999;
  };

  // Sort so verified reliable sources appear first
  scripts.sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    const rankA = getRank(a.name, a.url);
    const rankB = getRank(b.name, b.url);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return scripts;
}
