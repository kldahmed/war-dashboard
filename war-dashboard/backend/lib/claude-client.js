'use strict';

/**
 * Shared Claude API client for backend services.
 * Uses the server-side ANTHROPIC_API_KEY — never exposed to the browser.
 */

const DEFAULT_MODEL   = 'claude-sonnet-4-20250514';
const DEFAULT_TIMEOUT = 45_000;

/**
 * Call Claude and return the first text block.
 * @param {object} opts
 * @param {string}   opts.system      - System prompt
 * @param {string}   opts.user        - User message
 * @param {number}   [opts.maxTokens] - Max tokens (default 2000)
 * @param {string}   [opts.model]     - Override model
 * @param {number}   [opts.timeoutMs] - Request timeout ms
 * @returns {Promise<{ text: string, model: string, latencyMs: number }>}
 */
async function callClaude({ system, user, maxTokens = 2000, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => '');
      throw new Error(`Anthropic API error ${upstream.status}: ${raw.slice(0, 200)}`);
    }

    const data    = await upstream.json();
    const blocks  = Array.isArray(data.content) ? data.content : [];
    const text    = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const latencyMs = Date.now() - startedAt;

    return { text, model: data.model || model, latencyMs };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

module.exports = { callClaude };
