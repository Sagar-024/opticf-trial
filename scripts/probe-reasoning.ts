/**
 * Throwaway: what fields does the provider actually stream in each delta?
 * Prints the union of delta keys and a sample of any reasoning text.
 */
export {};

process.loadEnvFile('.env.local');

const base = process.env.LLM_BASE_URL ?? '';
const key = process.env.LLM_API_KEY ?? '';
const model = process.env.MODEL_NAME ?? '';

const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'x-opencode-session': process.env.LLM_SESSION ?? 'probe-session',
  },
  body: JSON.stringify({
    model,
    stream: true,
    max_tokens: 200,
    messages: [{ role: 'user', content: 'Which practices need attention? Think briefly, then answer in one sentence.' }],
  }),
});

if (!res.body) {
  console.log('no body', res.status);
  process.exit(0);
}

console.log('status:', res.status, 'type:', res.headers.get('content-type'));

const reader = res.body.getReader();
const decoder = new TextDecoder();
const keys = new Set<string>();
let reasoningSample = '';
let buffer = '';
let raw = '';
let chunks = 0;

while (chunks < 60) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value, { stream: true });
  if (raw.length < 400) raw += text;
  buffer += text;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      chunks = 999;
      break;
    }
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: Record<string, unknown> }> };
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      chunks += 1;
      for (const k of Object.keys(delta)) keys.add(k);
      const reasoning = delta['reasoning_content'];
      if (typeof reasoning === 'string' && reasoningSample.length < 300) reasoningSample += reasoning;
    } catch {
      // partial line; ignore
    }
  }
}

console.log('delta keys seen:', [...keys].join(', ') || '(none)');
console.log('reasoning sample:', JSON.stringify(reasoningSample.slice(0, 300)));
console.log('raw sample:', JSON.stringify(raw.slice(0, 400)));
console.log('model:', model);
