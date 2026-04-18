/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NormalizedEvent, StagingEvent } from "../types";

const DB_KEY = 'civicfeed_staging_events';

export const databaseService = {
  /**
   * Get all events from the staging database
   */
  getAll(): StagingEvent[] {
    const data = localStorage.getItem(DB_KEY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Save an array of events to staging, handling duplicates based on external_event_id
   */
  upsertMany(newEvents: NormalizedEvent[]): { inserted: number, updated: number } {
    const existing = this.getAll();
    const existingMap = new Map<string, StagingEvent>();
    existing.forEach(e => existingMap.set(e.external_event_id, e));

    let inserted = 0;
    let updated = 0;

    newEvents.forEach(normalized => {
      const existingEvent = existingMap.get(normalized.external_event_id);
      
      if (existingEvent) {
        // Simple change detection - in a real DB we'd compare hash or fields
        // For now, we update if something changed
        const hasChanged = JSON.stringify(existingEvent.raw_payload) !== JSON.stringify(normalized.raw_payload);
        
        if (hasChanged) {
          existingMap.set(normalized.external_event_id, {
            ...normalized,
            id: existingEvent.id // Keep internal ID
          });
          updated++;
        }
      } else {
        const id = Math.random().toString(36).substring(7);
        existingMap.set(normalized.external_event_id, {
          ...normalized,
          id
        });
        inserted++;
      }
    });

    const toSave = Array.from(existingMap.values());
    localStorage.setItem(DB_KEY, JSON.stringify(toSave));

    return { inserted, updated };
  },

  /**
   * Mark an event as processed or approved
   */
  updateStatus(id: string, status: string): void {
    const events = this.getAll();
    const updated = events.map(e => e.id === id ? { ...e, review_status: status as any } : e);
    localStorage.setItem(DB_KEY, JSON.stringify(updated));
  }
};
