import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import path from "path";
import fs from "fs";

const DATA_FILE =
  process.env.DATA_FILE_PATH ||
  (process.env.RENDER_DISK_PATH
    ? path.join(process.env.RENDER_DISK_PATH, "approved_events.json")
    : path.join(process.cwd(), "approved_events.json"));

const getApprovedEvents = (): unknown[] => {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }
  return [];
};

const saveApprovedEvents = (events: unknown[]) => {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
};

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

  app.post("/api/v1/sync", (req, res) => {
    const { events } = req.body as { events?: unknown[] };
    saveApprovedEvents(events || []);
    res.json({ status: "synced", count: (events || []).length });
  });

  app.get("/api/v1/approved-events", (req, res) => {
    const token = req.headers.authorization;
    const expectedToken = process.env.API_ACCESS_TOKEN || "oberlin_research_2026";

    if (!token || token !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ error: "Unauthorized. Missing or invalid research token." });
    }

    const events = getApprovedEvents();
    res.json({
      count: events.length,
      timestamp: new Date().toISOString(),
      data: events,
    });
  });
}
