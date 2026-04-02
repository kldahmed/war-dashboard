const DEFAULT_LIMIT = 20;

export function resolveFeedMode({ mode, fallbackEnabled = true } = {}) {
  const normalizedMode = String(mode || process.env.REACT_APP_FEED_MODE || "legacy").toLowerCase();
  const fallback = String(
    fallbackEnabled !== undefined ? fallbackEnabled : (process.env.REACT_APP_FEED_FALLBACK || "true")
  ).toLowerCase() === "true";

  return {
    mode: normalizedMode === "stored" ? "stored" : "legacy",
    fallbackEnabled: fallback,
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Stored feed failed (${res.status})`);
  }

  const body = await res.json();
  if (!Array.isArray(body.items)) throw new Error("Stored feed response is invalid");
  return body.items.map(mapStoredItem);
}

export async function fetchNewsItems(category, signal) {
  const { mode, fallbackEnabled } = resolveFeedMode();
  if (mode === "legacy") return callLegacyNews(category, signal);

  try {
    return await callStoredNews(category, signal);
  } catch (error) {
    if (!fallbackEnabled) throw error;
    return callLegacyNews(category, signal);
  }
}

export const __testing = {
  mapStoredItem,
};
