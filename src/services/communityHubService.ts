/**
 * CommunityHub service
 *
 * Duplicate detection uses OpenAI embeddings (text-embedding-3-small) so that
 * semantically identical events are caught regardless of how they were worded:
 *   "Tai Chi for Arthritis" == "Wednesday Arthritis Tai Chi Class" == "Tai Chi & Fall Prevention"
 *
 * Flow:
 *   1. Fetch all upcoming CommunityHub posts (once per ingest batch).
 *   2. Embed every post as  "title | date | location"  → cache as float vectors.
 *   3. Embed each incoming event the same way.
 *   4. Cosine-similarity ≥ DUPE_THRESHOLD  →  mark as 'exists'.
 *   5. Anything below  →  mark as 'new'.
 */

import OpenAI from 'openai';
import type { NormalizedEvent, StagingEvent } from '../types';

const HUB_BASE      = 'https://oberlin.communityhub.cloud';
const EMBED_MODEL   = 'text-embedding-3-small';
const DUPE_THRESHOLD = 0.82;   // tune: higher = stricter, lower = more aggressive

const openai = new OpenAI({
  apiKey: (import.meta as any).env?.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityHubPost {
  id: number;
  name: string;
  description: string;
  extendedDescription: string;
  isAnnouncement: boolean;
  image: string;
  approved: boolean;
  website: string;
  email: string;
  phone: string;
  next: { start: number; end: number } | null;
  sessions: { id: number; start: number; end: number }[];
  location: { id?: number; name: string; address: string } | null;
  sponsors: { id: number; name: string }[];
  postType: { id: number; name: string; type: string }[];
}

// ─── Fetch hub posts ──────────────────────────────────────────────────────────

export async function fetchCommunityHubPosts(): Promise<CommunityHubPost[]> {
  const url = `${HUB_BASE}/api/legacy/calendar/posts?limit=10000&page=0&filter=future&tab=main-feed&isJobs=false&order=ASC&postType=All&allPost`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CommunityHub fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.posts as CommunityHubPost[]) ?? [];
}

// ─── Text fingerprint ─────────────────────────────────────────────────────────
// Combine the most distinctive fields into one string for embedding.

function hubPostFingerprint(post: CommunityHubPost): string {
  const date = post.next?.start
    ? new Date(post.next.start * 1000).toISOString().slice(0, 10)
    : '';
  const location = post.location?.name ?? '';
  return `${post.name} | ${date} | ${location}`.trim();
}

function eventFingerprint(event: NormalizedEvent): string {
  return `${event.title} | ${event.start_date ?? ''} | ${event.location_name ?? ''}`.trim();
}

// ─── Embeddings & cosine similarity ──────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA === 0 || magB === 0 ? 0 : dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
  // results come back in the same order as input
  return res.data.map(d => d.embedding);
}

// ─── Core: enrich events with hub status ─────────────────────────────────────

export async function enrichWithHubStatus<T extends NormalizedEvent>(
  events: T[]
): Promise<T[]> {
  if (events.length === 0) return events;

  // 1. Fetch hub
  let hubPosts: CommunityHubPost[] = [];
  try {
    hubPosts = await fetchCommunityHubPosts();
  } catch (err) {
    console.error('CommunityHub fetch failed — marking all as unknown:', err);
    return events.map(e => ({ ...e, communityHubStatus: 'unknown' as const, communityHubId: null }));
  }

  if (hubPosts.length === 0) {
    return events.map(e => ({ ...e, communityHubStatus: 'new' as const, communityHubId: null }));
  }

  // 2. Embed hub posts
  const hubTexts = hubPosts.map(hubPostFingerprint);
  let hubVectors: number[][];
  try {
    hubVectors = await embedBatch(hubTexts);
  } catch (err) {
    console.error('Embedding hub posts failed:', err);
    return events.map(e => ({ ...e, communityHubStatus: 'unknown' as const, communityHubId: null }));
  }

  // 3. Embed incoming events
  const eventTexts = events.map(eventFingerprint);
  let eventVectors: number[][];
  try {
    eventVectors = await embedBatch(eventTexts);
  } catch (err) {
    console.error('Embedding incoming events failed:', err);
    return events.map(e => ({ ...e, communityHubStatus: 'unknown' as const, communityHubId: null }));
  }

  // 4. For each event, find the closest hub post
  return events.map((event, i) => {
    const evVec = eventVectors[i];
    let bestScore = 0;
    let bestPost: CommunityHubPost | null = null;

    for (let j = 0; j < hubPosts.length; j++) {
      const score = cosine(evVec, hubVectors[j]);
      if (score > bestScore) {
        bestScore = score;
        bestPost  = hubPosts[j];
      }
    }

    const isDupe = bestScore >= DUPE_THRESHOLD;
    return {
      ...event,
      communityHubStatus: isDupe ? 'exists' as const : 'new' as const,
      communityHubId:     isDupe ? bestPost!.id : null,
    };
  });
}

// ─── Post a single approved event to CommunityHub ────────────────────────────

function toUnixSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * POST a single approved event to CommunityHub.
 *
 * Payload mirrors the structure returned by GET /api/legacy/calendar/posts,
 * so the hub can parse it correctly.
 *
 * Auth: set VITE_COMMUNITYHUB_TOKEN in Vercel env vars if the hub requires
 * a Bearer token.  If not set, the request is sent without auth (works for
 * open hubs).
 */
export async function postToCommunityHub(event: StagingEvent): Promise<{ id: number }> {
  const startTs = event.start_datetime ? toUnixSeconds(event.start_datetime) : null;
  const endTs   = event.end_datetime   ? toUnixSeconds(event.end_datetime)   : null;

  // Build location string matching CommunityHub's format
  const locationName = [event.location_name, event.location_address]
    .filter(Boolean)
    .join(', ');

  const payload = {
    // Core identity
    name:               event.title,
    description:        event.description_short || event.description_long?.slice(0, 300) || '',
    extendedDescription: event.description_long || '',

    // Media & links
    website:   event.event_url  || '',
    image:     event.image_url  || '',
    urlLink:   event.event_url  || '',

    // Type flags
    isAnnouncement: false,
    eventType:      'ot',           // 'ot' = other/event  (vs 'an' = announcement)
    locationType:   'ph2',          // physical location type used by CommunityHub
    public:         true,

    // Contact (leave blank — organizer info isn't always available)
    email:   '',
    phone:   '',
    roomNum: '',

    // Timezone
    timezone: 'America/New_York',

    // Location object  (CommunityHub expects { name: "<address string>" })
    location: locationName
      ? { name: locationName }
      : null,

    // Sessions — array of unix-second timestamps
    sessions: startTs
      ? [{ start: startTs, end: endTs ?? startTs + 3600 }]
      : [],

    // Optional metadata
    sponsors: event.organizer
      ? [{ name: event.organizer }]
      : [],
    postType: event.tags?.slice(0, 1).map(t => ({ name: t })) ?? [],
  };

  // ── Route through same-origin Vercel proxy to avoid CORS ────────────────
  // Browser → /api/v1/hub-proxy (Vercel, same origin) → CommunityHub
  // This bypasses the browser's CORS preflight block on cross-origin POSTs.
  const res = await fetch('/api/v1/hub-proxy', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json.error || `Proxy error ${res.status}`);
  }

  return { id: json.id ?? 0 };
}
