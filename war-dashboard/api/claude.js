'use strict';

/**
 * /api/claude — Vercel serverless function
 * Server-side proxy for Anthropic Claude API.
 * The API key is ONLY available here via process.env — it is NEVER
 * bundled into or exposed in client-side JavaScript.
 */

const VALID_CATEGORIES  = new Set(['all', 'iran', 'gulf', 'usa', 'israel']);
const VALID_PROMPT_TYPES = new Set(['news', 'videos']);
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const NEWS_PROMPTS = {
  all:    'آخر 6 أخبار عاجلة عن التوترات بين إيران ودول الخليج وأمريكا وإسرائيل. أعد JSON فقط بلا markdown: [{"title":"...","summary":"...","category":"iran|gulf|usa|israel","urgency":"high|medium|low","time":"منذ X ساعة"}]',
  iran:   'آخر 6 أخبار عن إيران في التوترات الإقليمية. أعد JSON فقط: [{"title":"...","summary":"...","category":"iran","urgency":"high|medium|low","time":"منذ X ساعة"}]',
  gulf:   'آخر 6 أخبار عن الخليج في التوترات مع إيران. أعد JSON فقط: [{"title":"...","summary":"...","category":"gulf","urgency":"high|medium|low","time":"منذ X ساعة"}]',
  usa:    'آخر 6 أخبار عن أمريكا في الشرق الأوسط. أعد JSON فقط: [{"title":"...","summary":"...","category":"usa","urgency":"high|medium|low","time":"منذ X ساعة"}]',
  israel: 'آخر 6 أخبار عن إسرائيل وإيران. أعد JSON فقط: [{"title":"...","summary":"...","category":"israel","urgency":"high|medium|low","time":"منذ X ساعة"}]',
};

const VIDEO_PROMPTS = {
  all:    '6 فيديوهات يوتيوب حقيقية عن الصراعات في الشرق الأوسط 2024-2025. يوتيوب IDs يجب أن تكون 11 حرفاً حقيقية. أعد JSON فقط: [{"title":"...","description":"...","youtubeId":"REAL_11_CHAR_ID","category":"iran|gulf|usa|israel","duration":"X:XX"}]',
  iran:   '6 فيديوهات يوتيوب حقيقية عن إيران والتوترات 2024-2025. أعد JSON فقط: [{"title":"...","description":"...","youtubeId":"REAL_11_CHAR_ID","category":"iran","duration":"X:XX"}]',
  gulf:   '6 فيديوهات يوتيوب حقيقية عن الخليج والأمن 2024-2025. أعد JSON فقط: [{"title":"...","description":"...","youtubeId":"REAL_11_CHAR_ID","category":"gulf","duration":"X:XX"}]',
  usa:    '6 فيديوهات يوتيوب حقيقية عن أمريكا والشرق الأوسط 2024-2025. أعد JSON فقط: [{"title":"...","description":"...","youtubeId":"REAL_11_CHAR_ID","category":"usa","duration":"X:XX"}]',
  israel: '6 فيديوهات يوتيوب حقيقية عن إسرائيل وإيران 2024-2025. أعد JSON فقط: [{"title":"...","description":"...","youtubeId":"REAL_11_CHAR_ID","category":"israel","duration":"X:XX"}]',
};

// ── Validation / Sanitization ─────────────────────────────────────────────────

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DURATION_RE   = /^\d{1,2}:\d{2}(:\d{2})?$/;

function parseAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = parseAllowedOrigins();

  if (origin) {
    const isAllowed = allowedOrigins.length > 0
      ? allowedOrigins.includes(origin)
      : LOCAL_ORIGIN_RE.test(origin);
    if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function parseJsonArrayStrict(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('EMPTY_TEXT');
  if (!raw.startsWith('[') || !raw.endsWith(']')) throw new Error('NOT_PURE_JSON_ARRAY');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    throw new Error('INVALID_JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('NOT_ARRAY');
  return parsed;
}

function hasOnlyAllowedKeys(item, allowedKeys) {
  return Object.keys(item).every(k => allowedKeys.includes(k));
}

function isStrictNewsShape(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (!hasOnlyAllowedKeys(item, ['title', 'summary', 'category', 'urgency', 'time'])) return false;
  if (typeof item.title !== 'string' || typeof item.summary !== 'string' || typeof item.time !== 'string') return false;
  if (!VALID_CATEGORIES.has(item.category) || item.category === 'all') return false;
  if (!['high', 'medium', 'low'].includes(item.urgency)) return false;
  return true;
}

function isStrictVideoShape(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (!hasOnlyAllowedKeys(item, ['title', 'description', 'youtubeId', 'category', 'duration'])) return false;
  if (typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.youtubeId !== 'string') return false;
  if (typeof item.duration !== 'string') return false;
  if (!VALID_CATEGORIES.has(item.category) || item.category === 'all') return false;
  if (!YOUTUBE_ID_RE.test(item.youtubeId)) return false;
  if (item.duration && !DURATION_RE.test(item.duration)) return false;
  return true;
}

function validateRawItemsStructure(promptType, raw) {
  const shapeValidator = promptType === 'news' ? isStrictNewsShape : isStrictVideoShape;
  for (let i = 0; i < raw.length; i += 1) {
    if (!shapeValidator(raw[i])) {
      throw new Error(`INVALID_ITEM_SHAPE_AT_${i}`);
    }
  }
}

/** Strip HTML tags and truncate. React escapes on render, but we sanitize early. */
function safeStr(val, max) {
  if (typeof val !== 'string') return '';
  return val.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').slice(0, max).trim();
}

function sanitizeNewsItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const cat = (VALID_CATEGORIES.has(item.category) && item.category !== 'all')
    ? item.category : 'iran';
  const urgency = ['high', 'medium', 'low'].includes(item.urgency) ? item.urgency : 'medium';
  const title   = safeStr(item.title, 150);
  if (!title) return null;
  return {
    title,
    summary:  safeStr(item.summary, 500) || '...',
    category: cat,
    urgency,
    time:     safeStr(item.time, 60) || 'منذ قليل',
  };
}

function sanitizeVideoItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (!YOUTUBE_ID_RE.test(item.youtubeId)) return null; // drop invalid IDs
  const cat   = (VALID_CATEGORIES.has(item.category) && item.category !== 'all')
    ? item.category : 'iran';
  const title = safeStr(item.title, 150);
  if (!title) return null;
  return {
    title,
    description: safeStr(item.description, 300),
    youtubeId:   item.youtubeId,  // already validated by regex
    category:    cat,
    duration:    DURATION_RE.test(item.duration) ? item.duration : '',
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Basic security headers on every API response
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body ?? {};
  const { promptType, category } = body;

  // ── Input validation (allow-list only, never trust client) ──────────────────
  if (!VALID_PROMPT_TYPES.has(promptType)) {
    return res.status(400).json({ error: 'نوع طلب غير صالح' });
  }
  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'تصنيف غير صالح' });
  }

  // ── API key — server-side only, never sent to client ────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[/api/claude] ANTHROPIC_API_KEY is not configured');
    return res.status(503).json({ error: 'الخدمة غير متاحة — مفتاح API غير مضبوط على الخادم' });
  }

  const PROMPTS = promptType === 'news' ? NEWS_PROMPTS : VIDEO_PROMPTS;
  const prompt  = PROMPTS[category]; // prompt built server-side, not from user input
  const responseSchemaHint = promptType === 'news'
    ? '[{"title":"string","summary":"string","category":"iran|gulf|usa|israel","urgency":"high|medium|low","time":"string"}]'
    : '[{"title":"string","description":"string","youtubeId":"11-char","category":"iran|gulf|usa|israel","duration":"X:XX"}]';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);

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
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system:     `Return JSON only. No markdown, no prose, no code fences. Output must be exactly one JSON array matching this schema: ${responseSchemaHint}`,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => '');
      console.error(`[/api/claude] Anthropic error ${upstream.status}:`, raw.slice(0, 300));
      return res.status(502).json({
        error: `خطأ في الاتصال بـ AI (${upstream.status}) — حاول مجدداً بعد لحظات`,
      });
    }

    const data = await upstream.json();

    const blocks = Array.isArray(data.content) ? data.content : [];
    const txt = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    let raw = null;
    try {
      raw = parseJsonArrayStrict(txt);
      validateRawItemsStructure(promptType, raw);
    } catch (e) {
      console.error('[/api/claude] Strict JSON validation failed:', e.message,
        '| stop_reason:', data.stop_reason, '| text sample:', txt.slice(0, 300));
      const errMsgMap = {
        EMPTY_TEXT: 'استجابة AI فارغة — حاول مجدداً',
        NOT_PURE_JSON_ARRAY: 'استجابة AI يجب أن تكون JSON فقط بصيغة مصفوفة',
        INVALID_JSON: 'تعذر تحليل JSON من AI — حاول مجدداً',
        NOT_ARRAY: 'صيغة JSON غير صالحة — يجب أن تكون مصفوفة',
      };
      if (e.message.startsWith('INVALID_ITEM_SHAPE_AT_')) {
        return res.status(502).json({ error: 'بنية العناصر غير صالحة في استجابة AI' });
      }
      return res.status(502).json({ error: errMsgMap[e.message] || 'استجابة AI غير متوافقة مع البنية المطلوبة' });
    }

    const sanitize = promptType === 'news' ? sanitizeNewsItem : sanitizeVideoItem;
    const items    = raw.map(sanitize).filter(Boolean);

    if (items.length === 0) {
      return res.status(502).json({ error: 'لم تُعد AI بيانات صالحة — حاول مجدداً' });
    }

    return res.status(200).json({ items });

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error('[/api/claude] Request timed out after 28s');
      return res.status(504).json({ error: 'انتهت مهلة الاتصال بـ AI (28 ث) — حاول مجدداً' });
    }
    console.error('[/api/claude] Unexpected error:', err.message);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
};
