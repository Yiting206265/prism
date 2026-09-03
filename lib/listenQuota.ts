import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.VERCEL
  ? join('/tmp', 'speak')
  : join(process.cwd(), '.cache', 'speak');

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Total Listen plays across all visitors (UTC day). */
export function globalLimit(): number {
  return envInt('LISTEN_MAX_PER_DAY', 30);
}

/** Listen plays per visitor IP (UTC day). */
export function ipLimit(): number {
  return envInt('LISTEN_MAX_PER_IP_PER_DAY', 5);
}

/** Cloudflare Flux cover generations (UTC day). Stay well under the 10k Neuron free pool. */
export function cfCoverLimit(): number {
  return envInt('CF_COVER_MAX_PER_DAY', 80);
}

/** Groq chat calls for summaries + cover prompts (UTC day). */
export function groqLimit(): number {
  return envInt('GROQ_MAX_PER_DAY', 80);
}

type QuotaFile = {
  day: string;
  total: number;
  ips: Record<string, number>;
  cfCover: number;
  groq: number;
};

function quotaPath(): string {
  return join(CACHE_DIR, 'quota.json');
}

function readQuota(): QuotaFile {
  const day = todayUTC();
  const empty: QuotaFile = { day, total: 0, ips: {}, cfCover: 0, groq: 0 };
  try {
    if (!existsSync(quotaPath())) return empty;
    const data = JSON.parse(readFileSync(quotaPath(), 'utf8')) as Partial<QuotaFile>;
    if (data.day !== day) return empty;
    return {
      day,
      total: Number(data.total) || 0,
      ips: data.ips && typeof data.ips === 'object' ? data.ips : {},
      cfCover: Number(data.cfCover) || 0,
      groq: Number(data.groq) || 0,
    };
  } catch {
    return empty;
  }
}

function writeQuota(q: QuotaFile): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(quotaPath(), JSON.stringify(q));
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return (headers.get('x-real-ip') || 'unknown').slice(0, 64);
}

export type QuotaDenial = 'disabled' | 'global' | 'ip';

/** Reserve one Listen slot. Returns a denial reason, or null if allowed. */
export function takeListenSlot(ip: string): QuotaDenial | null {
  const gMax = globalLimit();
  const iMax = ipLimit();
  if (gMax === 0 || iMax === 0) return 'disabled';

  const q = readQuota();
  const used = q.ips[ip] ?? 0;
  if (q.total >= gMax) return 'global';
  if (used >= iMax) return 'ip';

  q.total += 1;
  q.ips[ip] = used + 1;
  writeQuota(q);
  return null;
}

/** True if a Cloudflare Flux cover generation is allowed. */
export function takeCfCoverSlot(): boolean {
  const max = cfCoverLimit();
  if (max === 0) return false;
  const q = readQuota();
  if (q.cfCover >= max) return false;
  q.cfCover += 1;
  writeQuota(q);
  return true;
}

/** True if a Groq chat call is allowed. */
export function takeGroqSlot(): boolean {
  const max = groqLimit();
  if (max === 0) return false;
  const q = readQuota();
  if (q.groq >= max) return false;
  q.groq += 1;
  writeQuota(q);
  return true;
}
