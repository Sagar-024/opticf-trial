'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  FileText,
  LayoutGrid,
  Map as MapIcon,
  MessageSquare,
  PanelLeft,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react';
import type { TodayPriorities, TodayPriority } from '@/data';
import type { MapModel } from '@/data/map-model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ChatView } from '@/components/chat/chat-view';
import { MapView, type MapIntent } from '@/components/map/map-view';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV = [
  { key: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { key: 'automations', label: 'Automations', icon: CheckSquare },
  { key: 'people', label: 'People & logs', icon: Users },
  { key: 'brain', label: 'Brain', icon: FileText },
];

function bandVariant(band: string): 'destructive' | 'secondary' | 'outline' {
  if (band === 'high') return 'destructive';
  if (band === 'medium') return 'secondary';
  return 'outline';
}

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
    <Card className="overflow-hidden">
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

        <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>

        <div className="mt-4 flex items-baseline gap-2 rounded-lg bg-secondary/60 px-3 py-2">
          <span className="label-caps">{item.metric.label}</span>
          <span className="text-lg font-semibold">{item.metric.value}</span>
          <span className="text-xs text-muted-foreground">{item.metric.comparison}</span>
        </div>

        <ul className="mt-3 space-y-1">
          {item.evidence.slice(0, 3).map((line, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground">
              <span className="mt-[6px] size-1 shrink-0 rounded-full bg-coral" />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={openRelated}>
            {item.practiceId ? 'Open practice' : 'Open region'} <ArrowRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={openRelated}>
            Show on map
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenDashboard(item)}>
            Open dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Placeholder({ title, note, tone = 'map' }: { title: string; note: string; tone?: 'map' | 'plain' }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className={cn('p-8', tone === 'map' && 'bg-map-bg text-map-fg')}>
        <p className={cn('text-[10px] uppercase tracking-[1.3px]', tone === 'map' ? 'text-map-muted' : 'text-muted-foreground')}>
          {title}
        </p>
        <p className="mt-2 text-sm">{note}</p>
      </CardContent>
    </Card>
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
  const [dest, setDest] = useState<'workspace' | 'automations' | 'people' | 'brain'>('workspace');
  const [tab, setTab] = useState('today');
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [railOpen, setRailOpen] = useState(true);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [mapIntent, setMapIntent] = useState<MapIntent | null>(null);

  function openPracticeOnMap(practiceId: string): void {
    setHighlighted([practiceId]);
    setDest('workspace');
    setTab('map');
  }

  function openRegionOnMap(region: string): void {
    setHighlighted([]);
    setMapIntent({ region, nonce: Date.now() });
    setDest('workspace');
    setTab('map');
  }

  /** A Today priority can be explored as a dashboard, using the chat. */
  function openDashboardFor(item: TodayPriority): void {
    const name = item.practiceId
      ? mapModel.practices.find((practice) => practice.practiceId === item.practiceId)?.name
      : undefined;
    const question = item.kind === 'region' || !name
      ? `Compare ${item.region} with the other regions this month.`
      : `Show me ${name} performance this month and what changed compared with last month.`;
    setPendingQuestion(question);
    setDest('workspace');
    setTab('chat');
  }

  function askFromMap(question: string): void {
    setPendingQuestion(question);
    setDest('workspace');
    setTab('chat');
  }

  // A shared map link (lens, region, filter or practice in the URL) opens the map
  // once, parsed here so the map itself never reads stale query parameters.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = ['lens', 'region', 'filter', 'practice'];
    if (!keys.some((key) => params.has(key))) return;

    const lens = params.get('lens');
    const lensIds = ['region', 'sales', 'contactLens', 'training', 'mentors'];
    setMapIntent({
      lens: lens && lensIds.includes(lens) ? (lens as MapIntent['lens']) : undefined,
      region: params.get('region'),
      filterId: params.get('filter') ?? undefined,
      selectedId: params.get('practice'),
      nonce: Date.now(),
    });
    setDest('workspace');
    setTab('map');
  }, []);

  function showOnMap(practiceIds: string[]): void {
    setHighlighted(practiceIds);
    setDest('workspace');
    setTab('map');
  }

  // Keep the rail in sync with the top-bar tabs: Map/Chat/Today all belong to
  // Workspace, and only the Brain tab highlights Brain in the rail.
  function gotoDest(key: 'workspace' | 'automations' | 'people' | 'brain'): void {
    setDest(key);
    setTab(key === 'brain' ? 'brain' : 'today');
  }

  function gotoTopTab(next: string): void {
    setTab(next);
    setDest(next === 'brain' ? 'brain' : 'workspace');
  }

  return (
    <div
      className="grid h-dvh overflow-hidden transition-[grid-template-columns] duration-200 ease-out"
      style={{ gridTemplateColumns: railOpen ? '220px minmax(0,1fr)' : '0px minmax(0,1fr)' }}
    >
      {/* Rail (closable) */}
      <aside
        className={cn(
          'flex flex-col overflow-hidden border-r border-border bg-rail px-4 py-6 transition-opacity duration-200',
          railOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!railOpen}
      >
        <div className="mb-7 flex items-center gap-2 px-2 text-[22px] font-bold tracking-tight">
          <Sparkles className="size-5 text-coral" /> Optific<span className="text-coral">+</span>
        </div>

        <div className="mb-6 flex items-center gap-2 border-y border-border px-1 py-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">N</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">Northstar Group</p>
            <p className="truncate text-[10px] text-muted-foreground">Leadership workspace</p>
          </div>
        </div>

        <p className="label-caps mb-2 px-2">Your organisation</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = dest === item.key;
          return (
            <button
              key={item.key}
              onClick={() => gotoDest(item.key as typeof dest)}
              className={cn(
                'mb-1 flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-xs transition-colors',
                active ? 'bg-rail-active font-semibold text-foreground' : 'text-muted-foreground hover:bg-rail-active/60',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}

        <p className="label-caps mb-2 mt-8 px-2">Recent explorations</p>
        {['Chorlton performance', 'Practices to focus on', 'Contact lens shortfall'].map((label) => (
          <button key={label} className="flex min-h-8 items-center gap-2 truncate rounded-md px-2.5 text-left text-[11px] text-muted-foreground hover:bg-rail-active/60">
            <MessageSquare className="size-3.5 shrink-0" /> {label}
          </button>
        ))}

        <div className="mt-auto flex items-center gap-2.5 border-t border-border px-1 pt-4">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rail-active text-[10px] font-semibold">SK</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold leading-tight">Sara Kelly</p>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">Group leadership</p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRailOpen((open) => !open)}
              aria-label={railOpen ? 'Close sidebar' : 'Open sidebar'}
              aria-expanded={railOpen}
              title={railOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              <PanelLeft />
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Northstar Group</span>
              <span>/</span>
              <span>{latestMonth}</span>
            </div>
          </div>
          <Tabs value={tab} onValueChange={gotoTopTab}>
            <TabsList>
              <TabsTrigger value="chat"><MessageSquare className="mr-1 size-3.5" />Chat</TabsTrigger>
              <TabsTrigger value="map"><MapIcon className="mr-1 size-3.5" />Map</TabsTrigger>
              <TabsTrigger value="today"><CalendarDays className="mr-1 size-3.5" />Today</TabsTrigger>
              <TabsTrigger value="brain"><FileText className="mr-1 size-3.5" />Brain</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Badge variant="outline" className="text-[10px]">Prototype</Badge>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <Tabs value={tab} onValueChange={gotoTopTab} className="h-full">
            <TabsContent value="today" className="m-0 h-full">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-4xl px-8 py-8">
                  <p className="label-caps">Today</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">What should I focus on today?</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {today.items.length} priorities for {today.monthLabel}, across {practiceCount} practices and {regionCount} regions -
                    every figure comes from the data layer.
                  </p>
                  <div className="mt-6 grid grid-cols-1 gap-4">
                    {today.items.map((item) => (
                      <PriorityCard
                    key={item.id}
                    item={item}
                    onOpenPractice={openPracticeOnMap}
                    onOpenRegion={openRegionOnMap}
                    onOpenDashboard={openDashboardFor}
                  />
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="map" className="m-0 h-full">
              <MapView
                model={mapModel}
                highlighted={highlighted}
                onHighlightChange={setHighlighted}
                onAsk={askFromMap}
                intent={mapIntent}
                onIntentHandled={() => setMapIntent(null)}
              />
            </TabsContent>

            <TabsContent value="chat" className="m-0 h-full">
              <ChatView
                onShowMap={showOnMap}
                pendingQuestion={pendingQuestion}
                onPendingHandled={() => setPendingQuestion(null)}
              />
            </TabsContent>

            <TabsContent value="brain" className="m-0 h-full">
              <div className="h-full p-6">
                <Placeholder title="Northstar Brain" note="Knowledge sections and edit-guidance / source dialogs (shadcn Dialog)." tone="plain" />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* status bar */}
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-6 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><TrendingDown className="size-3.5 text-coral" /> {practiceCount} practices connected</span>
          <span>Live AI · Fictional data · {latestMonth}</span>
        </div>
      </main>
    </div>
  );
}
