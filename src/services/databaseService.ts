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
      // Robust duplicate detection using external_event_id OR duplicate_key
      const existingById = existingMap.get(normalized.external_event_id);

      // Secondary check by searching for duplicate_key in existing values
      const existingByKey = existingById ? null : Array.from(existingMap.values()).find(e => e.duplicate_key === normalized.duplicate_key);

      const existingEvent = existingById || existingByKey;
      
      if (existingEvent) {
        // Simple change detection - in a real DB we'd compare hash or fields
        // For now, we update if something significant changed
        const hasChanged = JSON.stringify(existingEvent.raw_payload) !== JSON.stringify(normalized.raw_payload);
        
        if (hasChanged) {
          // If found by key but with different ID, we should still update the record associated with that key
          existingMap.set(existingEvent.external_event_id, {
            ...normalized,
            external_event_id: existingEvent.external_event_id, // Keep the ID we already have
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
