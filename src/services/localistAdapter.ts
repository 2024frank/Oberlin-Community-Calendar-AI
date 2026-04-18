/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NormalizedEvent } from "../types";
import { normalizeLocalistEvent } from "./normalizationService";

export interface LocalistFetchOptions {
  days?: number;
  pp?: number;
  page?: number;
}

const API_BASE = "https://calendar.oberlin.edu/api/2";

export async function fetchLocalistEvents(options: LocalistFetchOptions = {}): Promise<NormalizedEvent[]> {
  const { days = 30, pp = 50, page = 1 } = options;
  
  const url = new URL(`${API_BASE}/events`);
  url.searchParams.set("days", String(days));
  url.searchParams.set("pp", String(pp));
  url.searchParams.set("page", String(page));

  try {
    // Note: In a browser environment, this may hit CORS. 
    // In a production pipeline, this would run server-side.
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
      },
      // signal: AbortSignal.timeout(10000) // Timeout for reliability
    });

    if (!response.ok) {
      throw new Error(`Localist API error: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const events = payload.events || [];

    // Only include "live" events
    const liveEvents = events.filter((e: any) => e.event.status === "live");

    return liveEvents.map((e: any) => normalizeLocalistEvent(e.event));
  } catch (error) {
    console.error("Failed to fetch events from Localist:", error);
    throw error;
  }
}

export async function fetchHeritageCenterEvents(): Promise<NormalizedEvent[]> {
  const url = "https://www.oberlinheritagecenter.org/wp-admin/admin-ajax.php?action=fetch_Events";
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Heritage Center API error: ${response.status}`);
    }

    const events = await response.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events
      .filter((e: any) => e.start && new Date(e.start) >= today)
      .map((e: any) => {
        const { normalizeHeritageCenterEvent } = require("./normalizationService");
        return normalizeHeritageCenterEvent(e);
      });
  } catch (error) {
    console.error("Failed to fetch Heritage Center events:", error);
    return [];
  }
}
