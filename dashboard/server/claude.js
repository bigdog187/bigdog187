import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { toolSchemas, runTool, DASHBOARD_MUTATING_TOOLS } from './tools.js';

const SYSTEM_PROMPT = `You are the assistant inside the Weiley Electrical operations dashboard.
Weiley Electrical is an electrical contractor in Dubbo / Central West NSW.
You answer questions about the business using live data from AroFlo (their job
management system) via the tools provided. You can also reshape the dashboard
itself with the add_widget / remove_widget tools when the user asks.

Guidelines:
- When a question needs data, call the relevant tool rather than guessing.
- Be concise and practical. Lead with the answer, then brief supporting detail.
- Format money as Australian dollars. Use plain text, not tables of markdown
  unless a list is genuinely clearer.
- When the user asks to change the dashboard ("add a widget for...", "show me
  overdue jobs on the dashboard"), call get_dashboard if you need current ids,
  then add_widget / remove_widget. Confirm what you changed in one sentence.`;

const client = config.claude.enabled ? new Anthropic({ apiKey: config.claude.apiKey }) : null;

/**
 * Run a chat turn. Emits events via the `emit(event)` callback so the caller
 * can stream progress to the browser:
 *   { type: 'tool',  name }            a tool is being called
 *   { type: 'text',  text }            assistant text (final answer)
 *   { type: 'reload' }                 the dashboard layout changed
 *   { type: 'done' }                   turn complete
 *   { type: 'error', message }
 *
 * `history` is the prior [{role, content}] messages for context.
 */
export async function chat({ message, history = [], emit }) {
  if (!client) {
    return mockChat({ message, emit });
  }

  const messages = [...history, { role: 'user', content: message }];
  let dashboardChanged = false;

  // Manual tool-use loop.
  for (let step = 0; step < 8; step++) {
    let response;
    try {
      response = await client.messages.create({
        model: config.claude.model,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        tools: toolSchemas(),
        messages,
      });
    } catch (err) {
      emit({ type: 'error', message: String(err.message || err) });
      return { history: messages };
    }

    messages.push({ role: 'assistant', content: response.content });

    // Surface any text the model produced this step.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit({ type: 'text', text: block.text });
      }
    }

    if (response.stop_reason !== 'tool_use') break;

    // Execute every requested tool, collect results.
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      emit({ type: 'tool', name: block.name });
      const result = await runTool(block.name, block.input);
      if (DASHBOARD_MUTATING_TOOLS.has(block.name)) dashboardChanged = true;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (dashboardChanged) emit({ type: 'reload' });
  emit({ type: 'done' });
  // Trim thinking blocks from stored history (not needed for future turns here).
  return { history: messages };
}

/**
 * Run a one-shot prompt (no prior history) and return the final text plus the
 * tools that were called. Used by scheduled "Claude prompt" routines.
 */
export async function runPrompt(message) {
  const parts = [];
  const toolsUsed = [];
  let error = null;
  await chat({
    message,
    history: [],
    emit: (e) => {
      if (e.type === 'text') parts.push(e.text);
      else if (e.type === 'tool') toolsUsed.push(e.name);
      else if (e.type === 'error') error = e.message;
    },
  });
  if (error) throw new Error(error);
  return { text: parts.join('\n\n').trim(), toolsUsed };
}

// ── Mock chat (no API key) ────────────────────────────────────
// Gives believable behaviour so the whole app works before keys are added.
async function mockChat({ message, emit }) {
  const q = message.toLowerCase();
  let name = null;
  if (/overdue|late/.test(q)) name = 'list_jobs';
  else if (/invoice|owed|paid|outstanding/.test(q)) name = 'list_invoices';
  else if (/client|customer/.test(q)) name = 'list_clients';
  else if (/schedule|today|roster/.test(q)) name = 'get_schedule';
  else if (/hour|timesheet/.test(q)) name = 'list_timesheets';
  else name = 'get_metrics';

  emit({ type: 'tool', name });
  const data = await runTool(name, {});
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  emit({
    type: 'text',
    text:
      `*(Demo mode — no Claude key set, so this is a canned response.)*\n\n` +
      `I'd use the **${name}** tool to answer "${message}". It returned ${count} ` +
      `record${count === 1 ? '' : 's'} from AroFlo (mock data). Add your ` +
      `ANTHROPIC_API_KEY to .env to get real, reasoned answers.`,
  });
  emit({ type: 'done' });
  return { history: [] };
}
