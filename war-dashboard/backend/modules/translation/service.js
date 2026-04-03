'use strict';

const { query } = require('../../lib/db');
const logger = require('../../lib/logger');
const env = require('../../config/env');

const TRANSLATION_MODEL = 'claude-sonnet-4-20250514';
const TRANSLATION_PROVIDER = 'anthropic';
const FALLBACK_TRANSLATION_PROVIDER = 'google_gtx';

function hasTranslationProvider() {
  return env.translationEnabled && typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseStrictTranslation(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) throw new Error('translation_not_json');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('translation_invalid_shape');
  return {
    translatedTitleAr: sanitizeText(parsed.title_ar, 400),
    translatedSummaryAr: sanitizeText(parsed.summary_ar, 2400),
  };
}

function parseGoogleTranslatePayload(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new Error('translation_fallback_invalid_payload');
  }

  return sanitizeText(
    payload[0]
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
      .join(''),
    2400,
  );
}

async function updateTranslationRecord(normalizedItemId, fields) {
  await query(
    `UPDATE normalized_items
     SET translated_title_ar = $2,
         translated_summary_ar = $3,
         translation_status = $4,
         translation_provider = $5,
         translation_updated_at = NOW(),
         translation_error_message = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      normalizedItemId,
      fields.translatedTitleAr || null,
      fields.translatedSummaryAr || null,
      fields.translationStatus,
      fields.translationProvider || null,
      fields.translationErrorMessage || null,
    ],
  );
}

async function recordAiRun({ normalizedItemId, status, latencyMs, errorMessage }) {
  await query(
    `INSERT INTO ai_runs (service_type, model, input_ref, output_ref, latency_ms, status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      'translation_ar',
      TRANSLATION_MODEL,
      `normalized_item:${normalizedItemId}`,
      `translation_status:${status}`,
      latencyMs,
      status,
      errorMessage || null,
    ],
  );
}

async function requestArabicTranslation({ normalizedItemId, title, summary }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.translationTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        max_tokens: 500,
        system: 'Translate non-Arabic news content into concise modern Arabic. Return pure JSON only: {"title_ar":"...","summary_ar":"..."}. Do not add commentary or markdown.',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Translate this news item to Arabic. Preserve named entities, keep it neutral, and avoid adding facts. Title: ${title}\nSummary: ${summary}`,
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`translation_upstream_${response.status}:${raw.slice(0, 120)}`);
    }

    const body = await response.json();
    const joinedText = Array.isArray(body?.content)
      ? body.content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim()
      : '';
    const parsed = parseStrictTranslation(joinedText);

    if (!parsed.translatedTitleAr || !parsed.translatedSummaryAr) {
      throw new Error('translation_empty_payload');
    }

    const latencyMs = Date.now() - startedAt;
    await recordAiRun({ normalizedItemId, status: 'completed', latencyMs, errorMessage: null });
    return parsed;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    await recordAiRun({ normalizedItemId, status: 'failed', latencyMs, errorMessage: error.message }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestSingleFallbackTranslation(text, maxLength) {
  const sanitized = sanitizeText(text, maxLength);
  if (!sanitized) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.translationTimeoutMs);

  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', 'ar');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', sanitized);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-translation/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`translation_fallback_upstream_${response.status}`);
    }

    return sanitizeText(parseGoogleTranslatePayload(await response.json()), maxLength);
  } finally {
    clearTimeout(timer);
  }
}

async function requestFallbackArabicTranslation({ normalizedItemId, title, summary }) {
  const startedAt = Date.now();

  try {
    const [translatedTitleAr, translatedSummaryAr] = await Promise.all([
      requestSingleFallbackTranslation(title, 400),
      requestSingleFallbackTranslation(summary, 2400),
    ]);

    if (!translatedTitleAr && !translatedSummaryAr) {
      throw new Error('translation_fallback_empty_payload');
    }

    await recordAiRun({
      normalizedItemId,
      status: 'completed',
      latencyMs: Date.now() - startedAt,
      errorMessage: null,
    });

    return {
      translatedTitleAr: translatedTitleAr || sanitizeText(title, 400),
      translatedSummaryAr: translatedSummaryAr || sanitizeText(summary, 2400),
      translationProvider: FALLBACK_TRANSLATION_PROVIDER,
    };
  } catch (error) {
    await recordAiRun({
      normalizedItemId,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorMessage: error.message,
    }).catch(() => {});
    throw error;
  }
}

async function translateNormalizedItem(normalizedItemId, { correlationId = null } = {}) {
  const result = await query(
    `SELECT id, language, original_title, original_summary, translated_title_ar, translated_summary_ar, translation_status
     FROM normalized_items
     WHERE id = $1`,
    [normalizedItemId],
  );

  if (result.rowCount === 0) {
    return { translationStatus: 'missing' };
  }

  const item = result.rows[0];
  const originalTitle = sanitizeText(item.original_title, 400);
  const originalSummary = sanitizeText(item.original_summary, 2400);
  const language = String(item.language || '').toLowerCase();

  if (
    item.translation_status === 'translated'
    && sanitizeText(item.translated_title_ar, 400)
    && sanitizeText(item.translated_summary_ar, 2400)
  ) {
    return { translationStatus: 'translated', translated: false, cached: true };
  }

  if (language.startsWith('ar')) {
    await updateTranslationRecord(normalizedItemId, {
      translationStatus: 'not_required',
      translationProvider: null,
      translationErrorMessage: null,
      translatedTitleAr: null,
      translatedSummaryAr: null,
    });
    return { translationStatus: 'not_required', translated: false };
  }

  if (!originalTitle && !originalSummary) {
    await updateTranslationRecord(normalizedItemId, {
      translationStatus: 'failed',
      translationProvider: TRANSLATION_PROVIDER,
      translationErrorMessage: 'translation_source_empty',
      translatedTitleAr: null,
      translatedSummaryAr: null,
    });
    return { translationStatus: 'failed', translated: false };
  }

  if (!hasTranslationProvider()) {
    try {
      const translated = await requestFallbackArabicTranslation({
        normalizedItemId,
        title: originalTitle,
        summary: originalSummary,
      });

      await updateTranslationRecord(normalizedItemId, {
        translationStatus: 'translated',
        translationProvider: translated.translationProvider,
        translationErrorMessage: null,
        translatedTitleAr: translated.translatedTitleAr,
        translatedSummaryAr: translated.translatedSummaryAr,
      });

      return {
        translationStatus: 'translated',
        translated: true,
        translationProvider: translated.translationProvider,
      };
    } catch (fallbackError) {
      await updateTranslationRecord(normalizedItemId, {
        translationStatus: 'unavailable',
        translationProvider: FALLBACK_TRANSLATION_PROVIDER,
        translationErrorMessage: 'translation_provider_unavailable',
        translatedTitleAr: null,
        translatedSummaryAr: null,
      });
      return { translationStatus: 'unavailable', translated: false, errorMessage: fallbackError.message };
    }
  }

  try {
    const translated = await requestArabicTranslation({
      normalizedItemId,
      title: originalTitle,
      summary: originalSummary,
    });

    await updateTranslationRecord(normalizedItemId, {
      translationStatus: 'translated',
      translationProvider: TRANSLATION_PROVIDER,
      translationErrorMessage: null,
      translatedTitleAr: translated.translatedTitleAr,
      translatedSummaryAr: translated.translatedSummaryAr,
    });

    return {
      translationStatus: 'translated',
      translated: true,
      translationProvider: TRANSLATION_PROVIDER,
    };
  } catch (error) {
    logger.warn('translation_failed', {
      correlationId,
      normalizedItemId,
      message: error.message,
    });

    try {
      const translated = await requestFallbackArabicTranslation({
        normalizedItemId,
        title: originalTitle,
        summary: originalSummary,
      });

      await updateTranslationRecord(normalizedItemId, {
        translationStatus: 'translated',
        translationProvider: translated.translationProvider,
        translationErrorMessage: null,
        translatedTitleAr: translated.translatedTitleAr,
        translatedSummaryAr: translated.translatedSummaryAr,
      });

      return {
        translationStatus: 'translated',
        translated: true,
        translationProvider: translated.translationProvider,
      };
    } catch (fallbackError) {
      await updateTranslationRecord(normalizedItemId, {
        translationStatus: 'failed',
        translationProvider: FALLBACK_TRANSLATION_PROVIDER,
        translationErrorMessage: 'translation_failed',
        translatedTitleAr: null,
        translatedSummaryAr: null,
      });

      return {
        translationStatus: 'failed',
        translated: false,
        translationProvider: FALLBACK_TRANSLATION_PROVIDER,
        errorMessage: fallbackError.message,
      };
    }
  }
}

module.exports = {
  hasTranslationProvider,
  translateNormalizedItem,
};