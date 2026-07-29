import net from "net";
import dns from "dns/promises";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true; // be safe
  const [a, b] = parts;
  return (
    a === 127 || a === 10 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** SSRF guard: reject URLs whose host resolves to loopback/private/link-local space. */
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Blocked: ${host} is not a public host`);
  }
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
    if (isPrivateIp(host)) throw new Error(`Blocked: ${host} is a private address`);
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Blocked: ${host} resolves to a private address`);
  }
}

/**
 * fetch() that re-validates the host on EVERY redirect hop (manual redirect).
 * `redirect: "follow"` validates only the initial URL, so an attacker-controlled
 * public endpoint can 3xx-redirect into private/internal space (cloud metadata,
 * 10.x, 169.254.169.254) and the guard never sees it. This follows each hop by
 * hand and re-runs assertPublicHost first. It also strips secret-bearing headers
 * (Authorization/Cookie + any caller-named ones) when a redirect crosses to a
 * different host, so a redirect can't exfiltrate the tool's API key.
 *
 * `guard` mirrors the caller's authForced(): off on a self-host install, where
 * reaching a private host is a legitimate use — but redirects are still followed
 * by hand (and capped) so behaviour stays consistent.
 */
export async function guardedFetch(
  input: string | URL,
  init: RequestInit = {},
  opts: { guard?: boolean; maxRedirects?: number; sensitiveHeaders?: string[] } = {}
): Promise<Response> {
  const { guard = true, maxRedirects = 4, sensitiveHeaders = [] } = opts;
  const strip = new Set(
    ["authorization", "cookie", ...sensitiveHeaders.map((h) => h.toLowerCase())]
  );
  let current = new URL(input);
  const headers = new Headers(init.headers);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  for (let hop = 0; ; hop++) {
    if (guard) await assertPublicHost(current);
    const res = await fetch(current, { ...init, method, headers, body, redirect: "manual" });
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
    const location = res.headers.get("location");
    if (!location) return res; // a 3xx with no target — hand it back as-is
    if (hop >= maxRedirects) throw new Error(`Blocked: too many redirects (>${maxRedirects})`);
    const next = new URL(location, current);
    // 303 (and, per browser behaviour, 301/302 on an unsafe method) → GET, no body.
    if (
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD")
    ) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
    }
    // A cross-host redirect must not carry the original secret headers onward.
    if (next.host !== current.host) for (const h of strip) headers.delete(h);
    current = next;
  }
}
