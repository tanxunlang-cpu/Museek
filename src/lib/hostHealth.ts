/**
 * Host liveness memory for resolved play URLs.
 *
 * The WebView's media element is the worst place to discover that a play URL is
 * unreachable: on Android a request to a host that does not resolve leaves the
 * element stuck at `readyState 0` and `play()` never rejects, so the player sits
 * on a silent loading state until its 10s start timeout and then dies with
 * "playback timed out" — and nothing tries another source.
 *
 * The native HTTP client *does* report the failure immediately, so the probe that
 * already runs before a URL is accepted is the right place to learn it. When a
 * probe fails at the connection level (DNS, refused, unreachable) the host is
 * remembered here, and every later probe of a URL on that host fails closed —
 * which is what lets the source race and the quality ladder fall through to a
 * source that actually works.
 *
 * Only connection-level failures are recorded. A timeout, a 4xx/5xx status or a
 * blocked HEAD all prove the opposite (the host answered), and a real CDN that
 * merely does not honour `Range` must not be written off for the session.
 */

/** How long a host stays written off. Long enough to cover one play attempt. */
const DEAD_TTL_MS = 10 * 60_000
/** Cap so a pathological source list cannot grow this without bound. */
const DEAD_MAX = 200

/** How long a proven-good host keeps its edge in a source race. */
const LIVE_TTL_MS = 30 * 60_000
const LIVE_MAX = 200

const deadHosts = new Map<string, number>()
const liveHosts = new Map<string, number>()

/**
 * Cache key for a host: scheme + host + port. HTTP and HTTPS reachability are
 * decided independently (a host can serve TLS and refuse cleartext, or the
 * reverse), so a failure on one must not condemn the other.
 */
export function hostKeyOf(url: string): string {
  try {
    const parsed = new URL(url)
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80")
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}`
  } catch {
    return ""
  }
}

/** True when a previous probe proved this URL's host unreachable. */
export function isHostKnownDead(url: string): boolean {
  const key = hostKeyOf(url)
  if (!key) return false
  const until = deadHosts.get(key)
  if (until === undefined) return false
  if (Date.now() >= until) {
    deadHosts.delete(key)
    return false
  }
  return true
}

/** Remember that nothing can be fetched from this URL's host for a while. */
export function markHostDead(url: string): void {
  const key = hostKeyOf(url)
  if (!key) return
  liveHosts.delete(key)
  if (deadHosts.size >= DEAD_MAX && !deadHosts.has(key)) {
    const oldest = deadHosts.keys().next().value
    if (oldest !== undefined) deadHosts.delete(oldest)
  }
  deadHosts.set(key, Date.now() + DEAD_TTL_MS)
}

/**
 * Remember that this host served real audio. Used only to *prefer* a URL in a
 * source race — never to reject one — so a wrong answer costs latency at worst.
 */
export function markHostLive(url: string): void {
  const key = hostKeyOf(url)
  if (!key) return
  if (liveHosts.size >= LIVE_MAX && !liveHosts.has(key)) {
    const oldest = liveHosts.keys().next().value
    if (oldest !== undefined) liveHosts.delete(oldest)
  }
  liveHosts.set(key, Date.now() + LIVE_TTL_MS)
}

/** True when a previous successful probe came from this URL's host. */
export function isHostKnownLive(url: string): boolean {
  const key = hostKeyOf(url)
  if (!key) return false
  const until = liveHosts.get(key)
  if (until === undefined) return false
  if (Date.now() >= until) {
    liveHosts.delete(key)
    return false
  }
  return true
}

/**
 * Suffixes of hosts the platform adapters themselves hand out — the CDNs behind
 * NetEase, QQ, KuGou, KuWo and Migu.
 *
 * These are preferred in a source race without waiting to be proven, because
 * they are the hosts the app's own built-in resolver returns: waiting for a live
 * marking would mean the first play of a session still races an aggregator
 * against them, which is exactly the coin toss that picked an unreachable host.
 */
const KNOWN_CDN_SUFFIXES = [
  "126.net",
  "163.com",
  "music.163.com",
  "qq.com",
  "gtimg.cn",
  "kugou.com",
  "kgimg.com",
  "kglink.com",
  "kuwo.cn",
  "koowo.com",
  "migu.cn",
  "music.migu.cn",
]

/** True for a host this app already knows serves audio. */
export function isKnownCdnHost(url: string): boolean {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ""
    }
  })()
  if (!host) return false
  return KNOWN_CDN_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

/**
 * Should a URL be preferred over an equally plausible one in a source race?
 * True for hosts we have just proven, and for the known platform CDNs.
 */
export function isHostTrusted(url: string): boolean {
  return isHostKnownLive(url) || isKnownCdnHost(url)
}

/** Drop a host's write-off (used when a URL on it turns out to work). */
export function clearHostDead(url: string): void {
  deadHosts.delete(hostKeyOf(url))
}

/** Test seam: forget every remembered host. */
export function resetHostHealth(): void {
  deadHosts.clear()
  liveHosts.clear()
}

/**
 * True when an error thrown by the native HTTP plugin proves the request never
 * reached an origin: DNS failure, refused/reset connection, unroutable host.
 *
 * Deliberately excludes timeouts. A timeout is equally consistent with a live
 * but slow CDN — which must keep working — and with a black-holed host, and the
 * cost of the two mistakes is not symmetric: writing off a slow host for ten
 * minutes breaks playback that would have worked.
 */
export function isConnectionLevelError(error: unknown): boolean {
  const text = errorText(error)
  return /getaddrinfo|enotfound|eai_again|econnrefused|econnreset|ehostunreach|enetunreach|connection (?:refused|reset|closed)|dns|no address associated|failed to lookup|unreachable|network is down|network is unreachable/i.test(
    text,
  )
}

function errorText(error: unknown): string {
  const seen = new Set<unknown>()
  const parts: string[] = []
  let current: unknown = error
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { message?: unknown; cause?: unknown; code?: unknown }
    if (typeof candidate.message === "string") parts.push(candidate.message)
    if (typeof candidate.code === "string") parts.push(candidate.code)
    current = candidate.cause
  }
  if (typeof error === "string") parts.push(error)
  return parts.join(" | ")
}
