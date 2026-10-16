/**
 * Throwaway: does the real chat runner stream reasoning, tools and deltas in
 * the same order the UI would receive them? Run with npx tsx.
 */
export {};

process.loadEnvFile('.env.local');

const { runChatStream } = await import('../src/ai/chat');

const counts = { delta: 0, reasoning: 0, tool: 0, widgets: 0 };
const first: Record<string, string> = {};

const started = Date.now();
await runChatStream(
  { messages: [{ role: 'user', content: 'How is Chorlton doing this month?' }] } as never,
  {
    onDelta: (text) => {
      counts.delta += 1;
      if (!first.delta) first.delta = `${Date.now() - started}ms ${JSON.stringify(text.slice(0, 60))}`;
    },
    onReasoning: (text) => {
      counts.reasoning += 1;
      if (!first.reasoning) first.reasoning = `${Date.now() - started}ms ${JSON.stringify(text.slice(0, 80))}`;
    },
    onTool: (record) => {
      counts.tool += 1;
      console.log('tool:', record.name, '::', record.detail ?? '(no detail)');
      if (!first.tool) first.tool = `${Date.now() - started}ms ${record.name} :: ${record.detail ?? '(no detail)'}`;
    },
    onWidgets: () => {
      counts.widgets += 1;
    },
  },
);

console.log('first events:', first);
console.log('counts:', counts, 'total', Date.now() - started, 'ms');
