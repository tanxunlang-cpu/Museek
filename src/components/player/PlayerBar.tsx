import {
  Music,
  List,
  MicVocal,
  Captions,
  CaptionsOff,
  Search,
  Maximize2,
  Loader2,
  PictureInPicture2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Controls } from "./Controls";
import { ProgressSlider } from "./ProgressSlider";
import { VolumeControl } from "./VolumeControl";
import { Button } from "@/components/ui/button";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PlatformBadge,
  QualityBadge,
  PLATFORM_BRAND,
} from "@/components/common/MetaBadges";
import { PLATFORM_ORDER } from "@/components/common/PlatformTabs";
import { DownloadSongButton } from "@/components/common/DownloadSongButton";
import { enterMiniPlayer } from "@/lib/miniPlayer";
import { canToggleDesktopLyrics, hideDesktopLyrics, openDesktopLyrics } from "@/lib/desktopLyrics";
import { usePlayerStore } from "@/stores/playerStore";
import { useDesktopLyricsStore } from "@/stores/desktopLyricsStore";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OnlineSource } from "@/types/music";

export function PlayerBar() {
  const {
    currentSong,
    currentQuality,
    currentPicUrl,
    queue,
    showQueue,
    showLyrics,
    lyricLines,
    status,
    setShowQueue,
    setShowLyrics,
  } = usePlayerStore();
  const t = useT();
  const navigate = useNavigate();
  const desktopLyricsVisible = useDesktopLyricsStore(
    (state) => state.isVisible,
  );
  const hasLyrics = lyricLines.length > 0;
  const desktopLyricsControlsDisabled = !canToggleDesktopLyrics({
    hasSong: Boolean(currentSong),
    hasLyrics,
    visible: desktopLyricsVisible,
  });
  const loading = status === "loading";
  // Prefer the resolved cover; while loading fall back to the song's own pic so
  // the art doesn't blank out — the spinner overlay still signals resolving.
  const coverSrc = currentPicUrl ?? currentSong?.meta.picUrl ?? null;

  // Jump to the search page pre-filled with this song on another platform — handy
  // when the current platform's copy is VIP/unavailable.
  const searchOther = (platform: OnlineSource) => {
    if (!currentSong) return;
    const query = `${currentSong.name} ${currentSong.singer}`.trim();
    navigate("/search", { state: { searchSong: { platform, query } } });
  };

  return (
    <footer
      className={cn(
        "shrink-0 flex flex-col gap-0.5 border-t border-border/50",
        "bg-player/85 backdrop-blur-xl supports-[backdrop-filter]:bg-player/70",
        "shadow-[0_-8px_24px_-16px_hsl(30_20%_10%/0.12)]",
      )}
    >
      {/* Full-width progress bar across the top — modern player layout */}
      <ProgressSlider />

      <div className="flex items-center px-2.5 sm:px-4 pb-2 sm:pb-3.5 gap-2 sm:gap-4">
        {/* Left: Song info */}
        <div
          className="flex items-center gap-2 sm:gap-3.5 flex-1 min-w-0 md:w-72 md:shrink-0 md:flex-initial cursor-pointer select-none"
          onClick={() => currentSong && setShowLyrics(true)}
        >
          {coverSrc ? (
            <ShortcutTooltip label={t("player.lyrics")} action="lyrics">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!loading) setShowLyrics(true);
              }}
              disabled={loading}
              // Inner clips overlay so it never paints past rounded corners.
              className="group relative h-10 w-10 sm:h-12 sm:w-12 shrink-0 transition-transform duration-150 ease-out active:scale-[0.96] disabled:pointer-events-none"
            >
              <span className="absolute inset-0 overflow-hidden rounded-xl shadow-[var(--shadow-border)]">
                <img
                  src={coverSrc}
                  alt=""
                  className={cn(
                    "h-full w-full object-cover transition-opacity duration-200",
                    loading && "opacity-60",
                  )}
                />
                {loading ? (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45">
                    <Loader2 size={16} className="animate-spin text-white" />
                  </span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 icon-hover-maximize">
                    <Maximize2 size={15} className="text-white" />
                  </span>
                )}
              </span>
            </button>
            </ShortcutTooltip>
          ) : (
            <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-muted flex items-center justify-center overflow-hidden shrink-0 shadow-[var(--shadow-border)]">
              {loading ? (
                <Loader2
                  size={16}
                  className="animate-spin text-muted-foreground"
                />
              ) : (
                <Music size={18} className="text-muted-foreground" />
              )}
            </div>
          )}
          {currentSong ? (
            <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <p
                  className="text-xs sm:text-sm font-semibold tracking-tight truncate"
                  title={currentSong.name}
                >
                  {currentSong.name}
                </p>
                <PlatformBadge source={currentSong.source} className="hidden sm:inline-flex" />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <p
                  className="text-[11px] sm:text-xs text-muted-foreground truncate min-w-0"
                  title={currentSong.singer}
                >
                  {currentSong.singer}
                </p>
                <QualityBadge quality={currentQuality} className="hidden sm:inline-flex" />
              </div>
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-muted-foreground truncate">{t("player.empty")}</p>
          )}
        </div>

        {/* Center: Controls */}
        <div className="flex shrink-0 justify-center">
          <Controls showSecondary={false} />
        </div>

        {/* Right: Volume + Download + Lyrics + Queue + Mini */}
        <div className="flex items-center gap-0.5 md:gap-1 w-auto md:w-80 justify-end shrink-0">
          <div className="hidden md:flex">
            <VolumeControl />
          </div>
          <div className="hidden sm:flex">
            <DownloadSongButton song={currentSong} className="h-9 w-9" />
          </div>
          <div className="hidden sm:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 icon-hover-search"
                  disabled={!currentSong}
                  title={t("player.searchOther")}
                >
                  <Search size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t("player.searchOther")}
                </DropdownMenuLabel>
                {PLATFORM_ORDER.filter((s) => s !== currentSong?.source).map(
                  (s) => (
                    <DropdownMenuItem key={s} onClick={() => searchOther(s)}>
                      <span
                        className="h-2 w-2 rounded-full mr-2 shrink-0"
                        style={{ backgroundColor: PLATFORM_BRAND[s] }}
                      />
                      {t(`platform.${s}`)}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="hidden sm:flex">
            <ShortcutTooltip label={t("player.lyrics")} action="lyrics">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 icon-hover-mic",
                  showLyrics && "text-primary",
                )}
                onClick={() => setShowLyrics(!showLyrics)}
                disabled={!currentSong || !hasLyrics}
              >
                <MicVocal size={16} />
              </Button>
            </ShortcutTooltip>
          </div>
          <div className="hidden md:flex">
            <ShortcutTooltip
              label={t(
                desktopLyricsVisible
                  ? "player.desktopLyricsClose"
                  : "player.desktopLyrics",
              )}
              action="desktopLyrics"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 icon-hover-captions",
                  desktopLyricsVisible && "text-primary",
                )}
                onClick={() =>
                  void (desktopLyricsVisible
                    ? hideDesktopLyrics()
                    : openDesktopLyrics())
                }
                disabled={desktopLyricsControlsDisabled}
              >
                {desktopLyricsVisible ? (
                  <CaptionsOff size={16} />
                ) : (
                  <Captions size={16} />
                )}
              </Button>
            </ShortcutTooltip>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-9 w-9 shrink-0 icon-hover-list",
              showQueue && "text-primary",
            )}
            onClick={() => setShowQueue(!showQueue)}
            disabled={queue.length === 0}
            title={t("player.queue")}
          >
            <List size={16} />
          </Button>
          <div className="hidden md:flex">
            <ShortcutTooltip label={t("player.miniMode")} action="mini">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 icon-hover-pip"
                onClick={() => void enterMiniPlayer()}
                disabled={!currentSong}
              >
                <PictureInPicture2 size={16} />
              </Button>
            </ShortcutTooltip>
          </div>
        </div>
      </div>
    </footer>
  );
}
