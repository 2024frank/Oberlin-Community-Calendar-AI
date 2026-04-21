/**
 * Server-side proxy — fetches any external URL so the browser avoids CORS.
 * Called by scrapeAdapter.ts as /api/proxy?url=<encoded-url>
 */
export default async function handler(req: any, res: any) {
  const target = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;

  if (!target) {
    return res.status(400).json({ error: "url param required" });
  }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OberlinCommunityCalendar/1.0; +https://oberlin-community-calendar-ai.vercel.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const text = await response.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300"); // cache 5 min on CDN
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
