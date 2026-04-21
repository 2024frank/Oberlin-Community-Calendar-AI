/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NormalizedEvent, ReviewStatus } from "../types";

export function calculateQualityScore(event: Partial<NormalizedEvent>): {
  score: number;
  missingFields: string[];
  notes: string[];
  review_status: ReviewStatus;
} {
  let score = 0;
  const missingFields: string[] = [];
  const notes: string[] = [];

  // Required: title
  if (!event.title) missingFields.push("title");

  // Dates & Times
  if (event.start_date) score += 20; else missingFields.push("start_date");
  if (event.start_time) score += 20; else missingFields.push("start_time");
  if (event.end_date) score += 10; else notes.push("Missing end date");
  if (event.end_time) score += 10; else notes.push("Missing end time");

  // Location
  if (event.location_name) score += 10; else missingFields.push("location_name");
  if (event.location_address) score += 10; else notes.push("Missing precise address");

  // Descriptions
  if (event.description_long) score += 10; else missingFields.push("description_long");
  if (event.description_short) score += 10; else notes.push("Missing abbreviated sign description");

  // Connectivity
  if (event.event_url) score += 5; else notes.push("Missing source URL");
  
  // Research Metadata
  if (event.organizer) score += 5; else notes.push("Missing organizational sponsor");

  let review_status: ReviewStatus = 'needs_review';
  if (score >= 90) review_status = "ready";
  else if (score >= 70) review_status = "needs_review";
  else review_status = "needs_review";

  return { 
    score: Math.min(score, 100), 
    missingFields, 
    notes: [...notes, ...missingFields.map(f => `Required field missing: ${f}`)], 
    review_status 
  };
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;':   ' ',  '&amp;':  '&',  '&lt;':    '<',  '&gt;':    '>',
  '&quot;':  '"',  '&apos;': "'",  '&ndash;':  '–',  '&mdash;': '—',
  '&ldquo;': '"',  '&rdquo;': '"', '&lsquo;': '\u2018', '&rsquo;': '\u2019',
  '&hellip;': '…', '&bull;':  '•', '&copy;':   '©',  '&reg;':   '®',
  '&trade;': '™',  '&deg;':   '°', '&frac12;': '½',  '&frac14;': '¼',
  '&times;': '×',  '&divide;':'÷',
};

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>?/gm, ' ')
    // Named entities
    .replace(/&[a-z]+;/gi, m => HTML_ENTITIES[m.toLowerCase()] ?? ' ')
    // Numeric entities (e.g. &#8211; &#x2014;)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/gi,     (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeLocalistEvent(raw: any): NormalizedEvent {
  const customFields = raw.custom_fields || {};
  const filters = raw.filters || {};
  
  const instance = raw.event_instances?.[0]?.event_instance || {};
  const start = instance.start ? new Date(instance.start) : new Date();
  const end = instance.end ? new Date(instance.end) : null;
  
  const title = raw.title || "";
  const start_date = start.toISOString().split('T')[0];
  const start_time = start.toTimeString().split(' ')[0].substring(0, 5);
  const end_date = end ? end.toISOString().split('T')[0] : "";
  const end_time = end ? end.toTimeString().split(' ')[0].substring(0, 5) : "";

  const description = raw.description || "";
  const extended_description = stripHtml(description);
  
  const partialEvent: Partial<NormalizedEvent> = {
    external_event_id: String(raw.id),
    duplicate_key: `${title.toLowerCase().replace(/\s+/g, '-')}-${start_date}`,
    title,
    start_date,
    start_time,
    end_date,
    end_time,
    start_datetime: instance.start || "",
    end_datetime: instance.end || "",
    location_name: raw.location_name || "",
    location_address: raw.address || raw.location || "",
    organizer: customFields.organizational_sponsor || (filters.departments && filters.departments[0]?.name) || "Oberlin College",
    description_short: extended_description.substring(0, 200),
    description_long: extended_description,
    event_url: raw.localist_url || raw.url || "",
    image_url: raw.photo_url || "",
    tags: (filters.event_types || []).map((t: any) => t.name),
    source: "Oberlin College Events",
    recurrence: raw.recurring ? "Recurring" : "Single Event",
    cost: raw.free ? "Free" : (raw.ticket_cost || "Varies"),
    audience: (filters.target_audience || []).map((a: any) => a.name).join(", "),
    geographic_scope: raw.experience === 'online' ? 'online' : 'hyperlocal',
    ai_geographic_scope: raw.experience === 'online' ? 'online' : 'hyperlocal',
    quality_notes: [],
    missing_fields: []
  };

  const { score, missingFields, notes, review_status: calculatedStatus } = calculateQualityScore(partialEvent);

  return {
    ...partialEvent,
    quality_score: score,
    missing_fields: missingFields,
    quality_notes: notes,
    review_status: calculatedStatus,
    fetched_at: new Date().toISOString(),
    raw_payload: raw
  } as NormalizedEvent;
}

export function normalizeHeritageCenterEvent(raw: any): NormalizedEvent {
  const title = stripHtml(raw.title || "");
  const startStr = raw.start || "";
  const endStr = raw.end || startStr;
  
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  const start_date = start.toISOString().split('T')[0];
  const start_time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const end_date = end.toISOString().split('T')[0];
  const end_time = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  // Parsing image src from HTML: <img src="..." ... />
  const imageMatch = raw.feature_image_calendar ? raw.feature_image_calendar.match(/src=["']([^"']+)["']/) : null;
  const image_url = imageMatch ? imageMatch[1] : "";

  // Parsing link href from title HTML or button
  const linkMatch = (raw.title || "").match(/href=["']([^"']+)["']/) || (raw.view_more_button || "").match(/href=["']([^"']+)["']/);
  const event_url = linkMatch ? linkMatch[1] : "";

  const description_long = stripHtml(raw.post_event_excerpt || "");

  const partialEvent: Partial<NormalizedEvent> = {
    external_event_id: `ohc-${raw.id || Math.random().toString(36).substr(2, 9)}`,
    duplicate_key: `ohc-${title.toLowerCase().replace(/\s+/g, '-')}-${start_date}`,
    title,
    start_date,
    start_time,
    end_date,
    end_time,
    start_datetime: startStr,
    end_datetime: endStr,
    location_name: "Oberlin Heritage Center",
    location_address: "73 1/2 S Professor St, Oberlin, OH 44074",
    organizer: "Oberlin Heritage Center",
    description_short: description_long.substring(0, 200),
    description_long,
    event_url,
    image_url,
    tags: ["History", "Tour", "Cultural"],
    source: "Oberlin Heritage Center",
    recurrence: "Special Event",
    cost: "Varies",
    audience: "General Public",
    geographic_scope: 'city',
    ai_geographic_scope: 'city',
    quality_notes: [],
    missing_fields: []
  };

  const { score, missingFields, notes, review_status: calculatedStatus } = calculateQualityScore(partialEvent);

  return {
    ...partialEvent,
    quality_score: score,
    missing_fields: missingFields,
    quality_notes: notes,
    review_status: calculatedStatus,
    fetched_at: new Date().toISOString(),
    raw_payload: raw
  } as NormalizedEvent;
}
