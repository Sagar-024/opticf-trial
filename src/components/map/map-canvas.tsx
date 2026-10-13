'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Frame, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { MapPractice, MapModel } from '@/data/map-model';
import {
  boundsOfSubset,
  computeFit,
  computeFlyTo,
  computeLayout,
  nearestNode,
  type Bounds,
  type LayoutNode,
  type MapLevel,
} from '@/map/layout';
import type { Lens } from '@/map/lenses';
import { tooltipLines } from '@/map/lenses';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readPalette, type Palette } from './palette';

/**
 * The map canvas. Ported from the reference visual, fed from our data layer.
 *
 * The draw loop measures the DOM directly and keeps the transform in a ref, so
 * painting never depends on React state settling first. Positions come from the
 * pure seeded layout, and the palette is read once per theme change.
 */

export interface MapCanvasProps {
  model: MapModel;
  lens: Lens;
  level: MapLevel;
  regionName: string | null;
  highlighted: string[];
  matches: (practice: MapPractice) => boolean;
  selectedId: string | null;
  onSelect: (practiceId: string | null) => void;
  onDrillRegion: (region: string) => void;
  onReset: () => void;
  /** Practice ids to label without hovering (the current focus list). */
  emphasised?: string[];
  /** Immersive mode toggle, shown in the zoom cluster. */
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

// The toolbar, legend and focus strip are separate rows, not overlays, so the
// fit only needs room for the floating zoom cluster at the bottom. Kept tight
// on purpose: every pixel reserved here shrinks the whole graph.
const VIEWPORT_PADDING = { top: 14, right: 20, bottom: 56, left: 20 };
const FIT_PADDING = 22;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

export function MapCanvas({
  model,
  lens,
  level,
  regionName,
  highlighted,
  matches,
  selectedId,
  onSelect,
  onDrillRegion,
  onReset,
  emphasised,
  focus = false,
  onToggleFocus,
  className,
}: MapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 });
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);

  const paletteRef = useRef<Palette | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  const byId = useMemo(() => new Map(model.practices.map((p) => [p.practiceId, p])), [model.practices]);

  const items = useMemo(() => {
    const revenues = model.practices.map((practice) => practice.revenue);
    const min = Math.min(...revenues);
    const max = Math.max(...revenues);
    const span = max - min;
    return model.practices.map((practice) => {
      // Normalise revenue across the group so size actually communicates it:
      // roughly 6 to 15 graph units, so the largest is about 2.5x the smallest.
      const t = span > 0 ? (practice.revenue - min) / span : 0.5;
      return {
        id: practice.practiceId,
        region: practice.region,
        radius: 6 + Math.pow(t, 0.75) * 9,
      };
    });
  }, [model.practices]);

  const layout = useMemo(() => computeLayout(level, regionName, items), [level, regionName, items]);
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  /** Screen position of a layout node. Reads the live transform. */
  const project = useCallback(
    (node: LayoutNode) => {
      const { scale, offsetX, offsetY } = transformRef.current;
      return {
        x: offsetX + node.x * scale * zoom + pan.x,
        y: offsetY + node.y * scale * zoom + pan.y,
        r: node.r * scale * zoom,
      };
    },
    [zoom, pan],
  );

  // ── Palette follows the theme ─────────────────────────────────────────────
  useEffect(() => {
    paletteRef.current = readPalette();
    const observer = new MutationObserver(() => {
      paletteRef.current = readPalette();
      invalidateRef.current?.();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setHovered(null);
    setTooltip(null);
  }, [level, regionName]);

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
    // A drilled region is capped, otherwise ten practices balloon into discs on a
    // large screen. The full group has enough spread that no cap is needed.
    const fit = computeFit(
      layout.bounds,
      { width, height, ...VIEWPORT_PADDING },
      FIT_PADDING,
      level === 'region' ? 1.15 : undefined,
    );
    transformRef.current = { scale: fit.scale, offsetX: fit.offsetX, offsetY: fit.offsetY, width, height };

    const screen = (node: LayoutNode) => ({
      x: fit.offsetX + node.x * fit.scale * zoom + pan.x,
      y: fit.offsetY + node.y * fit.scale * zoom + pan.y,
      r: node.r * fit.scale * zoom,
    });

    const highlightActive = highlightSet.size > 0;
    const hubIds = new Set(layout.hubs.map((hub) => hub.id));
    const hubPoints = new Map(
      layout.hubs.map((hub) => [hub.id, screen(hub as unknown as LayoutNode)]),
    );
    const nodePoints = new Map(layout.nodes.map((node) => [node.id, screen(node)]));

    // ── Region territories ──
    // A soft neutral disc under each cluster. This is what turns a cloud of
    // dots into readable places. In a drilled region there is only one cluster,
    // so the disc would just be a wash over the whole canvas: skipped there.
    if (level !== 'region') {
      const grouped = new Map<number, Array<{ x: number; y: number; r: number }>>();
      for (const node of layout.nodes) {
        const point = nodePoints.get(node.id);
        if (!point) continue;
        const list = grouped.get(node.regionIndex);
        if (list) list.push(point);
        else grouped.set(node.regionIndex, [point]);
      }
      for (const points of grouped.values()) {
        const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        const spread = Math.max(...points.map((point) => Math.hypot(point.x - cx, point.y - cy) + point.r)) + 16;
        context.globalAlpha = highlightActive ? 0.20 : 0.42;
        context.beginPath();
        context.arc(cx, cy, spread, 0, Math.PI * 2);
        context.fillStyle = palette.border;
        context.fill();
      }
      context.globalAlpha = 1;
    }

    // ── Edges ──
    context.lineWidth = 0.7;
    for (const edge of layout.edges) {
      const a = hubPoints.get(edge.a) ?? nodePoints.get(edge.a);
      const b = hubPoints.get(edge.b) ?? nodePoints.get(edge.b);
      if (!a || !b) continue;

      const touched = highlightActive && (highlightSet.has(edge.a) || highlightSet.has(edge.b));
      const practice = byId.get(edge.b);
      const dimmedByFilter = practice ? !matches(practice) : false;
      // Practice links are the connective tissue of the graph: faint enough to
      // stay behind the nodes, strong enough to see on a dark canvas.
      context.globalAlpha = dimmedByFilter || (highlightActive && !touched) ? 0.06 : edge.kind === 'backbone' ? 0.55 : 0.3;
      context.strokeStyle = palette.border;
      context.setLineDash(edge.kind === 'practice' ? [3, 4] : []);
      context.beginPath();
      context.moveTo(a.x, a.y);
      if (edge.kind === 'backbone') {
        const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.09;
        const cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.09;
        context.quadraticCurveTo(cx, cy, b.x, b.y);
      } else {
        context.lineTo(b.x, b.y);
      }
      context.stroke();
    }
    context.setLineDash([]);

    // ── Practices ──
    const nodeBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const node of layout.nodes) {
      const practice = byId.get(node.id);
      const point = nodePoints.get(node.id);
      if (!practice || !point) continue;
      if (point.x < -60 || point.x > width + 60 || point.y < -60 || point.y > height + 60) continue;

      const visual = lens.visual(practice);
      const inHighlight = !highlightActive || highlightSet.has(node.id);
      const inFilter = matches(practice);
      const isSelected = selectedId === node.id;
      const isHovered = hovered === node.id;

      let alpha = visual.opacity;
      if (!inFilter) alpha = Math.min(alpha, palette.dimOpacity);
      if (!inHighlight) alpha = Math.min(alpha, palette.dimOpacity);
      // Never let a node become an unreadable speck. The fit cap keeps a
      // drilled region from blowing the radius up on a large screen.
      const radius = Math.max(3.5, point.r * visual.sizeFactor);
      nodeBoxes.push({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 });

      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = palette.colors[visual.colorKey];
      context.fill();

      // Large discs get a background-coloured edge so they read as drawn marks
      // rather than flat blobs.
      if (radius >= 10) {
        context.lineWidth = 1.5;
        context.strokeStyle = palette.background;
        context.stroke();
      }

      if (inFilter && (isSelected || isHovered || (highlightActive && inHighlight))) {
        context.strokeStyle = isSelected ? palette.colors.coral : palette.hubRing;
        context.lineWidth = isSelected ? 2 : 1;
        context.beginPath();
        context.arc(point.x, point.y, radius + (isSelected ? 4 : 3), 0, Math.PI * 2);
        context.stroke();
      }
    }

    // ── Hubs and their labels ──
    const labelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const hub of layout.hubs) {
      const point = hubPoints.get(hub.id);
      if (!point) continue;
      const isGroup = hub.kind === 'group';
      const radius = Math.max(isGroup ? 12 : 7, point.r);

      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
      context.strokeStyle = palette.hubRing;
      context.lineWidth = 0.8;
      context.stroke();

      context.globalAlpha = 1;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = isGroup ? palette.hubSurface : palette.colors.chart2;
      context.fill();
      context.lineWidth = 1.2;
      context.strokeStyle = isGroup ? palette.hubRing : palette.background;
      context.stroke();

      if (isGroup) {
        context.beginPath();
        context.arc(point.x, point.y, radius * 0.18, 0, Math.PI * 2);
        context.fillStyle = palette.colors.coral;
        context.fill();
      }

      // Label placement: try below, above, right, left. The first position that
      // clears every box already placed wins, so region names never stack. The
      // group label also avoids practice nodes, because it sits over the busiest
      // part of the graph where its fixed pixel size matters most.
      const gap = isGroup ? 12 : 9;
      context.font = `600 ${isGroup ? 13 : 11}px ${'Inter, sans-serif'}`;
      const labelWidth = context.measureText(hub.label).width;
      context.font = `400 9px ${'Inter, sans-serif'}`;
      const subWidth = context.measureText(hub.sub).width;
      const boxWidth = Math.max(labelWidth, subWidth) + 14;
      const boxHeight = 30;
      const options = [
        { x: point.x - boxWidth / 2, y: point.y + radius + gap },
        { x: point.x - boxWidth / 2, y: point.y - radius - gap - boxHeight },
        { x: point.x + radius + gap, y: point.y - boxHeight / 2 },
        { x: point.x - radius - gap - boxWidth, y: point.y - boxHeight / 2 },
      ];
      const obstacles = isGroup ? [...labelBoxes, ...nodeBoxes] : labelBoxes;
      const collides = (box: { x: number; y: number }): boolean =>
        obstacles.some((other) =>
          box.x < other.x + other.w && box.x + boxWidth > other.x && box.y < other.y + other.h && box.y + boxHeight > other.y,
        );
      const chosen = options.find((box) => !collides(box)) ?? options[0];
      labelBoxes.push({ ...chosen, w: boxWidth, h: boxHeight });

      const centreX = chosen.x + boxWidth / 2;
      const line1Y = chosen.y + 11;
      context.textAlign = 'center';
      context.lineWidth = 4;
      context.strokeStyle = palette.background;
      context.strokeText(hub.label, centreX, line1Y);
      context.fillStyle = palette.labelStrong;
      context.fillText(hub.label, centreX, line1Y);
      context.font = `400 9px ${'Inter, sans-serif'}`;
      context.strokeText(hub.sub, centreX, line1Y + 12);
      context.fillStyle = palette.label;
      context.fillText(hub.sub, centreX, line1Y + 12);
    }

    // Hub circles join the collision map, so a practice label can never be
    // drawn across a hub, only beside it.
    for (const hub of layout.hubs) {
      const point = hubPoints.get(hub.id);
      if (!point) continue;
      const isGroup = hub.kind === 'group';
      const radius = Math.max(isGroup ? 12 : 7, point.r) + 2;
      labelBoxes.push({ x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 });
    }

    // ── Practice labels: the important ones are always on ──
    const emphasisedSet = new Set(emphasised ?? []);
    const labelCandidates = layout.nodes.filter((node) => {
      const point = nodePoints.get(node.id);
      if (!point) return false;
      const isPriority =
        selectedId === node.id ||
        hovered === node.id ||
        emphasisedSet.has(node.id) ||
        (highlightActive && highlightSet.has(node.id));
      // Every practice once you zoom in a little, every practice in a drilled
      // region (there are only a handful, and names are the whole point there),
      // otherwise the key ones.
      return isPriority || zoom >= 1.15 || level === 'region';
    });

    for (const node of labelCandidates) {
      const practice = byId.get(node.id);
      const point = nodePoints.get(node.id);
      if (!practice || !point) continue;
      const priority = selectedId === node.id || hovered === node.id;

      context.font = `450 9px ${'Inter, sans-serif'}`;
      context.textAlign = 'center';
      const text = practice.name;
      const textWidth = context.measureText(text).width;
      const y = point.y + point.r + 12;
      const box = { x: point.x - textWidth / 2 - 5, y: y - 10, w: textWidth + 10, h: 25 };
      const collides = labelBoxes.some(
        (other) => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y,
      );
      if (collides && !priority) continue;
      labelBoxes.push(box);

      context.globalAlpha = 1;
      context.lineWidth = 4;
      context.strokeStyle = palette.background;
      context.strokeText(text, point.x, y);
      context.fillStyle = palette.labelStrong;
      context.fillText(text, point.x, y);

      context.font = `400 8px ${'Inter, sans-serif'}`;
      const sub = lens.valueLabel(practice);
      context.strokeText(sub, point.x, y + 11);
      context.fillStyle = palette.label;
      context.fillText(sub, point.x, y + 11);
    }

    context.globalAlpha = 1;
  }, [byId, emphasised, highlightSet, hovered, layout, lens, matches, pan, selectedId, zoom]);

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

  // A small hook so the renderer can be verified from a test or the console.
  useEffect(() => {
    const target = window as unknown as { __opticfMapRedraw?: () => void };
    target.__opticfMapRedraw = () => draw();
    return () => {
      delete target.__opticfMapRedraw;
    };
  }, [draw]);

  // Keep a live pointer so the theme observer can trigger a repaint.
  const invalidateRef = useRef<(() => void) | null>(null);
  invalidateRef.current = invalidate;

  // Paint synchronously after every state change. Waiting for a frame made
  // zooming feel laggy, and requestAnimationFrame is suspended while the tab is
  // hidden, which could freeze the canvas entirely.
  useLayoutEffect(() => {
    draw();
  }, [draw]);

  // Redraw whenever the element is resized (container size, sidebar toggle, tab switch).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => invalidate());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [invalidate]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // ── Interaction ───────────────────────────────────────────────────────────
  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const findNode = useCallback(
    (x: number, y: number) => nearestNode(layout.nodes, x, y, project),
    [layout.nodes, project],
  );

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = pointFromEvent(event);
    dragRef.current = { x: point.x, y: point.y, panX: pan.x, panY: pan.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
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
    const practice = node ? byId.get(node.id) : null;
    if (practice) {
      const { width, height } = transformRef.current;
      const lines = tooltipLines(practice, lens);
      setTooltip({
        x: Math.min(Math.max(8, width - 240), Math.max(8, point.x + 16)),
        y: Math.min(Math.max(8, height - 96), Math.max(8, point.y + 16)),
        title: practice.name,
        lines,
      });
    } else {
      setTooltip(null);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
    const current = dragRef.current;
    dragRef.current = null;
    if (!current || current.moved) return;

    const point = pointFromEvent(event);
    for (const hub of layout.hubs) {
      const hubPoint = project(hub as unknown as LayoutNode);
      if (Math.hypot(point.x - hubPoint.x, point.y - hubPoint.y) <= Math.max(26, hubPoint.r + 8)) {
        if (hub.kind === 'group') onReset();
        else onDrillRegion(hub.label);
        return;
      }
    }

    const node = findNode(point.x, point.y);
    onSelect(node ? node.id : null);
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>): void {
    const step = 260;
    if (event.key === 'Escape') {
      if (level === 'region') onReset();
      else onSelect(null);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      setPan((current) => ({
        x: current.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        y: current.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
      }));
      setKeyboardFocus(true);
      return;
    }
    if (event.key === 'Enter' && selectedId) {
      const practice = byId.get(selectedId);
      if (practice && level === 'group') onDrillRegion(practice.region);
    }
    if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(MAX_ZOOM, value * 1.25));
    if (event.key === '-') setZoom((value) => Math.max(MIN_ZOOM, value / 1.25));
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

  // ── Fly to a highlighted set (a chat answer, or a Where to focus card) ────
  useEffect(() => {
    if (highlightSet.size === 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const { scale, offsetX, offsetY, width, height } = transformRef.current;
    if (width === 0 || height === 0) return;
    const bounds: Bounds | null = boundsOfSubset(layout.nodes, [...highlightSet]);
    if (!bounds) return;

    // One practice is a dot: filling the canvas with it would slam to the zoom
    // ceiling and lose all context, so a single highlight stops at 2.5x and the
    // practice lands with its region around it.
    const flyTo = computeFlyTo(
      bounds,
      { scale, offsetX, offsetY, width, height },
      VIEWPORT_PADDING,
      { minZoom: MIN_ZOOM, maxZoom: highlightSet.size === 1 ? 2.5 : MAX_ZOOM },
    );
    setZoom(flyTo.zoom);
    setPan({ x: flyTo.panX, y: flyTo.panY });
    // Only when the highlight set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...highlightSet].join(',')]);

  const label =
    level === 'region' && regionName
      ? `${regionName}: ${layout.nodes.length} practices`
      : `Northstar Group: ${model.practices.length} practices across ${model.regions.length} regions`;

  return (
    <div ref={wrapRef} className={cn('relative h-full w-full min-w-0 overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', maxWidth: '100%' }}
        role="img"
        aria-label={`Interactive organisation map. ${label}.`}
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
          className="pointer-events-none absolute z-10 w-56 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-soft"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-semibold">{tooltip.title}</p>
          {tooltip.lines.map((line, index) => (
            <p key={`${index}-${line}`} className="text-muted-foreground">{line}</p>
          ))}
        </div>
      ) : null}

      {/* View controls, bottom centre so they are always easy to find. */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-soft backdrop-blur">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 transition-transform active:scale-90" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / 1.3))}>
          <Minus className="size-3.5" />
        </Button>
        <span className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 transition-transform active:scale-90" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * 1.3))}>
          <Plus className="size-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] transition-transform active:scale-90"
          aria-label="Fit graph to view"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <Frame className="size-3.5" /> Fit
        </Button>
        {onToggleFocus ? (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <Button
              variant={focus ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px] transition-transform active:scale-90"
              aria-label={focus ? 'Exit focus mode' : 'Enter focus mode'}
              title={focus ? 'Exit focus mode (Esc)' : 'Full screen graph'}
              onClick={() => onToggleFocus()}
            >
              {focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              {focus ? 'Exit focus' : 'Focus'}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
