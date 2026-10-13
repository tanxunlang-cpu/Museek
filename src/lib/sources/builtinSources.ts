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

const DEFAULT_BUILTIN_SOURCES: SourceScript["sources"] = {
  wy: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac"],
  },
  kw: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac"],
  },
  kg: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac"],
  },
  tx: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac"],
  },
  mg: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac"],
  },
};

export function getBuiltinSourceScripts(): SourceScript[] {
  const scripts: SourceScript[] = [];

  for (const [path, rawScript] of Object.entries(rawSourceModules)) {
    if (!rawScript || typeof rawScript !== "string") continue;
    const filename = path.split("/").pop() ?? "source.js";
    const meta = parseScriptMeta(rawScript);

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
      enabled: true,
      url: `builtin:${filename}`,
      sources: DEFAULT_BUILTIN_SOURCES,
    });
  }

  // Rank priorities: top end-to-end verified multi-platform 206 audio stream sources first
  const priorityKeywords = [
    "裤佬",
    "stellarwave",
    "墨澜音乐源v2.3",
    "西瓜",
    "gdstudio",
    "墨澜聚合",
    "k×h",
    "玉宁熙",
    "xinghai-music-sourcev2.3.11",
    "溯音",
    "非常刀",
    "收集の聚合",
    "星澜",
    "幻音",
    "hei music",
    "忆音",
    "念心",
    "音乐下载器",
    "全豆要",
    "星海2.3.8",
  ];
  const getRank = (name: string, file: string) => {
    const s = (name + " " + file).toLowerCase();
    for (let i = 0; i < priorityKeywords.length; i++) {
      if (s.includes(priorityKeywords[i])) return i;
    }
    return 999;
  };

  // Sort so verified reliable sources appear first in Wave 1 & Wave 2
  scripts.sort((a, b) => {
    const rankA = getRank(a.name, a.url ?? "");
    const rankB = getRank(b.name, b.url ?? "");
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return scripts;
}
