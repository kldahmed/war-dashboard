const DEFAULT_LIMIT = 20;

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === "true";
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
    error_reason: body?.error_reason || null,
    verify_mode: toBool(process.env.REACT_APP_PRODUCTION_VERIFY_MODE, false),
  };
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
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Legacy feed failed (${res.status})`);
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
  const sourceCategory = item?.source?.domain?.includes("state.gov") ? "usa" : null;
  const category = item?.category && item.category !== "general" ? item.category : (sourceCategory || "all");
  return {
    title: typeof item?.title === "string" ? item.title : "Untitled",
    summary: typeof item?.summary === "string" ? item.summary : "...",
    category,
    urgency: ["high", "medium", "low"].includes(item?.urgency) ? item.urgency : "medium",
    time: typeof item?.time === "string" ? item.time : "منذ قليل",
    source: item?.source || null,
    provenance: item?.provenance || null,
  };
}

async function callStoredNews(category, signal, limit = DEFAULT_LIMIT) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (category) params.set("category", category);

  const res = await fetch(`/api/news/feed?${params.toString()}`, { signal });
  const correlationId = res.headers.get("x-correlation-id") || null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Stored feed failed (${res.status})`);
    error.feedMeta = normalizeStoredMetadata({ ...body, correlation_id: body?.correlation_id || correlationId }, "stored");
    throw error;
  }

  const body = await res.json();
  if (!Array.isArray(body.items)) throw new Error("Stored feed response is invalid");
  return {
    items: body.items.map(mapStoredItem),
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
        error_reason: error.message,
        verify_mode: verifyProductionMode,
      };
      error.feedMeta = { ...feedMeta, error_reason: feedMeta.error_reason || error.message };
      throw error;
    }

    return callLegacyNewsEnvelope(category, signal, {
      mode: "legacy",
      fallbackUsed: true,
      errorReason: error?.message || "stored_feed_failed",
      correlationId: error?.feedMeta?.correlation_id || null,
    });
  }
}

export async function fetchNewsItems(category, signal) {
  const envelope = await fetchNewsFeedEnvelope(category, signal);
  return envelope.items;
}

export const __testing = {
  mapStoredItem,
};
