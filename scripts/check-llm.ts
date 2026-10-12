/**
 * LLM connectivity check.
 *
 *   npm run llm:check
 *
 * 1. GET {LLM_BASE_URL}/models with the Bearer key, printing status + model IDs
 *    only (never the key). If the configured base URL fails, it tries the
 *    documented alternative and reports which one works.
 * 2. Sends one tiny chat completion with a single dummy tool to confirm the
 *    endpoint supports OpenAI-style tool calling.
 *
 * No retries. The API key is never printed or logged.
 */
import { existsSync, readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { llmSessionHeaders } from '../src/ai/llm';

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

const PRIMARY = 'https://opencode.ai/zen/go/v1';
const ALTERNATIVE = 'https://opencode.ai/inference/openai/v1';

function normalize(url: string): string {
  return url.replace(/\/+$/, '');
}

async function listModels(baseURL: string, apiKey: string): Promise<{ status: number; ids: string[] }> {
  try {
    const response = await fetch(`${normalize(baseURL)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, ...llmSessionHeaders() },
    });
    let ids: string[] = [];
    if (response.ok) {
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      ids = (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
    return { status: response.status, ids };
  } catch (error) {
    return { status: -1, ids: [] };
  }
}

async function checkToolCalling(baseURL: string, apiKey: string, model: string): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL: normalize(baseURL), ...(Object.keys(llmSessionHeaders()).length > 0 ? { defaultHeaders: llmSessionHeaders() } : {}) });
  console.log(`  model: ${model}`);
  console.log('  sending one chat completion with a single dummy tool…');
  const response = await client.chat.completions.create({
    model,
    max_tokens: 64,
    tools: [
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'Echo a message back. Call this when asked.',
          parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        },
      },
    ],
    tool_choice: 'auto',
    messages: [{ role: 'user', content: 'Call the echo tool with message "ping". Do not answer in prose.' }],
  });
  const calls = response.choices[0]?.message?.tool_calls ?? [];
  if (calls.length === 0) {
    console.log('  result: NO tool_call returned - tool calling is NOT working as expected.');
    return;
  }
  const call = calls[0];
  const name = call.type === 'function' ? call.function.name : '?';
  const args = call.type === 'function' ? call.function.arguments : '';
  console.log(`  result: tool_calls -> ${name}(${args})  [PASS]`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const line = '─'.repeat(72);
  const apiKey = process.env.LLM_API_KEY;
  const configured = process.env.LLM_BASE_URL;
  const model = process.env.MODEL_NAME;

  console.log(`\n${line}\nLLM connectivity check\n${line}`);

  if (!apiKey) {
    console.log('\n  LLM_API_KEY is not set. Add it to .env.local (see below).');
    console.log(`${line}\n`);
    return;
  }

  const candidates = [configured, PRIMARY, ALTERNATIVE]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index);

  console.log('\nModels endpoint:');
  let working: { baseURL: string; ids: string[] } | null = null;
  for (const baseURL of candidates) {
    const { status, ids } = await listModels(baseURL, apiKey);
    const note = status === 401 ? ' (401 unauthorised)' : status === 403 ? ' (403 forbidden)' : status === 404 ? ' (404 not found)' : status === 429 ? ' (429 rate limited)' : '';
    console.log(`  ${baseURL}/models -> ${status === -1 ? 'network error' : status}${note}`);
    if (ids.length > 0) {
      console.log(`    ${ids.length} models: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ' …' : ''}`);
      if (!working) working = { baseURL, ids };
    }
  }

  if (!working) {
    console.log('\n  No base URL returned a model list. Check the key and LLM_BASE_URL.');
    console.log(`${line}\n`);
    return;
  }

  const chosenModel = model || working.ids[0];
  if (!model) console.log(`\n  MODEL_NAME not set - using the first listed model: ${chosenModel}`);

  console.log('\nTool calling:');
  try {
    await checkToolCalling(working.baseURL, apiKey, chosenModel);
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : 'unknown error';
    console.log(`  result: FAILED${status ? ` (${status})` : ''} - ${message}`);
  }

  console.log(`\n${line}`);
  console.log('Put this in .env.local (no quotes):\n');
  console.log(`  LLM_BASE_URL=${normalize(working.baseURL)}`);
  console.log('  LLM_API_KEY=<your key>');
  console.log(`  MODEL_NAME=${chosenModel}`);
  console.log(`\n${line}\n`);
}

main().catch((error) => {
  console.error('llm:check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
