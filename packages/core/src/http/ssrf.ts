import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export class SsrfError extends Error {
  readonly code = "ssrf_blocked";

  constructor() {
    super("Blocked network address");
    this.name = "SsrfError";
  }
}

export type DnsLookup = (hostname: string) => Promise<string[]>;

const BLOCKED_NAMES = new Set(["localhost", "metadata.google.internal", "metadata.google.com"]);

export function isBlockedIp(input: string): boolean {
  const ip = input.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isBlockedV4(mapped);
  }
  if (isIP(ip) === 4) return isBlockedV4(ip);
  if (isIP(ip) === 6) return isBlockedV6(ip);
  return true;
}

function isBlockedV4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return true;
    const value = Number(part);
    if (value > 255 || (part.length > 1 && part.startsWith("0"))) return true;
    numbers.push(value);
  }
  const [a, b, c] = numbers;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedV6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::" || value === "::1") return true;
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && isBlockedV4(dotted[1])) return true;
  const head = value.split(":")[0] ?? "";
  if (!head) return value === "::" || value === "::1";
  const first = Number.parseInt(head, 16);
  if (!Number.isFinite(first)) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

export function choosePinnedAddress(answers: string[]): string {
  const first = answers[0]?.trim().toLowerCase();
  if (!first || isBlockedIp(first)) throw new SsrfError();
  return first;
}

export async function systemDnsLookup(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function resolvePinnedAddress(hostname: string, lookup: DnsLookup = systemDnsLookup): Promise<string> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host.includes("%") ||
    BLOCKED_NAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new SsrfError();
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError();
    return host;
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith("-") || host.endsWith("-") || host.includes("..")) {
    throw new SsrfError();
  }
  let answers: string[];
  try {
    answers = await lookup(host);
  } catch {
    throw new SsrfError();
  }
  return choosePinnedAddress(answers);
}

export type HttpHop = { url: string; address: string };

export async function pinnedHttpRequest(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  followRedirects?: boolean;
  allowHost?: (hostname: string) => boolean;
  lookup?: DnsLookup;
}): Promise<{ status: number; body: string; truncated: boolean; finalUrl: string; hops: HttpHop[] }> {
  const lookup = input.lookup ?? systemDnsLookup;
  let current = parseHttpUrl(input.url);
  let method = input.method.toUpperCase();
  let body = input.body;
  const headers = lowerHeaders(input.headers);
  const hops: HttpHop[] = [];
  const maxRedirects = input.maxRedirects ?? 5;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (input.allowHost && !input.allowHost(current.hostname)) throw new SsrfError();
    const address = await resolvePinnedAddress(current.hostname, lookup);
    hops.push({ url: current.toString(), address });
    const response = await requestOnce({
      url: current,
      address,
      method,
      headers,
      body,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
    });
    const location = headerValue(response.headers.location);
    const isRedirect = input.followRedirects !== false && [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect || !location || redirect === maxRedirects) {
      return {
        status: response.status,
        body: response.body,
        truncated: response.truncated,
        finalUrl: current.toString(),
        hops,
      };
    }
    const next = parseHttpUrl(new URL(location, current).toString());
    if (next.hostname !== current.hostname) {
      delete headers.authorization;
      delete headers.cookie;
      delete headers["proxy-authorization"];
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
      method = "GET";
      body = undefined;
      delete headers["content-type"];
    }
    current = next;
  }
  throw new SsrfError();
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SsrfError();
  }
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) throw new SsrfError();
  return url;
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) output[key.toLowerCase()] = value;
  return output;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function requestOnce(input: {
  url: URL;
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }> {
  const transport = input.url.protocol === "https:" ? https : http;
  const family = input.address.includes(":") ? 6 : 4;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: { status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("request_failed"));
    };
    const req = transport.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port || (input.url.protocol === "https:" ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: { ...input.headers, host: input.url.host },
        servername: input.url.hostname,
        lookup: (_hostname, options, callback) => {
          const done = typeof options === "function" ? options : callback;
          if (typeof done !== "function") return;
          const all = typeof options === "object" && options !== null && "all" in options && options.all === true;
          if (all) done(null, [{ address: input.address, family }]);
          else done(null, input.address, family);
        },
        timeout: input.timeoutMs,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > input.maxBytes) {
            truncated = true;
            const keep = chunk.length - (size - input.maxBytes);
            if (keep > 0) chunks.push(chunk.subarray(0, keep));
            res.destroy();
            req.destroy();
            finish({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated: true,
            });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        });
        res.on("error", fail);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", fail);
    if (input.body && input.method !== "GET" && input.method !== "HEAD") req.write(input.body);
    req.end();
  });
}
