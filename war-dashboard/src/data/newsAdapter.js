const DEFAULT_LIMIT = 20;
const ALLOWED_CATEGORIES = new Set(["all", "iran", "gulf", "usa", "israel"]);
const ALLOWED_URGENCY = new Set(["high", "medium", "low"]);
const GENERIC_STORED_ERROR = "stored_feed_unavailable";

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === "true";
}

function normalizeText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeIsoTime(value, fallback = "منذ قليل") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsedMs = new Date(trimmed).getTime();
  if (Number.isNaN(parsedMs)) return fallback;
  return new Date(parsedMs).toISOString();
}

function normalizeCategory(item) {
  const rawCategory = normalizeText(item?.category, "").toLowerCase();
  if (ALLOWED_CATEGORIES.has(rawCategory)) return rawCategory;
  if (rawCategory === "general" || rawCategory === "official") {
    const sourceDomain = normalizeText(item?.source?.domain, "").toLowerCase();
    if (sourceDomain.includes("state.gov")) return "usa";
    return "all";
  }

  const sourceCategory = normalizeText(item?.source?.category, "").toLowerCase();
  if (ALLOWED_CATEGORIES.has(sourceCategory)) return sourceCategory;

  const sourceDomain = normalizeText(item?.source?.domain, "").toLowerCase();
  if (sourceDomain.includes("state.gov")) return "usa";
  return "all";
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  const normalized = {
    ...source,
    id: source.id ?? null,
    name: normalizeText(source.name, null),
    domain: normalizeText(source.domain, null),
    trust_score: source.trust_score ?? null,
  };
  return normalized;
}

function normalizeProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") return null;

  const cluster = provenance.cluster && typeof provenance.cluster === "object"
    ? {
        id: provenance.cluster.id ?? null,
        corroboration_count: Number.isFinite(Number(provenance.cluster.corroboration_count)) ? Number(provenance.cluster.corroboration_count) : 0,
        source_diversity: Number.isFinite(Number(provenance.cluster.source_diversity)) ? Number(provenance.cluster.source_diversity) : 0,
        contradiction_flag: Boolean(provenance.cluster.contradiction_flag),
      }
    : {
        id: null,
        corroboration_count: 0,
        source_diversity: 0,
        contradiction_flag: false,
      };

  const verification = provenance.verification && typeof provenance.verification === "object"
    ? {
        state: normalizeText(provenance.verification.state, "single_source"),
        confidence_score: Number.isFinite(Number(provenance.verification.confidence_score)) ? Number(provenance.verification.confidence_score) : null,
      }
    : {
        state: "single_source",
        confidence_score: null,
      };

  const editorial = provenance.editorial && typeof provenance.editorial === "object"
    ? {
        decision: normalizeText(provenance.editorial.decision, "publish"),
        priority: normalizeText(provenance.editorial.priority, "normal"),
        rank_score: Number.isFinite(Number(provenance.editorial.rank_score)) ? Number(provenance.editorial.rank_score) : 0,
      }
    : {
        decision: "publish",
        priority: "normal",
        rank_score: 0,
      };

  return {
    ...provenance,
    raw_item_id: provenance.raw_item_id ?? null,
    source_feed_id: provenance.source_feed_id ?? null,
    source_url: normalizeText(provenance.source_url, null),
    fetched_at: normalizeText(provenance.fetched_at, null),
    published_at_source: normalizeText(provenance.published_at_source, null),
    normalized_hash: normalizeText(provenance.normalized_hash, null),
    cluster,
    verification,
    editorial,
  };
}

function buildApiPath(pathname, query = {}) {
  const parts = [];
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(rawValue))}`);
  }

  if (parts.length === 0) return pathname;
  return `${pathname}?${parts.join("&")}`;
}

function buildAgeSec(isoTime) {
  if (!isoTime) return null;
  const ts = new Date(isoTime).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function normalizeStoredMetadata(body, mode) {
  const freshness = body?.freshness && typeof body.freshness === "object"
    ? {
        latest_item_at: body.freshness.latest_item_at || null,
        oldest_item_at: body.freshness.oldest_item_at || null,
        data_age_sec: Number.isFinite(body.freshness.data_age_sec) ? body.freshness.data_age_sec : buildAgeSec(body.freshness.latest_item_at),
        last_ingestion_at: body.freshness.last_ingestion_at || null,
      }
    : {
        latest_item_at: null,
        oldest_item_at: null,
        data_age_sec: null,
        last_ingestion_at: null,
      };

  return {
    mode,
    fallback_used: toBool(body?.fallback_used, false),
    item_count: Number.isFinite(body?.item_count) ? body.item_count : (Array.isArray(body?.items) ? body.items.length : 0),
    freshness,
    correlation_id: body?.correlation_id || null,
    error_reason: normalizeText(body?.error_reason, null),
    verify_mode: toBool(process.env.REACT_APP_PRODUCTION_VERIFY_MODE, false),
  };
}

function buildStoredRequestError(reason) {
  const error = new Error(GENERIC_STORED_ERROR);
  error.code = GENERIC_STORED_ERROR;
  error.reason = normalizeText(reason, GENERIC_STORED_ERROR);
  return error;
}

export function resolveFeedMode({ mode, fallbackEnabled = true } = {}) {
  const verifyProductionMode = toBool(process.env.REACT_APP_PRODUCTION_VERIFY_MODE, false);
  const normalizedMode = String(mode || process.env.REACT_APP_FEED_MODE || "legacy").toLowerCase();
  const fallback = toBool(
    fallbackEnabled !== undefined ? fallbackEnabled : process.env.REACT_APP_FEED_FALLBACK,
    true,
  );
  const normalizedResolvedMode = normalizedMode === "stored" ? "stored" : "legacy";

  return {
    mode: normalizedResolvedMode,
    // Verification mode disables silent fallback while validating stored path in production.
    fallbackEnabled: verifyProductionMode && normalizedResolvedMode === "stored" ? false : fallback,
    verifyProductionMode,
  };
}

async function callLegacyNews(category, signal) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptType: "news", category }),
    signal,
  });
  if (!res.ok) {
    throw new Error("legacy_feed_unavailable");
  }
  const body = await res.json();
  if (!Array.isArray(body.items)) throw new Error("Legacy feed response is invalid");
  return body.items;
}

async function callLegacyNewsEnvelope(category, signal, context = {}) {
  const items = await callLegacyNews(category, signal);
  return {
    items,
    metadata: {
      mode: context.mode || "legacy",
      fallback_used: toBool(context.fallbackUsed, false),
      item_count: items.length,
      freshness: {
        latest_item_at: null,
        oldest_item_at: null,
        data_age_sec: null,
        last_ingestion_at: null,
      },
      correlation_id: context.correlationId || null,
      error_reason: context.errorReason || null,
      verify_mode: toBool(process.env.REACT_APP_PRODUCTION_VERIFY_MODE, false),
    },
  };
}

function mapStoredItem(item) {
  return {
    id: item?.id ?? null,
    title: normalizeText(item?.title, "Untitled"),
    summary: normalizeText(item?.summary, "..."),
    category: normalizeCategory(item),
    urgency: ALLOWED_URGENCY.has(item?.urgency) ? item.urgency : "medium",
    time: normalizeIsoTime(item?.time),
    source: normalizeSource(item?.source),
    provenance: normalizeProvenance(item?.provenance),
  };
}

async function callStoredNews(category, signal, limit = DEFAULT_LIMIT) {
  const requestUrl = buildApiPath("/api/news/feed", {
    limit,
    category,
  });

  let res;
  try {
    res = await fetch(requestUrl, { signal });
  } catch (error) {
    const requestError = buildStoredRequestError("stored_feed_request_failed");
    requestError.cause = error;
    requestError.feedMeta = normalizeStoredMetadata({
      mode: "stored",
      fallback_used: false,
      item_count: 0,
      freshness: {
        latest_item_at: null,
        oldest_item_at: null,
        data_age_sec: null,
        last_ingestion_at: null,
      },
      correlation_id: null,
        error_reason: "stored_feed_request_failed",
    }, "stored");
    throw requestError;
  }

  const correlationId = res.headers.get("x-correlation-id") || null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = buildStoredRequestError(body?.error_reason || body?.error || `stored_feed_http_${res.status}`);
    error.feedMeta = normalizeStoredMetadata({ ...body, correlation_id: body?.correlation_id || correlationId }, "stored");
    throw error;
  }

  const body = await res.json();
  if (!Array.isArray(body.items)) throw buildStoredRequestError("stored_feed_invalid_shape");
  return {
    items: body.items.map(mapStoredItem).filter(Boolean),
    metadata: normalizeStoredMetadata({ ...body, correlation_id: body?.correlation_id || correlationId }, "stored"),
  };
}

export async function fetchNewsFeedEnvelope(category, signal) {
  const { mode, fallbackEnabled, verifyProductionMode } = resolveFeedMode();
  if (mode === "legacy") {
    return callLegacyNewsEnvelope(category, signal, {
      mode: "legacy",
      fallbackUsed: false,
      errorReason: null,
    });
  }

  try {
    return await callStoredNews(category, signal);
  } catch (error) {
    if (!fallbackEnabled) {
      const feedMeta = error?.feedMeta || {
        mode: "stored",
        fallback_used: false,
        item_count: 0,
        freshness: { latest_item_at: null, oldest_item_at: null, data_age_sec: null, last_ingestion_at: null },
        correlation_id: null,
        error_reason: error.reason || error.code || GENERIC_STORED_ERROR,
        verify_mode: verifyProductionMode,
      };
      error.feedMeta = { ...feedMeta, error_reason: feedMeta.error_reason || error.reason || error.code || GENERIC_STORED_ERROR };
      throw error;
    }

    return callLegacyNewsEnvelope(category, signal, {
      mode: "legacy",
      fallbackUsed: true,
      errorReason: error?.reason || error?.code || GENERIC_STORED_ERROR,
      correlationId: error?.feedMeta?.correlation_id || null,
    });
  }
}

export async function fetchNewsItems(category, signal) {
  const envelope = await fetchNewsFeedEnvelope(category, signal);
  return envelope.items;
}

export const __testing = {
  buildApiPath,
  mapStoredItem,
};
