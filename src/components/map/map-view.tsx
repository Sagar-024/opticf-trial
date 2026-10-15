'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleDashed, GitCompare, LayoutGrid, List, Maximize2, Minimize2, Search, X } from 'lucide-react';
import type { MapModel, MapPractice } from '@/data/map-model';
import { mentor_portfolios } from '@/data/map-model';
import { buildLenses, filterById, lensById, type LensId } from '@/map/lenses';
import type { MapLevel } from '@/map/layout';
import { tokenVarFor } from '@/components/map/palette';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MapCanvas } from './map-canvas';
import { PracticePanel } from './practice-panel';
import { ComparePanel } from './compare-panel';
import { buildCompareView } from '@/compare/model';

/**
 * The map surface: toolbar, lenses, legend, canvas, focus strip and inspector.
 *
 * In focus mode the chrome animates away with framer-motion and the graph fills
 * the screen, leaving only the controls needed to steer and to come back.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
/** The most practices one comparison takes. Past this the chart stops reading. */
const COMPARE_MAX = 8;
const SLIDE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.3, ease: EASE },
};

export interface MapIntent {
  /** Focus this region (null returns to the group view). */
  region?: string | null;
  lens?: LensId;
  filterId?: string;
  selectedId?: string | null;
  /** Open the compare dock on this pair, e.g. from a chat comparison. */
  compare?: string[];
  /** Bump to re-apply the same intent. */
  nonce: number;
}

export interface MapViewProps {
  model: MapModel;
  highlighted: string[];
  onHighlightChange: (ids: string[]) => void;
  intent?: MapIntent | null;
  onIntentHandled?: () => void;
  focus?: boolean;
  onToggleFocus?: () => void;
  /** Opens a linked Brain document from the practice panel. */
  onOpenBrain?: (documentTitle: string) => void;
  /** Hands a compared set to the assistant, for the written explanation. */
  onAsk?: (practiceIds: string[]) => void;
}

function inferLensFromHighlight(practices: MapPractice[], ids: string[]): LensId {
  if (ids.length === 0) return 'region';
  const set = practices.filter((practice) => ids.includes(practice.practiceId));
  if (set.length === 0) return 'region';

  const coverage: Array<[LensId, number]> = [
    ['contactLens', set.filter((practice) => practice.clAttainmentPct < 90).length],
    ['training', set.filter((practice) => practice.trainingCompletionPct < 100).length],
    ['sales', set.filter((practice) => practice.revenueMoMPct <= -3 || practice.revenueAttainmentPct < 95).length],
  ];
  const best = coverage.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] >= Math.ceil(set.length / 2) ? best[0] : 'sales';
}

export function MapView({
  model,
  highlighted,
  onHighlightChange,
  intent,
  onIntentHandled,
  focus = false,
  onToggleFocus,
  onOpenBrain,
  onAsk,
}: MapViewProps) {
  const [lensId, setLensId] = useState<LensId>('region');
  const [region, setRegion] = useState<string | null>(null);
  const [filterId, setFilterId] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showList, setShowList] = useState(false);
  /** The practice page is open: the whole area, like a popup over the map. */
  const [pageOpen, setPageOpen] = useState(false);
  /** Compare mode: node clicks build the pair instead of opening a practice. */
  const [compareMode, setCompareMode] = useState(false);
  /** The comparison page itself, over the map, exactly like the practice page. */
  const [compareOpen, setCompareOpen] = useState(false);

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

  /**
   * The five worth reading first: the largest revenue moves, biggest fall
   * first. A plain metric rather than a hidden score, so the strip can always
   * say why a practice is on it.
   */
  const focus_top = useMemo(
    () => [...matching].sort((a, b) => a.revenueMoMPct - b.revenueMoMPct).slice(0, 5),
    [matching],
  );

  const selected = useMemo(
    () => model.practices.find((practice) => practice.practiceId === selectedId) ?? null,
    [model.practices, selectedId],
  );

  const portfolios = useMemo(() => mentor_portfolios(model), [model]);

  /**
   * The practices under comparison, in the order they were picked, and the
   * view the card draws. Built by the same pure builder the chat tool uses.
   */
  const compareIds = useMemo(
    () => (compareMode ? highlighted.slice(0, COMPARE_MAX) : []),
    [compareMode, highlighted],
  );
  const compareKey = compareIds.join(',');
  const compareView = useMemo(() => {
    if (compareIds.length < 2) return null;
    const practices = compareIds
      .map((id) => model.practices.find((practice) => practice.practiceId === id))
      .filter((practice): practice is MapPractice => Boolean(practice));
    if (practices.length < 2) return null;
    return buildCompareView(practices, model.monthLabel, model.month);
    // The key pins the set; the model itself only changes on a data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareKey, model]);

  /** The thread the canvas draws: only a pair reads as one thread. */
  const compareLinks = useMemo<Array<[string, string]>>(
    () => (compareIds.length === 2 ? [[compareIds[0], compareIds[1]]] : []),
    // The key pins the pair; the ids array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareKey],
  );

  /**
   * The comparison rings. Four arcs per compared practice, all on one scale
   * (share of the 100% target line, capped at 130%), coloured by the same
   * bands the lenses use: green at target, amber just under, coral well under.
   * The graph then carries the comparison itself: two shapes, one glance.
   */
  const compareRings = useMemo(() => {
    const ids = compareMode ? compareIds : highlighted.length === 2 ? highlighted : [];
    const band = (attainment: number): 'green' | 'amber' | 'coral' =>
      attainment >= 100 ? 'green' : attainment >= 90 ? 'amber' : 'coral';
    const share = (attainment: number) => Math.min(1, Math.max(0, attainment / 130));

    return ids
      .map((id) => model.practices.find((practice) => practice.practiceId === id))
      .filter((practice): practice is MapPractice => Boolean(practice))
      .map((practice) => {
        const conversionAttainment =
          practice.conversionTargetPct > 0 ? (practice.conversionPct / practice.conversionTargetPct) * 100 : 0;
        const attainments = [
          practice.revenueAttainmentPct,
          conversionAttainment,
          practice.clAttainmentPct,
          practice.trainingCompletionPct,
        ];
        return {
          id: practice.practiceId,
          arcs: attainments.map((attainment) => ({ fraction: share(attainment), colorKey: band(attainment) })),
        };
      });
    // The key pins the pair; the model itself only changes on a data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, compareKey, highlighted.join(','), model]);

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

  // A chat highlight picks the lens that explains it best and brings the chain
  // of context into view. In compare mode the selection is the user's, so the
  // lens stays put.
  useEffect(() => {
    if (compareMode) return;
    if (highlighted.length === 0) return;
    setLensId(inferLensFromHighlight(model.practices, highlighted));
    setFilterId('all');
    setSelectedId((current) => (current && highlighted.includes(current) ? current : null));
    setRegion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted.join(','), compareMode]);

  // An explicit intent (a deep link or a Today card) is applied once, then
  // cleared by the shell so it cannot be replayed on remount.
  useEffect(() => {
    if (!intent) return;
    if (intent.lens) setLensId(intent.lens);
    if (intent.filterId) setFilterId(intent.filterId);
    if (intent.compare && intent.compare.length >= 2) {
      // A comparison handed over from chat: open it on the graph.
      setCompareMode(true);
      setCompareOpen(true);
      setSelectedId(null);
      setPageOpen(false);
      setRegion(null);
      onHighlightChange(intent.compare.slice(0, COMPARE_MAX));
    }
    setRegion(intent.region ?? null);
    setSelectedId(intent.selectedId ?? null);
    setPageOpen(Boolean(intent.selectedId));
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.nonce]);

  // Escape leaves focus mode.
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleFocus?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, onToggleFocus]);

  function selectLens(next: LensId): void {
    setLensId(next);
    setFilterId('all');
  }

  function selectPractice(practiceId: string | null): void {
    // In compare mode a node tap is a tick, never a practice page: the set
    // grows to as many practices as the reader wants, and any tap removes one
    // that is already in.
    if (compareMode) {
      if (!practiceId) return;
      if (highlighted.includes(practiceId)) {
        onHighlightChange(highlighted.filter((id) => id !== practiceId));
        return;
      }
      if (highlighted.length >= COMPARE_MAX) return;
      onHighlightChange([...highlighted, practiceId]);
      return;
    }
    setSelectedId(practiceId);
    setPageOpen(Boolean(practiceId));
  }

  /** Compare starts clean, and leaves clean; the pair is the selection. */
  function toggleCompareMode(): void {
    setCompareMode((on) => !on);
    setCompareOpen(false);
    setSelectedId(null);
    setPageOpen(false);
    onHighlightChange([]);
  }

  const matches = (practice: MapPractice) => filter.match(practice);
  /** The picked practices, named for the tray. */
  const compareNames = compareIds
    .map((id) => model.practices.find((practice) => practice.practiceId === id)?.name ?? id)
    .join(' · ');

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {compareOpen && compareView ? (
        /* The comparison page: the same shape as the practice page, opened
           over the graph, with the map waiting one press away. */
        <ComparePanel
          view={compareView}
          onRemove={(practiceId) => {
            const next = compareIds.filter((id) => id !== practiceId);
            onHighlightChange(next);
            if (next.length < 2) setCompareOpen(false);
          }}
          onClose={() => setCompareOpen(false)}
          onOpenBrain={onOpenBrain}
          onAsk={onAsk}
        />
      ) : pageOpen && selected ? (
        /* The practice page: the whole area, like a popup. No graph here; the
           map stays exactly as it was, one press away. */
        <PracticePanel
          key={selected.practiceId}
          practice={selected}
          month={model.month}
          onClose={() => setPageOpen(false)}
          onOpenBrain={onOpenBrain}
          onCompare={(practiceId) => {
            setPageOpen(false);
            setCompareOpen(false);
            setCompareMode(true);
            onHighlightChange([practiceId]);
          }}
        />
      ) : (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar: the map's single chrome row. Counts, highlight state and the
          list toggle live here too, so the canvas keeps every pixel the old
          header row was eating. */}
      <AnimatePresence initial={false}>
        {!focus ? (
          <motion.div key="toolbar" {...SLIDE} className="shrink-0 overflow-hidden border-b border-border">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
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

              <Select
                value={region ?? 'all'}
                onValueChange={(value) => {
                  setRegion(value === 'all' ? null : value);
                  onHighlightChange([]);
                }}
              >
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

              {/* Filter presets. Hidden when the only option is "all", so a
                  lens that has nothing to filter never shows a dead chip. */}
              {lens.filters.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {lens.filters.map((item) => (
                    <motion.button
                      key={item.id}
                      onClick={() => setFilterId(item.id)}
                      whileTap={{ scale: 0.96 }}
                      className={cn(
                        'relative rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                        filterId === item.id
                          ? 'border-[color:var(--accent-border)] text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {/* Same sliding highlight language as the rail. */}
                      {filterId === item.id ? (
                        <motion.span
                          layoutId="map-filter-pill"
                          className="absolute inset-0 rounded-full bg-[var(--accent-soft)]"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      ) : null}
                      <span className="relative">{item.label}</span>
                    </motion.button>
                  ))}
                </div>
              ) : null}

              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {matching.length} of {visible.length} matching
              </span>
              {highlighted.length > 0 && !compareMode ? (
                <Badge className="gap-1 bg-[var(--accent-600)] text-white">
                  {highlighted.length} highlighted
                  <button onClick={() => onHighlightChange([])} aria-label="Clear highlight">
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null}

              <div className="relative w-[190px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a practice"
                  className="h-8 pl-7 text-xs"
                  aria-label="Find a practice"
                />
              </div>

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
                <TooltipContent>{showList ? 'Back to the map' : 'List view'}</TooltipContent>
              </Tooltip>

              {/* Compare: node clicks build a set, then one press opens the page. */}
              <Button
                variant={compareMode ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={toggleCompareMode}
                aria-pressed={compareMode}
              >
                <GitCompare className="size-3.5" />
                Compare
              </Button>

              {/* Legend lives on the same band as the controls to give the graph more height. */}
              <div className="flex w-full flex-wrap items-center gap-3 pt-1">
                {lens.legend.map((entry) => (
                  <span key={entry.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: `oklch(var(${tokenVarFor(entry.colorKey)}))` }}
                    />
                    {entry.label}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  node size = monthly revenue
                </span>
                {/* While comparing, the graph explains its own rings. */}
                {compareRings.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CircleDashed className="size-3.5 text-muted-foreground" />
                    ring, clockwise from top: revenue · conversion · contact lens · training
                  </span>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Canvas or list */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {showList && !focus ? (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((practice) => (
                  <TableRow
                    key={practice.practiceId}
                    onClick={() => selectPractice(practice.practiceId)}
                    className={cn('cursor-pointer', highlightSet.has(practice.practiceId) && 'bg-[var(--accent-soft)]')}
                  >
                    <TableCell className="text-xs font-medium">{practice.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{practice.region}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.revenueDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.conversionDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.clAttainmentDisplay}</TableCell>
                    <TableCell className="text-xs tabular-nums">{practice.trainingCompletionDisplay}</TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      No practice matches this filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.995 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="h-full"
          >
            <MapCanvas
              model={{ ...model, practices: visible }}
              lens={lens}
              level={level}
              regionName={region}
              highlighted={highlighted}
              matches={matches}
              selectedId={selectedId}
              onSelect={selectPractice}
              links={compareLinks}
              rings={compareRings}
              veil={!compareMode || compareIds.length >= 2}
              emphasised={focus_top.map((practice) => practice.practiceId)}
              onDrillRegion={(next) => {
                setRegion(next);
                onHighlightChange([]);
              }}
              onReset={() => {
                setRegion(null);
                onHighlightChange([]);
              }}
              focus={focus}
              onToggleFocus={onToggleFocus}
            />
          </motion.div>
        )}

        {visible.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <div className="pointer-events-auto rounded-lg border border-border bg-card px-4 py-3 text-center text-xs text-muted-foreground [box-shadow:var(--shadow-floating)]">
              Nothing matches this filter.
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFilterId('all');
                    setQuery('');
                    onHighlightChange([]);
                  }}
                >
                  Reset filters
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}

        {/* In focus mode a compact lens switcher floats on the canvas. */}
        <AnimatePresence>
          {focus ? (
            <motion.div
              key="focus-controls"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1 [box-shadow:var(--shadow-floating)] backdrop-blur"
            >
              {lenses.map((item) => (
                <motion.button
                  key={item.id}
                  onClick={() => selectLens(item.id)}
                  whileTap={{ scale: 0.96 }}
                  className={cn(
                    'relative rounded-full px-2.5 py-1 text-[11px] transition-colors',
                    lensId === item.id ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {lensId === item.id ? (
                    <motion.span
                      layoutId="focus-lens-pill"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span className="relative">{item.label}</span>
                </motion.button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <button
                onClick={() => onToggleFocus?.()}
                className="rounded-full px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                title="Exit focus mode (Esc)"
              >
                Exit focus (Esc)
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* While comparing, the tray carries the pick: tap nodes to add or
            remove practices, then open the comparison over the graph. */}
        <AnimatePresence>
          {compareMode && !compareOpen ? (
            <motion.div
              key="compare-tray"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4"
            >
              <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-[color:var(--line)] bg-card/95 py-1 pl-3.5 pr-1 [box-shadow:var(--hi),var(--shadow-floating)] backdrop-blur">
                <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <GitCompare className="size-3.5 shrink-0 text-[var(--accent-600)]" />
                  {highlighted.length === 0 ? 'Tap practices to compare' : `${highlighted.length} selected`}
                </span>
                {compareNames ? (
                  <span className="hidden max-w-[340px] truncate text-[11px] text-foreground/80 md:block">
                    {compareNames}
                  </span>
                ) : null}
                {highlighted.length >= COMPARE_MAX ? (
                  <span className="hidden text-[10px] text-muted-foreground sm:block">
                    {COMPARE_MAX} is the most at once
                  </span>
                ) : null}
                {highlighted.length > 0 ? (
                  <button
                    onClick={() => onHighlightChange([])}
                    className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null}
                {/* Disabled is a quiet well, enabled is the app's primary ink:
                    the shadcn grey never touches this bar. */}
                <button
                  disabled={highlighted.length < 2}
                  onClick={() => setCompareOpen(true)}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[11px] font-medium transition-[background,color,filter] duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]',
                    highlighted.length < 2
                      ? 'surface-well bg-secondary text-muted-foreground/70'
                      : 'bg-primary text-primary-foreground hover:brightness-110',
                  )}
                >
                  Compare
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Focus strip: the original bottom row, always there. */}
      <AnimatePresence initial={false}>
        {!focus ? (
          <motion.div key="strip" {...SLIDE} className="shrink-0 overflow-hidden border-t border-border">
            <div className="px-4 py-3">
              {lensId === 'mentors' ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="label-caps">Mentor portfolios</span>
                    <span className="text-[10px] text-muted-foreground">
                      observed results for their practices, not proof of cause, not a ranking of people
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {portfolios.map((portfolio) => (
                      <button
                        key={portfolio.mentorId}
                        onClick={() => {
                          onHighlightChange(portfolio.practiceIds);
                          setFilterId(`mentor-${portfolio.mentorId}`);
                          setRegion(null);
                        }}
                        className={cn(
                          'min-w-[220px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                          filterId === `mentor-${portfolio.mentorId}` ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)]' : 'border-border hover:bg-accent',
                        )}
                      >
                        <p className="text-xs font-semibold">{portfolio.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {portfolio.practiceCount} practices
                          {portfolio.belowTargetCount > 0 ? ` · ${portfolio.belowTargetCount} below revenue target` : ''}
                          {portfolio.trainingGaps > 0 ? ` · ${portfolio.trainingGaps} with training gaps` : ''}
                        </p>
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          Revenue {portfolio.revenueDisplay} ({portfolio.revenueChangeDisplay})
                        </p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          Conversion {portfolio.conversionDisplay} ({portfolio.conversionChangeDisplay}) · {portfolio.practicesImproving}/{portfolio.practiceCount} grew
                        </p>
                      </button>
                    ))}
                    {portfolios.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No mentor assignments recorded.</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="label-caps">Where to focus</span>
                    <span className="text-[10px] text-muted-foreground">
                      top {focus_top.length} by revenue move, {lens.label.toLowerCase()} view
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {focus_top.map((practice) => (
                      <button
                        key={practice.practiceId}
                        onClick={() => {
                          // In compare mode a card is a tick, exactly like a node.
                          selectPractice(practice.practiceId);
                          if (!compareMode) onHighlightChange([practice.practiceId]);
                        }}
                        className={cn(
                          'min-w-[190px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                          highlightSet.has(practice.practiceId) ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)]' : 'border-border hover:bg-accent',
                        )}
                      >
                        <p className="text-xs font-semibold">{practice.name}</p>
                        <p className="text-[10px] text-muted-foreground">{practice.region}</p>
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          {practice.revenueDisplay} ({practice.revenueMoMDisplay})
                        </p>
                      </button>
                    ))}
                    {focus_top.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing to flag in this view.</p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </div>
      )}
    </div>
  );
}
