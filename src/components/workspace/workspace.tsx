'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { forceVisibleIfStuck } from '@/lib/anim';
import {
  deleteSession,
  groupSessions,
  listSessions,
  migrateLegacy,
  renameSession,
  setSessionPinned,
  subscribeToChats,
  upsertSession,
  type ChatSession,
} from '@/lib/chat-store';
import { WaveText } from '@/components/wave-text';
import {
  ArrowLeft,
  Bell,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  SquarePen,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { TodayPriorities, TodayPriority } from '@/data';
import type { MapModel } from '@/data/map-model';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChatView } from '@/components/chat/chat-view';
import { BrainView } from '@/components/brain/brain-view';
import { HomeDialog } from '@/components/home/home-dialog';
import { AutomationsView } from '@/components/automations/automations-view';
import { TasksView } from '@/components/tasks/tasks-view';
import { RailLeaves } from '@/components/workspace/rail-leaves';
import { ViewSwitcher } from '@/components/workspace/view-switcher';
import { Logo } from '@/components/logo';
import { MapView, type MapIntent } from '@/components/map/map-view';
import { ThemeToggle } from '@/components/theme-toggle';
import { listTasks, subscribeToTasks } from '@/lib/task-store';
import { cn } from '@/lib/utils';

type View = 'chat' | 'map' | 'brain' | 'automations' | 'tasks' | 'people';

/**
 * The rail: Chat, Brain, Automations and Tasks are the product; People and logs
 * sits below the divider as an admin tool. Map is not a tab: it opens from
 * Chat, which is the only place it belongs.
 */
const PRIMARY_NAV: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'brain', label: 'Brain', icon: FileText },
  { key: 'automations', label: 'Automations', icon: CheckSquare },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
];

const SECONDARY_NAV: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: 'people', label: 'People & logs', icon: Users },
];

/** Top bar titles, including the views that are not rail tabs (Map). */
const VIEW_LABELS: Record<View, string> = {
  chat: 'Chat',
  map: 'Map',
  brain: 'Brain',
  automations: 'Automations',
  tasks: 'Tasks',
  people: 'People & logs',
};

/** Home auto-opens at most once per browser session; any close sets this. */
const HOME_SESSION_KEY = 'optific.home.dismissed';
/** Whether the conversation list under Chat is folded, per browser. */
const CHAT_FOLD_KEY = 'optific.rail.chat-fold';

const EASE = [0.22, 1, 0.36, 1] as const;

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
    <div className="mx-auto max-w-5xl px-8 pb-10 pt-7">
      <h1 className="text-balance text-2xl font-semibold tracking-tight">
        <WaveText text={title} />
      </h1>
      <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title}>
            <CardContent className="p-4">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Preview only. The workflows behind it are not wired yet.
      </p>
    </div>
  );
}

export function Workspace({
  today,
  mapModel,
  practiceCount,
  reportingCount,
  regionCount,
  latestMonth,
}: {
  today: TodayPriorities;
  mapModel: MapModel;
  practiceCount: number;
  reportingCount: number;
  regionCount: number;
  latestMonth: string;
}) {
  const [view, setView] = useState<View>('chat');
  const [railOpen, setRailOpen] = useState(true);
  /** Hovering the collapsed icon rail expands it over the content. */
  const [railHovered, setRailHovered] = useState(false);
  /** Set right after a manual collapse: hover expansion stays off until the
   * pointer leaves the rail, so the click collapses it even while hovered. */
  const [railHoverSuppressed, setRailHoverSuppressed] = useState(false);
  const [mapFocus, setMapFocus] = useState(false);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [mapIntent, setMapIntent] = useState<MapIntent | null>(null);
  const [brainDocument, setBrainDocument] = useState<string | null>(null);
  /** A practice whose context is being written: the Brain opens on the create dialog. */
  const [brainComposeFor, setBrainComposeFor] = useState<string | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  /** Open tasks, for the rail count. */
  const [openTasks, setOpenTasks] = useState(0);
  /** The chat being renamed inline, if any. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** The top bar title input, while the open conversation is being renamed. */
  const [topRenaming, setTopRenaming] = useState(false);
  /** The last deleted chat, held for the undo line under the rail. */
  const [undoDelete, setUndoDelete] = useState<ChatSession | null>(null);
  /** Whether the conversation list under Chat is folded away. */
  const [chatFolded, setChatFolded] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  function openPracticeOnMap(practiceId: string): void {
    setHighlighted([practiceId]);
    setView('map');
  }

  /** Deep-opens the practice sheet on the map; used by Home, Automations and
      the task source chips. A jump from a task remembers the map as it was,
      and Back returns to the board. */
  function openPracticeDetails(practiceId: string, from?: 'tasks'): void {
    if (from !== 'tasks') setHighlighted([]);
    setMapIntent({ selectedId: practiceId, nonce: Date.now(), ...(from ? { from } : {}) });
    setView('map');
  }

  function openRegionOnMap(region: string): void {
    setHighlighted([]);
    setMapIntent({ region, nonce: Date.now() });
    setView('map');
  }

  function showPriorityOnMap(item: TodayPriority): void {
    if (item.practiceId) openPracticeOnMap(item.practiceId);
    else if (item.region) openRegionOnMap(item.region);
  }

  function showOnMap(practiceIds: string[]): void {
    setHighlighted(practiceIds);
    setView('map');
  }

  /** A chat comparison hands its practices to the map's compare picker. */
  function openCompareOnMap(practiceIds: string[]): void {
    setHighlighted([]);
    setMapIntent({ compare: practiceIds.slice(0, 8), nonce: Date.now() });
    setView('map');
  }

  /**
   * The map's comparison hands its practices to the assistant: the chat opens
   * with the question already asked, so the written explanation arrives with
   * the same card and its prose behind Explain.
   */
  function askAboutPractices(practiceIds: string[]): void {
    const names = practiceIds.map(
      (id) => mapModel.practices.find((practice) => practice.practiceId === id)?.name ?? id,
    );
    setPendingQuestion(`Compare ${names.join(', ')} and explain what stands out.`);
    setView('chat');
  }

  /** Clicking a Brain source in chat opens that document. */
  function openBrainDocument(title: string): void {
    setBrainComposeFor(null);
    setBrainDocument(title);
    setView('brain');
  }

  /** A practice with no context yet: the Brain opens ready to write one. */
  function addContextFor(practiceId: string): void {
    setBrainDocument(null);
    setBrainComposeFor(practiceId);
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

  // Query parameters only mean something while the map is open. Leaving it
  // drops them, so a chat or brain URL never carries a stale shared-map link.
  useEffect(() => {
    if (view === 'map') return;
    if (!window.location.search) return;
    window.history.replaceState(null, '', window.location.pathname);
  }, [view]);

  // Home pops up at most once per browser session. Any close writes the marker;
  // the bell in the top bar is the manual way back in.
  useEffect(() => {
    if (window.sessionStorage.getItem(HOME_SESSION_KEY) === '1') return;
    setHomeOpen(true);
  }, []);

  function handleHomeOpenChange(next: boolean): void {
    setHomeOpen(next);
    if (!next) window.sessionStorage.setItem(HOME_SESSION_KEY, '1');
  }

  function homeOpenPractice(practiceId: string): void {
    openPracticeDetails(practiceId);
    handleHomeOpenChange(false);
  }

  function homeShowOnMap(item: TodayPriority): void {
    showPriorityOnMap(item);
    handleHomeOpenChange(false);
  }

  /** Home hands a question to the chat, so a priority becomes a follow-up. */
  function homeAskAbout(question: string): void {
    setPendingQuestion(question);
    setView('chat');
    handleHomeOpenChange(false);
  }

  /** Automations hands a question to the chat the same way Home's Ask does. */
  function askFromAutomations(question: string): void {
    setPendingQuestion(question);
    setView('chat');
  }

  // Chat history lives in this browser for now. When the backend arrives, this
  // list comes from the server and nothing else on the rail changes.
  useEffect(() => {
    migrateLegacy();
    const refresh = () => setChatSessions(listSessions());
    refresh();
    return subscribeToChats(refresh);
  }, []);

  // The Tasks rail item carries the open count; the store is the one source.
  useEffect(() => {
    const refresh = () => setOpenTasks(listTasks().filter((task) => task.status === 'open').length);
    refresh();
    return subscribeToTasks(refresh);
  }, []);

  function startNewChat(): void {
    setChatSessionId(null);
    setView('chat');
  }

  function selectChat(id: string): void {
    setChatSessionId(id);
    setView('chat');
  }

  function renameChat(id: string, title: string): void {
    renameSession(id, title);
    setRenamingId(null);
  }

  /** Deleting keeps the thread in memory for a few seconds of undo. */
  function deleteChat(session: ChatSession): void {
    deleteSession(session.id);
    if (chatSessionId === session.id) setChatSessionId(null);
    setUndoDelete(session);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoDelete(null), 7000);
  }

  function undoDeleteChat(): void {
    if (!undoDelete) return;
    upsertSession(undoDelete);
    setUndoDelete(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }

  function togglePin(session: ChatSession): void {
    setSessionPinned(session.id, !session.pinned);
  }

  /** Fold or unfold the conversation list under Chat. */
  function toggleChatFold(): void {
    setChatFolded((folded) => {
      const next = !folded;
      try {
        window.localStorage.setItem(CHAT_FOLD_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable; the choice lasts this session only.
      }
      return next;
    });
  }

  // The undo line is on a timer; drop it when the workspace unmounts.
  useEffect(
    () => () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  // The Chat section fold is remembered per browser.
  useEffect(() => {
    try {
      setChatFolded(window.localStorage.getItem(CHAT_FOLD_KEY) === '1');
    } catch {
      // Storage unavailable; the list simply starts open.
    }
  }, []);

  // Leaving chat folds the conversation list, so Map, Brain and the rest of
  // the rail always arrive clean; tapping Chat brings the list back.
  useEffect(() => {
    if (view === 'chat' || chatFolded) return;
    setChatFolded(true);
    try {
      window.localStorage.setItem(CHAT_FOLD_KEY, '1');
    } catch {
      // Storage unavailable; the choice lasts this session only.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
    // The section you are on carries the pill. Chat renders its own row below
    // so its conversations can nest inside it.
    const active = view === item.key;
    return (
      <motion.button
        key={item.key}
        onClick={() => setView(item.key)}
        aria-current={active ? 'page' : undefined}
        variants={railItem}
        className={cn(
          'relative mb-0.5 flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs',
          !railExpanded && 'justify-center',
          active ? 'font-semibold text-[var(--accent-text)]' : 'text-muted-foreground hover:text-foreground',
        )}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        {/* One pill that slides between items: a soft tint with a 1px edge,
            never a heavy fill. */}
        {active ? (
          <motion.span
            layoutId="rail-active-pill"
            className="absolute inset-0 rounded-md border border-[color:var(--accent-line)] bg-[var(--accent-soft)]"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        ) : null}
        <Icon className={cn('relative size-4 shrink-0', active && 'text-[var(--accent-text)]')} />
        {railExpanded ? (
          <>
            <span className="relative">{item.label}</span>
            {/* Tasks carries its open count, so assigned work pulls the eye. */}
            {item.key === 'tasks' && openTasks > 0 ? (
              <span className="relative rounded-full bg-[var(--accent-soft)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--accent-text)]">
                {openTasks}
              </span>
            ) : null}
            {/* Only the section you are on carries the chevron; the others stay quiet. */}
            <ChevronRight
              className={cn(
                'relative ml-auto size-3.5 shrink-0 transition-[opacity,transform] duration-200 ease-out',
                active && !homeOpen ? 'translate-x-0 text-[var(--accent-text)] opacity-100' : '-translate-x-1 text-muted-foreground/60 opacity-0',
              )}
            />
          </>
        ) : null}
      </motion.button>
    );
  };

  const sessionButton = (session: ChatSession) => {
    const active = view === 'chat' && chatSessionId === session.id;

    // Inline rename: the row becomes a small input. Enter saves, Esc cancels,
    // leaving the field cancels too.
    if (renamingId === session.id) {
      return (
        <div key={session.id} className="flex w-full items-center">
          <input
            autoFocus
            defaultValue={session.title}
            onKeyDown={(event) => {
              if (event.key === 'Enter') renameChat(session.id, event.currentTarget.value);
              if (event.key === 'Escape') setRenamingId(null);
            }}
            onBlur={() => setRenamingId(null)}
            aria-label="Rename chat"
            className="min-h-8 w-full rounded-md border border-[color:var(--accent-border)] bg-card px-2.5 py-0 text-xs outline-none"
          />
        </div>
      );
    }

    // Deliberately not a motion variant: a conversation row must appear the
    // instant the chat is created, not wait on the rail's entrance animation.
    return (
      <div key={session.id} className="group relative flex w-full items-center">
        <motion.button
          onClick={() => selectChat(session.id)}
          aria-current={active ? 'true' : undefined}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={cn(
            'relative flex min-h-8 w-full items-center gap-2 rounded-md py-0 pl-2.5 pr-9 text-left text-xs',
            active ? 'font-semibold text-[var(--accent-text)]' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {active ? (
            <motion.span
              layoutId="rail-active-pill"
              className="absolute inset-0 rounded-md border border-[color:var(--accent-line)] bg-[var(--accent-soft)]"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          ) : null}
          <span className="relative min-w-0 flex-1 truncate">{session.title}</span>
          <ChevronRight
            className={cn(
              'relative size-3 shrink-0 transition-[opacity,transform] duration-200 ease-out',
              active
                ? 'translate-x-0 text-[var(--accent-text)] opacity-100 group-hover:opacity-0'
                : '-translate-x-1 text-muted-foreground/60 opacity-0',
            )}
          />
        </motion.button>

        {/* Pin, rename, delete. Appears on hover or keyboard focus so the list
            stays quiet at rest. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(event) => event.stopPropagation()}
              aria-label={`Options for ${session.title}`}
              className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground opacity-0 transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={2}>
            <DropdownMenuItem onSelect={() => togglePin(session)}>
              {session.pinned ? <PinOff /> : <Pin />}
              {session.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenamingId(session.id)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => deleteChat(session)}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const recentGroups = groupSessions(chatSessions);
  /** The open conversation, for the top bar title and its menu. */
  const activeChat = chatSessionId ? chatSessions.find((session) => session.id === chatSessionId) ?? null : null;
  // Chat is one section: `open` lights its icon while you are anywhere in
  // chat, `exact` marks the Chat row itself as "you are here" only when no
  // conversation is open. An open conversation takes the pill instead, so the
  // section light and the exact position never compete.
  const chatOpen = view === 'chat';
  const chatExact = view === 'chat' && !chatSessionId;
  // Folded, the conversation row is hidden, so the Chat row itself carries the
  // pill while you are in chat; unfolded, the exact-position rule above holds.
  const chatRowMarked = chatExact || (chatFolded && chatOpen);
  // The rail: pinned open at 220, hovering a collapsed rail expands it to 220
  // as an overlay, and at rest it is a 60px icon rail. The spacer next to the
  // content only ever follows the pinned width, so nothing reflows on hover.
  const railExpanded = !mapFocus && (railOpen || (railHovered && !railHoverSuppressed));
  const railWidth = mapFocus ? 0 : railOpen || (railHovered && !railHoverSuppressed) ? 220 : 60;
  const railSpacerWidth = mapFocus ? 0 : railOpen ? 220 : 60;
  const railSpring = { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 } as const;

  return (
    <div className="print-root relative flex h-dvh overflow-hidden">
      {/* The spacer keeps the content clear of the icon rail; the rail itself
          overlays when it expands on hover, so nothing ever reflows. */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ width: railSpacerWidth }}
        transition={railSpring}
        className="shrink-0"
      />
      {/* Rail: the only navigation. Nothing decorative. */}
      <motion.aside
        initial={false}
        animate={{ width: railWidth, opacity: mapFocus ? 0 : 1 }}
        transition={railSpring}
        onMouseEnter={() => setRailHovered(true)}
        onMouseLeave={() => {
          setRailHovered(false);
          setRailHoverSuppressed(false);
        }}
        className={cn(
          'absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-[var(--surface-2)]',
          mapFocus ? 'border-r-0' : 'border-r border-border',
          !mapFocus && !railOpen && railHovered && !railHoverSuppressed
            ? '[box-shadow:var(--shadow-floating),var(--rail-depth)]'
            : '[box-shadow:var(--rail-depth)]',
        )}
        aria-hidden={mapFocus}
      >
        {railExpanded ? <RailLeaves className="pointer-events-none absolute inset-0" /> : null}
        <motion.div
          className="relative flex h-full flex-col px-3 py-5"
          variants={railStagger}
          initial="hidden"
          animate={mapFocus ? 'hidden' : 'show'}
        >
          <motion.div variants={railItem} className="mb-3 flex h-9 items-center gap-2 px-2 text-[19px] font-bold tracking-tight">
            <Logo className="size-6 shrink-0" />
            {railExpanded ? (
              <>
                Optific<span className="text-[var(--accent-600)]">+</span>
                {/* Pins the rail open, or drops it back to the icon rest state. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (railOpen) {
                      setRailOpen(false);
                      setRailHoverSuppressed(true);
                    } else {
                      setRailOpen(true);
                    }
                  }}
                  aria-label={railOpen ? 'Collapse to icons' : 'Keep navigation open'}
                  aria-expanded={railOpen}
                >
                  {railOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Button>
              </>
            ) : null}
          </motion.div>

          {/* Org switcher as a quiet row, same rhythm as the nav below it. */}
          <motion.div
            variants={railItem}
            className={cn(
              'mb-3 flex h-10 items-center gap-2.5 rounded-lg px-2',
              !railExpanded && 'justify-center',
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[12px] font-bold text-primary-foreground ring-1 ring-[color:var(--line-strong)]">N</span>
            {railExpanded ? (
              <>
                {/* One line, like the nav rows; the month lives in the status
                    bar and the Home popup, so it is not repeated here. */}
                <p className="min-w-0 truncate text-[13px] font-semibold">Northstar Group</p>
              </>
            ) : null}
          </motion.div>

          <nav aria-label="Sections">
            {/* Chat is a section: its conversations live inside it, so there is
                only ever one place to look for "where am I". The row keeps the
                section light (orange icon and name) while you are in chat. */}
            <motion.div variants={railItem} className="group relative mb-0.5">
              <motion.button
                onClick={() => {
                  setView('chat');
                  toggleChatFold();
                }}
                aria-current={chatRowMarked ? 'page' : undefined}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className={cn(
                  'relative flex min-h-9 w-full items-center gap-2.5 rounded-md py-0 pl-2.5 text-left text-xs',
                  railExpanded ? 'pr-8' : 'pr-2.5 justify-center',
                  chatOpen
                    ? cn('text-[var(--accent-text)]', chatRowMarked && 'font-semibold')
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {chatRowMarked ? (
                  <motion.span
                    layoutId="rail-active-pill"
                    className="absolute inset-0 rounded-md border border-[color:var(--accent-line)] bg-[var(--accent-soft)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <MessageSquare className={cn('relative size-4 shrink-0', chatOpen && 'text-[var(--accent-text)]')} />
                {railExpanded ? <span className="relative">Chat</span> : null}
              </motion.button>
              {/* The fold is a click, never a hover, so nothing opens under the
                  pointer on the way to Map or Brain. It stays out of sight
                  unless you are in chat or reaching for this row, so it can
                  never read as a second active marker. */}
              {railExpanded ? (
                <button
                  onClick={toggleChatFold}
                  aria-expanded={!chatFolded}
                  aria-label={chatFolded ? 'Show chats' : 'Hide chats'}
                  className={cn(
                    'absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground/70 transition-[opacity,color] hover:text-foreground focus-visible:opacity-100',
                    chatOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <ChevronDown className={cn('size-3.5 transition-transform duration-200', chatFolded && '-rotate-90')} />
                </button>
              ) : null}
            </motion.div>

            {/* The conversations, nested under Chat: New chat first, then the
                day groups. The list caps with the window and scrolls on its
                own, so a long history never pushes the rail around. */}
            <motion.div variants={railItem} className={cn('mb-0.5', !railExpanded && 'hidden')}>
              <AnimatePresence initial={false}>
                {!chatFolded ? (
                  <motion.div
                    key="chat-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-[min(20rem,calc(100dvh-520px))] space-y-0.5 overflow-y-auto pb-1 pl-3 pr-0.5">
                      <button
                        onClick={startNewChat}
                        className="relative flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <SquarePen className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">New chat</span>
                      </button>
                      {recentGroups.pinned.length > 0 ? (
                        <p className="label-caps pb-1 pl-2.5 pt-2">Pinned</p>
                      ) : null}
                      {recentGroups.pinned.map(sessionButton)}
                      {recentGroups.today.length > 0 ? (
                        <p className="label-caps pb-1 pl-2.5 pt-2">Today</p>
                      ) : null}
                      {recentGroups.today.map(sessionButton)}
                      {recentGroups.yesterday.length > 0 ? (
                        <p className="label-caps pb-1 pl-2.5 pt-3">Yesterday</p>
                      ) : null}
                      {recentGroups.yesterday.map(sessionButton)}
                      {recentGroups.earlier.length > 0 ? (
                        <p className="label-caps pb-1 pl-2.5 pt-3">Earlier</p>
                      ) : null}
                      {recentGroups.earlier.map(sessionButton)}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>

            {PRIMARY_NAV.filter((item) => item.key !== 'chat').map(navButton)}
          </nav>

          <motion.div variants={railItem} className="my-3 border-t border-border" />

          <nav aria-label="Workspace tools">{SECONDARY_NAV.map(navButton)}</nav>

          {/* Profile as a quiet row, matching the org row above: identity
              only, no menus behind it yet, so it does not pretend to be one. */}
          <motion.div
            variants={railItem}
            className={cn(
              'mt-auto flex h-10 items-center gap-2.5 rounded-lg px-2',
              !railExpanded && 'justify-center',
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rail-active text-[10px] font-semibold">SK</span>
            {railExpanded ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-tight">Sara Kelly</p>
                  <p className="truncate text-[10px] leading-tight text-muted-foreground">Group leadership</p>
                </div>
              </>
            ) : null}
          </motion.div>

        </motion.div>
      </motion.aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar: the bar names where you are and, inside Chat, carries the
            Chat/Map switch. The sections themselves still live in the rail. */}
        <header
          className={cn(
            'shrink-0 overflow-hidden bg-background/80 transition-[height,opacity] duration-300 ease-out',
            '[box-shadow:var(--header-depth)]',
            mapFocus ? 'border-b-0' : 'border-b border-border',
          )}
          style={{ height: mapFocus ? 0 : 56, opacity: mapFocus ? 0 : 1 }}
          aria-hidden={mapFocus}
        >
          {/* Three tracks: the title left, the Chat/Map switch dead centre,
              and the status cluster right. Both side tracks are minmax(0,1fr),
              equal by construction, so the switch sits in the middle of the
              bar at any width; a narrow bar truncates the title instead of
              pushing the switch around. The bar is 56 tall to the switch's
              36, so the switch keeps 10px of air inside the bar's top and
              bottom edges, never touching either hairline. */}
          <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4">
            <div className="flex min-w-0 items-center">
              {/* The bar names what you are in. An open conversation names itself
                  and can be pinned, renamed or deleted from here. */}
              {view === 'chat' && activeChat ? (
                topRenaming ? (
                  <input
                    autoFocus
                    defaultValue={activeChat.title}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        renameChat(activeChat.id, event.currentTarget.value);
                        setTopRenaming(false);
                      }
                      if (event.key === 'Escape') setTopRenaming(false);
                    }}
                    onBlur={() => setTopRenaming(false)}
                    aria-label="Rename chat"
                    className="h-8 w-72 rounded-md border border-[color:var(--accent-border)] bg-card px-2.5 text-[13px] font-semibold outline-none"
                  />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent">
                        <span className="truncate">{activeChat.title}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
                      <DropdownMenuItem onSelect={() => togglePin(activeChat)}>
                        {activeChat.pinned ? <PinOff /> : <Pin />}
                        {activeChat.pinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setTopRenaming(true)}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => deleteChat(activeChat)}
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              ) : (
                <span className="truncate px-2 text-[13px] font-semibold text-foreground">{VIEW_LABELS[view]}</span>
              )}
            </div>

            {/* Chat and Map are one feature with two faces, so while either is
                open the switch that moves between them stays centred here. */}
            <div className="flex items-center justify-center">
              {view === 'chat' || view === 'map' ? (
                <ViewSwitcher view={view} onChange={(next) => setView(next)} />
              ) : null}
            </div>

            <div className="flex min-w-0 items-center justify-end gap-3">
              {/* What used to be the bottom status bar lives up here now. The
                  cluster yields below lg, so the centred switch always has
                  room and the two side tracks stay even. */}
              <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
                <span className="size-1.5 rounded-full bg-positive" />
                {reportingCount < practiceCount
                  ? `${reportingCount} of ${practiceCount} practices reporting`
                  : `${practiceCount} practices connected`}
              </span>
              <span className="hidden text-[11px] tabular-nums text-muted-foreground lg:block">{latestMonth}</span>
              {/* The way back to the briefing after its once-per-session popup. */}
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => setHomeOpen(true)}
                aria-label="What needs attention today"
                title="What needs attention today"
              >
                <Bell />
              </Button>
              <ThemeToggle />
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
          {view === 'chat' ? (
            <ChatView
              onShowMap={showOnMap}
              onOpenBrain={openBrainDocument}
              onCompareOnMap={openCompareOnMap}
              pendingQuestion={pendingQuestion}
              onPendingHandled={() => setPendingQuestion(null)}
              sessionId={chatSessionId}
              onSessionChange={setChatSessionId}
              practiceName={(practiceId) => mapModel.practices.find((practice) => practice.practiceId === practiceId)?.name ?? practiceId}
            />
          ) : null}

          {view === 'map' ? (
            <MapView
              model={mapModel}
              highlighted={highlighted}
              onHighlightChange={setHighlighted}
              intent={mapIntent}
              onIntentHandled={() => setMapIntent(null)}
              focus={mapFocus}
              onToggleFocus={() => setMapFocus((value) => !value)}
              onOpenBrain={openBrainDocument}
              onAddContext={addContextFor}
              onAsk={askAboutPractices}
              onBackToTasks={() => setView('tasks')}
            />
          ) : null}

          {view === 'brain' ? (
            <BrainView
              openDocumentTitle={brainDocument}
              onOpened={() => setBrainDocument(null)}
              onOpenPractice={openPracticeOnMap}
              practiceName={(practiceId) => mapModel.practices.find((practice) => practice.practiceId === practiceId)?.name ?? practiceId}
              practices={mapModel.practices}
              composeFor={brainComposeFor}
              onComposeHandled={() => setBrainComposeFor(null)}
            />
          ) : null}

          {view === 'automations' ? (
            <AutomationsView
              today={today}
              onAskAbout={askFromAutomations}
              onOpenPractice={openPracticeDetails}
              onOpenRegion={openRegionOnMap}
            />
          ) : null}

          {view === 'tasks' ? (
            <TasksView
              onOpenSource={(source) => {
                if (source.practiceId) openPracticeDetails(source.practiceId, 'tasks');
                else if (source.region) openRegionOnMap(source.region);
              }}
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
      </main>

      {/* The undo lives at the window level so a delete from anywhere, the
          top bar included, can always be taken back, even with the rail
          collapsed. The wrapper never blocks clicks; only the toast itself. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
        <AnimatePresence>
          {undoDelete ? (
            <motion.div
              key="undo-delete"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: EASE }}
              role="status"
              className="surface-card pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">Chat deleted</span>
              <button onClick={undoDeleteChat} className="shrink-0 font-medium text-[var(--accent-text)]">
                Undo
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <HomeDialog
        open={homeOpen}
        onOpenChange={handleHomeOpenChange}
        today={today}
        practiceName={(practiceId) =>
          mapModel.practices.find((practice) => practice.practiceId === practiceId)?.name ?? practiceId
        }
        practiceOf={(practiceId) =>
          mapModel.practices.find((practice) => practice.practiceId === practiceId)
        }
        onOpenPractice={homeOpenPractice}
        onAskAbout={homeAskAbout}
        onShowOnMap={homeShowOnMap}
      />
    </div>
  );
}
