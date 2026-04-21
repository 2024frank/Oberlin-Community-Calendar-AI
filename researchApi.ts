import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { Redis } from "@upstash/redis";

const EVENTS_KEY = "approved_events";

function getRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    return new Redis({ url, token });
  }
  return null;
}

// In-memory fallback for local dev (no Redis configured)
let memoryStore: unknown[] = [];

async function loadEvents(): Promise<unknown[]> {
  const redis = getRedis();
  if (redis) {
    return (await redis.get<unknown[]>(EVENTS_KEY)) ?? [];
  }
  return memoryStore;
}

async function saveEvents(events: unknown[]): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(EVENTS_KEY, events);
  } else {
    memoryStore = events;
  }
}

/** Comma-separated list of allowed browser origins (e.g. your static site URL). */
export function setupCors(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const allowed = (process.env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = req.headers.origin as string | undefined;
    const allowOrigin =
      origin && allowed.includes(origin) ? origin : allowed.length === 1 ? allowed[0] : undefined;

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Max-Age", "86400");
      return res.status(204).end();
    }

    next();
  });
}

export function attachResearchApi(app: Express) {
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/v1/sync", async (req, res) => {
    const { events } = req.body as { events?: unknown[] };
    await saveEvents(events || []);
    res.json({ status: "synced", count: (events || []).length });
  });

  // ── Load events from Redis back into the UI (no auth — same origin) ──────────
  app.get("/api/v1/db-events", async (_req, res) => {
    const events = await loadEvents();
    res.json({ count: (events as any[]).length, data: events });
  });

  // ── Server-side push: reads Redis → pushes to CommunityHub → clears from Redis ──
  app.post("/api/v1/push-to-hub", async (req, res) => {
    const HUB_BASE = "https://oberlin.communityhub.cloud";
    const token: string | undefined = process.env.COMMUNITYHUB_TOKEN;

    try {
      const allEvents = (await loadEvents()) as any[];
      const toSend = allEvents.filter(
        (e: any) =>
          e.review_status === "approved" &&
          e.communityHubStatus !== "sent" &&
          e.communityHubStatus !== "exists"
      );

      if (toSend.length === 0) {
        return res.json({ status: "nothing_to_push", sent: 0, failed: 0 });
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];
      const remaining: any[] = [];

      for (const event of allEvents) {
        const needsPush =
          event.review_status === "approved" &&
          event.communityHubStatus !== "sent" &&
          event.communityHubStatus !== "exists";

        if (!needsPush) {
          // Keep this event in Redis as-is
          remaining.push(event);
          continue;
        }

        // Build payload matching CommunityHub's expected format
        const toUnix = (iso: string) => {
          const ms = Date.parse(iso);
          return isNaN(ms) ? null : Math.floor(ms / 1000);
        };
        const startTs = event.start_datetime ? toUnix(event.start_datetime) : null;
        const endTs   = event.end_datetime   ? toUnix(event.end_datetime)   : null;
        const locationName = [event.location_name, event.location_address]
          .filter(Boolean).join(", ");

        const payload = {
          name:                event.title,
          description:         event.description_short || (event.description_long || "").slice(0, 300),
          extendedDescription: event.description_long  || "",
          website:   event.event_url  || "",
          image:     event.image_url  || "",
          urlLink:   event.event_url  || "",
          isAnnouncement: false,
          eventType:      "ot",
          locationType:   "ph2",
          public:         true,
          email: "", phone: "", roomNum: "",
          timezone: "America/New_York",
          location: locationName ? { name: locationName } : null,
          sessions: startTs ? [{ start: startTs, end: endTs ?? startTs + 3600 }] : [],
          sponsors: event.organizer ? [{ name: event.organizer }] : [],
          postType: (event.tags || []).slice(0, 1).map((t: string) => ({ name: t })),
        };

        try {
          const hubRes = await fetch(`${HUB_BASE}/api/legacy/calendar/posts`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });

          if (!hubRes.ok) {
            const errText = await hubRes.text();
            throw new Error(`HTTP ${hubRes.status}: ${errText.replace(/<[^>]*>/g, " ").trim().slice(0, 150)}`);
          }

          // Successfully pushed — event is cleared from Redis (not added to remaining)
          sent++;
        } catch (err: any) {
          failed++;
          errors.push(`"${event.title}": ${err.message}`);
          // Keep failed events in Redis so they can be retried
          remaining.push(event);
        }
      }

      // Save remaining (un-pushed) events back to Redis
      await saveEvents(remaining);

      return res.json({ status: "done", sent, failed, errors });
    } catch (err: any) {
      return res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/v1/approved-events", async (req, res) => {
    const token = req.headers.authorization;
    const expectedToken = process.env.API_ACCESS_TOKEN || "oberlin_research_2026";

    if (!token || token !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ error: "Unauthorized. Missing or invalid research token." });
    }

    const events = await loadEvents();
    res.json({
      count: events.length,
      timestamp: new Date().toISOString(),
      data: events,
    });
  });
}
