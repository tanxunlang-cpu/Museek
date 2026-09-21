import { Folder, RotateCcw, Music, Download as DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsCard, SettingRow } from "@/components/settings/SettingsCard";
import { useSettingsStore, type NamingScheme } from "@/stores/settingsStore";
import { resolveSystemAudioDir, resolveSystemDownloadsDir } from "@/lib/downloadPath";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Quality } from "@/types/music";

const QUALITIES: Quality[] = ["128k", "320k", "flac", "flac24bit"];
const NAMINGS: NamingScheme[] = ["singer-name", "name-singer", "name"];
const CONCURRENCY = [1, 2, 3, 4, 5];

export function DownloadSettings() {
  const {
    downloadQuality,
    embedLyrics,
    embedCover,
    downloadDir,
    maxConcurrent,
    fileNaming,
    deleteDownloadFiles,
    setDownloadQuality,
    setEmbedLyrics,
    setEmbedCover,
    setDownloadDir,
    setMaxConcurrent,
    setFileNaming,
    setDeleteDownloadFiles,
  } = useSettingsStore();
  const t = useT();
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  async function chooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") {
        setDownloadDir(dir);
        return;
      }
    } catch {
      // dialog unavailable or mobile
    }
    // Fallback: auto-resolve system audio or download dir if picker is unsupported
    const fallback = (await resolveSystemAudioDir()) || (await resolveSystemDownloadsDir());
    if (fallback) setDownloadDir(fallback);
  }

  async function setAudioDir() {
    const dir = await resolveSystemAudioDir();
    if (dir) setDownloadDir(dir);
  }

  async function setSystemDownloadDir() {
    const dir = await resolveSystemDownloadsDir();
    if (dir) setDownloadDir(dir);
  }

  return (
    <ScrollArea className="h-full">
      <div className="pr-3 pb-4">
        <SettingsCard>
          <SettingRow
            title={t("playback.downloadQualityTitle")}
            desc={t("playback.downloadQualityDesc")}
          >
            <div className="flex flex-wrap gap-2">
              {QUALITIES.map((q) => (
                <Button
                  key={q}
                  variant={downloadQuality === q ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDownloadQuality(q)}
                >
                  {t(`quality.${q}`)}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            title={t("download.locationTitle")}
            desc={t("download.locationDesc")}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex-1 min-w-0 text-sm px-3 py-2 rounded-md border bg-muted/40 truncate",
                    !downloadDir && "text-muted-foreground",
                  )}
                  title={downloadDir ?? undefined}
                >
                  {downloadDir || t("download.notSet")}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={chooseFolder}
                  disabled={!isTauri}
                  className="shrink-0"
                >
                  <Folder size={15} className="mr-2" />
                  {t("download.choose")}
                </Button>
                {downloadDir && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground"
                    onClick={() => setDownloadDir(null)}
                    title={t("download.clearLocation")}
                  >
                    <RotateCcw size={15} />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">快捷预设:</span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs gap-1 px-2.5"
                  onClick={setAudioDir}
                  disabled={!isTauri}
                >
                  <Music size={12} />
                  系统音乐目录
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs gap-1 px-2.5"
                  onClick={setSystemDownloadDir}
                  disabled={!isTauri}
                >
                  <DownloadIcon size={12} />
                  系统下载目录
                </Button>
              </div>
            </div>
          </SettingRow>

          <SettingRow
            title={t("download.concurrencyTitle")}
            desc={t("download.concurrencyDesc")}
          >
            <div className="flex gap-2">
              {CONCURRENCY.map((n) => (
                <Button
                  key={n}
                  variant={maxConcurrent === n ? "default" : "outline"}
                  size="icon"
                  className="h-9 w-9 tabular-nums"
                  onClick={() => setMaxConcurrent(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            title={t("download.namingTitle")}
            desc={t("download.namingDesc")}
          >
            <div className="flex flex-wrap gap-2">
              {NAMINGS.map((n) => (
                <Button
                  key={n}
                  variant={fileNaming === n ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFileNaming(n)}
                >
                  {t(`naming.${n}`)}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            title={t("download.embedLyricsTitle")}
            desc={t("download.embedLyricsDesc")}
            control={
              <Switch checked={embedLyrics} onCheckedChange={setEmbedLyrics} />
            }
          />

          <SettingRow
            title={t("download.embedCoverTitle")}
            desc={t("download.embedCoverDesc")}
            control={
              <Switch checked={embedCover} onCheckedChange={setEmbedCover} />
            }
          />

          <SettingRow
            title={t("download.deleteFilesTitle")}
            desc={t("download.deleteFilesDesc")}
            control={
              <Switch
                checked={deleteDownloadFiles}
                onCheckedChange={setDeleteDownloadFiles}
              />
            }
          />
        </SettingsCard>
      </div>
    </ScrollArea>
  );
}
