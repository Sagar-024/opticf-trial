/**
 * Shared types for the chat layer.
 *
 * Tools return widgets directly. The server collects them and the model only
 * writes prose - it never authors chart numbers.
 */

export type WidgetType = 'kpi' | 'chart' | 'table';

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
}

export interface KpiWidget {
  type: 'kpi';
  id: string;
  title: string;
  items: KpiItem[];
}

export interface ChartPoint {
  label: string;
  value: number;
  /** Pre-formatted value for the axis/tooltip. */
  display: string;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

export interface ChartWidget {
  type: 'chart';
  id: string;
  title: string;
  chart: 'bar' | 'grouped-bar' | 'line';
  valueType: 'currency' | 'percent' | 'number';
  series: ChartSeries[];
}

export interface TableWidget {
  type: 'table';
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
}

export type Widget = KpiWidget | ChartWidget | TableWidget;

/** The analytical context carried between turns so follow-ups work. */
export interface ChatContext {
  metric?: string;
  group_by?: string;
  filters: {
    regions?: string[];
    practiceIds?: string[];
  };
  period: { month?: string; from?: string; to?: string };
  practiceIds: string[];
}

export interface ChatResponse {
  text: string;
  widgets: Widget[];
  mapHighlight: string[];
  context: ChatContext;
  /** Human-readable data sources behind the answer. */
  sources: string[];
  /** True when the answer failed one of the guards. */
  flagged?: boolean;
  /** Which guard fired, so the interface can say something specific. */
  flagReason?: 'leak' | 'ungrounded' | 'numbers';
  /** True when an untraceable figure meant the answer had to be withdrawn. */
  withdrawn?: boolean;
}

/** Internal: what a tool returns to the server (never sent raw to the model). */
export interface ToolOutput {
  /** Compact, pre-formatted summary the model may quote. */
  summary: string;
  widgets: Widget[];
  mapHighlight?: string[];
  context?: Partial<ChatContext>;
  /** Every literal number string this tool produced, for the guard. */
  numbers: string[];
  /** Human-readable data sources behind this tool's output. */
  sources?: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  widgetTypes: WidgetType[];
  mapHighlight: string[];
  /** True when the model sent arguments that were not valid JSON. */
  malformed?: boolean;
  error?: string;
}
