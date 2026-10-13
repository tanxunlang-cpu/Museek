import { create } from "zustand";
import { parseScriptMeta } from "@/lib/lxApi";
import {
  sourceRunner,
  loadSourceScripts,
  saveSourceScripts,
  loadSourceProbeResults,
  saveSourceProbeResults,
} from "@/lib/sources";
import { getBuiltinSourceScripts } from "@/lib/sources/builtinSources";
import { t } from "@/lib/i18n";
import type { SourceScript } from "@/types/source";
import type { SourceProbeResult } from "@/lib/sources/probe";

interface SourceState {
  scripts: SourceScript[];
  isLoading: boolean;
  error: string | null;
  probeResults: Record<string, SourceProbeResult>;

  /** @returns whether this created a new entry or refreshed a duplicate */
  importScript: (
    rawScript: string,
    url?: string,
  ) => Promise<"added" | "updated">;
  removeScript: (id: string) => void;
  toggleEnabled: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  reorderScripts: (from: number, to: number) => void;
  setScriptSources: (id: string, sources: unknown) => void;
  setProbeResult: (id: string, result: SourceProbeResult) => void;
  loadFromDisk: () => Promise<void>;
  ensureReady: () => Promise<void>;
  clearError: () => void;
}

function generateId(): string {
  return `user_api_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

let inFlightLoadFromDisk: Promise<void> | null = null;

export const useSourceStore = create<SourceState>((set, get) => ({
  scripts: [],
  isLoading: false,
  error: null,
  probeResults: {},

  clearError: () => set({ error: null }),

  async importScript(rawScript, url) {
    const meta = parseScriptMeta(rawScript);
    // Dedupe: re-importing the same origin (or byte-identical content) updates the
    // existing entry in place instead of adding a duplicate.
    const existing = get().scripts.find(
      (s) => (url && s.url === url) || s.rawScript === rawScript,
    );
    const script: SourceScript = {
      id: existing?.id ?? generateId(),
      ...meta,
      rawScript,
      enabled: existing?.enabled ?? true,
      url,
    };

    // Validate by loading it
    set({ isLoading: true, error: null });
    try {
      // loadScript returns the `sources` from the script's `inited` event — attach
      // them now so the platform list shows immediately (the script isn't in the
      // store yet when `inited` fires, so setScriptSources alone would be lost).
      const sources = await sourceRunner.loadScript(script);
      if (sources) script.sources = sources as SourceScript["sources"];
      set((s) => {
        // Any import (new OR re-import) moves the entry to the TOP so the most
        // recently imported source is always first (and tried first in failover).
        const scripts = existing
          ? [script, ...s.scripts.filter((x) => x.id !== existing.id)]
          : [script, ...s.scripts];
        sourceRunner.setScripts(scripts);
        saveSourceScripts(scripts);
        return { scripts, isLoading: false };
      });
      return existing ? "updated" : "added";
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message });
      throw err;
    }
  },

  removeScript(id) {
    sourceRunner.unloadScript(id);
    set((s) => {
      const scripts = s.scripts.filter((x) => x.id !== id);
      const probeResults = { ...s.probeResults };
      delete probeResults[id];
      sourceRunner.setScripts(scripts);
      saveSourceScripts(scripts);
      saveSourceProbeResults(probeResults);
      return { scripts, probeResults };
    });
  },

  async setEnabled(id, enabled) {
    const script = get().scripts.find((s) => s.id === id);
    if (!script || script.enabled === enabled) return;

    set((s) => {
      const scripts = s.scripts.map((x) =>
        x.id === id ? { ...x, enabled } : x,
      );
      sourceRunner.setScripts(scripts);
      saveSourceScripts(scripts);
      return { scripts };
    });

    if (enabled) {
      set({ isLoading: true, error: null });
      try {
        const sources = await sourceRunner.loadScript(script);
        if (sources) get().setScriptSources(id, sources);
        set({ isLoading: false });
      } catch (err) {
        set({
          isLoading: false,
          error: t("sources.err.loadFailed", {
            name: script.name,
            msg: (err as Error).message,
          }),
        });
      }
    } else {
      sourceRunner.unloadScript(id);
    }
  },

  async toggleEnabled(id) {
    const script = get().scripts.find((s) => s.id === id);
    if (!script) return;
    await get().setEnabled(id, !script.enabled);
  },

  reorderScripts(from, to) {
    set((s) => {
      const n = s.scripts.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return {};
      const scripts = [...s.scripts];
      const [moved] = scripts.splice(from, 1);
      scripts.splice(to, 0, moved);
      sourceRunner.setScripts(scripts);
      saveSourceScripts(scripts);
      return { scripts };
    });
  },

  setScriptSources(id, sources) {
    set((s) => {
      const scripts = s.scripts.map((x) =>
        x.id === id ? { ...x, sources: sources as SourceScript["sources"] } : x,
      );
      sourceRunner.setScripts(scripts);
      return { scripts };
    });
  },

  setProbeResult(id, result) {
    set((s) => {
      const probeResults = { ...s.probeResults, [id]: result };
      saveSourceProbeResults(probeResults);
      return { probeResults };
    });
  },

  async ensureReady() {
    if (sourceRunner.isReady()) return;
    if (inFlightLoadFromDisk) {
      await inFlightLoadFromDisk;
      if (sourceRunner.isReady()) return;
    }
    await get().loadFromDisk();
  },

  async loadFromDisk() {
    if (inFlightLoadFromDisk) return inFlightLoadFromDisk;
    const run = async () => {
      const [diskScripts, storedProbe] = await Promise.all([
        loadSourceScripts(),
        loadSourceProbeResults(),
      ]);
      const builtinScripts = getBuiltinSourceScripts();
      const BUILTIN_MIGRATION_VER = "3.11.5-r1";
      const migratedVer =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("museek_builtin_sources_ver")
          : null;

      let scripts = diskScripts;
      if (!diskScripts || diskScripts.length === 0) {
        scripts = builtinScripts;
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(
            "museek_builtin_sources_ver",
            BUILTIN_MIGRATION_VER,
          );
        }
        saveSourceScripts(scripts);
      } else if (migratedVer !== BUILTIN_MIGRATION_VER) {
        // Upgrade migration: preserve custom user-imported scripts at the top,
        // and refresh all 25 builtin sources to enabled=true in verified priority order.
        const userScripts = diskScripts.filter(
          (s) =>
            !s.id.startsWith("builtin_") && !s.url?.startsWith("builtin:"),
        );
        scripts = [...userScripts, ...builtinScripts];
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(
            "museek_builtin_sources_ver",
            BUILTIN_MIGRATION_VER,
          );
        }
        saveSourceScripts(scripts);
      } else {
        const existingUrlsOrIds = new Set(
          scripts.map((s) => s.url || s.id).filter(Boolean) as string[],
        );
        const missingBuiltins = builtinScripts.filter(
          (b) =>
            (!b.url || !existingUrlsOrIds.has(b.url)) &&
            !existingUrlsOrIds.has(b.id),
        );
        if (missingBuiltins.length > 0) {
          scripts = [
            ...scripts,
            ...missingBuiltins.map((b) => ({ ...b })),
          ];
          saveSourceScripts(scripts);
        }
        // Self-heal if all scripts were accidentally disabled
        if (!scripts.some((s) => s.enabled)) {
          scripts = scripts.map((s) => ({ ...s, enabled: true }));
          saveSourceScripts(scripts);
        }
      }
      const known = new Set(scripts.map((s) => s.id));
      const probeResults = Object.fromEntries(
        Object.entries(storedProbe).filter(([id]) => known.has(id)),
      );
      if (Object.keys(probeResults).length !== Object.keys(storedProbe).length) {
        saveSourceProbeResults(probeResults);
      }
      set({ scripts, probeResults });
      sourceRunner.setScripts(scripts);

      // Load the first 8 enabled sources (Wave 1) immediately so playback is ready
      // within < 300ms, then load the remaining enabled sources in background batches
      // of 6 so spawning 25 workers does not spike mobile WebView CPU at startup.
      const enabledScripts = scripts.filter((s) => s.enabled);
      const loadOne = async (script: SourceScript) => {
        try {
          const sources = await sourceRunner.loadScript(script);
          if (sources && Object.keys(sources).length > 0) {
            get().setScriptSources(script.id, sources);
          }
        } catch {
          // skip sources that fail to load/init
        }
      };

      const primaryWave = enabledScripts.slice(0, 8);
      const remainingScripts = enabledScripts.slice(8);

      await Promise.allSettled(primaryWave.map(loadOne));

      if (remainingScripts.length > 0) {
        void (async () => {
          const BATCH_SIZE = 6;
          for (let i = 0; i < remainingScripts.length; i += BATCH_SIZE) {
            const batch = remainingScripts.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(batch.map(loadOne));
          }
        })();
      }
    };
    inFlightLoadFromDisk = run().finally(() => {
      inFlightLoadFromDisk = null;
    });
    return inFlightLoadFromDisk;
  },
}));
