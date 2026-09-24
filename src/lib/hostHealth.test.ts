/**
 * Checks for the play-URL liveness rules that decide whether a resolved URL is
 * handed to the media element or thrown away so another source can be tried.
 *
 * Run with: node --experimental-strip-types src/lib/hostHealth.test.ts
 * (plain node, no runner — same style as localMusic/cue.test.ts; imports are
 * relative and extension-explicit so node resolves them without the `@/` alias)
 */

import {
  clearHostDead,
  hostKeyOf,
  isConnectionLevelError,
  isHostKnownDead,
  isHostKnownLive,
  isKnownCdnHost,
  isHostTrusted,
  markHostDead,
  markHostLive,
  resetHostHealth,
} from "./hostHealth.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`);
}

function runHostHealthTests(): void {
  resetHostHealth();

  // --- host keys -----------------------------------------------------------
  assert(
    hostKeyOf("https://music-dl.sayqz.com/api/?x=1") ===
      "https://music-dl.sayqz.com:443",
    "https key includes the default port",
  );
  assert(
    hostKeyOf("http://example.com:8080/a.mp3") === "http://example.com:8080",
    "explicit port is kept",
  );
  assert(hostKeyOf("not a url") === "", "an unparsable url has no key");

  // The same host over TLS and cleartext is decided independently.
  markHostDead("https://example.com/a.mp3");
  assert(
    isHostKnownDead("https://example.com/b.mp3"),
    "a write-off covers the whole https host",
  );
  assert(
    !isHostKnownDead("http://example.com/b.mp3"),
    "cleartext on the same host is a different decision",
  );
  clearHostDead("https://example.com/a.mp3");
  assert(
    !isHostKnownDead("https://example.com/b.mp3"),
    "clearHostDead forgets the host",
  );

  // --- connection-level classification -------------------------------------
  assert(
    isConnectionLevelError(
      new Error(
        "error sending request for url (https://music-dl.sayqz.com/x): error trying to connect: dns error: failed to lookup address information: Name or service not known",
      ),
    ),
    "a DNS failure counts as connection-level",
  );
  assert(
    isConnectionLevelError(new Error("connect: connection refused")),
    "a refused connection counts",
  );
  assert(
    isConnectionLevelError({ message: "outer", cause: { code: "ENOTFOUND" } }),
    "nested causes are searched",
  );
  // A timeout proves nothing: a slow CDN must not be written off.
  assert(
    !isConnectionLevelError(new Error("Timed out after 3000ms")),
    "a timeout is not connection-level",
  );
  assert(
    !isConnectionLevelError(new Error("HTTP 404")),
    "an HTTP status is not connection-level",
  );

  // --- known platform CDNs -------------------------------------------------
  assert(isKnownCdnHost("https://m801.music.126.net/a.mp3"), "126.net is a CDN");
  assert(
    isKnownCdnHost("https://dl.stream.qqmusic.qq.com/a.mp3"),
    "qq.com is a CDN",
  );
  assert(
    !isKnownCdnHost("https://music-dl.sayqz.com/api/"),
    "an unknown aggregator is not treated as a CDN",
  );
  assert(
    !isKnownCdnHost("https://notqq.com/a.mp3"),
    "a suffix must be on a label boundary, not a substring",
  );

  // --- trust --------------------------------------------------------------
  markHostLive("https://music.3e0.cn/a.mp3");
  assert(isHostKnownLive("https://music.3e0.cn/b.mp3"), "proven live host");
  assert(isHostTrusted("https://music.3e0.cn/b.mp3"), "live implies trusted");
  assert(
    isHostTrusted("https://m701.music.126.net/a.mp3"),
    "a known CDN is trusted without a probe",
  );
  assert(
    !isHostTrusted("https://music-dl.sayqz.com/api/"),
    "an unknown host is not trusted",
  );
  // A host cannot be both: writing it off drops any live marking.
  markHostDead("https://music.3e0.cn/a.mp3");
  assert(
    !isHostKnownLive("https://music.3e0.cn/b.mp3"),
    "a write-off clears the live marking",
  );
  assert(isHostKnownDead("https://music.3e0.cn/b.mp3"), "and records the death");

  resetHostHealth();
  assert(
    !isHostKnownDead("https://music.3e0.cn/b.mp3"),
    "reset forgets everything",
  );
}

runHostHealthTests();
console.log("hostHealth: ok");
