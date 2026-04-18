/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from "openai";
import { NormalizedEvent } from "../types";
import { calculateQualityScore } from "./normalizationService";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // Essential for client-side demo, though server-side is preferred.
});

/**
 * Extract event information from text using OpenAI.
 * Replaces the previous Gemini implementation as per research requirements.
 */
export async function extractEventsFromText(text: string, sourceName: string, sourceUrl: string): Promise<Partial<NormalizedEvent>[]> {
  if (!process.env.OPENAI_API_KEY) {
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
