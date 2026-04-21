/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  LayoutDashboard,
  Calendar,
  Database,
  CheckCircle2,
  Clock,
  BarChart3,
  Search,
  Plus,
  MoreVertical,
  ExternalLink,
  MapPin,
  Tag as TagIcon,
  AlertCircle,
  History,
  Workflow,
  Sparkles,
  ChevronRight,
  Filter,
  Download,
  Terminal,
  RefreshCw,
  X,
  RotateCcw,
  Menu,
  ChevronLeft,
  Check,
  Ban,
  Send,
  Pencil,
  Globe
} from 'lucide-react';
import { extractEventsFromText, enrichEventFields } from './services/aiService';
import { enrichWithHubStatus, postToCommunityHub } from './services/communityHubService';
import { AIPulse } from './components/AIPulse';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { StagingEvent, Source, MetricPoint } from './types';
import { fetchLocalistEvents, fetchHeritageCenterEvents } from './services/localistAdapter';
import { scrapeSource } from './services/scrapeAdapter';
import { databaseService } from './services/databaseService';
import { calculateQualityScore } from './services/normalizationService';
import { cn } from './lib/utils';
import { apiUrl } from './lib/apiBase';

// --- Sample Data ---
const INITIAL_SOURCES: Source[] = [
  { id: 'oberlin-college', name: 'Oberlin College and Conservatory', url: 'calendar.oberlin.edu', adapter: 'Localist v2', category: 'Institutional', lastScanned: undefined, status: 'active', frequency: 60 },
  { id: 'oberlin-heritage', name: 'Heritage Society', url: 'oberlinheritagecenter.org', adapter: 'WP-AJAX', category: 'History', lastScanned: undefined, status: 'active', frequency: 1440 },
  { id: 'amam', name: 'AMAM', url: 'amam.oberlin.edu', eventsUrl: 'https://amam.oberlin.edu/events', adapter: 'AI Scrape', category: 'Art', lastScanned: undefined, status: 'active', frequency: 720 },
  { id: 'city-oberlin', name: 'City of Oberlin', url: 'cityofoberlin.com', eventsUrl: 'https://www.cityofoberlin.com/calendar-of-events/', adapter: 'AI Scrape', category: 'Municipal', lastScanned: undefined, status: 'active', frequency: 720 },
  { id: 'fava', name: 'FAVA', url: 'favagallery.org', eventsUrl: 'https://www.favagallery.org/events/', adapter: 'AI Scrape', category: 'Art', lastScanned: undefined, status: 'active', frequency: 1440 },
  { id: 'apollo', name: 'Apollo Theatre', url: 'apollotheatre.org', eventsUrl: 'https://apollotheatre.org/events/', adapter: 'AI Scrape', category: 'Entertainment', lastScanned: undefined, status: 'active', frequency: 720 },
  { id: 'obp', name: 'Oberlin Business Partnership', url: 'oberlin.org', eventsUrl: 'https://www.oberlin.org/events', adapter: 'AI Scrape', category: 'Business', lastScanned: undefined, status: 'active', frequency: 1440 },
  { id: 'library', name: 'Oberlin Public Library', url: 'oberlinlibrary.org', eventsUrl: 'https://www.oberlinlibrary.org/events', adapter: 'AI Scrape', category: 'Public Service', lastScanned: undefined, status: 'active', frequency: 720 },
];

const SOURCE_COLORS: Record<string, string> = {
  'Oberlin College and Conservatory': '#C41230',
  'Heritage Society': '#B87333',
  'AMAM': '#6366F1',
  'City of Oberlin': '#2563EB',
  'FAVA': '#EC4899',
  'Apollo Theatre': '#F59E0B',
  'Oberlin Business Partnership': '#10B981',
  'Oberlin Public Library': '#8B5CF6',
  'Manual Audit': '#9CA3AF'
};

// --- Sub-components ---

const MetricCard = ({ title, value, icon: Icon, trend }: { title: string, value: string | number, icon: any, trend?: string }) => (
  <div className="metric-card transition-all hover:border-gray-300">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">{title}</span>
      <div className="p-2 bg-gray-50 rounded-lg text-gray-600">
        <Icon size={18} />
      </div>
    </div>
    <div className="flex items-end gap-2">
      <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
      {trend && <span className="text-xs font-semibold text-emerald-600 mb-1">{trend}</span>}
    </div>
  </div>
);

const Badge = ({ children, variant = 'gray' }: { children: React.ReactNode, variant?: 'gray' | 'blue' | 'green' | 'red' | 'purple' }) => {
  const styles = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    purple: 'bg-violet-100 text-violet-700'
  };
  return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', styles[variant])}>{children}</span>;
}

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'all' | 'review' | 'approved' | 'analytics' | 'playground' | 'settings'>('all');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [syncLimit, setSyncLimit] = useState(10);
  const [stagingEvents, setStagingEvents] = useState<StagingEvent[]>([]);
  const [sources, setSources] = useState<Source[]>(INITIAL_SOURCES);
  const [isIngesting, setIsIngesting] = useState(false);
  const [lastLog, setLastLog] = useState<string>('');

  const [evaluationInput, setEvaluationInput] = useState('');
  const [evaluationOutput, setEvaluationOutput] = useState<any>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<null | 'correct' | 'incorrect'>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [editingEvent, setEditingEvent] = useState<StagingEvent | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [sendingToHub, setSendingToHub] = useState<Set<string>>(new Set());
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [hubPushProgress, setHubPushProgress] = useState<{ sent: number; total: number } | null>(null);
  const [pushResult, setPushResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);
  // Ref-based guards — synchronous, immune to React batching delays
  const bulkSendingRef = React.useRef(false);
  const sendingIdsRef  = React.useRef(new Set<string>());
  // Persisted set of event IDs already pushed — survives re-renders, prevents double-push
  const pushedIdsRef   = React.useRef<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('hub_pushed_ids') || '[]'))
  );
  const [autoApprove, setAutoApprove] = useState<boolean>(() => localStorage.getItem('auto_approve') === 'true');
  const [autoApproveThreshold, setAutoApproveThreshold] = useState<number>(() => Number(localStorage.getItem('auto_approve_threshold') || 80));

  const toggleSource = (source: string) =>
    setSelectedSources(prev => {
      const next = new Set(prev);
      next.has(source) ? next.delete(source) : next.add(source);
      return next;
    });

  const toggleAutoApprove = () =>
    setAutoApprove(v => { const next = !v; localStorage.setItem('auto_approve', String(next)); return next; });

  const changeThreshold = (v: number) => {
    setAutoApproveThreshold(v);
    localStorage.setItem('auto_approve_threshold', String(v));
  };

  const applyAutoApproveNow = async () => {
    const all = databaseService.getAll();
    let count = 0;
    all.forEach(e => {
      if (e.quality_score >= autoApproveThreshold && e.review_status !== 'approved' && e.review_status !== 'rejected') {
        databaseService.updateStatus(e.id, 'approved');
        count++;
      }
    });
    const updated = databaseService.getAll();
    setStagingEvents(updated);
    await syncToDatabase(updated);
    setLastLog(`✓ ${count} events auto-approved · synced to database`);
  };

  const [researchInsight, setResearchInsight] = useState<{ observation: string, recommendation: string }>({
    observation: '92% of rejected items are due to "Missing Coordinates" or "Generic Heritage Tags".',
    recommendation: 'Auto-approve metadata for items with >95% confidence score from verified Oberlin sub-domains.'
  });
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  // Hydrate from localStorage on mount — strip any stale CommunityHub source events
  useEffect(() => {
    const all = databaseService.getAll();
    const cleaned = all.filter(e => e.source !== 'CommunityHub');
    if (cleaned.length !== all.length) {
      localStorage.setItem('civicfeed_staging_events', JSON.stringify(cleaned));
    }
    setStagingEvents(cleaned);
  }, []);

  // Real extraction data: events grouped by source, derived from actual staging events
  const extractionData = useMemo(() => {
    if (stagingEvents.length === 0) return [];
    const counts: Record<string, number> = {};
    stagingEvents.forEach(e => {
      counts[e.source] = (counts[e.source] || 0) + 1;
    });
    return Object.entries(counts).map(([source, events]) => ({ date: source, events, source }));
  }, [stagingEvents]);

  const pendingCount = useMemo(() =>
    stagingEvents.filter(e => e.review_status === 'needs_review' || e.review_status === 'ready').length,
  [stagingEvents]);

  const dupStats = useMemo(() => {
    const checked = stagingEvents.filter(e => e.communityHubStatus && e.communityHubStatus !== 'unknown');
    const exists  = stagingEvents.filter(e => e.communityHubStatus === 'exists').length;
    const sent    = stagingEvents.filter(e => e.communityHubStatus === 'sent').length;
    const isNew   = stagingEvents.filter(e => e.communityHubStatus === 'new').length;
    const dupeRate = checked.length > 0 ? ((exists / checked.length) * 100).toFixed(1) : '0.0';
    return { exists, sent, isNew, checked: checked.length, dupeRate };
  }, [stagingEvents]);

  const approvedCount = useMemo(() => 
    stagingEvents.filter(e => e.review_status === 'approved').length, 
  [stagingEvents]);

  const rejectedCount = useMemo(() => 
    stagingEvents.filter(e => e.review_status === 'rejected').length, 
  [stagingEvents]);

  // Push all approved events to Redis database
  const syncToDatabase = async (events?: StagingEvent[]) => {
    const toSync = (events ?? stagingEvents).filter(e => e.review_status === 'approved');
    if (toSync.length === 0) return;
    await fetch(apiUrl('/api/v1/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: toSync }),
    });
  };

  const handleApprove = (id: string) => {
    databaseService.updateStatus(id, 'approved');
    const all = databaseService.getAll();
    setStagingEvents(all);
    syncToDatabase(all);
  };

  const handleReject = (id: string) => {
    databaseService.updateStatus(id, 'rejected');
    setStagingEvents(databaseService.getAll());
  };

  const handleUndoApprove = (id: string) => {
    databaseService.updateStatus(id, 'ready');
    setStagingEvents(databaseService.getAll());
  };

  const handleSaveEdit = (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!editingEvent) return;
    
    // Re-audit before saving
    const audit = calculateQualityScore(editingEvent);
    const auditedEvent = {
      ...editingEvent,
      quality_score: audit.score,
      quality_notes: audit.notes,
      missing_fields: audit.missingFields,
      review_status: audit.review_status
    };

    // Save to DB
    const updated = stagingEvents.map(ev => ev.id === auditedEvent.id ? auditedEvent : ev);
    localStorage.setItem('staging_events', JSON.stringify(updated));
    setStagingEvents(updated);
    setEditingEvent(null);
  };

  const handleIngestAll = async () => {
    setIsIngesting(true);
    const results: Record<string, number> = {};
    try {
      // ── Step 1: Fetch native API sources in parallel ──────────────────────
      setLastLog('Fetching Oberlin College & Heritage Center...');
      const [localistRes, heritageRes] = await Promise.allSettled([
        fetchLocalistEvents({ days: 90, pp: 100 }),
        fetchHeritageCenterEvents(),
      ]);
      const localistEvents = localistRes.status === 'fulfilled' ? localistRes.value : [];
      const heritageEvents = heritageRes.status === 'fulfilled' ? heritageRes.value : [];
      results['Oberlin College Events'] = localistEvents.length;
      results['Heritage Center']        = heritageEvents.length;

      // ── Step 2: AI-scrape other active sources in parallel ────────────────
      const scrapeSources = sources.filter(s => s.status === 'active' && s.eventsUrl);
      if (scrapeSources.length > 0) {
        setLastLog(`Scraping ${scrapeSources.length} additional sources with AI...`);
        const scrapeResults = await Promise.allSettled(
          scrapeSources.map(s => scrapeSource(s.eventsUrl!, s.name))
        );
        var scrapedEvents = scrapeResults.flatMap((r, i) => {
          if (r.status === 'fulfilled') {
            results[scrapeSources[i].name] = r.value.length;
            return r.value;
          }
          console.error(`Scrape failed for ${scrapeSources[i].name}:`, r.reason);
          results[scrapeSources[i].name] = 0;
          return [];
        });
      } else {
        var scrapedEvents: any[] = [];
      }

      // ── Step 3: Combine ───────────────────────────────────────────────────
      const all = [...localistEvents, ...heritageEvents, ...scrapedEvents];
      const summary = Object.entries(results).map(([k, v]) => `${v} ${k}`).join(' · ');
      setLastLog(`Got ${all.length} events (${summary}). AI enriching fields & classifying regions...`);

      // ── Step 4: AI field enrichment — fills missing fields, reclassifies geo scope, re-scores ──
      const aiEnriched = await enrichEventFields(all);

      // ── Step 5: Silent hub duplicate check (semantic embeddings) ─────────
      setLastLog(`Fields enriched. Checking against CommunityHub for duplicates...`);
      const enriched = await enrichWithHubStatus(aiEnriched);

      // ── Step 6: Save (without touching review_status) ────────────────────
      const { inserted, updated } = databaseService.upsertMany(enriched);

      // ── Step 7: Auto-approve — runs AFTER upsert so it hits every event ──
      let autoApproved = 0;
      if (autoApprove) {
        const allNow = databaseService.getAll();
        allNow.forEach(e => {
          if (
            e.quality_score >= autoApproveThreshold &&
            e.review_status !== 'approved' &&
            e.review_status !== 'rejected'
          ) {
            databaseService.updateStatus(e.id, 'approved');
            autoApproved++;
          }
        });
      }

      const finalAll = databaseService.getAll();
      setStagingEvents(finalAll);

      // Push approved events to Redis immediately
      setLastLog('Syncing approved events to database...');
      await syncToDatabase(finalAll);

      const autoMsg = autoApprove ? ` · ${autoApproved} auto-approved` : '';
      setLastLog(`✓ Done: ${inserted} new · ${updated} updated${autoMsg} · synced to DB`);

      const now = new Date().toISOString();
      setSources(prev => prev.map(s => ({ ...s, lastScanned: now })));
    } catch (error) {
      setLastLog(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}`);
    } finally {
      setIsIngesting(false);
    }
  };

  const markPushed = (id: string) => {
    pushedIdsRef.current.add(id);
    localStorage.setItem('hub_pushed_ids', JSON.stringify([...pushedIdsRef.current]));
  };

  const handleSendToHub = async (event: StagingEvent) => {
    // Triple-layer duplicate guard
    if (sendingIdsRef.current.has(event.id)) return;
    if (pushedIdsRef.current.has(event.id)) {
      setLastLog(`"${event.title}" was already pushed to CommunityHub — skipping to prevent duplicate.`);
      return;
    }
    sendingIdsRef.current.add(event.id);
    setSendingToHub(prev => new Set(prev).add(event.id));
    setPushResult(null);
    setLastLog(`Sending "${event.title}" to CommunityHub...`);
    try {
      await postToCommunityHub(event);
      markPushed(event.id);                         // persist immediately
      databaseService.remove(event.id);
      const remaining = databaseService.getAll();
      setStagingEvents(remaining);
      await syncToDatabase(remaining);
      setPushResult({ sent: 1, failed: 0, errors: [] });
      setLastLog(`✓ "${event.title}" sent to CommunityHub`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const clean = msg.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      setPushResult({ sent: 0, failed: 1, errors: [clean] });
      setLastLog(`CommunityHub error: ${clean}`);
    } finally {
      sendingIdsRef.current.delete(event.id);
      setSendingToHub(prev => { const s = new Set(prev); s.delete(event.id); return s; });
    }
  };

  const handleBulkSendToHub = async () => {
    if (bulkSendingRef.current) return;
    bulkSendingRef.current = true;
    setPushResult(null);

    const toSend = stagingEvents.filter(
      e => e.review_status === 'approved' &&
           e.communityHubStatus !== 'sent' &&
           e.communityHubStatus !== 'exists' &&
           !sendingIdsRef.current.has(e.id) &&
           !pushedIdsRef.current.has(e.id)     // skip already-pushed events
    );
    if (toSend.length === 0) {
      bulkSendingRef.current = false;
      setLastLog('No approved events to push — all already sent or none approved.');
      return;
    }

    setIsBulkSending(true);
    setHubPushProgress({ sent: 0, total: toSend.length });
    setLastLog(`Pushing ${toSend.length} events to CommunityHub...`);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const event of toSend) {
      sendingIdsRef.current.add(event.id);
      setSendingToHub(prev => new Set(prev).add(event.id));
      try {
        await postToCommunityHub(event);
        markPushed(event.id);                       // persist before removing
        databaseService.remove(event.id);
        sent++;
        setHubPushProgress({ sent, total: toSend.length });
        setLastLog(`Pushed ${sent}/${toSend.length} · "${event.title}"`);
      } catch (err) {
        failed++;
        const msg = (err instanceof Error ? err.message : String(err))
          .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
        errors.push(`"${event.title}": ${msg}`);
      } finally {
        sendingIdsRef.current.delete(event.id);
        setSendingToHub(prev => { const s = new Set(prev); s.delete(event.id); return s; });
      }
    }

    const remaining = databaseService.getAll();
    setStagingEvents(remaining);
    await syncToDatabase(remaining);

    bulkSendingRef.current = false;
    setIsBulkSending(false);
    setHubPushProgress(null);
    setPushResult({ sent, failed, errors });
    setLastLog(
      failed === 0
        ? `✓ All ${sent} events pushed to CommunityHub successfully`
        : `Done: ${sent} sent · ${failed} failed`
    );
  };

  /** Load approved events from Redis into the local staging DB + UI */
  const handleLoadFromDb = async () => {
    setLastLog('Loading events from database...');
    try {
      const res = await fetch('/api/v1/db-events');
      if (!res.ok) throw new Error(`DB fetch failed: ${res.status}`);
      const { data, count } = await res.json();
      if (!count || count === 0) {
        setLastLog('Database is empty — no events to load.');
        return;
      }
      // Upsert into local staging
      databaseService.upsertMany(data);
      const all = databaseService.getAll();
      setStagingEvents(all);
      setLastLog(`✓ Loaded ${count} events from database into staging`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastLog(`Load from DB error: ${msg}`);
    }
  };

  /** Push all approved events from Redis → CommunityHub server-side, clear from DB */
  const handleServerPushToHub = async () => {
    if (bulkSendingRef.current) return;
    bulkSendingRef.current = true;
    setIsBulkSending(true);
    setLastLog('Server: pushing approved events from DB to CommunityHub...');
    try {
      const res = await fetch('/api/v1/push-to-hub', { method: 'POST' });
      if (!res.ok) throw new Error(`Push failed: ${res.status}`);
      const result = await res.json();
      // Refresh local view from DB
      const dbRes = await fetch('/api/v1/db-events');
      const { data } = await dbRes.json();
      databaseService.upsertMany(data || []);
      setStagingEvents(databaseService.getAll());
      const failNote = result.failed > 0 ? ` · ${result.failed} failed` : '';
      setLastLog(`✓ Server push done: ${result.sent} sent to CommunityHub${failNote}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastLog(`Server push error: ${msg}`);
    } finally {
      bulkSendingRef.current = false;
      setIsBulkSending(false);
      setHubPushProgress(null);
    }
  };

  const updateSourceFrequency = (id: string, frequency: number) => {
    setSources(prev => prev.map(s => s.id === id ? { ...s, frequency } : s));
  };

  // Background polling logic
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];

    sources.forEach(source => {
      if (source.status === 'active' && source.frequency > 0) {
        const interval = setInterval(async () => {
          console.log(`Polling ${source.name} every ${source.frequency} minutes...`);

          let fetchedEvents: any[] = [];
          try {
            if (source.id === 'oberlin-college') {
              fetchedEvents = await fetchLocalistEvents({ days: 14, pp: syncLimit });
            } else if (source.id === 'oberlin-heritage') {
              fetchedEvents = await fetchHeritageCenterEvents();
            } else {
              // Placeholder for other sources until their specific adapters are implemented
              // For now, we simulate a pull to show the system is working
              console.log(`Simulated pull for ${source.name}`);
            }

            if (fetchedEvents.length > 0) {
              databaseService.upsertMany(fetchedEvents);
              setStagingEvents(databaseService.getAll());
            }

            // Update only the lastScanned for this source without triggering full sources re-effect
            setSources(prev => prev.map(s => s.id === source.id ? { ...s, lastScanned: new Date().toISOString() } : s));
          } catch (err) {
            console.error(`Polling error for ${source.name}:`, err);
          }
        }, source.frequency * 60 * 1000);
        intervals.push(interval);
      }
    });

    return () => intervals.forEach(clearInterval);
  }, [sources.map(s => s.id + s.frequency + s.status).join(','), syncLimit]);

  const generateResearchInsight = async () => {
    if (stagingEvents.length === 0) return;
    setIsInsightLoading(true);
    try {
      const openai = (await import('openai')).default;
      const client = new openai({
        apiKey: process.env.OPENAI_API_KEY,
        dangerouslyAllowBrowser: true
      });

      const eventData = stagingEvents.slice(0, 30).map(e => ({
        title: e.title,
        source: e.source,
        score: e.quality_score,
        status: e.review_status,
        notes: e.quality_notes
      }));

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a research data auditor. Analyze the provided event extraction data and return a JSON object with 'observation' and 'recommendation' strings."
          },
          {
            role: "user",
            content: `Analyze these extraction results: ${JSON.stringify(eventData)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const content = JSON.parse(response.choices[0].message.content || '{}');
      if (content.observation && content.recommendation) {
        setResearchInsight(content);
      }
    } catch (err) {
      console.error("Failed to generate research insight:", err);
    } finally {
      setIsInsightLoading(false);
    }
  };

  useEffect(() => {
    if (stagingEvents.length > 0) {
      const timer = setTimeout(generateResearchInsight, 2000);
      return () => clearTimeout(timer);
    }
  }, [stagingEvents.length]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F9FAFB]">

      {/* ── Push result banner — stays visible until dismissed ───────────── */}
      {pushResult && !isBulkSending && sendingToHub.size === 0 && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-start gap-4 px-5 py-4 rounded-2xl shadow-2xl min-w-[300px] max-w-[420px] ${pushResult.failed === 0 ? 'bg-emerald-600' : pushResult.sent === 0 ? 'bg-rose-600' : 'bg-amber-500'} text-white`}>
          <div className="text-2xl mt-0.5">
            {pushResult.failed === 0 ? '✓' : pushResult.sent === 0 ? '✕' : '⚠'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-1">
              CommunityHub Push Result
            </p>
            {pushResult.sent > 0 && (
              <p className="text-[14px] font-bold">{pushResult.sent} event{pushResult.sent !== 1 ? 's' : ''} sent successfully</p>
            )}
            {pushResult.failed > 0 && (
              <p className="text-[14px] font-bold">{pushResult.failed} failed to push</p>
            )}
            {pushResult.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {pushResult.errors.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-[11px] opacity-90 break-words">{e}</p>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setPushResult(null)} className="text-white/70 hover:text-white text-lg leading-none mt-0.5">✕</button>
        </div>
      )}

      {/* ── CommunityHub push toast ───────────────────────────────────────── */}
      {(isBulkSending || sendingToHub.size > 0) && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-3 px-5 py-4 bg-gray-950 text-white rounded-2xl shadow-2xl min-w-[280px]">
            {/* Animated ring */}
            <div className="relative flex-shrink-0 w-8 h-8">
              <svg className="animate-spin w-8 h-8" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="13" stroke="white" strokeOpacity="0.15" strokeWidth="3"/>
                <path d="M16 3a13 13 0 0 1 13 13" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse"/>
              </div>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] font-black uppercase tracking-widest text-violet-300">
                Pushing to CommunityHub
              </span>
              {isBulkSending && hubPushProgress ? (
                <>
                  <span className="text-[13px] font-semibold text-white">
                    {hubPushProgress.sent} of {hubPushProgress.total} events sent
                  </span>
                  <div className="mt-1 w-full bg-white/10 rounded-full h-1 overflow-hidden">
                    <div
                      className="bg-violet-400 h-1 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round((hubPushProgress.sent / hubPushProgress.total) * 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                <span className="text-[13px] font-semibold text-white truncate">
                  {lastLog.replace('Sending "', '').replace('" to CommunityHub...', '') || 'Connecting...'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarCollapsed ? 80 : 320 }}
        className="bg-white text-gray-900 flex flex-col border-r border-gray-100 z-20 relative shrink-0"
      >
        {/* Line-integrated Toggle */}
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className={cn(
            "absolute -right-3 top-10 w-6 h-6 bg-white border border-gray-100 rounded-full flex items-center justify-center text-gray-400 hover:text-crimson shadow-sm z-30 transition-all active:scale-90",
            isSidebarCollapsed && "hover:bg-crimson hover:text-white"
          )}
        >
          {isSidebarCollapsed ? <Menu size={10} /> : <ChevronLeft size={10} />}
        </button>

        <div className="p-8 border-b border-gray-50 flex flex-col min-h-[140px] justify-center">
          {!isSidebarCollapsed ? (
            <div className="flex flex-col">
              {/* Logo mark + wordmark */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-crimson flex items-center justify-center shadow-lg shadow-crimson/20">
                  <Calendar size={18} className="text-white" />
                </div>
                <div>
                  <h1 className="text-[15px] font-black tracking-tight text-gray-950 uppercase leading-none">
                    Oberlin
                  </h1>
                  <p className="text-[11px] font-black text-crimson uppercase tracking-wider leading-none mt-0.5">
                    Community Calendar
                  </p>
                </div>
              </div>
              <span className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em] border-t border-gray-50 pt-3">AI-Powered · Live Data</span>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-crimson flex items-center justify-center shadow-lg shadow-crimson/20 mx-auto">
              <Calendar size={18} className="text-white" />
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2 overflow-y-auto custom-scrollbar italic font-black uppercase tracking-widest text-[11px]">
          <button 
            onClick={() => setActiveTab('all')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group",
              activeTab === 'all' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="All Events"
          >
            <Database size={18} className={activeTab === 'all' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
            {!isSidebarCollapsed && "All Events"}
          </button>

          <button 
            onClick={() => setActiveTab('review')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group relative",
              activeTab === 'review' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="Needs Review"
          >
            <div className="relative">
              <History size={18} className={activeTab === 'review' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
              {stagingEvents.filter(e => e.review_status !== 'approved').length > 0 && (
                <span className="absolute -top-2 -right-2 w-4 h-4 bg-crimson text-white text-[8px] flex items-center justify-center rounded-full border-2 border-white font-black">
                  {stagingEvents.filter(e => e.review_status !== 'approved').length}
                </span>
              )}
            </div>
            {!isSidebarCollapsed && "Needs Review"}
          </button>

          <button 
            onClick={() => setActiveTab('approved')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group",
              activeTab === 'approved' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="Approved Events"
          >
            <CheckCircle2 size={18} className={activeTab === 'approved' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
            {!isSidebarCollapsed && "Approved Events"}
          </button>

          <div className="h-4" />

          <button 
            onClick={() => setActiveTab('analytics')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group",
              activeTab === 'analytics' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="Analytics"
          >
            <LayoutDashboard size={18} className={activeTab === 'analytics' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
            {!isSidebarCollapsed && "Analytics"}
          </button>

          <button 
            onClick={() => setActiveTab('playground')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group",
              activeTab === 'playground' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="Playground"
          >
            <Sparkles size={18} className={activeTab === 'playground' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
            {!isSidebarCollapsed && "Playground"}
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all group",
              activeTab === 'settings' ? "bg-gray-100 text-crimson" : "text-gray-400 hover:text-crimson hover:bg-crimson/5",
              isSidebarCollapsed && "justify-center px-0"
            )}
            title="Settings"
          >
            <Workflow size={18} className={activeTab === 'settings' ? "text-crimson" : "text-gray-300 group-hover:text-crimson"} />
            {!isSidebarCollapsed && "Settings"}
          </button>
        </nav>

        {/* Data Persistence Info */}
        <div className={cn("p-6 mt-auto transition-opacity duration-200", isSidebarCollapsed ? "opacity-0 invisible" : "opacity-100")}>
          {!isSidebarCollapsed && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Research API Live</span>
              </div>
              <h4 className="text-[10px] font-bold text-gray-900 mb-1 uppercase tracking-tight">Data Destination</h4>
              <p className="text-[10px] text-gray-400 leading-relaxed mb-4 font-medium">
                Approved events are synced to the Institutional Data Lake and exposed via:
              </p>
              <div className="space-y-2">
                <a 
                  href={apiUrl("/api/v1/approved-events")} 
                  target="_blank"
                  className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-100 rounded-xl group hover:border-crimson/30 transition-all"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Terminal size={12} className="text-gray-400 group-hover:text-crimson" />
                    <span className="text-[10px] font-mono text-gray-600 truncate">/api/v1/approved-events</span>
                  </div>
                  <ExternalLink size={10} className="text-gray-300 group-hover:text-crimson shrink-0" />
                </a>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#F9FAFB]">
        <header className="h-20 flex items-center justify-between px-8 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[#C41230] italic">
              {activeTab === 'all' && "All Community Events"}
              {activeTab === 'review' && "Action Required: Review Queue"}
              {activeTab === 'approved' && "Verified Repository: Approved"}
              {activeTab === 'analytics' && "Institutional Analytics Dashboard"}
              {activeTab === 'playground' && "AI Orchestration Playground"}
              {activeTab === 'settings' && "System Infrastructure Configuration"}
            </h2>

            <button
              onClick={handleIngestAll}
              disabled={isIngesting}
              className="flex items-center gap-2 px-4 py-2 bg-crimson/5 text-crimson text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-crimson hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={isIngesting ? "animate-spin" : ""} />
              {isIngesting ? "Pulling Data..." : "Pull Events"}
            </button>
            <button
              onClick={() => syncToDatabase().then(() => setLastLog('✓ Approved events synced to database'))}
              disabled={approvedCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-30"
            >
              <Database size={14} />
              Sync DB ({approvedCount})
            </button>
            <button
              onClick={handleLoadFromDb}
              className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-500 hover:text-white transition-all"
            >
              <Database size={14} />
              Load from DB
            </button>
            <button
              onClick={handleServerPushToHub}
              disabled={isBulkSending}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-600 transition-all disabled:opacity-60"
            >
              {isBulkSending
                ? <><svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg> Pushing...</>
                : <><ExternalLink size={14}/> Push DB → Hub</>
              }
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="Search repository..."
                className="pl-9 pr-4 py-2 bg-gray-50 border border-transparent rounded-2xl text-[11px] font-bold uppercase tracking-widest focus:outline-none focus:bg-white focus:border-crimson/10 transition-all w-80 shadow-inner"
              />
            </div>
            <div className="h-4 w-px bg-gray-200 mx-2" />
            <button className="p-2.5 bg-gray-50 text-gray-400 hover:text-crimson rounded-xl transition-all active:scale-95">
              <Filter size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-8 max-w-[1400px] mx-auto">
            <AnimatePresence mode="wait">
              {/* Event Browsing Views (All, Review, Approved) */}
              {(activeTab === 'all' || activeTab === 'review' || activeTab === 'approved') && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  key={activeTab}
                  className="space-y-8"
                >
                  <div className="flex items-center justify-between bg-white p-10 rounded-[40px] border border-gray-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)]">
                    <div>
                      <h3 className="text-3xl font-black italic tracking-tighter text-gray-900 uppercase">
                        {activeTab === 'all' && "Community Civic Feed"}
                        {activeTab === 'review' && "Review Submissions"}
                        {activeTab === 'approved' && "Verified Repository"}
                      </h3>
                    </div>
                    {/* Bulk send button — only visible on the Approved tab */}
                    {activeTab === 'approved' && (() => {
                      const unsent = stagingEvents.filter(
                        e => e.review_status === 'approved' && e.communityHubStatus !== 'sent' && e.communityHubStatus !== 'exists'
                      );
                      if (unsent.length === 0) return null;
                      return (
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            onClick={handleBulkSendToHub}
                            disabled={isBulkSending}
                            className="flex items-center gap-2 px-5 py-3 bg-violet-500 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl hover:bg-violet-600 transition-all shadow-lg disabled:opacity-80 disabled:cursor-not-allowed"
                          >
                            {isBulkSending ? (
                              <>
                                <svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
                                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                                </svg>
                                {hubPushProgress
                                  ? `Sending ${hubPushProgress.sent}/${hubPushProgress.total}...`
                                  : 'Sending...'}
                              </>
                            ) : (
                              <>
                                <ExternalLink size={14} />
                                Push All to CommunityHub ({unsent.length})
                              </>
                            )}
                          </button>
                          {/* Progress bar during bulk push */}
                          {isBulkSending && hubPushProgress && (
                            <div className="w-full bg-violet-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-violet-500 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${(hubPushProgress.sent / hubPushProgress.total) * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* ── Source filter pills ── */}
                  {(() => {
                    const activeSources: string[] = Array.from(new Set<string>(stagingEvents.map(e => e.source))).sort();
                    if (activeSources.length < 2) return null;
                    return (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedSources(new Set())}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                            selectedSources.size === 0
                              ? "bg-gray-900 text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          )}
                        >
                          All
                        </button>
                        {activeSources.map(src => (
                          <button
                            key={src}
                            onClick={() => toggleSource(src)}
                            className={cn(
                              "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                              selectedSources.has(src)
                                ? "bg-crimson text-white border-crimson"
                                : "bg-white text-gray-500 border-gray-100 hover:border-crimson/30 hover:text-crimson"
                            )}
                          >
                            {src}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                    {stagingEvents
                      .filter(e => {
                        if (activeTab === 'review') return e.review_status === 'needs_review' || e.review_status === 'ready';
                        if (activeTab === 'approved') return e.review_status === 'approved';
                        return true;
                      })
                      .filter(e => selectedSources.size === 0 || selectedSources.has(e.source))
                      .length === 0 ? (
                        <div className="col-span-full py-32 flex flex-col items-center justify-center text-center bg-white rounded-[40px] border border-gray-50 italic text-gray-300 font-medium">
                          No matching records found in this partition.
                        </div>
                      ) : (
                        stagingEvents
                          .filter(e => {
                            if (activeTab === 'review') return e.review_status === 'needs_review' || e.review_status === 'ready';
                            if (activeTab === 'approved') return e.review_status === 'approved';
                            return true;
                          })
                          .filter(e => selectedSources.size === 0 || selectedSources.has(e.source))
                          .map(event => {
                            const isPending  = event.review_status === 'ready' || event.review_status === 'needs_review';
                            const isApproved = event.review_status === 'approved';
                            const isRejected = event.review_status === 'rejected';
                            const hubNew     = event.communityHubStatus === 'new';
                            const hubExists  = event.communityHubStatus === 'exists';
                            const hubSent    = event.communityHubStatus === 'sent';

                            return (
                              <div
                                key={event.id}
                                className={cn(
                                  "bg-white rounded-3xl border p-7 flex flex-col gap-5 transition-all duration-200 group",
                                  "hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)]",
                                  isApproved ? "border-emerald-100" : isRejected ? "border-rose-100" : "border-gray-100"
                                )}
                              >
                                {/* ── Top row: badges + score ── */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    {/* Status */}
                                    <span className={cn(
                                      "text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                      isApproved ? "bg-emerald-50 text-emerald-700" :
                                      isRejected ? "bg-rose-50 text-rose-600" :
                                      event.review_status === 'needs_review' ? "bg-amber-50 text-amber-600" :
                                      "bg-gray-100 text-gray-500"
                                    )}>
                                      {isApproved ? "✓ Approved" : isRejected ? "✕ Rejected" : event.review_status === 'needs_review' ? "⚠ Needs Review" : "Ready"}
                                    </span>

                                    {/* Hub status */}
                                    {hubExists && (
                                      <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                        <Globe size={10}/> On Hub
                                      </span>
                                    )}
                                    {hubNew && (
                                      <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-violet-50 text-violet-600 border border-violet-100 flex items-center gap-1">
                                        ✦ New to Hub
                                      </span>
                                    )}
                                    {hubSent && (
                                      <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1">
                                        <Send size={10}/> Sent
                                      </span>
                                    )}

                                    {/* Source */}
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                                      {event.source}
                                    </span>
                                  </div>

                                  {/* Score pill */}
                                  <span className={cn(
                                    "shrink-0 text-[11px] font-black px-3 py-1.5 rounded-xl border",
                                    event.quality_score >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                                    event.quality_score >= 70 ? "bg-amber-50 text-amber-700 border-amber-100" :
                                    "bg-rose-50 text-rose-600 border-rose-100"
                                  )}>
                                    {event.quality_score}%
                                  </span>
                                </div>

                                {/* ── Title ── */}
                                <div>
                                  <h4 className="text-xl font-black tracking-tight text-gray-900 uppercase italic leading-tight group-hover:text-crimson transition-colors line-clamp-2">
                                    {event.title}
                                  </h4>
                                </div>

                                {/* ── Description ── */}
                                <p className="text-[13px] text-gray-500 leading-relaxed line-clamp-2 flex-1">
                                  {event.description_long || event.description_short || '—'}
                                </p>

                                {/* ── Meta row ── */}
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                                  {event.start_date && (
                                    <span className="flex items-center gap-1.5">
                                      <Calendar size={12}/> {event.start_date}
                                    </span>
                                  )}
                                  {event.location_name && (
                                    <span className="flex items-center gap-1.5">
                                      <MapPin size={12}/> {event.location_name}
                                    </span>
                                  )}
                                  {event.geographic_scope && (
                                    <span className="flex items-center gap-1.5 text-crimson/60">
                                      {event.geographic_scope}
                                    </span>
                                  )}
                                </div>

                                {/* ── Action buttons ── */}
                                <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-50">

                                  {/* Approve — shown when pending or rejected */}
                                  {(isPending || isRejected) && (
                                    <button
                                      onClick={() => handleApprove(event.id)}
                                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all active:scale-95"
                                    >
                                      <Check size={13}/> Approve
                                    </button>
                                  )}

                                  {/* Reject — shown when pending or approved */}
                                  {(isPending || isApproved) && (
                                    <button
                                      onClick={() => isApproved ? handleUndoApprove(event.id) : handleReject(event.id)}
                                      className={cn(
                                        "flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95",
                                        isApproved
                                          ? "bg-gray-100 text-gray-500 hover:bg-rose-50 hover:text-rose-600"
                                          : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                                      )}
                                    >
                                      <RotateCcw size={13}/>
                                      {isApproved ? "Undo" : "Reject"}
                                    </button>
                                  )}

                                  {/* Send to Hub — only for approved + not already there */}
                                  {isApproved && !hubExists && !hubSent && (
                                    <button
                                      onClick={() => handleSendToHub(event)}
                                      disabled={sendingToHub.has(event.id)}
                                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-violet-600 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                      {sendingToHub.has(event.id) ? (
                                        <>
                                          <svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                            <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
                                            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                                          </svg>
                                          Sending...
                                        </>
                                      ) : (
                                        <><Send size={13}/> Send to Hub</>
                                      )}
                                    </button>
                                  )}

                                  {/* Spacer pushes Edit to the right */}
                                  <div className="flex-1" />

                                  {/* Edit / Audit */}
                                  <button
                                    onClick={() => setEditingEvent(event)}
                                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-crimson transition-all active:scale-95"
                                  >
                                    <Pencil size={13}/> Edit
                                  </button>
                                </div>
                              </div>
                            );
                          })
                      )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'analytics' && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  key="analytics"
                  className="space-y-8"
                >
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <MetricCard title="Total Events" value={stagingEvents.length} icon={Database} />
                    <MetricCard title="Approved" value={approvedCount} icon={CheckCircle2} trend="Real-time" />
                    <MetricCard title="Pending Review" value={pendingCount} icon={Clock} />
                    <MetricCard title="Duplicates Found" value={dupStats.exists} icon={AlertCircle} trend={`${dupStats.dupeRate}% dupe rate`} />
                    <MetricCard title="New to Hub" value={dupStats.isNew} icon={Globe} />
                    <MetricCard title="Sent to Hub" value={dupStats.sent} icon={Send} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                      {/* Extraction Frequency */}
                      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-10">
                        <div className="flex items-center justify-between mb-10">
                          <div>
                            <h3 className="text-2xl font-black italic tracking-tighter text-gray-900 uppercase">Events by Source</h3>
                            <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-widest mt-1">Live count of ingested events per data source</p>
                          </div>
                          <div className="flex flex-wrap gap-4 justify-end">
                            {Object.entries(SOURCE_COLORS).map(([name, color]) => (
                              <div key={name} className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="h-[350px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={extractionData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECECEE" />
                              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 900 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 900 }} />
                              <Tooltip 
                                contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.1)' }}
                                cursor={{ fill: '#F9FAFB' }}
                              />
                              <Bar 
                                dataKey="events" 
                                radius={[8, 8, 0, 0]} 
                                barSize={45}
                              >
                                {extractionData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={SOURCE_COLORS[entry.source] || '#E5E7EB'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-10">
                          <h3 className="text-lg font-black italic tracking-tighter text-gray-900 uppercase mb-8">Source Distribution</h3>
                          <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={Object.entries(
                                    stagingEvents.reduce((acc: any, curr) => {
                                      acc[curr.source] = (acc[curr.source] || 0) + 1;
                                      return acc;
                                    }, {})
                                  ).map(([name, value]) => ({ name, value }))}
                                  innerRadius={60}
                                  paddingAngle={5}
                                  dataKey="value"
                                >
                                  {stagingEvents.length > 0 ? (
                                    Object.entries(
                                      stagingEvents.reduce((acc: any, curr) => {
                                        acc[curr.source] = (acc[curr.source] || 0) + 1;
                                        return acc;
                                      }, {})
                                    ).map(([name], index) => (
                                      <Cell key={`cell-${index}`} fill={(SOURCE_COLORS as any)[name] || '#E5E7EB'} />
                                    ))
                                  ) : (
                                    <Cell fill="#E5E7EB" />
                                  )}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-10">
                          <h3 className="text-lg font-black italic tracking-tighter text-gray-900 uppercase mb-8">Audit Integrity</h3>
                          <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={[
                                    { name: 'Approved', value: approvedCount },
                                    { name: 'Needs Review', value: pendingCount },
                                    { name: 'Rejected', value: rejectedCount }
                                  ]}
                                  innerRadius={60}
                                  paddingAngle={5}
                                  dataKey="value"
                                >
                                  <Cell fill="#10B981" />
                                  <Cell fill="#9CA3AF" />
                                  <Cell fill="#C41230" />
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">

                      {/* Duplicate detection breakdown */}
                      <div className="bg-white rounded-3xl border border-gray-100 p-7 space-y-5">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Hub Duplicate Detection</h3>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">AI embedding comparison against CommunityHub</p>
                        </div>

                        {dupStats.checked === 0 ? (
                          <p className="text-xs text-gray-400 italic">Pull events to run duplicate detection.</p>
                        ) : (
                          <>
                            {/* Visual bar */}
                            <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden flex">
                              <div
                                className="h-full bg-blue-400 transition-all"
                                style={{ width: `${(dupStats.exists / dupStats.checked) * 100}%` }}
                              />
                              <div
                                className="h-full bg-violet-400 transition-all"
                                style={{ width: `${(dupStats.isNew / dupStats.checked) * 100}%` }}
                              />
                              <div
                                className="h-full bg-emerald-400 transition-all"
                                style={{ width: `${(dupStats.sent / dupStats.checked) * 100}%` }}
                              />
                            </div>

                            <div className="grid grid-cols-3 gap-3 text-center">
                              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                                <div className="text-2xl font-black text-blue-600">{dupStats.exists}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-blue-400 mt-1">Already on Hub</div>
                              </div>
                              <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
                                <div className="text-2xl font-black text-violet-600">{dupStats.isNew}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-violet-400 mt-1">New to Hub</div>
                              </div>
                              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                                <div className="text-2xl font-black text-emerald-600">{dupStats.sent}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-emerald-400 mt-1">Sent to Hub</div>
                              </div>
                            </div>

                            <div className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                              {dupStats.dupeRate}% duplicate rate across {dupStats.checked} checked events
                            </div>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-6">
                        <AIPulse events={stagingEvents} />
                      </div>
                      
                      <div className="bg-gray-950 rounded-[40px] p-10 text-white shadow-2xl relative overflow-hidden">
                        {isInsightLoading && (
                          <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm z-10 flex items-center justify-center">
                            <RefreshCw size={24} className="text-crimson animate-spin" />
                          </div>
                        )}
                        <h3 className="text-xl font-black italic tracking-tighter uppercase mb-6 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sparkles size={20} className="text-crimson" /> Research Insight
                          </div>
                          <button onClick={generateResearchInsight} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                            <RefreshCw size={14} className="text-gray-500" />
                          </button>
                        </h3>
                        <p className="text-sm font-medium leading-relaxed text-gray-400 mb-8">
                          AI-driven analysis of extraction quality and repository trends.
                        </p>
                        <div className="space-y-4">
                           <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                             <div className="text-[10px] font-black uppercase tracking-widest text-crimson mb-1">Observation</div>
                             <p className="text-[12px] font-medium">{researchInsight.observation}</p>
                           </div>
                           <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                             <div className="text-[10px] font-black uppercase tracking-widest text-crimson mb-1">Recommendation</div>
                             <p className="text-[12px] font-medium">{researchInsight.recommendation}</p>
                           </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-10">
                        <h3 className="text-lg font-black italic tracking-tighter text-gray-900 uppercase mb-2">AI Precision Analysis</h3>
                        <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-widest mb-8">Comparing AI Classification vs. Human Audit</p>
                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={(() => {
                                  const approved = stagingEvents.filter(e => e.review_status === 'approved');
                                  if (approved.length === 0) return [{ name: 'Awaiting Audit', value: 1 }];
                                  const correct = approved.filter(e => e.geographic_scope === e.ai_geographic_scope).length;
                                  const incorrect = approved.length - correct;
                                  return [
                                    { name: 'Precise', value: correct },
                                    { name: 'Manually Corrected', value: incorrect }
                                  ];
                                })()}
                                innerRadius={60}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                <Cell fill="#10B981" />
                                <Cell fill="#F59E0B" />
                              </Pie>
                              <Tooltip />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  key="settings"
                  className="bg-white rounded-[40px] border border-gray-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)] overflow-hidden"
                >
                  <div className="p-10 border-b border-gray-50 bg-white">
                    <h3 className="text-3xl font-black italic tracking-tighter text-gray-900 uppercase">Provider Infrastructure</h3>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Configuring extraction adapters and system synchronization parameters</p>
                  </div>

                  {/* Auto-approve settings */}
                  <div className="p-10 border-b border-gray-100 bg-white">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest text-gray-900">Auto-Approve</h4>
                        <p className="text-xs text-gray-400 font-medium mt-1">
                          Events with a quality score at or above the threshold are automatically approved on ingest
                        </p>
                      </div>
                      {/* Toggle */}
                      <button
                        onClick={toggleAutoApprove}
                        className={cn(
                          "relative w-12 h-6 rounded-full transition-colors shrink-0",
                          autoApprove ? "bg-emerald-500" : "bg-gray-200"
                        )}
                      >
                        <span className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform",
                          autoApprove ? "translate-x-7" : "translate-x-1"
                        )} />
                      </button>
                    </div>

                    {autoApprove && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-6 bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
                          <span className="text-xs font-black uppercase tracking-widest text-emerald-700 shrink-0">
                            Threshold
                          </span>
                          <input
                            type="range"
                            min={50} max={100} step={5}
                            value={autoApproveThreshold}
                            onChange={e => changeThreshold(Number(e.target.value))}
                            className="flex-1 accent-emerald-500"
                          />
                          <span className="text-xl font-black text-emerald-700 w-16 text-right">
                            {autoApproveThreshold}%
                          </span>
                        </div>
                        <button
                          onClick={applyAutoApproveNow}
                          className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2"
                        >
                          <Check size={14} /> Apply to Existing Events Now
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="p-10 bg-gray-50/30 border-b border-gray-100">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                      <div className="space-y-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#C41230]">Normalization engine</div>
                        <p className="text-sm font-medium leading-relaxed text-gray-600 italic">Uses Oberlin specific JSON-LD schemas to ensure cross-institutional compatibility between the College and Environmental Dashboard.</p>
                      </div>
                      <div className="space-y-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#C41230]">Auditing logic</div>
                        <p className="text-sm font-medium leading-relaxed text-gray-600 italic">Every event is scored against 14 metadata criteria. Items {'<'} 70% are automatically flagged for the human review queue.</p>
                      </div>
                      <div className="space-y-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#C41230]">Data Persistence</div>
                        <p className="text-sm font-medium leading-relaxed text-gray-600 italic">Approved records are synced every 30 minutes to the central community repository via institutional REST endpoints.</p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-10 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Provider Name</th>
                          <th className="px-10 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Endpoint Protocol</th>
                          <th className="px-10 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                          <th className="px-10 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Frequency (min)</th>
                          <th className="px-10 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Last Harvest</th>
                          <th className="px-10 py-5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {sources.map(source => (
                          <tr key={source.id} className="group hover:bg-gray-50/50 transition-all">
                            <td className="px-10 py-6">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-white border border-gray-100 rounded-xl text-crimson group-hover:scale-110 transition-transform">
                                  <ExternalLink size={16} />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-gray-900">{source.name}</span>
                                  <span className="text-[10px] font-mono text-gray-400">{source.url}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-10 py-6 font-mono text-xs text-gray-500 uppercase">{source.adapter}</td>
                            <td className="px-10 py-6">
                              <Badge variant={source.status === 'active' ? 'green' : 'gray'}>{source.status}</Badge>
                            </td>
                            <td className="px-10 py-6">
                              <input
                                type="number"
                                value={source.frequency}
                                onChange={(e) => updateSourceFrequency(source.id, parseInt(e.target.value) || 0)}
                                className="w-20 p-2 bg-white border border-gray-100 rounded-lg text-xs font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson outline-none transition-all"
                              />
                            </td>
                            <td className="px-10 py-6 font-mono text-xs text-gray-500">{source.lastScanned ? new Date(source.lastScanned).toLocaleString() : 'Never'}</td>
                            <td className="px-10 py-6 text-right">
                              <button className="p-2 text-gray-300 hover:text-crimson transition-colors">
                                <MoreVertical size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
              {activeTab === 'playground' && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  key="playground"
                  className="flex flex-col gap-8 h-full"
                >
                  <div className="flex items-center justify-between bg-white p-10 rounded-[40px] border border-gray-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)]">
                    <div>
                      <h3 className="text-3xl font-black italic tracking-tighter text-gray-900 uppercase">AI Orchestration</h3>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Manual extraction audit and testing environment</p>
                    </div>

                    <div className="flex items-center gap-8">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Model Retrieval Capacity</label>
                          <div className="flex items-center gap-4">
                            <input 
                              type="range"
                              min="1"
                              max="100"
                              value={syncLimit}
                              onChange={(e) => setSyncLimit(parseInt(e.target.value))}
                              className="w-48 accent-crimson h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-xl font-black text-gray-900 w-12">{syncLimit}</span>
                          </div>
                        </div>
                        <button 
                           onClick={handleIngestAll}
                           disabled={isIngesting}
                           className="px-10 py-5 bg-gray-950 text-white rounded-[24px] text-[11px] font-black uppercase tracking-[0.2em] hover:bg-crimson transition-all flex items-center gap-3"
                        >
                           <RefreshCw size={18} className={isIngesting ? "animate-spin" : ""} />
                           Run Sync Job
                        </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
                    <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm flex flex-col overflow-hidden">
                      <div className="p-8 border-b border-gray-50 bg-gray-100/30 flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-widest text-crimson">Extraction Input</h3>
                        <span className="text-[10px] font-bold text-gray-400">Limit set to {syncLimit} records</span>
                      </div>
                      <textarea 
                        placeholder="Paste raw webpage content or unstructured text here for high-fidelity extraction..."
                        className="flex-1 p-10 text-[15px] font-medium leading-relaxed resize-none focus:outline-none bg-transparent"
                        value={evaluationInput}
                        onChange={(e) => setEvaluationInput(e.target.value)}
                      />
                      <div className="p-8 border-t border-gray-50 flex gap-4">
                        <button 
                          onClick={async () => {
                            setIsEvaluating(true);
                            try {
                              const results = await extractEventsFromText(evaluationInput, "Manual Audit", "https://research.oberlin.edu");
                              setEvaluationOutput(results[0] || null);
                            } catch (err) {
                              console.error(err);
                            } finally {
                              setIsEvaluating(false);
                            }
                          }}
                          disabled={!evaluationInput || isEvaluating}
                          className="flex-1 py-5 bg-crimson text-white rounded-2xl text-[12px] font-black uppercase tracking-widest hover:bg-crimson/90 transition-all disabled:opacity-50 italic"
                        >
                          {isEvaluating ? 'Normalizing Infrastructure...' : 'Orchestrate AI Extraction'}
                        </button>
                      </div>
                    </div>

                    <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm flex flex-col overflow-hidden">
                      <div className="p-8 border-b border-gray-50 bg-gray-100/30 flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-widest text-[#C41230]">Structured Staging Payload</h3>
                        <span className="text-[10px] font-bold text-gray-400">Standardized Research Format</span>
                      </div>
                      <div className="flex-1 p-10 font-mono text-[11px] overflow-auto bg-gray-900 text-emerald-400 shadow-inner">
                        {evaluationOutput ? (
                          <pre>{JSON.stringify(evaluationOutput, null, 2)}</pre>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-gray-700 italic text-center p-10">
                            Awaiting input to generate semantic extraction payload...
                          </div>
                        )}
                      </div>
                      <div className="p-8 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                          <button 
                            disabled={!evaluationOutput}
                            onClick={() => setEvaluationStatus('correct')}
                            className={cn(
                              "flex-1 py-4 border-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                              evaluationStatus === 'correct' ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-200 text-gray-400 hover:border-emerald-500 hover:text-emerald-500"
                            )}
                          >
                            <CheckCircle2 size={16} /> Mark as Correct
                          </button>
                          <button 
                            disabled={!evaluationOutput}
                            onClick={() => setEvaluationStatus('incorrect')}
                            className={cn(
                              "flex-1 py-4 border-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                              evaluationStatus === 'incorrect' ? "bg-rose-500 border-rose-500 text-white" : "border-gray-200 text-gray-400 hover:border-rose-500 hover:text-rose-500"
                            )}
                          >
                            <X size={16} /> Mark as Incorrect
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Edit Modal Overlay */}
      <AnimatePresence>
        {editingEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingEvent(null)}
              className="absolute inset-0 bg-crimson/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-4xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-gold"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <div>
                  <h3 className="text-xl font-bold uppercase tracking-tighter italic text-crimson mb-1">Advanced Event Editor</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Environmental Dashboard Normalization Engine</p>
                </div>
                <button onClick={() => setEditingEvent(null)} className="p-2 hover:bg-white rounded-full transition-all text-gray-400 hover:text-crimson">
                  <X size={24} />
                </button>
              </div>

              <form id="edit-form" onSubmit={handleSaveEdit} className="flex-1 overflow-y-auto p-10 space-y-12">
                {/* Visual Metadata Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                  <div className="lg:col-span-2 space-y-8">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Event Title</label>
                      <input 
                        type="text" 
                        value={editingEvent.title}
                        onChange={(e) => setEditingEvent({...editingEvent, title: e.target.value})}
                        className="w-full text-3xl font-black italic tracking-tighter bg-transparent border-b-2 border-gray-100 focus:border-crimson outline-none py-2 transition-all uppercase"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Start Date & Time</label>
                        <div className="flex gap-2">
                          <input 
                            type="date" 
                            value={editingEvent.start_date}
                            onChange={(e) => setEditingEvent({...editingEvent, start_date: e.target.value})}
                            className="flex-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                          />
                          <input 
                            type="time" 
                            value={editingEvent.start_time}
                            onChange={(e) => setEditingEvent({...editingEvent, start_time: e.target.value})}
                            className="w-32 p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">End Date & Time</label>
                        <div className="flex gap-2">
                          <input 
                            type="date" 
                            value={editingEvent.end_date}
                            onChange={(e) => setEditingEvent({...editingEvent, end_date: e.target.value})}
                            className="flex-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                          />
                          <input 
                            type="time" 
                            value={editingEvent.end_time}
                            onChange={(e) => setEditingEvent({...editingEvent, end_time: e.target.value})}
                            className="w-32 p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Location Name</label>
                        <input 
                          type="text" 
                          value={editingEvent.location_name}
                          onChange={(e) => setEditingEvent({...editingEvent, location_name: e.target.value})}
                          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Location Address</label>
                        <input 
                          type="text" 
                          value={editingEvent.location_address}
                          onChange={(e) => setEditingEvent({...editingEvent, location_address: e.target.value})}
                          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-crimson/5 rounded-3xl p-6 border border-crimson/10">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-crimson mb-2 flex items-center gap-2">
                        <BarChart3 size={14} /> Normalization Audit
                      </h4>
                      <div className="flex items-end gap-2 mb-4">
                        <span className="text-5xl font-black italic text-crimson leading-none">{editingEvent.quality_score}</span>
                        <span className="text-sm font-bold text-crimson/50 pb-1">/100</span>
                      </div>
                      <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden mb-4">
                        <div className="bg-crimson h-full transition-all" style={{ width: `${editingEvent.quality_score}%` }} />
                      </div>
                      <div className="space-y-1">
                        <h5 className="text-[9px] font-black uppercase tracking-widest text-gray-400">Score Reasoning:</h5>
                        {(editingEvent.quality_notes || []).length > 0 || editingEvent.quality_score < 100 ? (
                           <ul className="space-y-1">
                             {(editingEvent.quality_notes || []).map((note, idx) => (
                               <li key={idx} className="text-[10px] font-bold text-crimson flex items-center gap-2">
                                 <AlertCircle size={10} /> {note}
                               </li>
                             ))}
                             {editingEvent.quality_score < 100 && (editingEvent.quality_notes || []).length === 0 && (
                               <li className="text-[10px] font-bold text-crimson flex items-center gap-2">
                                 <AlertCircle size={10} /> Minor inconsistencies detected in metadata.
                               </li>
                             )}
                           </ul>
                        ) : (
                          <p className="text-[10px] font-bold text-emerald-600">Perfect extraction match.</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-2 col-span-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Geographic Scope (AI Decided: {editingEvent.ai_geographic_scope})</label>
                      <select 
                        value={editingEvent.geographic_scope}
                        onChange={(e) => setEditingEvent({...editingEvent, geographic_scope: e.target.value as any})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      >
                        <option value="hyperlocal">Hyperlocal (Institutional)</option>
                        <option value="city">City (Community Wide)</option>
                        <option value="lorain_county">Lorain County</option>
                        <option value="northeast_ohio">Northeast Ohio</option>
                        <option value="state">State Level</option>
                        <option value="national">National</option>
                        <option value="online">Online / Virtual</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Organizer / Sponsor</label>
                      <input 
                        type="text" 
                        value={editingEvent.organizer}
                        onChange={(e) => setEditingEvent({...editingEvent, organizer: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Audience</label>
                      <input 
                        type="text" 
                        value={editingEvent.audience}
                        onChange={(e) => setEditingEvent({...editingEvent, audience: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Cost</label>
                      <input 
                        type="text" 
                        value={editingEvent.cost}
                        onChange={(e) => setEditingEvent({...editingEvent, cost: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Recurrence</label>
                      <input 
                        type="text" 
                        value={editingEvent.recurrence}
                        onChange={(e) => setEditingEvent({...editingEvent, recurrence: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Duplicate Key (Slug)</label>
                      <input 
                        type="text" 
                        value={editingEvent.duplicate_key}
                        onChange={(e) => setEditingEvent({...editingEvent, duplicate_key: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-mono focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Extended Description (description_long)</label>
                    <textarea 
                      rows={6}
                      value={editingEvent.description_long}
                      onChange={(e) => setEditingEvent({...editingEvent, description_long: e.target.value})}
                      className="w-full p-6 bg-gray-50 border border-gray-100 rounded-[32px] text-sm font-medium leading-relaxed focus:ring-2 focus:ring-crimson/20 focus:border-crimson transition-all"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Short Sign Extract (description_short)</label>
                    <textarea 
                      rows={3}
                      value={editingEvent.description_short}
                      onChange={(e) => setEditingEvent({...editingEvent, description_short: e.target.value})}
                      className="w-full p-6 bg-gold/5 border border-gold/20 rounded-[24px] text-sm font-bold italic focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all"
                      maxLength={200}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Event URL</label>
                      <input 
                        type="text" 
                        value={editingEvent.event_url}
                        onChange={(e) => setEditingEvent({...editingEvent, event_url: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Image URL</label>
                      <input 
                        type="text" 
                        value={editingEvent.image_url}
                        onChange={(e) => setEditingEvent({...editingEvent, image_url: e.target.value})}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              </form>

              <div className="p-8 bg-gray-50 border-t border-gray-100 flex gap-4 shrink-0">
                <button 
                  type="button" 
                  onClick={() => {
                    handleApprove(editingEvent.id);
                    setEditingEvent(null);
                  }}
                  className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 active:scale-95 transition-all flex items-center justify-center gap-3 italic"
                >
                  <CheckCircle2 size={18} /> Approve Record
                </button>
                <button 
                  type="submit" 
                  form="edit-form"
                  className="px-10 py-4 bg-gray-950 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg hover:bg-gray-800 active:scale-95 transition-all italic"
                >
                  Commit Edits
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    handleReject(editingEvent.id);
                    setEditingEvent(null);
                  }}
                  className="px-8 py-4 bg-white border border-rose-100 text-rose-500 rounded-2xl text-[11px] font-black uppercase tracking-[0.1em] hover:bg-rose-50 transition-all font-black"
                >
                  Reject & Purge
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
