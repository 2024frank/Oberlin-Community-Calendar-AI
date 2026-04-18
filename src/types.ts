/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ReviewStatus = 'ready' | 'needs_review' | 'approved' | 'rejected';

export type GeographicScope = 
  | 'hyperlocal' 
  | 'city' 
  | 'lorain_county' 
  | 'northeast_ohio' 
  | 'state' 
  | 'national' 
  | 'online' 
  | 'unknown';

export interface NormalizedEvent {
  external_event_id: string;
  duplicate_key: string;
  title: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  start_datetime: string; // ISO for internal sorting
  end_datetime: string;   // ISO for internal sorting
  location_name: string;
  location_address: string;
  organizer: string;
  description_short: string;
  description_long: string;
  event_url: string;
  image_url: string;
  tags: string[];
  source: string;
  recurrence: string;
  cost: string;
  audience: string;
  geographic_scope: GeographicScope;
  quality_score: number;
  quality_reason?: string;
  quality_notes: string[];
  missing_fields: string[];
  review_status: ReviewStatus;
  fetched_at: string;
  ai_geographic_scope: GeographicScope;
  raw_payload: any;
}

export interface StagingEvent extends NormalizedEvent {
  id: string;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  adapter: string;
  apiBase?: string;
  category: string;
  lastScanned?: string;
  status: 'active' | 'inactive';
  frequency: number; // minutes
}

export interface MetricPoint {
  date: string;
  events: number;
  accuracy: number;
  source: string;
}
