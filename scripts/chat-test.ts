/**
 * Chat API test harness.
 *
 *   npm run chat:test          # against the real OpenAI-compatible endpoint
 *   npm run chat:test -- --mock  # deterministic mock transport (no key)
 *
 * Real mode requires .env.local with LLM_BASE_URL, LLM_API_KEY, MODEL_NAME.
 * The API key is never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runChat } from '../src/ai/chat';
import { getDataset } from '../src/ai/dataset';
import { monthsOf } from '../src/data/index';
import { LlmError, type LlmClient, type LlmMessage, type LlmResponse } from '../src/ai/llm';
import type { ChatContext } from '../src/ai/types';

function loadEnvLocal(): void {
  const path = '.env.local';
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

/** Deterministic mock transport implementing the same LlmClient interface. */
function makeMockClient(): LlmClient {
  const months = monthsOf(getDataset());
  const to = months[months.length - 1];
  const from = months[months.length - 2];

  const pick = (text: string): { tool: string; input: Record<string, unknown> } => {
    const q = text.toLowerCase();
    if (/dashboard/.test(q)) return { tool: 'build_dashboard', input: { metrics: ['revenue', 'conversion'], group_by: 'group' } };
    if (/revenue drop|biggest/.test(q)) return { tool: 'compare', input: { metric: 'revenue', group_by: 'practice', period_a: { from: to, to }, period_b: { from, to: from }, limit: 5 } };
    if (/compare.*north west|north west.*other/.test(q)) return { tool: 'compare', input: { metric: 'revenue', group_by: 'region', period_a: { from: to, to }, period_b: { from, to: from } } };
    if (/north west/.test(q)) return { tool: 'query_metrics', input: { regions: ['North West'] } };
    if (/contact lens/.test(q)) return { tool: 'below_cl_target', input: {} };
    if (/training|completed/.test(q)) return { tool: 'training_status', input: {} };
    if (/map/.test(q)) return { tool: 'highlight_on_map', input: { practice_ids: [] } };
    if (/attention|focus/.test(q)) return { tool: 'rank_attention', input: { limit: 5 } };
    return { tool: 'today_priorities', input: {} };
  };

  return {
    async chat({ messages }: { model: string; messages: LlmMessage[]; tools: unknown[] }): Promise<LlmResponse> {
      const last = messages[messages.length - 1];
      if (last.role === 'tool') {
        const summaries = messages
          .filter((m) => m.role === 'tool')
          .map((m) => {
            try {
              return JSON.parse(String(m.content)).summary as string;
            } catch {
              return '';
            }
          });
        return { text: `Based on the data - ${summaries.join(' ')}`, toolCalls: [], finishReason: 'stop' };
      }
      const userText = typeof last.content === 'string' ? last.content : '';
      const { tool, input } = pick(userText);
      return { text: '', toolCalls: [{ id: 'call_mock_1', name: tool, arguments: JSON.stringify(input) }], finishReason: 'tool_calls' };
    },
  };
}

interface Scenario {
  title: string;
  turns: string[];
}

const SCENARIOS: Scenario[] = [
  { title: '1. Dashboard: revenue + conversion', turns: ['Create a dashboard showing revenue and conversion across the group this month.'] },
  { title: '2. Biggest revenue drop vs last month', turns: ['Which practices have had the biggest revenue drop compared with last month?'] },
  { title: '3. Compare North West with other regions (+ follow-up)', turns: ['Compare the North West with the other regions.', 'Break that down by practice'] },
  { title: '4. Contact lens sales by practice (+ follow-up)', turns: ['Show me contact lens sales by practice.', 'Only show the North West'] },
  { title: '5. Training not completed', turns: ["Which practices haven't completed their training?"] },
  { title: '6. Most attention + evidence', turns: ['Which practices need the most attention, and what in the data suggests that?'] },
  { title: '7. Show those on the map', turns: ['Which practices need the most attention, and what in the data suggests that?', 'Show those practices on the map.'] },
  { title: '8. Why did North West revenue drop? (must say data does not explain)', turns: ['Why did North West revenue drop?'] },
];

const line = '─'.repeat(76);

interface TurnTiming {
  scenario: string;
  turn: string;
  ms: number;
  calls: number;
  widgets: number;
}

async function runScenario(scenario: Scenario, client: LlmClient, model?: string): Promise<TurnTiming[]> {
  console.log(`\n${line}\n${scenario.title}\n${line}`);
  let context: ChatContext | null = null;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const timings: TurnTiming[] = [];

  for (const turn of scenario.turns) {
    messages.push({ role: 'user', content: turn });
    console.log(`\n> ${turn}`);
    const started = Date.now();
    const result = await runChat({ messages, context, client, model });
    const ms = result.durationMs || Date.now() - started;

    const calls = result.toolCalls.map((c) => {
      const flag = c.malformed ? ' MALFORMED-ARGS' : '';
      return `${c.name}[${c.widgetTypes.join(',')}]${flag}`;
    });
    console.log(`  tool calls (${result.toolCalls.length}, ${result.iterations} iter): ${calls.length ? calls.join('  ') : '(none)'}`);
    console.log(`  widgets: ${result.widgets.length}`);
    for (const widget of result.widgets) console.log(`      · ${widget.type.padEnd(6)} ${widget.title}`);
    console.log(`  mapHighlight: [${result.mapHighlight.join(', ')}]`);
    console.log(`  flagged: ${result.flagged ?? false}`);
    console.log(`  time: ${(ms / 1000).toFixed(1)}s`);
    console.log(`  text: ${result.text.replace(/\s+/g, ' ').slice(0, 700)}${result.text.length > 700 ? '…' : ''}`);

    timings.push({ scenario: scenario.title, turn, ms, calls: result.toolCalls.length, widgets: result.widgets.length });
    messages.push({ role: 'assistant', content: result.text });
    context = result.context;
  }
  return timings;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const mock = process.argv.includes('--mock');

  if (!mock) {
    const missing = ['LLM_BASE_URL', 'LLM_API_KEY', 'MODEL_NAME'].filter((key) => !process.env[key]);
    if (missing.length > 0) {
      console.log(`\n${line}\nChat test could not run against the real endpoint.`);
      console.log(`  Missing: ${missing.join(', ')}`);
      console.log('\nCreate .env.local in the project root:');
      console.log('  LLM_BASE_URL=https://opencode.ai/zen/go/v1');
      console.log('  LLM_API_KEY=<your key>');
      console.log('  MODEL_NAME=<model id, e.g. deepseek-v4.1-flash>');
      console.log('\nThen run:  npm run llm:check   (confirms the endpoint + tool calling)');
      console.log('           npm run chat:test');
      console.log(`${line}\n`);
      return;
    }
  }

  console.log(mock
    ? `\n${line}\nMOCK transport - verifies the tool loop, widgets, guard and context (no API key).\n${line}`
    : `\n${line}\nREAL endpoint - ${process.env.LLM_BASE_URL} · model ${process.env.MODEL_NAME}\n${line}`);

  const client = mock ? makeMockClient() : undefined;
  const model = mock ? 'mock' : undefined;

  const timings: TurnTiming[] = [];
  for (const scenario of SCENARIOS) {
    try {
      timings.push(...(await runScenario(scenario, client as LlmClient, model)));
    } catch (error) {
      if (error instanceof LlmError) {
        console.log(`\n  STOPPED: ${error.message}${error.status ? ` (${error.status})` : ''}`);
        process.exitCode = 1;
        printTimings(timings);
        return; // no retry loops
      }
      throw error;
    }
  }

  printTimings(timings);
  console.log(`\n${line}\nDone.\n${line}`);
}

function printTimings(timings: TurnTiming[]): void {
  console.log(`\n${line}\nTiming per answer (target under ~15s)\n${line}`);
  let total = 0;
  let max = 0;
  for (const t of timings) {
    total += t.ms;
    max = Math.max(max, t.ms);
    const flag = t.ms > 15000 ? '  <-- over 15s' : '';
    console.log(`  ${(t.ms / 1000).toFixed(1).padStart(5)}s  calls=${String(t.calls).padStart(2)} widgets=${String(t.widgets).padStart(2)}  ${t.turn.slice(0, 46)}${flag}`);
  }
  console.log(`  total ${(total / 1000).toFixed(1)}s over ${timings.length} answers · slowest ${(max / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error('chat-test failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
