const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Resolves the preferred default directory for storing downloaded audio. */
export async function resolveSystemDefaultDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { audioDir, downloadDir } = await import("@tauri-apps/api/path");
    let dir: string | null = null;
    try {
      dir = await audioDir();
    } catch {
      /* audioDir might fail or be empty */
    }
    if (!dir) {
      try {
        dir = await downloadDir();
      } catch {
        /* downloadDir might fail */
      }
    }
    return dir ? dir.replace(/[/\\]+$/, "") : null;
  } catch {
    return null;
  }
}

/** Resolves the system Music/Audio directory. */
export async function resolveSystemAudioDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { audioDir } = await import("@tauri-apps/api/path");
    const dir = await audioDir();
    return dir ? dir.replace(/[/\\]+$/, "") : null;
  } catch {
    return null;
  }
}

/** Resolves the system Downloads directory. */
export async function resolveSystemDownloadsDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { downloadDir } = await import("@tauri-apps/api/path");
    const dir = await downloadDir();
    return dir ? dir.replace(/[/\\]+$/, "") : null;
  } catch {
    return null;
  }
}
