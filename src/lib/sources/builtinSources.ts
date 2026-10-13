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
    qualitys: ["128k", "320k", "flac", "flac24bit"],
  },
  kw: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac", "flac24bit"],
  },
  kg: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac", "flac24bit"],
  },
  tx: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac", "flac24bit"],
  },
  mg: {
    type: "music",
    actions: ["musicUrl"],
    qualitys: ["128k", "320k", "flac", "flac24bit"],
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
    "二改整合版",
    "墨澜音乐源v2.3.0",
    "聚合api接口",
    "stellarwave",
    "回避聚合",
    "xinghai-music-sourcev2.3.13",
    "西瓜聚合",
    "k×h",
    "gdstudio",
    "hei music",
    "念心",
    "星澜",
    "收集の聚合",
    "溯音",
    "墨澜音乐源v2.3.4",
    "玉宁熙",
    "裤佬",
    "非常刀",
    "幻音",
    "忆音",
    "音乐下载器",
    "全豆要",
    "hywmusic",
    "统一音乐源",
    "260809",
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
