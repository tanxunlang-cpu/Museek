import { createSourceRegistry } from "./sourceRegistry";
import { SourceWorkerHost } from "./sources/sourceWorkerHost";
import { t } from "@/lib/i18n";
import { qualityCandidates, qualityUpgradeCandidates, QUALITY_LADDER } from "@/lib/quality";
import { toLxMusicInfo } from "@/lib/lxMusicInfo";
import { looksLikeRealAudio } from "@/lib/audioUrlProbe";
import { isHostTrusted } from "@/lib/hostHealth";
import { createAsyncCache } from "@/lib/cache";
import { getWyBuiltinMusicUrl } from "@/lib/playlists/wyUrl";
import type { SourceScript, SourceRegistry, LxRequestPayload } from "@/types/source";
import { isMobile } from "@/lib/os";
import type { LyricInfo, MusicInfo, OnlineSource, Quality } from "@/types/music";

/** Parallel musicUrl probes per wave — 8 on mobile so all top verified sources race in Wave 1, 12 on desktop. */
const MUSIC_URL_WAVE = isMobile() ? 8 : 12;
/** Per-source musicUrl attempt timeout (scripts without their own timeout can hang). */
const MUSIC_URL_ATTEMPT_MS = 3_500;
/** Successful play URLs are reusable briefly (CDN links expire; keep TTL short). */
const musicUrlCache = createAsyncCache<string>(4 * 60_000, 80);
const picCache = createAsyncCache<string | null>(30 * 60_000, 80);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** First fulfilled promise wins (Promise.any without requiring ES2021 lib). */
function raceFirst<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!promises.length) {
      reject(new Error("raceFirst: empty"));
      return;
    }
    let settled = false;
    let pending = promises.length;
    const errors: unknown[] = [];
    for (const p of promises) {
      p.then(
        (v) => {
          if (settled) return;
          settled = true;
          resolve(v);
        },
        (err) => {
          if (settled) return;
          errors.push(err);
          pending -= 1;
          if (pending === 0) {
            settled = true;
            reject(
              errors[0] instanceof Error
                ? errors[0]
                : new Error(String(errors[0])),
            );
          }
        },
      );
    }
  });
}

export class SourceRunner {
  constructor(private readonly registry: SourceRegistry) {}

  setScripts(scripts: SourceScript[]): void {
    this.registry.setScripts(scripts);
  }

  // Multiple enabled sources can be loaded simultaneously; musicUrl races them
  // in small waves and takes the first valid full-track URL. Keyed by script id.
  private sessions = new Map<string, SourceWorkerHost>();

  async loadScript(
    script: SourceScript,
  ): Promise<Record<string, unknown> | undefined> {
    this.unloadScript(script.id);
    const host = new SourceWorkerHost();
    try {
      const sources = await host.start(script);
      this.sessions.set(script.id, host);
      return sources;
    } catch (err) {
      host.terminate();
      throw err;
    }
  }

  unloadScript(id: string): void {
    this.sessions.get(id)?.terminate();
    this.sessions.delete(id);
  }

  isLoaded(id: string): boolean {
    return this.sessions.has(id);
  }

  isReady(): boolean {
    return this.sessions.size > 0;
  }

  /**
   * Ask one script for a play URL. Does not race other sources or write the
   * playback cache — used by the Sources “test all” health check.
   */
  async probeMusicUrl(scriptId: string, payload: LxRequestPayload): Promise<boolean> {
    const session = this.sessions.get(scriptId);
    if (!session) return false;
    const quality = (payload.type ?? "128k") as Quality;
    const request = this.buildRequest("musicUrl", payload);
    try {
      const url = await withTimeout(
        (async () => {
          const result = await session.invoke(request);
          if (typeof result === "string" && result.startsWith("http")) {
            if (await looksLikeRealAudio(result, payload.info, quality)) {
              return result;
            }
          }
          return null;
        })(),
        MUSIC_URL_ATTEMPT_MS,
        `probe:${scriptId}`,
      );
      return Boolean(url);
    } catch {
      return false;
    }
  }

  // Enabled+loaded sources in UI list order (used for lyric/pic failover and
  // as the musicUrl race participant set).
  private getOrderedIds(
    action?: "musicUrl" | "lyric" | "pic",
    platform?: string,
    quality?: Quality,
  ): string[] {
    const scripts = this.registry
      .getScripts()
      .filter((s) => s.enabled && this.sessions.has(s.id));
    if (!action || !platform) return scripts.map((s) => s.id);

    const matched = scripts
      .filter(
        (s) =>
          !s.sources ||
          Object.keys(s.sources).length === 0 ||
          Boolean(s.sources[platform]),
      )
      .filter((s) => {
        const actions = s.sources?.[platform]?.actions;
        return !actions?.length || actions.includes(action);
      });

    if (action === "musicUrl" && quality) {
      const withQuality = matched.filter((s) => {
        const qs = s.sources?.[platform]?.qualitys;
        return !qs?.length || qs.includes(quality);
      });
      if (withQuality.length > 0) {
        return withQuality.map((s) => s.id);
      }
    }

    return matched.map((s) => s.id);
  }

  /** Enabled, loaded source ids in list order — changes when the user edits sources. */
  layoutKey(): string {
    return this.getOrderedIds().join("|");
  }

  /**
   * Platforms the enabled, loaded scripts declare support for.
   */
  servedPlatforms(): OnlineSource[] {
    const out = new Set<OnlineSource>();
    for (const script of this.registry.getScripts()) {
      if (!script.enabled || !this.sessions.has(script.id)) continue;
      for (const key of Object.keys(script.sources ?? {})) {
        out.add(key as OnlineSource);
      }
    }
    return [...out];
  }

  private buildRequest(
    action: "musicUrl" | "lyric" | "pic",
    payload: LxRequestPayload,
  ) {
    return {
      source: payload.source,
      action,
      info: {
        type: payload.type ?? "128k",
        musicInfo: toLxMusicInfo(payload.info),
      },
    };
  }

  private musicUrlKey(payload: LxRequestPayload): string {
    const q = payload.type ?? "128k";
    return `${payload.source}:${payload.info.meta.songId}:${q}`;
  }

  /**
   * Race a wave of sources; first URL that passes the real-audio probe wins.
   * After a winner, remaining probes in the wave are cancelled (no more HEAD/Range).
   */
  private raceMusicUrlWave(
    ids: string[],
    payload: LxRequestPayload,
    quality: Quality,
  ): Promise<string> {
    const request = this.buildRequest("musicUrl", payload);

    type Outcome = { ok: true; url: string } | { ok: false };

    return new Promise((resolve, reject) => {
      let settled = false;
      let remaining = ids.length;
      if (!remaining) {
        reject(new Error(t("sources.err.allFailed")));
        return;
      }

      const GRACE_MS = 80;
      let fallbackUrl = "";
      let graceTimer: number | undefined;

      const cleanup = () => {
        if (graceTimer !== undefined) window.clearTimeout(graceTimer);
        graceTimer = undefined;
      };

      const settle = (url: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(url);
      };

      const armGrace = () => {
        if (settled || graceTimer !== undefined) return;
        graceTimer = window.setTimeout(() => {
          if (!fallbackUrl) return;
          settle(fallbackUrl);
        }, GRACE_MS);
      };

      const tryOne = async (id: string): Promise<Outcome> => {
        if (settled) return { ok: false };
        const session = this.sessions.get(id);
        if (!session) return { ok: false };
        try {
          const url = await withTimeout(
            (async () => {
              const result = await session.invoke(request);
              if (settled) return null;
              if (typeof result === "string" && result.startsWith("http")) {
                if (
                  await looksLikeRealAudio(
                    result,
                    payload.info,
                    quality,
                    () => settled,
                  )
                ) {
                  return result;
                }
              }
              return null;
            })(),
            MUSIC_URL_ATTEMPT_MS,
            `musicUrl:${id}`,
          );
          if (settled) return { ok: false };
          if (url) return { ok: true, url };
        } catch {
          /* counted as failure below */
        }
        return { ok: false };
      };

      for (const id of ids) {
        void tryOne(id).then((outcome) => {
          if (settled) return;
          if (outcome.ok) {
            if (isHostTrusted(outcome.url)) {
              settle(outcome.url);
              return;
            }
            // Never overwrite a preferred candidate with a later unknown one.
            if (!fallbackUrl) fallbackUrl = outcome.url;
            armGrace();
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            settled = true;
            cleanup();
            if (fallbackUrl) {
              resolve(fallbackUrl);
              return;
            }
            reject(new Error(t("sources.err.allFailed")));
          }
        });
      }
    });
  }

  /** Drop cached play URLs so a stale CDN link is not reused after a fetch fail. */
  invalidateMusicUrl(song: MusicInfo): void {
    for (const quality of QUALITY_LADDER) {
      musicUrlCache.forget(
        this.musicUrlKey({
          source: song.source,
          action: "musicUrl",
          info: song,
          type: quality,
        }),
      );
    }
  }

  async getMusicUrl(payload: LxRequestPayload): Promise<string> {
    const quality = (payload.type ?? "128k") as Quality;
    const ids = this.getOrderedIds("musicUrl", payload.source, quality);
    if (!ids.length) {
      const anyEnabled = this.registry
        .getScripts()
        .some((s) => s.enabled && this.sessions.has(s.id));
      throw new Error(
        anyEnabled
          ? t("sources.err.noPlatform", {
              platform: t(`platform.${payload.source}`),
            })
          : t("sources.err.noEnabled"),
      );
    }

    const key = this.musicUrlKey(payload);

    return musicUrlCache(key, async () => {
      let lastErr: unknown;
      for (let i = 0; i < ids.length; i += MUSIC_URL_WAVE) {
        const wave = ids.slice(i, i + MUSIC_URL_WAVE);
        try {
          return await this.raceMusicUrlWave(wave, payload, quality);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error(t("sources.err.allFailed"));
    });
  }

  // Resolve a playback URL starting at `preferred`, stepping down the quality
  // ladder with a 900ms hedged fallback so slow/unavailable high-bitrate tiers
  // (e.g. 320k/FLAC) never stall playback start when a fast lower tier is ready.
  async getMusicUrlAdaptive(
    song: MusicInfo,
    preferred: Quality,
    opts?: { betterThan?: Quality },
  ): Promise<{ url: string; quality: Quality }> {
    const candidates = opts?.betterThan
      ? qualityUpgradeCandidates(preferred, opts.betterThan)
      : qualityCandidates(preferred);
    if (!candidates.length) {
      throw new Error("no higher quality to try");
    }

    const tryBuiltin = async (quality: Quality): Promise<string> => {
      return withTimeout(
        (async () => {
          const url = await getWyBuiltinMusicUrl(song.meta.songId, quality);
          if (!(await looksLikeRealAudio(url, song, quality))) {
            throw new Error("NetEase builtin URL failed audio probe");
          }
          return url;
        })(),
        MUSIC_URL_ATTEMPT_MS,
        "musicUrl:wy-builtin",
      );
    };

    const tryQuality = async (
      quality: Quality,
      idx: number,
    ): Promise<{ url: string; quality: Quality }> => {
      const fromSources = this.getMusicUrl({
        source: song.source,
        action: "musicUrl",
        info: song,
        type: quality,
      });

      if (song.source === "wy") {
        if (idx === 0) {
          return raceFirst([
            fromSources.then((url) => ({ url, quality })),
            tryBuiltin(quality).then((url) => ({ url, quality })),
          ]);
        }
        try {
          const url = await fromSources;
          return { url, quality };
        } catch {
          const url = await tryBuiltin(quality);
          return { url, quality };
        }
      }

      const url = await fromSources;
      return { url, quality };
    };

    if (candidates.length === 1) {
      return tryQuality(candidates[0], 0);
    }

    // Staggered hedge: start candidate 0 immediately; start candidate i+1 either
    // when candidate i fails OR after HEDGE_MS (900ms), whichever comes first.
    const HEDGE_MS = 900;
    return new Promise<{ url: string; quality: Quality }>((resolve, reject) => {
      let settled = false;
      let pending = candidates.length;
      let nextIdx = 0;
      let lastErr: unknown;
      const timers: ReturnType<typeof setTimeout>[] = [];

      const clearAllTimers = () => {
        for (const tId of timers) clearTimeout(tId);
        timers.length = 0;
      };

      const launchNext = () => {
        if (settled || nextIdx >= candidates.length) return;
        const idx = nextIdx++;
        const q = candidates[idx];

        if (nextIdx < candidates.length) {
          const tId = setTimeout(() => {
            launchNext();
          }, HEDGE_MS);
          timers.push(tId);
        }

        void tryQuality(q, idx).then(
          (res) => {
            if (settled) return;
            settled = true;
            clearAllTimers();
            resolve(res);
          },
          (err) => {
            if (settled) return;
            lastErr = err;
            pending -= 1;
            if (pending === 0) {
              settled = true;
              clearAllTimers();
              reject(
                lastErr instanceof Error
                  ? lastErr
                  : new Error(t("sources.err.noEnabled")),
              );
              return;
            }
            // Immediately trigger the next quality tier without waiting for HEDGE_MS
            launchNext();
          },
        );
      };

      launchNext();
    });
  }

  async getLyric(payload: LxRequestPayload): Promise<LyricInfo | null> {
    for (const id of this.getOrderedIds("lyric", payload.source)) {
      const session = this.sessions.get(id);
      if (!session) continue;
      try {
        const result = await session.invoke(this.buildRequest("lyric", payload));
        if (result && typeof result === "object" && "lyric" in result)
          return result as LyricInfo;
      } catch {
        // try next source
      }
    }
    return null;
  }

  async getPic(payload: LxRequestPayload): Promise<string | null> {
    const key = `${payload.source}:${payload.info.meta.songId}`;
    return picCache(key, async () => {
      for (const id of this.getOrderedIds("pic", payload.source)) {
        const session = this.sessions.get(id);
        if (!session) continue;
        try {
          const result = await session.invoke(this.buildRequest("pic", payload));
          if (typeof result === "string" && result.startsWith("http"))
            return result;
        } catch {
          // try next source
        }
      }
      return null;
    });
  }
}

export function createSourceRunner(registry: SourceRegistry): SourceRunner {
  return new SourceRunner(registry);
}

export const sourceRunner = createSourceRunner(createSourceRegistry());
