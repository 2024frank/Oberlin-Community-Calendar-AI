/**
 * Generic scrape adapter.
 * Fetches any events page via the server-side proxy (no CORS), strips HTML,
 * then passes the clean text to OpenAI for event extraction.
 */

import type { NormalizedEvent } from "../types";
import { extractEventsFromText } from "./aiService";

/** Strip tags, scripts, styles — keep readable text under 6 000 chars */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 6000);
}

export async function scrapeSource(
  eventsUrl: string,
  sourceName: string
): Promise<NormalizedEvent[]> {
  // Fetch via server-side proxy
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(eventsUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy failed for ${sourceName}: ${res.status}`);

  const html = await res.text();
  const text = htmlToText(html);

  if (text.length < 50) {
    console.warn(`${sourceName}: page returned very little text — may be behind a login`);
    return [];
  }

  // AI extraction
  const extracted = await extractEventsFromText(text, sourceName, eventsUrl);
  return extracted as NormalizedEvent[];
}
