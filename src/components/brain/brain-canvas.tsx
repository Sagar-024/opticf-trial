'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Frame, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { BrainGraph, BrainGraphNode } from '@/brain/graph';
import { initialsOf } from '@/components/canvas/ink';
import { readPalette, type Palette } from '@/components/map/palette';
import { Button } from '@/components/ui/button';
import { computeFit, computeFlyTo, type Bounds } from '@/map/layout';
import { cn } from '@/lib/utils';

/**
 * The Practice Brain graph, drawn on a 2D canvas.
 *
 * Same viewport discipline as the map canvas: the draw loop measures the DOM
 * directly and keeps the transform in a ref, so painting never waits on React
 * state, and the palette is read once per theme change. The graph itself is
 * pure geometry from buildBrainGraph: hub at the origin, sections in an even
 * ring, each section's documents in an outward fan, owners beyond their
 * busiest section.
 */

export interface BrainCanvasHandle {
  /** Centre the view on these node ids (single ids stop at 2.5x). */
  flyToNodes(ids: string[]): void;
  /** Back to the whole graph. */
  fit(): void;
}

export interface BrainCanvasProps {
  graph: BrainGraph;
  /** Node ids to keep bright (and label); everything else veils under dimOpacity. */
  highlighted: string[];
  selectedId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  practiceName?: (practiceId: string) => string;
  /** Focus mode: the page chrome hides and the graph owns the surface. */
  focus?: boolean;
  onToggleFocus?: () => void;
  className?: string;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface ScreenPoint {
  x: number;
  y: number;
  r: number;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/** One node's label line: its own font and colour. */
interface LabelLine {
  text: string;
  font: string;
  color: string;
}

/**
 * The document and team discs keep the reference's paper white in both
 * themes: a light disc with quiet ink reads on cream paper and on near black.
 */
const NODE_SURFACE = 'rgba(255, 255, 255, 0.96)';
const NODE_EDGE = 'rgba(24, 20, 16, 0.12)';
const DOC_INK = '#8B857C';
const TEAM_INK = '#4E5566';
/** Connector threads: warm grey, readable on cream paper and on near black. */
const EDGE_INK = 'rgba(168, 156, 144, 0.8)';

const VIEWPORT_PADDING = { top: 16, right: 20, bottom: 64, left: 20 };
const FIT_PADDING = 26;
/**
 * Cap on the resting fit, in the same spirit as the map's drilled-region cap:
 * a sparse graph (or the hub alone when there are no documents) must not blow
 * its discs up to fill the canvas.
 */
const MAX_FIT_SCALE = 1.15;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
/** One node is a dot: filling the canvas with it would lose all context. */
const SINGLE_NODE_MAX_ZOOM = 2.5;
const PAN_STEP = 120;
const DOT_STEP_UNITS = 28;
const DOT_MIN_SCREEN = 18;
const MAX_DOTS = 5000;

/** Smallest screen radius each role keeps, so a node never becomes a speck.
    The hub floor also keeps the sparkle legible at the resting fit. */
function radiusOf(role: BrainGraphNode['role'], screenR: number): number {
  if (role === 'hub') return Math.max(32, screenR);
  if (role === 'section') return Math.max(12, screenR);
  if (role === 'owner') return Math.max(9, screenR);
  return Math.max(7, screenR);
}

function collides(box: { x: number; y: number; w: number; h: number }, others: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  return others.some(
    (other) =>
      box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y,
  );
}

/** Same colour at a lower alpha, for gradients over the dotted paper. */
function withAlpha(color: string, alpha: number): string {
  const close = color.lastIndexOf(')');
  if (!color.startsWith('oklch(') || close < 0) return color;
  return `${color.slice(0, close)} / ${alpha}${color.slice(close)}`;
}

/** A rounded rectangle as an explicit path, without relying on ctx.roundRect. */
function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.arcTo(x + w, y, x + w, y + radius, radius);
  context.lineTo(x + w, y + h - radius);
  context.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  context.lineTo(x + radius, y + h);
  context.arcTo(x, y + h, x, y + h - radius, radius);
  context.lineTo(x, y + radius);
  context.arcTo(x, y, x + radius, y, radius);
  context.closePath();
}

/** The page mark inside a document disc: a sheet with a turned-down corner and
    two lines of writing, drawn only once the disc is large enough to hold it. */
function drawPageGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const w = radius * 0.66;
  const h = radius * 0.86;
  const left = x - w / 2;
  const top = y - h / 2;
  const right = left + w;
  const bottom = top + h;
  const fold = Math.min(w, h) * 0.34;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  // The sheet, with the corner turned down.
  context.beginPath();
  context.moveTo(left, top + 1.5);
  context.quadraticCurveTo(left, top, left + 1.5, top);
  context.lineTo(right - fold, top);
  context.lineTo(right, top + fold);
  context.lineTo(right, bottom - 1.5);
  context.quadraticCurveTo(right, bottom, right - 1.5, bottom);
  context.lineTo(left + 1.5, bottom);
  context.quadraticCurveTo(left, bottom, left, bottom - 1.5);
  context.closePath();
  context.stroke();
  // The turned corner itself.
  context.beginPath();
  context.moveTo(right - fold, top);
  context.lineTo(right - fold, top + fold);
  context.lineTo(right, top + fold);
  context.stroke();
  // Two lines of writing.
  context.beginPath();
  context.moveTo(left + w * 0.22, top + h * 0.52);
  context.lineTo(right - w * 0.22, top + h * 0.52);
  context.moveTo(left + w * 0.22, top + h * 0.72);
  context.lineTo(right - w * 0.36, top + h * 0.72);
  context.stroke();
  context.restore();
}

/** The hub mark: one four point sparkle as a single quadratic path. */
function drawSparkle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  // The path is authored in a 20.4 unit box, so scale it to the wanted span.
  const scale = size / 20.4;
  const px = (value: number): number => x + (value - 12) * scale;
  const py = (value: number): number => y + (value - 12) * scale;
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(px(12), py(1.8));
  context.quadraticCurveTo(px(13.2), py(10.8), px(22.2), py(12));
  context.quadraticCurveTo(px(13.2), py(13.2), px(12), py(22.2));
  context.quadraticCurveTo(px(10.8), py(13.2), px(1.8), py(12));
  context.quadraticCurveTo(px(10.8), py(10.8), px(12), py(1.8));
  context.closePath();
  context.fill();
  context.restore();
}

/** Longest document label line the canvas keeps before cutting with an ellipsis. */
const LABEL_LINE_CHARS = 22;

/** Two tidy lines at most: words for the first line up to the limit, the rest
    on the second line, cut at a word boundary with an ellipsis. */
function splitTitle(title: string): string[] {
  const words = title.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const first: string[] = [];
  let index = 0;
  while (index < words.length) {
    const candidate = [...first, words[index]].join(' ');
    if (first.length > 0 && candidate.length > LABEL_LINE_CHARS) break;
    first.push(words[index]);
    index += 1;
  }
  const rest = words.slice(index).join(' ');
  if (rest.length === 0) return [first.join(' ')];
  return [first.join(' '), clampLine(rest)];
}

function clampLine(text: string): string {
  if (text.length <= LABEL_LINE_CHARS) return text;
  const cut = text.slice(0, LABEL_LINE_CHARS + 1);
  const space = cut.lastIndexOf(' ');
  const body = (space > 0 ? cut.slice(0, space) : text.slice(0, LABEL_LINE_CHARS)).trimEnd();
  return `${body}…`;
}

export const BrainCanvas = forwardRef<BrainCanvasHandle, BrainCanvasProps>(function BrainCanvas(
  { graph, highlighted, selectedId, onSelectNode, practiceName, focus = false, onToggleFocus, className },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 });
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  /** The graph as the imperative handle reads it, so fly-to never waits for a render. */
  const graphRef = useRef(graph);
  graphRef.current = graph;
  /** The last fly-to request, re-applied when the canvas genuinely resizes. */
  const lastFlyRef = useRef<string[] | null>(null);

  const paletteRef = useRef<Palette | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  /** Bumped when the canvas genuinely changes size, so a fly-to can re-apply. */
  const [frame, setFrame] = useState(0);
  const lastSizeRef = useRef({ w: 0, h: 0 });

  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);
  const hubNode = useMemo(() => graph.nodes.find((node) => node.role === 'hub') ?? null, [graph]);
  const ownerNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'owner'), [graph]);
  const sectionNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'section'), [graph]);
  const documentNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'document'), [graph]);
  const roleById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node.role])), [graph]);

  // ── Palette follows the theme ─────────────────────────────────────────────
  const invalidateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    paletteRef.current = readPalette();
    const observer = new MutationObserver(() => {
      paletteRef.current = readPalette();
      invalidateRef.current?.();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!wrap || !canvas || !context) return;
    // Read the theme palette on demand, so the first paint never waits on state.
    const palette = paletteRef.current ?? (paletteRef.current = readPalette());

    const rect = wrap.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    // Fit is computed here, from the real DOM size, so React state cannot lag it.
    const fit = computeFit(graph.bounds, { width, height, ...VIEWPORT_PADDING }, FIT_PADDING, MAX_FIT_SCALE);
    transformRef.current = { scale: fit.scale, offsetX: fit.offsetX, offsetY: fit.offsetY, width, height };

    // Debug hook for the QA harness, mirroring the map canvas: read the live
    // transform and project a node without driving the pointer.
    (window as unknown as { __opticfBrainView?: unknown }).__opticfBrainView = {
      zoom,
      panX: pan.x,
      panY: pan.y,
      width,
      height,
      project: (id: string) => {
        const node = graph.nodes.find((candidate) => candidate.id === id);
        return node ? screen(node) : null;
      },
    };

    const screen = (node: BrainGraphNode): ScreenPoint => ({
      x: fit.offsetX + node.x * fit.scale * zoom + pan.x,
      y: fit.offsetY + node.y * fit.scale * zoom + pan.y,
      r: node.r * fit.scale * zoom,
    });
    const cull = (point: ScreenPoint): boolean =>
      point.x < -80 || point.x > width + 80 || point.y < -80 || point.y > height + 80;

    const points = new Map<string, ScreenPoint>();
    for (const node of graph.nodes) points.set(node.id, screen(node));

    const dimming = highlightSet.size > 0;
    const inFocus = (id: string): boolean => highlightSet.has(id) || selectedId === id;
    const alphaOf = (id: string): number => (dimming && !inFocus(id) ? palette.dimOpacity : 1);

    // ── Dotted world ──
    // A calm grid of specks under everything. The world step is 28 graph units,
    // doubled until one step covers at least 18 screen pixels, so the dots stay
    // small at every zoom. Above 5000 dots the grid is skipped entirely.
    {
      let step = DOT_STEP_UNITS;
      let screenStep = step * fit.scale * zoom;
      let guard = 0;
      while (screenStep < DOT_MIN_SCREEN && guard < 16) {
        step *= 2;
        screenStep *= 2;
        guard += 1;
      }
      const originX = fit.offsetX + pan.x;
      const originY = fit.offsetY + pan.y;
      const firstX = Math.ceil((0 - originX) / screenStep);
      const firstY = Math.ceil((0 - originY) / screenStep);
      const lastX = Math.floor((width - originX) / screenStep);
      const lastY = Math.floor((height - originY) / screenStep);
      const cols = lastX - firstX + 1;
      const rows = lastY - firstY + 1;
      if (cols > 0 && rows > 0 && cols * rows <= MAX_DOTS) {
        // One path for every dot: a fill per dot would cost 5000 draws.
        context.globalAlpha = 0.16;
        context.fillStyle = palette.border;
        context.beginPath();
        for (let ix = firstX; ix <= lastX; ix += 1) {
          for (let iy = firstY; iy <= lastY; iy += 1) {
            const dotX = originX + ix * screenStep;
            const dotY = originY + iy * screenStep;
            context.moveTo(dotX + 0.85, dotY);
            context.arc(dotX, dotY, 0.85, 0, Math.PI * 2);
          }
        }
        context.fill();
        context.globalAlpha = 1;
      }
    }

    // ── Edges ──
    // Two voices only: the coral spokes carry structure from the hub to the
    // sections, and every knowledge thread is a fine grey dashed curve. All of
    // it is curved, so the graph reads woven rather than wired.
    for (const edge of graph.edges) {
      const a = points.get(edge.a);
      const b = points.get(edge.b);
      if (!a || !b) continue;
      const aRole = roleById.get(edge.a);
      const bRole = roleById.get(edge.b);
      const hubSpoke =
        edge.kind === 'structure' &&
        ((aRole === 'hub' && bRole === 'section') || (bRole === 'hub' && aRole === 'section'));
      const touched = inFocus(edge.a) || inFocus(edge.b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      // Bow every thread to one side: a gentle, deterministic weave.
      const bow = hubSpoke ? 0.1 : 0.07;
      const controlX = (a.x + b.x) / 2 + (-dy / length) * length * bow;
      const controlY = (a.y + b.y) / 2 + (dx / length) * length * bow;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.quadraticCurveTo(controlX, controlY, b.x, b.y);
      if (hubSpoke) {
        context.setLineDash([]);
        context.lineWidth = 1.25;
        context.strokeStyle = palette.colors.coral;
        context.globalAlpha = touched || !dimming ? 0.6 : palette.dimOpacity;
      } else {
        context.setLineDash([4, 5]);
        context.lineWidth = 1.25;
        context.strokeStyle = EDGE_INK;
        context.globalAlpha = touched || !dimming ? 1 : palette.dimOpacity;
      }
      context.stroke();
    }
    context.setLineDash([]);

    // ── Owner bus ──
    // A row of team discs is joined by one quiet bracket underneath, the
    // structure line of the team area.
    if (ownerNodes.length > 1) {
      const rows = new Map<number, ScreenPoint[]>();
      for (const node of ownerNodes) {
        const point = points.get(node.id);
        if (!point) continue;
        const key = Math.round(point.y / 40);
        rows.set(key, [...(rows.get(key) ?? []), point]);
      }
      const ownerFocused = ownerNodes.some((node) => inFocus(node.id));
      context.setLineDash([]);
      context.lineWidth = 1.25;
      context.strokeStyle = EDGE_INK;
      context.globalAlpha = !dimming || ownerFocused ? 1 : palette.dimOpacity;
      for (const row of rows.values()) {
        if (row.length < 2) continue;
        const bracketY = Math.max(...row.map((point) => point.y)) + radiusOf('owner', row[0].r) + 18;
        const minX = Math.min(...row.map((point) => point.x));
        const maxX = Math.max(...row.map((point) => point.x));
        context.beginPath();
        context.moveTo(minX, bracketY);
        context.lineTo(maxX, bracketY);
        for (const point of row) {
          context.moveTo(point.x, point.y + radiusOf('owner', point.r));
          context.lineTo(point.x, bracketY);
        }
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    // ── Discs ──
    const discBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const discBox = (point: ScreenPoint, radius: number): void => {
      discBoxes.push({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 });
    };

    // Owners: soft neutral discs with the initials. No stroke, no border noise.
    for (const node of ownerNodes) {
      const point = points.get(node.id);
      if (!point || cull(point)) continue;
      const radius = radiusOf('owner', point.r);
      const alpha = alphaOf(node.id);
      discBox(point, radius);
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = NODE_SURFACE;
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = NODE_EDGE;
      context.stroke();
      if (radius >= 8) {
        context.font = '500 11px Inter, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = TEAM_INK;
        context.fillText(node.initials ?? initialsOf(node.label), point.x, point.y + 0.5);
      }
    }

    // Sections: coral soft discs with the document count.
    for (const node of sectionNodes) {
      const point = points.get(node.id);
      if (!point || cull(point)) continue;
      const radius = radiusOf('section', point.r);
      const alpha = alphaOf(node.id);
      // The core stores a phrase ("3 documents"); the disc carries just the count.
      const count = node.sub?.match(/\d+/)?.[0] ?? '';
      discBox(point, radius);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.globalAlpha = alpha * 0.85;
      context.fillStyle = palette.colors.coral;
      context.fill();
      context.globalAlpha = alpha;
      context.lineWidth = 1.5;
      context.strokeStyle = palette.colors.coral;
      context.stroke();
      if (count) {
        context.font = `600 ${Math.max(12, Math.round(radius * 0.9))}px Inter, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = palette.labelStrong;
        context.fillText(count, point.x, point.y + 0.5);
      }
    }

    // Documents: quiet discs, a page mark only when it fits, and the live flags.
    for (const node of documentNodes) {
      const point = points.get(node.id);
      if (!point || cull(point)) continue;
      const radius = radiusOf('document', point.r);
      const alpha = alphaOf(node.id);
      const flags = node.flags;
      discBox(point, radius);

      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = NODE_SURFACE;
      context.fill();
      // A conflict takes over the border: one coral ring, nothing added outside.
      context.lineWidth = flags?.conflict ? 1.5 : 1;
      context.strokeStyle = flags?.conflict ? palette.colors.coral : NODE_EDGE;
      context.stroke();

      if (radius >= 5.5) {
        context.globalAlpha = alpha * 0.8;
        drawPageGlyph(context, point.x, point.y, radius, DOC_INK);
      }

      if (flags?.reviewDue) {
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(point.x + radius * Math.SQRT1_2, point.y - radius * Math.SQRT1_2, 1.5, 0, Math.PI * 2);
        context.fillStyle = palette.colors.amber;
        context.fill();
      }

      if (flags?.practiceLinks && flags.practiceLinks.length > 0) {
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(point.x, point.y + radius, 1.5, 0, Math.PI * 2);
        context.fillStyle = palette.colors.coral;
        context.fill();
      }
    }

    // The hub, last: a soft halo, the pale disc, then the coral app mark with
    // the white sparkle, so the hub reads as the source of everything.
    if (hubNode) {
      const point = points.get(hubNode.id);
      if (point) {
        const radius = radiusOf('hub', point.r);
        const alpha = alphaOf(hubNode.id);
        discBox(point, radius);
        const halo = context.createRadialGradient(
          point.x,
          point.y,
          radius * 0.5,
          point.x,
          point.y,
          radius * 2.8,
        );
        halo.addColorStop(0, withAlpha(palette.colors.coral, 0.14 * alpha));
        halo.addColorStop(1, withAlpha(palette.colors.coral, 0));
        context.fillStyle = halo;
        context.beginPath();
        context.arc(point.x, point.y, radius * 2.8, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = alpha * 0.22;
        context.fillStyle = palette.colors.coral;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        const mark = radius * 1.35;
        context.globalAlpha = alpha;
        roundedRectPath(context, point.x - mark / 2, point.y - mark / 2, mark, mark, mark * 0.3);
        context.fillStyle = palette.colors.coral;
        context.fill();
        drawSparkle(context, point.x, point.y, mark * 0.62, '#ffffff');
      }
    }

    // Hover and selection share one quiet coral ring, and nothing else.
    if (hovered !== null || selectedId !== null) {
      context.lineWidth = 1.5;
      context.strokeStyle = palette.colors.coral;
      for (const node of graph.nodes) {
        if (node.id !== hovered && node.id !== selectedId) continue;
        const point = points.get(node.id);
        if (!point || cull(point)) continue;
        context.globalAlpha = alphaOf(node.id);
        context.beginPath();
        context.arc(point.x, point.y, radiusOf(node.role, point.r) + 4, 0, Math.PI * 2);
        context.stroke();
      }
    }

    // ── Labels ──
    // Placed boxes are kept so a label never lands on one already drawn. Each
    // tries below, above, right, then left. A document label that collides is
    // dropped unless the node is priority (hovered, selected or highlighted).
    const labelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    /** Whether the projected graph has room for every node's label. */
    const labelsFit = fit.scale * zoom >= 0.42;
    const placeLabel = (
      point: ScreenPoint,
      radius: number,
      alpha: number,
      lines: LabelLine[],
      sub: string | null,
      subFont: string,
      isPriority: boolean,
      avoidDiscs: boolean,
      gap: number,
    ): void => {
      const widths = lines.map((line) => {
        context.font = line.font;
        return context.measureText(line.text).width;
      });
      context.font = subFont;
      const subWidth = sub ? context.measureText(sub).width : 0;
      const boxWidth = Math.max(subWidth, ...widths, 0) + 14;
      const lineHeight = 13;
      const boxHeight = lines.length * lineHeight + (sub ? 13 : 0) + 8;
      const options = [
        { x: point.x - boxWidth / 2, y: point.y + radius + gap, w: boxWidth, h: boxHeight },
        { x: point.x - boxWidth / 2, y: point.y - radius - gap - boxHeight, w: boxWidth, h: boxHeight },
        { x: point.x + radius + gap, y: point.y - boxHeight / 2, w: boxWidth, h: boxHeight },
        { x: point.x - radius - gap - boxWidth, y: point.y - boxHeight / 2, w: boxWidth, h: boxHeight },
      ];
      const blockers = avoidDiscs ? [...labelBoxes, ...discBoxes] : labelBoxes;
      const chosen = options.find((box) => !collides(box, blockers));
      if (!chosen && !isPriority) return;
      const box = chosen ?? options[0];
      labelBoxes.push(box);

      const centreX = box.x + boxWidth / 2;
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.lineWidth = 4;
      context.strokeStyle = palette.background;
      context.globalAlpha = alpha;
      lines.forEach((line, index) => {
        context.font = line.font;
        const y = box.y + 12 + index * lineHeight;
        context.strokeText(line.text, centreX, y);
        context.fillStyle = line.color;
        context.fillText(line.text, centreX, y);
      });
      if (sub) {
        context.font = subFont;
        const y = box.y + 12 + lines.length * lineHeight;
        context.strokeText(sub, centreX, y);
        context.fillStyle = palette.label;
        context.fillText(sub, centreX, y);
      }
    };

    if (hubNode) {
      const point = points.get(hubNode.id);
      if (point) {
        placeLabel(
          point,
          radiusOf('hub', point.r),
          alphaOf(hubNode.id),
          [{ text: hubNode.label || 'Practice Brain', font: '600 13.5px Inter, sans-serif', color: palette.labelStrong }],
          hubNode.sub ?? null,
          '400 9.5px Inter, sans-serif',
          true,
          true,
          14,
        );
      }
    }

    for (const node of sectionNodes) {
      const point = points.get(node.id);
      if (!point) continue;
      placeLabel(
        point,
        radiusOf('section', point.r),
        alphaOf(node.id),
        [{ text: node.label, font: '500 11.5px Inter, sans-serif', color: palette.labelStrong }],
        null,
        '400 9px Inter, sans-serif',
        true,
        false,
        10,
      );
    }

    for (const node of ownerNodes) {
      const point = points.get(node.id);
      if (!point) continue;
      const priority = hovered === node.id || selectedId === node.id || highlightSet.has(node.id);
      if (!labelsFit && !priority) continue;
      placeLabel(
        point,
        radiusOf('owner', point.r),
        alphaOf(node.id),
        [{ text: node.label, font: '500 10.5px Inter, sans-serif', color: palette.labelStrong }],
        node.sub ?? null,
        '400 9px Inter, sans-serif',
        true,
        false,
        10,
      );
    }

    for (const node of documentNodes) {
      const point = points.get(node.id);
      if (!point) continue;
      const priority = hovered === node.id || selectedId === node.id || highlightSet.has(node.id);
      // Up to two quiet lines in the muted ink, halved behind a stroke so
      // dashed threads never cut them. A tight fit hides them all except the
      // focused and the flagged, so the graph never becomes text soup; zooming
      // in (or a wider window) brings every label back.
      const flagged = Boolean(node.flags?.conflict) || Boolean(node.flags?.reviewDue);
      if (!labelsFit && !priority && !flagged) continue;
      const lines: LabelLine[] = splitTitle(node.label).map((line) => ({
        text: line,
        font: '500 10.5px Inter, sans-serif',
        color: palette.labelStrong,
      }));
      placeLabel(
        point,
        radiusOf('document', point.r),
        alphaOf(node.id),
        lines,
        null,
        '400 9px Inter, sans-serif',
        priority,
        false,
        9,
      );
    }

    context.globalAlpha = 1;

    // ── Empty state ──
    if (graph.stats.documents === 0) {
      const text = 'The Brain has no documents yet.';
      context.font = '500 13px Inter, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const textWidth = context.measureText(text).width;
      const boxWidth = textWidth + 34;
      const boxHeight = 38;
      roundedRectPath(context, width / 2 - boxWidth / 2, height / 2 - boxHeight / 2, boxWidth, boxHeight, 12);
      context.globalAlpha = 0.92;
      context.fillStyle = palette.hubSurface;
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = palette.border;
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = palette.labelStrong;
      context.fillText(text, width / 2, height / 2 + 0.5);
    }
  }, [
    documentNodes,
    graph,
    highlightSet,
    hovered,
    hubNode,
    ownerNodes,
    pan,
    roleById,
    sectionNodes,
    selectedId,
    zoom,
  ]);

  const invalidate = useCallback(() => {
    // requestAnimationFrame is suspended while the page is hidden, so paint
    // synchronously in that case rather than leaving the canvas blank.
    if (typeof document !== 'undefined' && document.hidden) {
      draw();
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  // Keep a live pointer so the theme observer can trigger a repaint.
  invalidateRef.current = invalidate;

  // Repaint when the tab becomes visible again, and clear any frame that was
  // scheduled while the page was hidden (those callbacks can be dropped).
  useEffect(() => {
    const onVisibility = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      draw();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [draw]);

  // Paint synchronously after every state change. Waiting for a frame made
  // panning feel laggy, and requestAnimationFrame is suspended while the tab is
  // hidden, which could freeze the canvas entirely.
  useLayoutEffect(() => {
    draw();
  }, [draw]);

  // Focus mode hands the keyboard to the canvas: +/- and F work at once, and
  // Escape stays inside the dialog so Radix still closes it on the next press.
  useEffect(() => {
    if (focus) canvasRef.current?.focus();
  }, [focus]);

  // Redraw whenever the element is resized (container size, panel open, tab
  // switch). The first draw can happen before the surface has settled, so a
  // size change also re-applies the last fly-to: otherwise a highlight opened
  // from a citation can be centred against a transform that no longer matches.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w !== lastSizeRef.current.w || h !== lastSizeRef.current.h) {
        lastSizeRef.current = { w, h };
        setFrame((value) => value + 1);
      }
      invalidate();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [invalidate]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // ── Fly-to handle ─────────────────────────────────────────────────────────
  const applyFit = useCallback(() => {
    lastFlyRef.current = null;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const flyToNodes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    lastFlyRef.current = ids;
    const { scale, offsetX, offsetY, width, height } = transformRef.current;
    if (width === 0 || height === 0) return;
    const wanted = new Set(ids);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of graphRef.current.nodes) {
      if (!wanted.has(node.id)) continue;
      minX = Math.min(minX, node.x - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      minY = Math.min(minY, node.y - node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    const bounds: Bounds = { minX, maxX, minY, maxY };
    const flight = computeFlyTo(bounds, { scale, offsetX, offsetY, width, height }, VIEWPORT_PADDING, {
      minZoom: MIN_ZOOM,
      maxZoom: ids.length === 1 ? SINGLE_NODE_MAX_ZOOM : MAX_ZOOM,
    });
    setZoom(flight.zoom);
    setPan({ x: flight.panX, y: flight.panY });
  }, []);

  useImperativeHandle(ref, () => ({ flyToNodes, fit: applyFit }), [applyFit, flyToNodes]);

  // A fly-to requested before the surface settled re-applies on a real resize.
  useEffect(() => {
    if (frame === 0) return;
    const ids = lastFlyRef.current;
    if (ids && ids.length > 0) flyToNodes(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  // ── Interaction ───────────────────────────────────────────────────────────
  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** Screen position of a node. Reads the live transform. */
  const project = useCallback(
    (node: BrainGraphNode) => {
      const { scale, offsetX, offsetY } = transformRef.current;
      return {
        x: offsetX + node.x * scale * zoom + pan.x,
        y: offsetY + node.y * scale * zoom + pan.y,
        r: node.r * scale * zoom,
      };
    },
    [zoom, pan],
  );

  const findNode = useCallback(
    (x: number, y: number): BrainGraphNode | null => {
      let best: BrainGraphNode | null = null;
      let bestDistance = Infinity;
      for (const node of graph.nodes) {
        const point = project(node);
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance <= Math.max(6, point.r + 4) + 18 && distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      return best;
    },
    [graph.nodes, project],
  );

  const tooltipFor = useCallback(
    (node: BrainGraphNode): { title: string; lines: string[] } => {
      if (node.role === 'hub') {
        return {
          title: node.label || 'Your Practice Brain',
          lines: [
            `${graph.stats.documents} documents in ${graph.stats.sections} sections`,
            ...(graph.stats.reviewDue > 0
              ? [`${graph.stats.reviewDue} review${graph.stats.reviewDue === 1 ? '' : 's'} due`]
              : []),
          ],
        };
      }
      if (node.role === 'section') {
        return { title: node.label, lines: [node.sub ?? 'Section'] };
      }
      if (node.role === 'owner') {
        return { title: node.label, lines: [node.sub ?? 'Owner'] };
      }
      const lines: string[] = [];
      if (node.section) lines.push(node.section);
      if (node.flags?.conflict) lines.push('Needs clarification');
      if (node.flags?.reviewDue) lines.push('Review due');
      if (node.flags?.yours) lines.push('Yours');
      if (node.flags?.practiceLinks && node.flags.practiceLinks.length > 0) {
        const names = node.flags.practiceLinks.map((id) => practiceName?.(id) ?? id).join(', ');
        lines.push(`Linked to ${names}`);
      }
      return { title: node.label, lines };
    },
    [graph.stats.documents, graph.stats.reviewDue, graph.stats.sections, practiceName],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const point = pointFromEvent(event);
    dragRef.current = { x: point.x, y: point.y, panX: pan.x, panY: pan.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const point = pointFromEvent(event);
    const current = dragRef.current;

    if (current) {
      const dx = point.x - current.x;
      const dy = point.y - current.y;
      if (Math.hypot(dx, dy) > 4) current.moved = true;
      if (current.moved) {
        setPan({ x: current.panX + dx, y: current.panY + dy });
        setTooltip(null);
      }
      return;
    }

    const node = findNode(point.x, point.y);
    setHovered(node?.id ?? null);
    if (node) {
      const { width, height } = transformRef.current;
      const { title, lines } = tooltipFor(node);
      setTooltip({
        x: Math.min(Math.max(8, width - 250), Math.max(8, point.x + 16)),
        y: Math.min(Math.max(8, height - 110), Math.max(8, point.y + 16)),
        title,
        lines,
      });
    } else {
      setTooltip(null);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = dragRef.current;
    dragRef.current = null;
    if (!current || current.moved) return;
    const point = pointFromEvent(event);
    const node = findNode(point.x, point.y);
    onSelectNode(node ? node.id : null);
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = pointFromEvent(event);
    const { width, height } = transformRef.current;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    if (next === zoom) return;
    const ratio = next / zoom;
    setPan({
      x: point.x - width / 2 - (point.x - width / 2 - pan.x) * ratio,
      y: point.y - height / 2 - (point.y - height / 2 - pan.y) * ratio,
    });
    setZoom(next);
  }
  const wheelRef = useRef(handleWheel);
  wheelRef.current = handleWheel;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>): void {
    if (event.key === 'Escape') {
      onSelectNode(null);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      setPan((current) => ({
        x: current.x + (event.key === 'ArrowRight' ? PAN_STEP : event.key === 'ArrowLeft' ? -PAN_STEP : 0),
        y: current.y + (event.key === 'ArrowDown' ? PAN_STEP : event.key === 'ArrowUp' ? -PAN_STEP : 0),
      }));
      setKeyboardFocus(true);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom((value) => Math.min(MAX_ZOOM, value * 1.25));
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      setZoom((value) => Math.max(MIN_ZOOM, value / 1.25));
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      applyFit();
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      onToggleFocus?.();
    }
  }

  // Wheel zoom needs a non-passive listener, otherwise preventDefault is
  // ignored and React logs a passive listener error on every scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => wheelRef.current(event);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const reviewsDue = graph.stats.reviewDue;
  const label = `Practice Brain graph, ${graph.stats.documents} documents in ${graph.stats.sections} sections${reviewsDue > 0 ? `, ${reviewsDue} review${reviewsDue === 1 ? '' : 's'} due` : ''}.`;

  return (
    <div ref={wrapRef} className={cn('relative h-full w-full min-w-0 overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', maxWidth: '100%' }}
        role="img"
        aria-label={label}
        tabIndex={0}
        className={cn('block h-full w-full cursor-grab touch-none outline-none', keyboardFocus && 'ring-1 ring-ring')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          setHovered(null);
          setTooltip(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setKeyboardFocus(false)}
      />

      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 w-60 rounded-lg border border-border bg-card px-3 py-2 text-xs [box-shadow:var(--shadow-floating)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-semibold">{tooltip.title}</p>
          {tooltip.lines.map((line, index) => (
            <p key={`${index}-${line}`} className="text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* View controls, bottom right so they never sit over the hub. */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 [box-shadow:var(--shadow-floating)] backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 transition-transform active:scale-90"
          aria-label="Zoom out"
          onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / 1.3))}
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 transition-transform active:scale-90"
          aria-label="Zoom in"
          onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * 1.3))}
        >
          <Plus className="size-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] transition-transform active:scale-90"
          aria-label="Fit graph to view"
          onClick={applyFit}
        >
          <Frame className="size-3.5" /> Fit
        </Button>
        {onToggleFocus ? (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 transition-transform active:scale-90"
              aria-label={focus ? 'Exit focus mode' : 'Focus on the graph'}
              title={focus ? 'Exit focus (F)' : 'Focus (F)'}
              onClick={onToggleFocus}
            >
              {focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});
