'use client';

import { Fragment, useEffect, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { forceVisibleIfStuck } from '@/lib/anim';
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  FileText,
  Map as MapIcon,
  MessageSquare,
  PanelLeft,
  Sparkles,
  TrendingDown,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { TodayPriorities, TodayPriority } from '@/data';
import type { MapModel } from '@/data/map-model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatView } from '@/components/chat/chat-view';
import { BrainView } from '@/components/brain/brain-view';
import { Logo } from '@/components/logo';
import { MapView, type MapIntent } from '@/components/map/map-view';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type View = 'today' | 'chat' | 'map' | 'brain' | 'automations' | 'people';

const PRIMARY_NAV: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: 'today', label: 'Today', icon: CalendarDays },
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'map', label: 'Map', icon: MapIcon },
  { key: 'brain', label: 'Brain', icon: FileText },
];

const SECONDARY_NAV: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: 'automations', label: 'Automations', icon: CheckSquare },
  { key: 'people', label: 'People & logs', icon: Users },
];

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Word wave: the Today headline and its support line arrive as one wave of ink,
 * each word rising out of a soft blur a beat after the one before it. Total
 * delays stay under the 800ms safety sweep. Reduced motion renders the text
 * plainly, and `data-anim` lets the freeze safety net rescue words if frames
 * stop mid arrival.
 */
function WaveText({
  text,
  className,
  delay = 0,
  step = 28,
}: {
  text: string;
  className?: string;
  delay?: number;
  step?: number;
}) {
  const reduceMotion = useReducedMotion();
  const words = text.split(' ');
  if (reduceMotion) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {words.map((word, index) => (
        <Fragment key={`${index}-${word}`}>
          {index > 0 ? ' ' : null}
          <span data-anim className="wave-word" style={{ animationDelay: `${delay + index * step}ms` }}>
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Rail entrance: the logo leads, then the org block, then each nav item and the
 * profile follow a beat later. Replays whenever the rail reopens.
 */
const railStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } },
};

const railItem: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.34, ease: EASE } },
};

function PriorityCard({
  item,
  onOpenPractice,
  onOpenRegion,
  onOpenDashboard,
}: {
  item: TodayPriority;
  onOpenPractice: (practiceId: string) => void;
  onOpenRegion: (region: string) => void;
  onOpenDashboard: (item: TodayPriority) => void;
}) {
  const openRelated = () => {
    if (item.practiceId) onOpenPractice(item.practiceId);
    else if (item.region) onOpenRegion(item.region);
  };

  return (
    <Card className="surface-card shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={item.kind === 'region' ? 'default' : 'secondary'}>
              {item.kind === 'region' ? 'Region' : 'Practice'}
            </Badge>
            <span className="text-xs text-muted-foreground">{item.region}</span>
          </div>
          <Badge variant="outline" className="capitalize">{item.issue.replace(/-/g, ' ')}</Badge>
        </div>

        <h3 className="mt-3 text-base font-semibold text-pretty">{item.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{item.summary}</p>

        <div className="surface-well mt-4 flex items-baseline gap-2 rounded-lg bg-secondary/60 px-3 py-2">
          <span className="label-caps">{item.metric.label}</span>
          <span className="text-lg font-semibold tabular-nums">{item.metric.value}</span>
          <span className="text-xs text-muted-foreground">{item.metric.comparison}</span>
        </div>

        <ul className="mt-3 space-y-1">
          {item.evidence.slice(0, 3).map((line, index) => (
            <li key={`${index}-${line.slice(0, 24)}`} className="flex gap-2 text-xs text-muted-foreground">
              <span className="mt-[6px] size-1 shrink-0 rounded-full bg-coral" />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={openRelated}>
            {item.practiceId ? 'Open practice' : 'Open region'} <ArrowRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={openRelated}>Show on map</Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenDashboard(item)}>Open dashboard</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlaceholderPage({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ title: string; note: string }>;
}) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <p className="label-caps">Visual placeholder</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title} className="shadow-panel">
            <CardContent className="p-4">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Agreed as a placeholder for this stage. The workflows behind it are not wired yet.
      </p>
    </div>
  );
}

export function Workspace({
  today,
  mapModel,
  practiceCount,
  regionCount,
  latestMonth,
}: {
  today: TodayPriorities;
  mapModel: MapModel;
  practiceCount: number;
  regionCount: number;
  latestMonth: string;
}) {
  const [view, setView] = useState<View>('today');
  const [railOpen, setRailOpen] = useState(true);
  const [mapFocus, setMapFocus] = useState(false);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [mapIntent, setMapIntent] = useState<MapIntent | null>(null);
  const [brainDocument, setBrainDocument] = useState<string | null>(null);

  function openPracticeOnMap(practiceId: string): void {
    setHighlighted([practiceId]);
    setView('map');
  }

  function openRegionOnMap(region: string): void {
    setHighlighted([]);
    setMapIntent({ region, nonce: Date.now() });
    setView('map');
  }

  function openDashboardFor(item: TodayPriority): void {
    const name = item.practiceId
      ? mapModel.practices.find((practice) => practice.practiceId === item.practiceId)?.name
      : undefined;
    setPendingQuestion(
      item.kind === 'region' || !name
        ? `Compare ${item.region} with the other regions this month.`
        : `Show me ${name} performance this month and what changed compared with last month.`,
    );
    setView('chat');
  }

  function askFromMap(question: string): void {
    setPendingQuestion(question);
    setView('chat');
  }

  function showOnMap(practiceIds: string[]): void {
    setHighlighted(practiceIds);
    setView('map');
  }

  /** Clicking a Brain source in chat opens that document. */
  function openBrainDocument(title: string): void {
    setBrainDocument(title);
    setView('brain');
  }

  // A shared map link opens the map once, parsed here so the map never reads
  // stale query parameters.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!['lens', 'region', 'filter', 'practice'].some((key) => params.has(key))) return;
    const lens = params.get('lens');
    const lensIds = ['region', 'sales', 'contactLens', 'training', 'mentors'];
    setMapIntent({
      lens: lens && lensIds.includes(lens) ? (lens as MapIntent['lens']) : undefined,
      region: params.get('region'),
      filterId: params.get('filter') ?? undefined,
      selectedId: params.get('practice'),
      nonce: Date.now(),
    });
    setView('map');
  }, []);

  // Focus mode hides the shell, so make sure the user can always leave it.
  useEffect(() => {
    if (!mapFocus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapFocus]);

  // If animation frames are frozen (background tab), make sure the section we
  // just switched to is not left invisible mid entrance.
  useEffect(() => {
    const timer = window.setTimeout(() => forceVisibleIfStuck(document.querySelector('main')), 800);
    return () => window.clearTimeout(timer);
  }, [view, mapFocus]);

  const navButton = (item: { key: View; label: string; icon: LucideIcon }) => {
    const Icon = item.icon;
    const active = view === item.key;
    return (
      <motion.button
        key={item.key}
        onClick={() => setView(item.key)}
        aria-current={active ? 'page' : undefined}
        variants={railItem}
        className={cn(
          'relative mb-0.5 flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs',
          active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        {/* One pill that slides between items instead of swapping backgrounds. */}
        {active ? (
          <motion.span
            layoutId="rail-active-pill"
            className="absolute inset-0 rounded-md bg-rail-active"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        ) : null}
        <Icon className="relative size-4 shrink-0" />
        <span className="relative">{item.label}</span>
      </motion.button>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Rail: the only navigation. Nothing decorative. */}
      <motion.aside
        initial={false}
        animate={{ width: railOpen && !mapFocus ? 220 : 0, opacity: railOpen && !mapFocus ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 32, mass: 0.9 }}
        className={cn(
          'flex shrink-0 flex-col overflow-hidden bg-rail',
          railOpen && !mapFocus ? 'border-r border-border' : 'border-r-0',
        )}
        aria-hidden={!railOpen || mapFocus}
      >
        <motion.div
          className="flex h-full flex-col px-3 py-5"
          variants={railStagger}
          initial="hidden"
          animate={railOpen && !mapFocus ? 'show' : 'hidden'}
        >
          <motion.div variants={railItem} className="mb-5 flex items-center gap-2 px-2 text-[19px] font-bold tracking-tight">
            <Logo className="size-6" /> Optific<span className="text-coral">+</span>
          </motion.div>

          <motion.div variants={railItem} className="mb-4 flex items-center gap-2 border-y border-border px-1.5 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">N</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold leading-tight">Northstar Group</p>
              <p className="truncate text-[10px] leading-tight text-muted-foreground">{latestMonth}</p>
            </div>
          </motion.div>

          <nav aria-label="Sections">{PRIMARY_NAV.map(navButton)}</nav>

          <motion.div variants={railItem} className="my-3 border-t border-border" />

          <nav aria-label="Workspace tools">{SECONDARY_NAV.map(navButton)}</nav>

          <motion.div variants={railItem} className="mt-auto flex items-center gap-2.5 border-t border-border px-1 pt-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rail-active text-[10px] font-semibold">SK</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight">Sara Kelly</p>
              <p className="truncate text-[10px] leading-tight text-muted-foreground">Group leadership</p>
            </div>
          </motion.div>
        </motion.div>
      </motion.aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar: no tabs here, navigation lives in the rail. */}
        <header
          className={cn(
            'shrink-0 overflow-hidden bg-background/80 transition-[height,opacity] duration-300 ease-out',
            mapFocus ? 'border-b-0' : 'border-b border-border',
          )}
          style={{ height: mapFocus ? 0 : 56, opacity: mapFocus ? 0 : 1 }}
          aria-hidden={mapFocus}
        >
          <div className="flex h-14 items-center gap-2 px-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRailOpen((open) => !open)}
              aria-label={railOpen ? 'Hide navigation' : 'Show navigation'}
              aria-expanded={railOpen}
            >
              <PanelLeft />
            </Button>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">Northstar Group</span>
              <span className="text-border">/</span>
              <span className="truncate">
                {[...PRIMARY_NAV, ...SECONDARY_NAV].find((item) => item.key === view)?.label ?? 'Workspace'}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <Badge variant="outline" className="text-[10px]">Prototype</Badge>
            </div>
          </div>
        </header>

        <div className="min-h-0 min-w-0 flex-1">
          {/* Enter-only transition on section change: no exit delay, so switching
              views stays instant while the new content eases in. */}
          <motion.div
            key={view}
            data-anim
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="h-full"
          >
          {view === 'today' ? (
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-4xl px-8 py-8">
                <p className="label-caps">Today</p>
                <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight">
                  <WaveText text="What should I focus on today?" />
                </h1>
                <p className="mt-1 max-w-[62ch] text-pretty text-sm text-muted-foreground">
                  <WaveText
                    text={`${today.items.length} priorities for ${today.monthLabel}, across ${practiceCount} practices and ${regionCount} regions. Every figure comes from the data layer.`}
                    delay={160}
                    step={11}
                  />
                </p>
                <div className="mt-6 grid grid-cols-1 gap-4">
                  {today.items.map((item, index) => (
                    <motion.div
                      key={item.id}
                      data-anim
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.46, delay: 0.05 * index, ease: EASE }}
                    >
                      <PriorityCard
                        item={item}
                        onOpenPractice={openPracticeOnMap}
                        onOpenRegion={openRegionOnMap}
                        onOpenDashboard={openDashboardFor}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          ) : null}

          {view === 'chat' ? (
            <ChatView
              onShowMap={showOnMap}
              onOpenBrain={openBrainDocument}
              pendingQuestion={pendingQuestion}
              onPendingHandled={() => setPendingQuestion(null)}
            />
          ) : null}

          {view === 'map' ? (
            <MapView
              model={mapModel}
              highlighted={highlighted}
              onHighlightChange={setHighlighted}
              onAsk={askFromMap}
              intent={mapIntent}
              onIntentHandled={() => setMapIntent(null)}
              focus={mapFocus}
              onToggleFocus={() => setMapFocus((value) => !value)}
            />
          ) : null}

          {view === 'brain' ? (
            <BrainView openDocumentTitle={brainDocument} onOpened={() => setBrainDocument(null)} />
          ) : null}

          {view === 'automations' ? (
            <PlaceholderPage
              title="Automations"
              description="Recurring checks that prepare work for a human to review. Weekly practice reviews and a daily claims follow up are the two workflows the group asked for."
              items={[
                { title: 'Weekly practice reviews', note: 'Mondays at 8am. Practices with revenue down more than 6 percent get a review draft for their mentor.' },
                { title: 'Daily claims follow up', note: 'Every morning. Claims older than 30 days get a follow up draft for Finance Support.' },
                { title: 'Nothing is sent automatically', note: 'Outputs land in a review inbox. A person approves them.' },
              ]}
            />
          ) : null}

          {view === 'people' ? (
            <PlaceholderPage
              title="People and logs"
              description="Adoption and answer quality. Which teams are using the workspace, which questions they are asking, and which answers need a second look."
              items={[
                { title: 'Adoption this week', note: '164 of 182 invited sample users active, 90 percent.' },
                { title: 'Questions asked', note: 'Every question is logged with the sources used to answer it.' },
                { title: 'Answers flagged for review', note: 'Flags mark answers that need a human check. They are not proof of an error.' },
              ]}
            />
          ) : null}
          </motion.div>
        </div>

        {/* Status bar */}
        <div
          className={cn(
            'shrink-0 overflow-hidden transition-[height,opacity] duration-300 ease-out',
            mapFocus ? 'border-t-0' : 'border-t border-border',
          )}
          style={{ height: mapFocus ? 0 : 36, opacity: mapFocus ? 0 : 1 }}
          aria-hidden={mapFocus}
        >
          <div className="flex h-9 items-center gap-4 px-6 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><TrendingDown className="size-3.5 text-coral" /> {practiceCount} practices connected</span>
            <span>Live AI · Fictional data · {latestMonth}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
