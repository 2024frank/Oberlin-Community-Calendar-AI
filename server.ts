import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE =
  process.env.DATA_FILE_PATH ||
  (process.env.RENDER_DISK_PATH
    ? path.join(process.env.RENDER_DISK_PATH, "approved_events.json")
    : path.join(process.cwd(), "approved_events.json"));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Helper to read approved events
const getApprovedEvents = () => {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return [];
};

// Helper to save approved events
const saveApprovedEvents = (events: any[]) => {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
};

// API: Sync from frontend
app.post("/api/v1/sync", (req, res) => {
  const { events } = req.body;
  saveApprovedEvents(events || []);
  res.json({ status: "synced", count: (events || []).length });
});

// API: Get approved events (with token auth)
app.get("/api/v1/approved-events", (req, res) => {
  const token = req.headers.authorization;
  const expectedToken = process.env.API_ACCESS_TOKEN || 'oberlin_research_2026';

  if (!token || token !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: "Unauthorized. Missing or invalid research token." });
  }

  const events = getApprovedEvents();
  res.json({
    count: events.length,
    timestamp: new Date().toISOString(),
    data: events
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Research API: GET http://localhost:${PORT}/api/v1/approved-events (Auth required)`);
  });
}

startServer();
