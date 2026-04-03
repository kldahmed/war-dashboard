'use strict';

const { randomUUID } = require('node:crypto');
const { query }      = require('../../lib/db');
const logger         = require('../../lib/logger');
const { callClaude } = require('../../lib/claude-client');

/* ── Constants ──────────────────────────────────────────────────── */
const ARTICLES_FOR_BRIEFING = 25;
const DIGEST_COOLDOWN_MIN   = 25;   // never generate more often than this
const ESCALATION_LEVELS     = new Set(['low', 'medium', 'high', 'critical']);

const SYSTEM_PROMPT = `أنت محلل استخباراتي متخصص في شؤون الشرق الأوسط والجيوسياسة.
مهمتك: تحليل مجموعة من الأخبار الفعلية المُختارة بعناية وكتابة تقرير موقف استخباراتي (SITREP) موجز ودقيق.

قواعد صارمة:
- أعد JSON فقط — بلا markdown، بلا نص خارج الـ JSON.
- استند فقط إلى الأخبار المُقدَّمة؛ لا تخترع أحداثاً.
- كن محدداً: اذكر الأطراف والمواقع بدقة.
- مستوى التصعيد: low | medium | high | critical فقط.

Schema المطلوب (بالضبط):
{
  "headline": "string — عنوان موجز للحالة الراهنة (أقل من 120 حرف)",
  "escalation_level": "low|medium|high|critical",
  "situation_summary": "string — ملخص استخباراتي 3-4 جمل بالعربية",
  "key_actors": [
    { "name": "string", "role": "string", "latest_action": "string" }
  ],
  "active_fronts": [
    { "front": "string", "status": "string", "trend": "escalating|stable|de-escalating" }
  ],
  "contradictions": [
    { "topic": "string", "version_a": "string", "source_a": "string", "version_b": "string", "source_b": "string" }
  ]
}`;

/* ── Helpers ────────────────────────────────────────────────────── */
function safeParseDigest(text) {
  const raw = text.trim();
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON_OBJECT');
  const parsed = JSON.parse(raw.slice(start, end + 1));

  // Validate and sanitise fields
  const escalation = ESCALATION_LEVELS.has(parsed.escalation_level)
    ? parsed.escalation_level : 'medium';

  return {
    headline:           String(parsed.headline          || '').slice(0, 200),
    escalation_level:   escalation,
    situation_summary:  String(parsed.situation_summary || '').slice(0, 2000),
    key_actors:         Array.isArray(parsed.key_actors)     ? parsed.key_actors.slice(0, 8)  : [],
    active_fronts:      Array.isArray(parsed.active_fronts)  ? parsed.active_fronts.slice(0, 6) : [],
    contradictions:     Array.isArray(parsed.contradictions) ? parsed.contradictions.slice(0, 5) : [],
  };
}

async function isOnCooldown() {
  const res = await query(`
    SELECT generated_at FROM intelligence_digests
    ORDER BY generated_at DESC LIMIT 1
  `);
  if (res.rowCount === 0) return false;
  const last = new Date(res.rows[0].generated_at).getTime();
  return (Date.now() - last) < DIGEST_COOLDOWN_MIN * 60 * 1000;
}

async function fetchTopArticles() {
  const res = await query(`
    SELECT
      ni.id,
      COALESCE(ni.translated_title_ar, ni.original_title, ni.canonical_title) AS title,
      COALESCE(ni.translated_summary_ar, ni.original_summary)                  AS summary,
      ni.published_at_source,
      ni.category,
      ni.translation_status,
      ni.category_confidence_score AS confidence_score,
      s.name        AS source_name,
      s.trust_score,
      COALESCE(sc.item_count - 1, 0) AS corroboration_count
    FROM normalized_items ni
    JOIN sources s ON s.id = ni.source_id
    LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
    LEFT JOIN story_clusters sc ON sc.id = ce.cluster_id
    WHERE ni.status = 'ready'
      AND ni.published_at_source > NOW() - INTERVAL '6 hours'
    ORDER BY
      (COALESCE(s.trust_score, 50) / 100.0
       + COALESCE(sc.item_count, 1) * 0.05
       + CASE ni.category WHEN 'breaking' THEN 0.3 WHEN 'war' THEN 0.2 ELSE 0 END
      ) DESC,
      ni.published_at_source DESC
    LIMIT $1
  `, [ARTICLES_FOR_BRIEFING]);

  return res.rows;
}

function buildUserPrompt(articles) {
  const lines = articles.map((a, i) => {
    const trust   = a.trust_score  ? `[ثقة: ${Math.round(a.trust_score)}%]` : '';
    const corr    = Number(a.corroboration_count || 0) > 0 ? `[${a.corroboration_count} مصادر داعمة]` : '';
    const cat     = a.category || '';
    const summary = a.summary ? `\n   الملخص: ${String(a.summary).slice(0, 150)}` : '';
    return `${i + 1}. [${cat}] ${trust}${corr}\n   ${a.title}${summary}\n   المصدر: ${a.source_name}`;
  });

  return `أحدث ${articles.length} خبر عالي الثقة (آخر 6 ساعات):\n\n${lines.join('\n\n')}\n\nاكتب تقرير الموقف الآن:`;
}

/* ── Main entry ─────────────────────────────────────────────────── */
async function generateSitrep({ correlationId = randomUUID(), force = false } = {}) {
  // Cooldown guard
  if (!force && await isOnCooldown()) {
    logger.info('sitrep:skipped:cooldown', { correlationId });
    return null;
  }

  const articles = await fetchTopArticles();
  if (articles.length < 3) {
    logger.info('sitrep:skipped:insufficient_data', { correlationId, count: articles.length });
    return null;
  }

  logger.info('sitrep:start', { correlationId, article_count: articles.length });

  const userPrompt = buildUserPrompt(articles);
  const { text, model, latencyMs } = await callClaude({
    system:    SYSTEM_PROMPT,
    user:      userPrompt,
    maxTokens: 1800,
    timeoutMs: 45_000,
  });

  const digest      = safeParseDigest(text);
  const sourceIds   = articles.map(a => a.id);

  const insertRes = await query(`
    INSERT INTO intelligence_digests
      (escalation_level, headline, situation_summary, key_actors, active_fronts,
       contradictions, source_item_ids, model, latency_ms, correlation_id)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
    RETURNING id, generated_at
  `, [
    digest.escalation_level,
    digest.headline,
    digest.situation_summary,
    JSON.stringify(digest.key_actors),
    JSON.stringify(digest.active_fronts),
    JSON.stringify(digest.contradictions),
    JSON.stringify(sourceIds),
    model,
    latencyMs,
    correlationId,
  ]);

  const row = insertRes.rows[0];
  logger.info('sitrep:done', { correlationId, id: row.id, escalation: digest.escalation_level, latencyMs });

  return { id: row.id, generated_at: row.generated_at, latencyMs, ...digest };
}

async function getLatestSitrep() {
  const res = await query(`
    SELECT id, generated_at, escalation_level, headline, situation_summary,
           key_actors, active_fronts, contradictions, latency_ms
    FROM intelligence_digests
    ORDER BY generated_at DESC
    LIMIT 1
  `);
  return res.rowCount > 0 ? res.rows[0] : null;
}

module.exports = { generateSitrep, getLatestSitrep };
