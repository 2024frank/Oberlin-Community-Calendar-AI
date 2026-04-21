/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NormalizedEvent } from "../types";
import { normalizeLocalistEvent, normalizeHeritageCenterEvent } from "./normalizationService";

export interface LocalistFetchOptions {
  days?: number;
  pp?: number;
}

const LOCALIST_BASE = "https://calendar.oberlin.edu/api/2";
const HUB_BASE      = "https://oberlin.communityhub.cloud";

// ─── Localist (Oberlin College) — with full pagination ───────────────────────

export async function fetchLocalistEvents(
  options: LocalistFetchOptions = {}
): Promise<NormalizedEvent[]> {
  const { days = 90, pp = 100 } = options;
  const all: NormalizedEvent[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${LOCALIST_BASE}/events`);
    url.searchParams.set("days", String(days));
    url.searchParams.set("pp",   String(pp));
    url.searchParams.set("page", String(page));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Localist API error: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const events: any[] = payload.events || [];

    const live = events
      .filter((e: any) => e.event?.status === "live")
      .map((e: any) => normalizeLocalistEvent(e.event));

    all.push(...live);

    // Localist returns a `page` object with `current` and `total`
    const pageInfo = payload.page;
    if (pageInfo && pageInfo.current < pageInfo.total) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return all;
}

// ─── Heritage Center ──────────────────────────────────────────────────────────

export async function fetchHeritageCenterEvents(): Promise<NormalizedEvent[]> {
  const url =
    "https://www.oberlinheritagecenter.org/wp-admin/admin-ajax.php?action=fetch_Events";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Heritage Center API error: ${response.status}`);

    const events = await response.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events
      .filter((e: any) => e.start && new Date(e.start) >= today)
      .map((e: any) => normalizeHeritageCenterEvent(e));
  } catch (error) {
    console.error("Failed to fetch Heritage Center events:", error);
    return [];
  }
}

// ─── CommunityHub — normalize posts into NormalizedEvent ─────────────────────

export async function fetchCommunityHubEvents(): Promise<NormalizedEvent[]> {
  const url = `${HUB_BASE}/api/legacy/calendar/posts?limit=10000&page=0&filter=future&tab=main-feed&isJobs=false&order=ASC&postType=All&allPost`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CommunityHub API error: ${res.status}`);
    const data = await res.json();
    const posts: any[] = data.posts || [];
    const today = new Date();

    return posts
      .filter((p: any) => p.next?.start && new Date(p.next.start * 1000) >= today)
      .map((p: any): NormalizedEvent => {
        const startMs  = p.next.start * 1000;
        const endMs    = p.next.end   ? p.next.end * 1000 : startMs + 3600_000;
        const startDt  = new Date(startMs);
        const endDt    = new Date(endMs);

        const pad  = (n: number) => String(n).padStart(2, "0");
        const ymd  = (d: Date) =>
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const hms  = (d: Date) =>
          `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

        return {
          external_event_id: `communityhub-${p.id}`,
          duplicate_key:     `${(p.name || "").toLowerCase().replace(/\W+/g, "-")}-${ymd(startDt)}`,
          title:             p.name || "Untitled",
          start_date:        ymd(startDt),
          start_time:        hms(startDt),
          end_date:          ymd(endDt),
          end_time:          hms(endDt),
          start_datetime:    startDt.toISOString(),
          end_datetime:      endDt.toISOString(),
          location_name:     p.location?.name    || "",
          location_address:  p.location?.address || "",
          organizer:         p.sponsors?.[0]?.name || "",
          description_short: p.description       || "",
          description_long:  p.extendedDescription || p.description || "",
          event_url:         p.website || `${HUB_BASE}/events/${p.id}`,
          image_url:         p.image  || "",
          tags:              p.postType?.map((t: any) => t.name) || [],
          source:            "CommunityHub",
          recurrence:        "",
          cost:              "",
          audience:          "",
          geographic_scope:  "city",
          quality_score:     80,
          quality_notes:     [],
          missing_fields:    [],
          review_status:     "ready",
          fetched_at:        new Date().toISOString(),
          ai_geographic_scope: "city",
          raw_payload:       p,
        };
      });
  } catch (error) {
    console.error("Failed to fetch CommunityHub events:", error);
    return [];
  }
}
