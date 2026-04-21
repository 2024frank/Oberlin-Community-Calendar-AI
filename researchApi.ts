import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { Redis } from "@upstash/redis";

const EVENTS_KEY = "approved_events";

function getRedis(): Redis | null {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
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
