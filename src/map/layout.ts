import { hashSeed, mulberry32 } from '../lib/prng';

/**
 * Pure map layout. No DOM, no canvas, no React.
 *
 * Deterministic: the same input always produces the same positions, because
 * positions come from a seeded PRNG rather than Math.random. That keeps the
 * demo stable between loads and makes the maths unit testable.
 */

export type MapLevel = 'group' | 'region';

export interface LayoutItem {
  id: string;
  region: string;
  /** Base node radius in graph units. */
  radius: number;
}

export interface LayoutNode {
  id: string;
  region: string;
  regionIndex: number;
  x: number;
  y: number;
  r: number;
}

export interface LayoutHub {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  r: number;
  kind: 'group' | 'region';
  regionIndex?: number;
}

export interface LayoutEdge {
  a: string;
  b: string;
  kind: 'backbone' | 'practice';
  regionIndex: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Layout {
  level: MapLevel;
  regionName: string | null;
  nodes: LayoutNode[];
  hubs: LayoutHub[];
  edges: LayoutEdge[];
  bounds: Bounds;
}

/** Fixed cluster centres at group level, loosely matching the reference. */
const REGION_CENTRES: Array<[number, number]> = [
  [-370, -96],
  [-139, 175],
  [271, -18],
  [464, 200],
  [507, -146],
  [-64, -150],
  [79, -311],
  [-457, 179],
  [-514, -282],
];

const STRETCH = [1.35, 0.85, 1.45, 0.9, 1.05, 1.25, 0.75, 1.1, 1.3];
const ROTATION = [0, 0.93, 1.86, 2.79, 3.72, 4.65, 5.58, 0.47, 1.4];

const GROUP_HUB: Omit<LayoutHub, 'x' | 'y' | 'sub'> = {
  id: 'group',
  label: 'Northstar Group',
  r: 22,
  kind: 'group',
};

function cloud(
  items: LayoutItem[],
  regionIndex: number,
  cx: number,
  cy: number,
  multiplier: number,
  seed: number,
): LayoutNode[] {
  const random = mulberry32((seed ^ hashSeed(`${regionIndex}:${items.length}`)) >>> 0);
  const spread = (38 + Math.sqrt(Math.max(1, items.length)) * 9) * multiplier;
  const stretch = STRETCH[regionIndex % STRETCH.length];
  const rotation = ROTATION[regionIndex % ROTATION.length];

  return items.map((item, index) => {
    const angle = random() * Math.PI * 2;
    const radius = Math.pow(random(), 0.63) * spread;
    const lobe = index % 5 === 0 ? 1.4 : 1;
    let x = Math.cos(angle) * radius * stretch * lobe;
    let y = (Math.sin(angle) * radius) / stretch * 0.79;
    // A gentle bend so clusters look organic rather than perfectly elliptical.
    x += Math.sin((y / spread) * 3 + regionIndex) * spread * 0.25;

    const xx = x * Math.cos(rotation) - y * Math.sin(rotation);
    const yy = x * Math.sin(rotation) + y * Math.cos(rotation);

    return { id: item.id, region: item.region, regionIndex, x: cx + xx, y: cy + yy, r: item.radius };
  });
}

/** Push overlapping practice nodes apart, within a region, and keep a clear
 *  ring around each region hub so the hub never disappears under its cluster. */
function relax(nodes: LayoutNode[], hubs: LayoutHub[] = [], steps = 44): void {
  const hubByRegion = new Map<number, LayoutHub>();
  for (const hub of hubs) {
    if (hub.regionIndex !== undefined) hubByRegion.set(hub.regionIndex, hub);
  }

  for (let step = 0; step < steps; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.regionIndex !== b.regionIndex) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = 0.1;
          dy = 0.1;
          distance = 0.1414;
        }
        const min = 13 + (a.r + b.r) * 1.35;
        if (distance < min) {
          const shift = (min - distance) * 0.52;
          a.x -= (dx / distance) * shift;
          a.y -= (dy / distance) * shift;
          b.x += (dx / distance) * shift;
          b.y += (dy / distance) * shift;
        }
      }
    }

    for (const node of nodes) {
      const hub = hubByRegion.get(node.regionIndex);
      if (!hub) continue;
      let dx = node.x - hub.x;
      let dy = node.y - hub.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        // Deterministic escape direction, so the layout stays reproducible.
        dx = node.id.length % 2 === 0 ? 0.1 : -0.1;
        dy = 0.1;
        distance = 0.1414;
      }
      const min = hub.r + node.r + 10;
      if (distance < min) {
        const push = (min - distance) * 0.55;
        node.x += (dx / distance) * push;
        node.y += (dy / distance) * push;
      }
    }
  }
}

/** Keep region clusters from colliding with each other. */
function separateRegions(nodes: LayoutNode[], hubs: LayoutHub[], gap = 48): void {
  const boundsOf = (regionIndex: number): Bounds => {
    const hub = hubs.find((h) => h.regionIndex === regionIndex)!;
    const members = nodes.filter((n) => n.regionIndex === regionIndex);
    const xs = [hub.x, ...members.map((n) => n.x)];
    const ys = [hub.y, ...members.map((n) => n.y)];
    const rs = [hub.r, ...members.map((n) => n.r)];
    return {
      minX: Math.min(...xs.map((x, i) => x - rs[i])),
      maxX: Math.max(...xs.map((x, i) => x + rs[i])),
      minY: Math.min(...ys.map((y, i) => y - rs[i])),
      maxY: Math.max(...ys.map((y, i) => y + rs[i])),
    };
  };

  const move = (regionIndex: number, dx: number, dy: number) => {
    const hub = hubs.find((h) => h.regionIndex === regionIndex)!;
    hub.x += dx;
    hub.y += dy;
    for (const node of nodes) {
      if (node.regionIndex === regionIndex) {
        node.x += dx;
        node.y += dy;
      }
    }
  };

  const indices = hubs.map((h) => h.regionIndex!).filter((value) => value !== undefined);

  for (let step = 0; step < 160; step += 1) {
    let shifted = false;

    for (const i of indices) {
      const a = boundsOf(i);
      const overlapX = Math.min(a.maxX, 78) - Math.max(a.minX, -78) + gap / 2;
      const overlapY = Math.min(a.maxY, 78) - Math.max(a.minY, -52) + gap / 2;
      if (overlapX > 0 && overlapY > 0) {
        const cx = (a.minX + a.maxX) / 2;
        const cy = (a.minY + a.maxY) / 2;
        if (overlapX < overlapY) move(i, (cx >= 0 ? 1 : -1) * (overlapX + 1), 0);
        else move(i, 0, (cy >= 0 ? 1 : -1) * (overlapY + 1));
        shifted = true;
      }

      for (const j of indices) {
        if (j <= i) continue;
        const a2 = boundsOf(i);
        const b = boundsOf(j);
        const overX = Math.min(a2.maxX, b.maxX) - Math.max(a2.minX, b.minX) + gap;
        const overY = Math.min(a2.maxY, b.maxY) - Math.max(a2.minY, b.minY) + gap;
        if (overX > 0 && overY > 0) {
          const dirX = a2.minX + a2.maxX < b.minX + b.maxX ? -1 : 1;
          const dirY = a2.minY + a2.maxY < b.minY + b.maxY ? -1 : 1;
          if (overX < overY) {
            move(i, (dirX * (overX + 1)) / 2, 0);
            move(j, (-dirX * (overX + 1)) / 2, 0);
          } else {
            move(i, 0, (dirY * (overY + 1)) / 2);
            move(j, 0, (-dirY * (overY + 1)) / 2);
          }
          shifted = true;
        }
      }
    }

    if (!shifted) break;
  }
}

/** Keep region clusters out of the middle, so the group hub owns the centre. */
function clearCentre(nodes: LayoutNode[], hubs: LayoutHub[], minDistance = 190): void {
  for (const hub of hubs) {
    if (hub.kind !== 'region') continue;
    const members = nodes.filter((node) => node.regionIndex === hub.regionIndex);
    let nearest = Math.hypot(hub.x, hub.y) - hub.r;
    for (const node of members) {
      nearest = Math.min(nearest, Math.hypot(node.x, node.y) - node.r);
    }
    if (nearest >= minDistance) continue;
    const push = minDistance - nearest;
    const length = Math.hypot(hub.x, hub.y) || 1;
    const dx = (hub.x / length) * push;
    const dy = (hub.y / length) * push;
    hub.x += dx;
    hub.y += dy;
    for (const node of members) {
      node.x += dx;
      node.y += dy;
    }
  }
}

function boundsOfNodes(nodes: LayoutNode[], hubs: LayoutHub[]): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const node of nodes) {
    xs.push(node.x - node.r, node.x + node.r);
    ys.push(node.y - node.r, node.y + node.r);
  }
  for (const hub of hubs) {
    xs.push(hub.x - hub.r, hub.x + hub.r);
    ys.push(hub.y - hub.r, hub.y + hub.r);
  }
  if (xs.length === 0) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Round to half pixels and guarantee finite numbers. */
function normalise(nodes: LayoutNode[], hubs: LayoutHub[]): void {
  for (const node of nodes) {
    node.x = Number.isFinite(node.x) ? Math.round(node.x * 2) / 2 : 0;
    node.y = Number.isFinite(node.y) ? Math.round(node.y * 2) / 2 : 0;
  }
  for (const hub of hubs) {
    hub.x = Number.isFinite(hub.x) ? Math.round(hub.x * 2) / 2 : 0;
    hub.y = Number.isFinite(hub.y) ? Math.round(hub.y * 2) / 2 : 0;
  }
}

/** Compute the layout for a level of the map. */
export function computeLayout(
  level: MapLevel,
  regionName: string | null,
  items: LayoutItem[],
  seed = 20261012,
): Layout {
  const regionNames = [...new Set(items.map((item) => item.region))].sort();

  if (level === 'region' && regionName) {
    const regionItems = items.filter((item) => item.region === regionName);
    const hub: LayoutHub = {
      id: `region-${regionName}`,
      label: regionName,
      sub: `${regionItems.length} practices`,
      x: 0,
      y: 0,
      r: 20,
      kind: 'region',
      regionIndex: 0,
    };
    const nodes = cloud(regionItems, 0, 0, 0, 2, seed);
    relax(nodes, [hub]);
    normalise(nodes, [hub]);
    const edges: LayoutEdge[] = nodes.map((node) => ({
      a: hub.id,
      b: node.id,
      kind: 'practice',
      regionIndex: 0,
    }));
    return { level, regionName, nodes, hubs: [hub], edges, bounds: boundsOfNodes(nodes, [hub]) };
  }

  const hubs: LayoutHub[] = [{
    ...GROUP_HUB,
    x: 0,
    y: 0,
    sub: `${items.length} practices, ${regionNames.length} regions`,
  }];

  const allNodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  regionNames.forEach((name, index) => {
    const [cx, cy] = REGION_CENTRES[index % REGION_CENTRES.length];
    const regionItems = items.filter((item) => item.region === name);
    const hubRadius = 9 + Math.sqrt(Math.max(1, regionItems.length)) * 1.1;
    hubs.push({
      id: `region-${name}`,
      label: name,
      sub: `${regionItems.length} practices`,
      x: cx,
      y: cy,
      r: hubRadius,
      kind: 'region',
      regionIndex: index,
    });
    edges.push({ a: 'group', b: `region-${name}`, kind: 'backbone', regionIndex: index });
    allNodes.push(...cloud(regionItems, index, cx, cy, 1, seed));
  });

  relax(allNodes, hubs.filter((hub) => hub.kind === 'region'));
  separateRegions(allNodes, hubs.filter((hub) => hub.kind === 'region'));
  clearCentre(allNodes, hubs.filter((hub) => hub.kind === 'region'));
  normalise(allNodes, hubs);

  for (const node of allNodes) {
    edges.push({ a: `region-${node.region}`, b: node.id, kind: 'practice', regionIndex: node.regionIndex });
  }

  return { level, regionName: null, nodes: allNodes, hubs, edges, bounds: boundsOfNodes(allNodes, hubs) };
}

export interface Viewport {
  width: number;
  height: number;
  /** Reserved space around the graph, in CSS pixels. */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit the graph into the visible area, leaving room for the toolbar and panel.
 * Uses the bounding box centre as the anchor, so the result is symmetric and
 * survives a single-node graph (where the box has zero size).
 */
export function computeFit(bounds: Bounds, viewport: Viewport, padding = 40): Fit {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  const availableWidth = Math.max(40, viewport.width - viewport.left - viewport.right - padding * 2);
  const availableHeight = Math.max(40, viewport.height - viewport.top - viewport.bottom - padding * 2);

  const scale = Math.max(0.05, Math.min(availableWidth / width, availableHeight / height));

  const focusX = viewport.left + padding + availableWidth / 2;
  const focusY = viewport.top + padding + availableHeight / 2;

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;

  return {
    scale,
    offsetX: focusX - centreX * scale,
    offsetY: focusY - centreY * scale,
  };
}

/** Nearest node to a screen point, or null when nothing is close enough. */
export function nearestNode(
  nodes: LayoutNode[],
  x: number,
  y: number,
  project: (node: LayoutNode) => { x: number; y: number; r: number },
  tolerance = 18,
): LayoutNode | null {
  let best: LayoutNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const point = project(node);
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance <= Math.max(6, point.r + 4) + tolerance && distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/** Bounds of a subset of nodes, used to fly to a highlight set. */
export function boundsOfSubset(nodes: LayoutNode[], ids: string[]): Bounds | null {
  const set = new Set(ids);
  const subset = nodes.filter((node) => set.has(node.id));
  if (subset.length === 0) return null;
  return boundsOfNodes(subset, []);
}
