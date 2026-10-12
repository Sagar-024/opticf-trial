'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, LayoutGrid, List, Search, Sparkles, X } from 'lucide-react';
import type { MapModel, MapPractice } from '@/data/map-model';
import { buildLenses, filterById, lensById, type LensId } from '@/map/lenses';
import type { MapLevel } from '@/map/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MapCanvas } from './map-canvas';
import { PracticeSheet } from './practice-sheet';

/**
 * The map surface: toolbar, lenses, legend, canvas, focus strip, list view and
 * inspector. Every number shown here comes from the map model, which is built
 * from the same pure functions the chat tools use.
 */

export interface MapIntent {
  /** Focus this region (null returns to the group view). */
  region?: string | null;
  lens?: LensId;
  filterId?: string;
  selectedId?: string | null;
  /** Bump to re-apply the same intent. */
  nonce: number;
}

export interface MapViewProps {
  model: MapModel;
  highlighted: string[];
  onHighlightChange: (ids: string[]) => void;
  onAsk: (question: string) => void;
  intent?: MapIntent | null;
  /** Called once the intent has been applied, so it is never replayed. */
  onIntentHandled?: () => void;
}

function inferLensFromHighlight(practices: MapPractice[], ids: string[]): LensId {
  if (ids.length === 0) return 'region';
  const set = practices.filter((practice) => ids.includes(practice.practiceId));
  if (set.length === 0) return 'region';

  const coverage: Array<[LensId, number]> = [
    ['contactLens', set.filter((practice) => practice.clAttainmentPct < 90).length],
    ['training', set.filter((practice) => practice.trainingCompletionPct < 100).length],
    ['sales', set.filter((practice) => practice.attentionScore >= 25).length],
  ];
  const best = coverage.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] >= Math.ceil(set.length / 2) ? best[0] : 'sales';
}

export function MapView({ model, highlighted, onHighlightChange, onAsk, intent, onIntentHandled }: MapViewProps) {
  const [lensId, setLensId] = useState<LensId>('region');
  const [region, setRegion] = useState<string | null>(null);
  const [filterId, setFilterId] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showList, setShowList] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const lenses = useMemo(
    () => buildLenses({ regions: model.regions.map((r) => r.name), mentors: model.mentors }),
    [model.regions, model.mentors],
  );
  const lens = lensById(lenses, lensId);
  const filter = filterById(lens, filterId);

  const level: MapLevel = region ? 'region' : 'group';
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  const visible = useMemo(() => {
    const inLevel = region ? model.practices.filter((p) => p.region === region) : model.practices;
    const q = query.trim().toLowerCase();
    if (!q) return inLevel;
    return inLevel.filter((p) => p.name.toLowerCase().includes(q) || p.region.toLowerCase().includes(q) || p.practiceId.toLowerCase() === q);
  }, [model.practices, region, query]);

  /** Matches within the current view, so the counter and the strip agree. */
  const matching = useMemo(() => visible.filter((practice) => filter.match(practice)), [visible, filter]);

  const focus = useMemo(
    () => [...matching].sort((a, b) => b.attentionScore - a.attentionScore).slice(0, 5),
    [matching],
  );

  const selected = useMemo(
    () => model.practices.find((practice) => practice.practiceId === selectedId) ?? null,
    [model.practices, selectedId],
  );

  // The URL only mirrors the current view. Deep links are parsed once by the
  // shell (see the `intent` prop), so a stale query can never be replayed when
  // the map remounts after a tab switch.
  useEffect(() => {
    const params = new URLSearchParams();
    if (lensId !== 'region') params.set('lens', lensId);
    if (region) params.set('region', region);
    if (filterId !== 'all') params.set('filter', filterId);
    if (selectedId) params.set('practice', selectedId);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [lensId, region, filterId, selectedId]);

  // A chat highlight picks the lens that explains it best.
  useEffect(() => {
    if (highlighted.length === 0) return;
    setLensId(inferLensFromHighlight(model.practices, highlighted));
    setFilterId('all');
    setSelectedId(null);
    setRegion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted.join(',')]);

  // An explicit intent (a deep link or a Today card) is applied once, then
  // cleared by the shell so it cannot be replayed on remount.
  useEffect(() => {
    if (!intent) return;
    if (intent.lens) setLensId(intent.lens);
    if (intent.filterId) setFilterId(intent.filterId);
    setRegion(intent.region ?? null);
    setSelectedId(intent.selectedId ?? null);
    setSheetOpen(Boolean(intent.selectedId));
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.nonce]);

  function selectLens(next: LensId): void {
    setLensId(next);
    setFilterId('all');
  }

  function selectPractice(practiceId: string | null): void {
    setSelectedId(practiceId);
    setSheetOpen(Boolean(practiceId));
  }

  const matches = (practice: MapPractice) => filter.match(practice);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb + counters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          onClick={() => {
            setRegion(null);
            onHighlightChange([]);
          }}
          className="text-xs font-semibold text-foreground"
        >
          Northstar Group
        </button>
        {region ? (
          <>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <button onClick={() => onHighlightChange([])} className="text-xs text-muted-foreground">
              {region}
            </button>
          </>
        ) : null}
        <Badge variant="outline" className="ml-1 text-[10px]">
          {model.monthLabel}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {matching.length} of {visible.length} matching
          </span>
          {highlighted.length > 0 ? (
            <Badge className="gap-1 bg-coral text-white">
              {highlighted.length} highlighted
              <button onClick={() => onHighlightChange([])} aria-label="Clear highlight">
                <X className="size-3" />
              </button>
            </Badge>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showList ? 'secondary' : 'ghost'}
                size="icon"
                aria-label={showList ? 'Show map' : 'Show list view'}
                onClick={() => setShowList((value) => !value)}
              >
                {showList ? <LayoutGrid /> : <List />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showList ? 'Back to the map' : 'List view, keyboard and screen reader friendly'}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Select value={lensId} onValueChange={(value) => selectLens(value as LensId)}>
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Map lens">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lenses.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={region ?? 'all'} onValueChange={(value) => { setRegion(value === 'all' ? null : value); onHighlightChange([]); }}>
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Filter by region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All regions</SelectItem>
            {model.regions.map((item) => (
              <SelectItem key={item.name} value={item.name} className="text-xs">
                {item.name} ({item.practiceCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-1">
          {lens.filters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterId(item.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                filterId === item.id
                  ? 'border-coral bg-coral/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-[190px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a practice"
            className="h-8 pl-7 text-xs"
            aria-label="Find a practice"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2">
        {lens.legend.map((entry) => (
          <span key={entry.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: `oklch(var(--${entry.colorKey === 'coral' ? 'coral' : entry.colorKey}))` }} />
            {entry.label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="size-3 text-coral" /> {lens.question}
        </span>
      </div>

      {/* Canvas or list */}
      <div className="relative min-h-0 flex-1">
        {showList ? (
          <div className="h-full overflow-y-auto px-4 pb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Practice</TableHead>
                  <TableHead className="text-[11px]">Region</TableHead>
                  <TableHead className="text-[11px]">Revenue</TableHead>
                  <TableHead className="text-[11px]">Conversion</TableHead>
                  <TableHead className="text-[11px]">Contact lens</TableHead>
                  <TableHead className="text-[11px]">Training</TableHead>
                  <TableHead className="text-[11px]">Attention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((practice) => (
                  <TableRow
                    key={practice.practiceId}
                    onClick={() => selectPractice(practice.practiceId)}
                    className={cn('cursor-pointer', highlightSet.has(practice.practiceId) && 'bg-coral/10')}
                  >
                    <TableCell className="text-xs font-medium">{practice.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{practice.region}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.revenueDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.conversionDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.clAttainmentDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.trainingCompletionDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.attentionScore}</TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                      No practice matches this filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        ) : (
          <MapCanvas
            model={{ ...model, practices: visible }}
            lens={lens}
            level={level}
            regionName={region}
            highlighted={highlighted}
            matches={matches}
            selectedId={selectedId}
            onSelect={selectPractice}
            onDrillRegion={(next) => {
              setRegion(next);
              onHighlightChange([]);
            }}
            onReset={() => {
              setRegion(null);
              onHighlightChange([]);
            }}
          />
        )}

        {visible.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="pointer-events-auto rounded-lg border border-border bg-card px-4 py-3 text-center text-xs text-muted-foreground shadow-soft">
              Nothing matches this filter.
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => { setFilterId('all'); setQuery(''); onHighlightChange([]); }}>
                  Reset filters
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Focus strip: what to look at next */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="label-caps">Where to focus</span>
          <span className="text-[10px] text-muted-foreground">top {focus.length} by attention score in {lens.label.toLowerCase()} view</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {focus.map((practice) => (
            <button
              key={practice.practiceId}
              onClick={() => {
                selectPractice(practice.practiceId);
                onHighlightChange([practice.practiceId]);
              }}
              className={cn(
                'min-w-[190px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                highlightSet.has(practice.practiceId) ? 'border-coral bg-coral/10' : 'border-border hover:bg-accent',
              )}
            >
              <p className="text-xs font-semibold">{practice.name}</p>
              <p className="text-[10px] text-muted-foreground">{practice.region} · score {practice.attentionScore}/100</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {practice.revenueDisplay} ({practice.revenueMoMDisplay})
              </p>
            </button>
          ))}
          {focus.length === 0 ? (
            <p className="text-xs text-muted-foreground">No practices need attention in this view.</p>
          ) : null}
        </div>
      </div>

      <PracticeSheet
        practice={selected}
        open={sheetOpen && Boolean(selected)}
        onOpenChange={setSheetOpen}
        onAsk={onAsk}
        onHighlight={(practiceId) => onHighlightChange([practiceId])}
      />
    </div>
  );
}
