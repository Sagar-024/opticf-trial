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
import { Frame, Minus, Plus } from 'lucide-react';
import type { BrainGraph, BrainGraphNode } from '@/brain/graph';
import { initialsOf, oklchLightness } from '@/components/canvas/ink';
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
 * pure geometry from buildBrainGraph: hub at the origin, sections in a ring,
 * each section's documents beside it, owners on the outer ring.
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

/** Smallest screen radius each role keeps, so a node never becomes a speck. */
function radiusOf(role: BrainGraphNode['role'], screenR: number): number {
  if (role === 'hub') return Math.max(11, screenR);
  if (role === 'section') return Math.max(7, screenR);
  if (role === 'owner') return Math.max(6, screenR);
  return Math.max(3, screenR);
}

function collides(box: { x: number; y: number; w: number; h: number }, others: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  return others.some(
    (other) =>
      box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y,
  );
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

/** The tiny page glyph inside a document disc: a rounded rect plus two lines. */
function drawPageGlyph(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const w = radius * 0.78;
  const h = radius * 1.04;
  const left = x - w / 2;
  const top = y - h / 2;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(0.8, radius * 0.09);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  roundedRectPath(context, left, top, w, h, Math.min(1.6, w * 0.28));
  context.stroke();
  context.beginPath();
  context.moveTo(left + w * 0.22, top + h * 0.36);
  context.lineTo(left + w * 0.78, top + h * 0.36);
  context.moveTo(left + w * 0.22, top + h * 0.62);
  context.lineTo(left + w * 0.62, top + h * 0.62);
  context.stroke();
  context.restore();
}

/** A tiny coral map pin, marking a document that links to practices. */
function drawPin(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  holeColor: string,
): void {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x - size * 0.85, y + size * 0.75);
  context.lineTo(x + size * 0.85, y + size * 0.75);
  context.lineTo(x, y + size * 2.3);
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(x, y, size, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = holeColor;
  context.beginPath();
  context.arc(x, y, size * 0.38, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** The hub mark: a four point sparkle, two overlapping thin diamonds. */
function drawSparkle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const thin = size * 0.2;
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + thin, y);
  context.lineTo(x, y + size);
  context.lineTo(x - thin, y);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(x - size, y);
  context.lineTo(x, y + thin);
  context.lineTo(x + size, y);
  context.lineTo(x, y - thin);
  context.closePath();
  context.fill();
  context.restore();
}

export const BrainCanvas = forwardRef<BrainCanvasHandle, BrainCanvasProps>(function BrainCanvas(
  { graph, highlighted, selectedId, onSelectNode, practiceName, className },
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
  const structureEdges = useMemo(() => graph.edges.filter((edge) => edge.kind === 'structure'), [graph]);
  const knowledgeEdges = useMemo(() => graph.edges.filter((edge) => edge.kind === 'knowledge'), [graph]);
  const hubNode = useMemo(() => graph.nodes.find((node) => node.role === 'hub') ?? null, [graph]);
  const ownerNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'owner'), [graph]);
  const sectionNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'section'), [graph]);
  const documentNodes = useMemo(() => graph.nodes.filter((node) => node.role === 'document'), [graph]);

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
        const dot = 1.5;
        context.globalAlpha = 0.35;
        context.fillStyle = palette.border;
        for (let ix = firstX; ix <= lastX; ix += 1) {
          for (let iy = firstY; iy <= lastY; iy += 1) {
            context.fillRect(originX + ix * screenStep - dot / 2, originY + iy * screenStep - dot / 2, dot, dot);
          }
        }
        context.globalAlpha = 1;
      }
    }

    // ── Structure edges (solid, under the nodes) ──
    context.lineWidth = 1;
    context.strokeStyle = palette.labelStrong;
    context.setLineDash([]);
    for (const edge of structureEdges) {
      const a = points.get(edge.a);
      const b = points.get(edge.b);
      if (!a || !b) continue;
      const touched = inFocus(edge.a) || inFocus(edge.b);
      context.globalAlpha = touched || !dimming ? 0.5 : palette.dimOpacity;
      context.beginPath();
      context.moveTo(a.x, a.y);
      const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.07;
      const cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.07;
      context.quadraticCurveTo(cx, cy, b.x, b.y);
      context.stroke();
    }

    // ── Knowledge edges (connected knowledge, dotted) ──
    context.lineWidth = 0.9;
    context.setLineDash([3, 4]);
    for (const edge of knowledgeEdges) {
      const a = points.get(edge.a);
      const b = points.get(edge.b);
      if (!a || !b) continue;
      const touched = inFocus(edge.a) || inFocus(edge.b);
      context.globalAlpha = touched || !dimming ? 0.45 : palette.dimOpacity;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
    context.setLineDash([]);

    // ── Discs ──
    const discBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const discBox = (point: ScreenPoint, radius: number): void => {
      discBoxes.push({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 });
    };

    // Owners: people.
    for (const node of ownerNodes) {
      const point = points.get(node.id);
      if (!point || cull(point)) continue;
      const radius = radiusOf('owner', point.r);
      const alpha = alphaOf(node.id);
      discBox(point, radius);
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = palette.hubSurface;
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = palette.hubRing;
      context.globalAlpha = alpha * 0.55;
      context.stroke();
      context.globalAlpha = alpha;
      if (radius >= 7) {
        const lightness = oklchLightness(palette.hubSurface);
        context.save();
        context.font = `600 ${Math.round(radius * 0.85)}px Inter, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = lightness > 0.62 ? 'rgba(15, 17, 20, 0.78)' : 'rgba(255, 255, 255, 0.94)';
        context.fillText(node.initials ?? initialsOf(node.label), point.x, point.y + radius * 0.04);
        context.restore();
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
      context.globalAlpha = alpha * 0.16;
      context.fillStyle = palette.colors.coral;
      context.fill();
      context.globalAlpha = alpha * 0.55;
      context.lineWidth = 1;
      context.strokeStyle = palette.colors.coral;
      context.stroke();
      context.globalAlpha = alpha;
      if (count) {
        context.font = `600 ${Math.round(radius * 0.95)}px Inter, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = palette.labelStrong;
        context.fillText(count, point.x, point.y + radius * 0.04);
      }
    }

    // Documents: white discs with a page glyph and the live flags.
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
      context.fillStyle = palette.hubSurface;
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = palette.border;
      context.stroke();

      if (flags?.conflict) {
        context.globalAlpha = alpha * 0.9;
        context.beginPath();
        context.arc(point.x, point.y, radius + 2.4, 0, Math.PI * 2);
        context.lineWidth = 1.5;
        context.strokeStyle = palette.colors.coral;
        context.stroke();
      }

      if (radius >= 6) {
        context.globalAlpha = alpha * 0.85;
        drawPageGlyph(context, point.x, point.y, radius, palette.label);
      }

      if (flags?.reviewDue) {
        const dotRadius = Math.max(1.6, radius * 0.26);
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(point.x + radius * 0.78, point.y - radius * 0.78, dotRadius, 0, Math.PI * 2);
        context.fillStyle = palette.colors.amber;
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = palette.hubSurface;
        context.stroke();
      }

      if (flags?.practiceLinks && flags.practiceLinks.length > 0) {
        context.globalAlpha = alpha;
        drawPin(
          context,
          point.x - radius * 0.82,
          point.y + radius * 0.82,
          Math.max(1.4, radius * 0.22),
          palette.colors.coral,
          palette.hubSurface,
        );
      }

      if (inFocus(node.id)) {
        const isSelected = selectedId === node.id;
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(point.x, point.y, radius + (isSelected ? 4 : 3), 0, Math.PI * 2);
        context.strokeStyle = isSelected ? palette.colors.coral : palette.hubRing;
        context.lineWidth = isSelected ? 2 : 1;
        context.stroke();
      }
    }

    // The hub, last: the coral centre of the whole graph.
    if (hubNode) {
      const point = points.get(hubNode.id);
      if (point) {
        const radius = radiusOf('hub', point.r);
        const alpha = alphaOf(hubNode.id);
        discBox(point, radius);
        context.globalAlpha = alpha * 0.4;
        context.beginPath();
        context.arc(point.x, point.y, radius + 7, 0, Math.PI * 2);
        context.lineWidth = 1.2;
        context.strokeStyle = palette.colors.coral;
        context.stroke();
        context.globalAlpha = alpha * 0.12;
        context.beginPath();
        context.arc(point.x, point.y, radius + 12, 0, Math.PI * 2);
        context.lineWidth = 5;
        context.stroke();
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = palette.colors.coral;
        context.fill();
        context.lineWidth = 1.4;
        context.strokeStyle = palette.background;
        context.stroke();
        if (inFocus(hubNode.id)) {
          context.beginPath();
          context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
          context.lineWidth = 1;
          context.strokeStyle = selectedId === hubNode.id ? palette.labelStrong : palette.hubRing;
          context.stroke();
        }
        drawSparkle(context, point.x, point.y, radius * 0.5, 'rgba(255, 255, 255, 0.96)');
      }
    }

    // ── Labels ──
    // Placed boxes are kept so a label never lands on one already drawn. Each
    // tries below, above, right, then left. A document label that collides is
    // dropped unless the node is priority (hovered, selected or highlighted).
    const labelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const placeLabel = (
      point: ScreenPoint,
      radius: number,
      alpha: number,
      label: string,
      sub: string | null,
      labelFont: string,
      subFont: string,
      isPriority: boolean,
      avoidDiscs: boolean,
      gap: number,
    ): void => {
      context.font = labelFont;
      const labelWidth = context.measureText(label).width;
      context.font = subFont;
      const subWidth = sub ? context.measureText(sub).width : 0;
      const boxWidth = Math.max(labelWidth, subWidth) + 14;
      const boxHeight = sub ? 31 : 21;
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
      const line1Y = box.y + (sub ? 12 : 14);
      context.globalAlpha = alpha;
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.lineWidth = 4;
      context.strokeStyle = palette.background;
      context.font = labelFont;
      context.strokeText(label, centreX, line1Y);
      context.fillStyle = palette.labelStrong;
      context.fillText(label, centreX, line1Y);
      if (sub) {
        context.font = subFont;
        context.strokeText(sub, centreX, line1Y + 13);
        context.fillStyle = palette.label;
        context.fillText(sub, centreX, line1Y + 13);
      }
    };

    if (hubNode) {
      const point = points.get(hubNode.id);
      if (point) {
        placeLabel(
          point,
          radiusOf('hub', point.r),
          alphaOf(hubNode.id),
          hubNode.label || 'Practice Brain',
          hubNode.sub ?? null,
          '600 13px Inter, sans-serif',
          '400 9px Inter, sans-serif',
          true,
          true,
          12,
        );
      }
    }

    for (const node of [...ownerNodes, ...sectionNodes]) {
      const point = points.get(node.id);
      if (!point) continue;
      placeLabel(
        point,
        radiusOf(node.role, point.r),
        alphaOf(node.id),
        node.label,
        null,
        '600 11px Inter, sans-serif',
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
      const wantsLabel =
        priority ||
        zoom >= 1.1 ||
        Boolean(node.flags?.conflict) ||
        Boolean(node.flags?.reviewDue);
      if (!wantsLabel) continue;
      placeLabel(
        point,
        radiusOf('document', point.r),
        alphaOf(node.id),
        node.label,
        null,
        '450 10px Inter, sans-serif',
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
    knowledgeEdges,
    ownerNodes,
    pan,
    sectionNodes,
    selectedId,
    structureEdges,
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
      </div>
    </div>
  );
});
