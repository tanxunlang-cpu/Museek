import type { MusicInfo } from "@/types/music"

/**
 * Flatten Museek's nested MusicInfo into the flat shape lx-music source scripts
 * expect (`songmid` at the top level, `types` / `_types`, per-source id fields).
 */
export function toLxMusicInfo(m: MusicInfo): Record<string, unknown> {
  const _types: Record<string, { size: string | null; hash?: string }> = {}
  for (const [k, v] of Object.entries(m.meta._qualitys ?? {})) {
    if (v) {
      _types[k] = {
        size: v.size,
        ...(v.hash || m.meta.hash ? { hash: v.hash || m.meta.hash } : {}),
      }
    }
  }
  if (m.meta.hash) {
    for (const q of ["128k", "320k", "flac", "flac24bit"]) {
      if (!_types[q]) {
        _types[q] = { size: null, hash: m.meta.hash }
      } else if (!_types[q].hash) {
        _types[q].hash = m.meta.hash
      }
    }
  }

  return {
    id: m.meta.songId || m.id,
    name: m.name,
    songName: m.name,
    singer: m.singer,
    artist: m.singer,
    source: m.source,
    songmid: m.meta.songId,
    songId: m.meta.songId,
    songid: m.meta.songId,
    mid: m.meta.songId,
    rid: m.meta.songId,
    musicId: m.meta.songId,
    musicrid: m.meta.songId,
    albumId: m.meta.albumId ?? "",
    albumMid: m.meta.albumId ?? "",
    albumName: m.albumName,
    album: m.albumName,
    interval: m.interval,
    img: m.meta.picUrl ?? null,
    lrc: null,
    otherSource: null,
    types: m.meta.qualitys,
    _types,
    typeUrl: {},
    hash: m.meta.hash,
    FileHash: m.meta.hash,
    HQFileHash: _types["320k"]?.hash ?? m.meta.hash,
    SQFileHash: _types["flac"]?.hash ?? m.meta.hash,
    strMediaMid: m.meta.strMediaMid ?? m.meta.songId,
    mediaId: m.meta.strMediaMid ?? m.meta.songId,
    copyrightId: m.meta.copyrightId ?? m.meta.songId,
    meta: {
      ...m.meta,
      _qualitys: _types,
    },
  }
}
