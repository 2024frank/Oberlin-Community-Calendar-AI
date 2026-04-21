/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from "openai";
import { NormalizedEvent, GeographicScope } from "../types";
import { calculateQualityScore } from "./normalizationService";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: (import.meta as any).env?.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // Essential for client-side demo, though server-side is preferred.
});

/**
 * Extract event information from text using OpenAI.
 * Replaces the previous Gemini implementation as per research requirements.
 */
export async function extractEventsFromText(text: string, sourceName: string, sourceUrl: string): Promise<Partial<NormalizedEvent>[]> {
  const hasKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!hasKey) {
    console.error("OPENAI_API_KEY is not defined in environment variables.");
    return [];
  }

  try {
    const prompt = `
      Extract event information from the following text provided by ${sourceName} (${sourceUrl}).
      Normalize data into the Oberlin Research Instrument format.
      
      CRITICAL INSTRUCTIONS:
      1. Decision on geographic_scope MUST be one of: 'hyperlocal', 'city', 'lorain_county', 'northeast_ohio', 'state', 'national', 'online'.
      2. Decision on duplicate_key: Generate a unique slug based on title + date + location.
      3. For quality_notes: List exactly what is missing or low quality (e.g., "Missing precise end time", "Vague location").
      4. For destination: Default to 'Environmental Dashboard'.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert event data extraction assistant for Oberlin College research. Return a JSON object with an 'events' array." },
        { role: "user", content: `${prompt}\n\nCONTENT:\n${text}` }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || '{"events": []}';
    const parsed = JSON.parse(content);
    const results = parsed.events || [];
    
    return results.map((item: any) => {
      // Create helper datetimes for sorting
      const startIso = `${item.start_date}T${item.start_time || '00:00:00'}`;
      const endIso = item.end_date ? `${item.end_date}T${item.end_time || '23:59:59'}` : startIso;

      // Run deterministic quality audit
      const audit = calculateQualityScore(item);

      return {
        ...item,
        start_datetime: startIso,
        end_datetime: endIso,
        source: sourceName,
        review_status: audit.review_status,
        quality_score: audit.score,
        quality_notes: [...(item.quality_notes || []), ...audit.notes],
        missing_fields: audit.missingFields,
        fetched_at: new Date().toISOString(),
        raw_payload: item
      };
    });
  } catch (error) {
    console.error("OpenAI Extraction error:", error);
    return [];
  }
}

/**
 * AI enrichment pass: fills missing fields and re-classifies geographic scope
 * for each event. Runs AFTER raw fetch, BEFORE hub deduplication.
 * Processes in batches of 10 to stay within token limits.
 */
export async function enrichEventFields(events: NormalizedEvent[]): Promise<NormalizedEvent[]> {
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set — skipping AI field enrichment");
    return events;
  }

  const BATCH_SIZE = 10;
  const enriched: NormalizedEvent[] = [];

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);

    const batchInput = batch.map((e, idx) => ({
      idx,
      title: e.title,
      start_date: e.start_date,
      location_name: e.location_name || "",
      location_address: e.location_address || "",
      description_long: (e.description_long || "").slice(0, 600),
      description_short: e.description_short || "",
      organizer: e.organizer || "",
      tags: e.tags || [],
      audience: e.audience || "",
      cost: e.cost || "",
      recurrence: e.recurrence || "",
      geographic_scope: e.geographic_scope || "",
      source: e.source,
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert event data enrichment assistant for the Oberlin Community Calendar (Oberlin, Ohio, USA).

For each event in the input, intelligently fill in any missing or weak fields and classify its geographic scope.

GEOGRAPHIC SCOPE RULES — pick exactly one:
• 'hyperlocal'     — specific to Oberlin College campus or a single building/neighborhood
• 'city'           — open to all of Oberlin city residents
• 'lorain_county'  — Lorain County-wide audience
• 'northeast_ohio' — northeast Ohio region
• 'state'          — Ohio-wide event
• 'national'       — national event
• 'online'         — virtual / online-only

Return ONLY a valid JSON object {"results": [...]} where each entry has exactly these keys:
  description_short  (string, ≤200 chars — plain English summary of the event)
  geographic_scope   (one of the 7 values above)
  tags               (string[] — 2-5 relevant topic tags, e.g. ["Music","Free","Outdoor"])
  organizer          (string — name of hosting org or person, empty string if unknown)
  audience           (string — who it's for, e.g. "Students, Faculty", "General Public", "Families")
  cost               (string — e.g. "Free", "$10", "Varies", empty string if unknown)
  recurrence         (string — e.g. "Weekly", "Single Event", "Monthly", empty string if unknown)

IMPORTANT: If an existing field already has a good value, keep it. Only improve weak or empty values.`,
          },
          {
            role: "user",
            content: `Enrich these ${batch.length} Oberlin-area events:\n\n${JSON.stringify(batchInput, null, 2)}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const content = response.choices[0].message.content || '{"results":[]}';
      const parsed = JSON.parse(content);
      const results: any[] = parsed.results || [];

      batch.forEach((event, idx) => {
        const fill = results[idx] || {};

        const enrichedEvent: NormalizedEvent = {
          ...event,
          // Only fill if currently empty/missing
          description_short: event.description_short || fill.description_short || "",
          geographic_scope: (fill.geographic_scope as GeographicScope) || event.geographic_scope || "city",
          ai_geographic_scope: (fill.geographic_scope as GeographicScope) || event.ai_geographic_scope || "city",
          tags: (event.tags?.length ? event.tags : null) ?? fill.tags ?? [],
          organizer: event.organizer || fill.organizer || "",
          audience: event.audience || fill.audience || "",
          cost: event.cost || fill.cost || "",
          recurrence: event.recurrence || fill.recurrence || "",
        };

        // Re-score with enriched fields
        const audit = calculateQualityScore(enrichedEvent);
        enrichedEvent.quality_score = audit.score;
        enrichedEvent.quality_notes = audit.notes;
        enrichedEvent.missing_fields = audit.missingFields;
        enrichedEvent.review_status = audit.review_status;

        enriched.push(enrichedEvent);
      });
    } catch (err) {
      console.error(`enrichEventFields batch ${i}–${i + BATCH_SIZE} failed:`, err);
      // Fall back to un-enriched events so nothing is lost
      enriched.push(...batch);
    }
  }

  return enriched;
}
