'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, FileText, MapPin, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import {
  BRAIN_AS_OF,
  BRAIN_SECTIONS,
  EMPTY_BRAIN_STATE,
  isReviewDue,
  mergeBrainDocuments,
  newBrainDocumentId,
  type BrainDocument,
  type BrainOverride,
  type BrainState,
} from '@/content/brain';
import { readBrainState, writeBrainState } from '@/lib/brain-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** The fields the create dialog collects, before the document is saved. */
interface CreateDraft {
  section: string;
  title: string;
  scope: string;
  /** The linked practice id, or '' for whole group guidance. */
  relatedPracticeId: string;
  owner: string;
  content: string;
}

function defaultCreateDraft(section: string): CreateDraft {
  return { section, title: '', scope: 'Group guidance', relatedPracticeId: '', owner: 'Sara Kelly', content: '' };
}

/**
 * The practices a document is linked to, as chips. This is the connection the
 * brief asks for: knowledge points at places, and a place can point back.
 */
function PracticeLinks({
  ids,
  label,
  onOpen,
}: {
  ids?: string[];
  label: (practiceId: string) => string;
  onOpen?: (practiceId: string) => void;
}) {
  if (!ids || ids.length === 0 || !onOpen) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((practiceId) => (
        <button
          key={practiceId}
          onClick={() => onOpen(practiceId)}
          title="Open on the map"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MapPin className="size-2.5 text-[var(--accent-600)]" />
          {label(practiceId)}
        </button>
      ))}
    </div>
  );
}

/**
 * The Brain tab: the group's written guidance, with read and edit dialogs.
 * Edits are kept locally for the demo and are used by the chat's search_brain
 * tool (which reads the same documents).
 */
export function BrainView({
  openDocumentTitle,
  onOpened,
  onOpenPractice,
  practiceName,
  practices,
  composeFor,
  onComposeHandled,
}: {
  openDocumentTitle?: string | null;
  onOpened?: () => void;
  onOpenPractice?: (practiceId: string) => void;
  practiceName?: (practiceId: string) => string;
  /** Practices for the new document scope select. */
  practices?: Array<{ practiceId: string; name: string }>;
  /** A practice the reader asked to add context for; opens the create dialog prefilled. */
  composeFor?: string | null;
  onComposeHandled?: () => void;
} = {}) {
  const [section, setSection] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [brainState, setBrainState] = useState<BrainState>(EMPTY_BRAIN_STATE);
  const [reading, setReading] = useState<BrainDocument | null>(null);
  const [editing, setEditing] = useState<BrainDocument | null>(null);
  const [draft, setDraft] = useState<BrainOverride>({});
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => defaultCreateDraft('Operations'));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBrainState(readBrainState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeBrainState(brainState);
  }, [brainState, hydrated]);

  const documents = useMemo(() => mergeBrainDocuments(brainState), [brainState]);

  const reviewDueCount = useMemo(
    () => documents.filter((document) => isReviewDue(document.reviewed)).length,
    [documents],
  );

  const sortedPractices = useMemo(
    () => [...(practices ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [practices],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (section !== 'all' && document.section !== section) return false;
      if (!q) return true;
      return `${document.title} ${document.section} ${document.scope} ${document.content}`.toLowerCase().includes(q);
    });
  }, [documents, section, query]);

  // A source chip in chat can ask us to open a specific document.
  useEffect(() => {
    if (!openDocumentTitle) return;
    const match = documents.find((document) => document.title === openDocumentTitle);
    if (match) {
      setSection('all');
      setQuery('');
      setReading(match);
    }
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocumentTitle]);

  // A practice page can ask for a new context document: the create dialog
  // opens prefilled for that practice.
  useEffect(() => {
    if (!composeFor) return;
    const name = practices?.find((practice) => practice.practiceId === composeFor)?.name
      ?? practiceName?.(composeFor)
      ?? composeFor;
    setCreateDraft({
      section: 'Practice context',
      title: `${name}: `,
      scope: name,
      relatedPracticeId: composeFor,
      owner: 'Sara Kelly',
      content: '',
    });
    setCreating(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeFor]);

  function openEditor(document: BrainDocument): void {
    setEditing(document);
    setDraft({ content: document.content, owner: document.owner, conflict: Boolean(document.conflict) });
  }

  function saveEdit(): void {
    if (!editing) return;
    setBrainState((current) => ({
      ...current,
      overrides: {
        ...current.overrides,
        [editing.id]: {
          content: draft.content ?? editing.content,
          owner: draft.owner ?? editing.owner,
          conflict: Boolean(draft.conflict),
        },
      },
    }));
    setEditing(null);
  }

  function resetDocument(id: string): void {
    setBrainState((current) => {
      const overrides = { ...current.overrides };
      delete overrides[id];
      return { ...current, overrides };
    });
  }

  function openCreate(): void {
    setCreateDraft(defaultCreateDraft(section === 'all' ? 'Operations' : section));
    setCreating(true);
  }

  /** Closing the dialog also clears any compose request from a practice page. */
  function closeCreate(): void {
    setCreating(false);
    if (composeFor) onComposeHandled?.();
  }

  function chooseScope(value: string): void {
    if (value === 'group') {
      setCreateDraft((current) => ({ ...current, relatedPracticeId: '', scope: 'Group guidance' }));
      return;
    }
    const name = practices?.find((practice) => practice.practiceId === value)?.name ?? value;
    setCreateDraft((current) => ({ ...current, relatedPracticeId: value, scope: name }));
  }

  function saveNewDocument(): void {
    const title = createDraft.title.trim();
    const content = createDraft.content.trim();
    if (!title || !content) return;
    const practice = practices?.find((entry) => entry.practiceId === createDraft.relatedPracticeId);
    setBrainState((current) => ({
      ...current,
      created: [
        ...current.created,
        {
          id: newBrainDocumentId(),
          section: createDraft.section,
          title,
          owner: createDraft.owner.trim() || 'Sara Kelly',
          reviewed: BRAIN_AS_OF,
          scope: practice?.name ?? createDraft.scope,
          content,
          ...(practice ? { relatedPracticeIds: [practice.practiceId] } : {}),
        },
      ],
    }));
    closeCreate();
  }

  function deleteDocument(id: string): void {
    setBrainState((current) => ({
      ...current,
      created: current.created.filter((document) => document.id !== id),
    }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <FileText className="size-3.5 text-[var(--accent-600)]" /> Northstar Brain
          </span>
          <span className="text-[11px] text-muted-foreground">
            {documents.length} documents
          </span>
          {reviewDueCount > 0 ? (
            <span className="text-[11px] text-muted-foreground">{reviewDueCount} needs review</span>
          ) : null}
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="size-3.5" /> New document
          </Button>
          <div className="relative ml-auto w-[220px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search guidance"
              className="h-8 pl-7 text-xs"
              aria-label="Search guidance"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <button
            onClick={() => setSection('all')}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              section === 'all' ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-foreground' : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            All sections
          </button>
          {BRAIN_SECTIONS.map((name) => (
            <button
              key={name}
              onClick={() => setSection(name)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                section === name ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-foreground' : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {/* Cards reflow into their new places when the section filter changes.
            No exit animation on purpose: if frames are frozen the exiting cards
            would linger, so the layout animation does the work instead. */}
        <motion.div layout className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((document, index) => (
            <motion.div
              key={document.id}
              data-anim
              layout
              initial={{ opacity: 0, x: -14, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ duration: 0.34, delay: Math.min(index * 0.04, 0.24), ease: [0.22, 1, 0.36, 1] }}
            >
              <Card className="h-full">
                <CardContent className="flex h-full flex-col p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{document.scope}</Badge>
                  <span className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">{document.section}</span>
                  {document.conflict ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <TriangleAlert className="size-3" /> Needs clarification
                    </Badge>
                  ) : null}
                  {isReviewDue(document.reviewed) ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Clock className="size-3" /> Review due
                    </Badge>
                  ) : null}
                  {document.origin === 'yours' ? (
                    <Badge variant="outline" className="text-[10px]">Yours</Badge>
                  ) : null}
                  {brainState.overrides[document.id] ? (
                    <Badge variant="outline" className="text-[10px]">Edited</Badge>
                  ) : null}
                </div>

                <h3 className="mt-2 text-sm font-semibold">{document.title}</h3>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{document.content}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {document.owner} · reviewed {document.reviewed}
                </p>
                <div className="mt-2">
                  <PracticeLinks
                    ids={document.relatedPracticeIds}
                    label={(practiceId) => practiceName?.(practiceId) ?? practiceId}
                    onOpen={onOpenPractice}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReading(document)}>Read</Button>
                  {document.origin === 'yours' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteDocument(document.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => openEditor(document)}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      {brainState.overrides[document.id] ? (
                        <Button size="sm" variant="ghost" onClick={() => resetDocument(document.id)}>
                          <RotateCcw className="size-3.5" /> Reset
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground">No guidance matches this search.</p>
          ) : null}
        </motion.div>
      </div>

      {/* Read */}
      <Dialog open={Boolean(reading)} onOpenChange={(open) => !open && setReading(null)}>
        <DialogContent className="max-w-2xl">
          {reading ? (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{reading.scope}</Badge>
                  <span className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">{reading.section}</span>
                  {reading.conflict ? <Badge variant="destructive" className="text-[10px]">Needs clarification</Badge> : null}
                  {isReviewDue(reading.reviewed) ? <Badge variant="outline" className="gap-1 text-[10px]"><Clock className="size-3" /> Review due</Badge> : null}
                  {reading.origin === 'yours' ? <Badge variant="outline" className="text-[10px]">Yours</Badge> : null}
                </div>
                <DialogTitle className="mt-2">{reading.title}</DialogTitle>
                <DialogDescription>
                  {reading.owner} · reviewed {reading.reviewed}
                </DialogDescription>
                <div className="mt-2">
                  <PracticeLinks
                    ids={reading.relatedPracticeIds}
                    label={(practiceId) => practiceName?.(practiceId) ?? practiceId}
                    onOpen={onOpenPractice}
                  />
                </div>
              </DialogHeader>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{reading.content}</p>
              <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3 text-[var(--accent-600)]" /> Ask in chat and this guidance is cited in the sources.
              </p>
              <DialogFooter>
                {reading.origin === 'yours' ? null : (
                  <Button variant="outline" onClick={() => { setReading(null); openEditor(reading); }}>Edit this guidance</Button>
                )}
                <Button onClick={() => setReading(null)}>Close</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing ? (
            <>
              <DialogHeader>
                <DialogTitle>Edit guidance</DialogTitle>
                <DialogDescription>
                  Changes are saved in this browser only. Chat answers use this text after you save.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <label className="label-caps mb-1 block" htmlFor="brain-owner">Owner</label>
                  <Input
                    id="brain-owner"
                    value={draft.owner ?? editing.owner}
                    onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="label-caps mb-1 block" htmlFor="brain-content">Guidance</label>
                  <Textarea
                    id="brain-content"
                    rows={9}
                    value={draft.content ?? editing.content}
                    onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                    className="resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.conflict)}
                    onChange={(event) => setDraft((current) => ({ ...current, conflict: event.target.checked }))}
                  />
                  Mark as conflicting guidance, clarification required
                </label>
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    resetDocument(editing.id);
                    setEditing(null);
                  }}
                >
                  Reset to default
                </Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={saveEdit}>Save guidance</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create your own guidance */}
      <Dialog open={creating} onOpenChange={(open) => !open && closeCreate()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
            <DialogDescription>
              Your own guidance, saved in this browser only. Chat answers cite it like any other document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label-caps mb-1 block" htmlFor="brain-new-section">Section</label>
                <Select
                  value={createDraft.section}
                  onValueChange={(value) => setCreateDraft((current) => ({ ...current, section: value }))}
                >
                  <SelectTrigger id="brain-new-section" className="text-xs" aria-label="Section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAIN_SECTIONS.map((name) => (
                      <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="label-caps mb-1 block" htmlFor="brain-new-scope">Scope</label>
                <Select value={createDraft.relatedPracticeId || 'group'} onValueChange={chooseScope}>
                  <SelectTrigger id="brain-new-scope" className="text-xs" aria-label="Scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group" className="text-xs">Whole group</SelectItem>
                    {sortedPractices.map((practice) => (
                      <SelectItem key={practice.practiceId} value={practice.practiceId} className="text-xs">
                        {practice.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="label-caps mb-1 block" htmlFor="brain-new-title">Title</label>
              <Input
                id="brain-new-title"
                value={createDraft.title}
                onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label-caps mb-1 block" htmlFor="brain-new-owner">Owner</label>
              <Input
                id="brain-new-owner"
                value={createDraft.owner}
                onChange={(event) => setCreateDraft((current) => ({ ...current, owner: event.target.value }))}
              />
            </div>
            <div>
              <label className="label-caps mb-1 block" htmlFor="brain-new-content">Guidance</label>
              <Textarea
                id="brain-new-content"
                rows={7}
                value={createDraft.content}
                onChange={(event) => setCreateDraft((current) => ({ ...current, content: event.target.value }))}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button onClick={saveNewDocument} disabled={!createDraft.title.trim() || !createDraft.content.trim()}>
              Save document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
