'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MESSAGE_LEN = 1_000;
const MAX_CONTEXT_LEN = 12_000;

function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .slice(0, maxLen)
    .trim();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_err) {
    throw new Error('INVALID_JSON');
  }
}

async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_OPENROUTER_KEY');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'war-dashboard',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: 'أنت مساعد تحليلي إخباري. أجب بالعربية بشكل دقيق ومختصر وبأسلوب مهني.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      const details = await upstream.text().catch(() => '');
      console.error('[api/assistant] OpenRouter error:', upstream.status, details.slice(0, 300));
      throw new Error(`UPSTREAM_${upstream.status}`);
    }

    const data = await upstream.json();
    const answer = data?.choices?.[0]?.message?.content;

    if (!answer || typeof answer !== 'string') {
      throw new Error('EMPTY_RESPONSE');
    }

    return answer.trim();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('UPSTREAM_TIMEOUT');
    }
    throw err;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const message = sanitizeText(body?.message, MAX_MESSAGE_LEN);
    const context = sanitizeText(body?.context || '', MAX_CONTEXT_LEN);

    if (!message) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'message required' }));
      return;
    }

    const prompt = context
      ? `السياق الإخباري:\n${context}\n\nالسؤال:\n${message}`
      : message;

    const reply = await callOpenRouter(prompt);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ response: reply }));
  } catch (err) {
    console.error('[api/assistant] error:', err);

    const statusByCode = {
      INVALID_JSON: 400,
      MISSING_OPENROUTER_KEY: 503,
      UPSTREAM_TIMEOUT: 504,
      EMPTY_RESPONSE: 502,
    };

    const messageByCode = {
      INVALID_JSON: 'Malformed JSON body',
      MISSING_OPENROUTER_KEY: 'Assistant API key is not configured',
      UPSTREAM_TIMEOUT: 'Assistant upstream timed out',
      EMPTY_RESPONSE: 'Assistant upstream returned empty response',
    };

    const statusCode = statusByCode[err.message] || (err.message.startsWith('UPSTREAM_') ? 502 : 500);
    const errorMessage = messageByCode[err.message] || 'Internal server error';

    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: errorMessage }));
  }
};
