import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchNewsFeedEnvelope } from "./data/newsAdapter";

const TAB_ITEMS = [
  { id: "news", label: "غرفة الأخبار", icon: "🗞️" },
  { id: "videos", label: "الفيديو", icon: "🎞️" },
  { id: "live", label: "القنوات", icon: "📡" },
  { id: "ops", label: "Newsroom Pro", icon: "🧭" },
];

const NEWS_CATEGORIES = [
  { id: "all", label: "الكل", icon: "🌐" },
  { id: "breaking", label: "عاجل", icon: "🚨" },
  { id: "war", label: "نزاعات", icon: "🛡️" },
  { id: "politics", label: "سياسة", icon: "🏛️" },
  { id: "economy", label: "اقتصاد", icon: "💹" },
  { id: "energy", label: "طاقة", icon: "⚡" },
  { id: "technology", label: "تقنية", icon: "🧠" },
  { id: "analysis", label: "تحليل", icon: "📊" },
  { id: "iran", label: "إيران", icon: "🇮🇷" },
  { id: "gulf", label: "الخليج", icon: "🌍" },
  { id: "israel", label: "إسرائيل", icon: "🇮🇱" },
  { id: "usa", label: "أمريكا", icon: "🇺🇸" },
  { id: "world", label: "العالم", icon: "🗺️" },
];

const LIVE_CATEGORY_LABELS = {
  all: "الكل",
  news: "أخبار",
  sports: "رياضة",
  entertainment: "ترفيه",
  economy: "اقتصاد",
  documentary: "وثائقي",
  analysis: "تحليل",
  general: "عام",
};

const URGENCY_META = {
  high: { label: "عاجل", color: "#ff5449" },
  medium: { label: "مهم", color: "#f39c12" },
  low: { label: "متابعة", color: "#7f8c8d" },
};

const BG_GRADIENTS = [
  "radial-gradient(1400px 620px at 5% -10%, rgba(244,94,10,.22) 0%, rgba(8,8,12,0) 50%), radial-gradient(980px 520px at 95% 0%, rgba(11,123,146,.18) 0%, rgba(8,8,12,0) 55%), linear-gradient(160deg, #07090d 0%, #09070a 45%, #0c1117 100%)",
  "radial-gradient(1100px 560px at -10% 20%, rgba(225,29,72,.18) 0%, rgba(7,7,10,0) 55%), radial-gradient(1200px 640px at 110% 10%, rgba(16,185,129,.16) 0%, rgba(7,7,10,0) 50%), linear-gradient(160deg, #07080b 0%, #0a0b10 45%, #081015 100%)",
  "radial-gradient(900px 460px at 12% 4%, rgba(59,130,246,.2) 0%, rgba(8,8,12,0) 60%), radial-gradient(1250px 690px at 98% -4%, rgba(245,158,11,.16) 0%, rgba(8,8,12,0) 58%), linear-gradient(160deg, #070a10 0%, #0a0c11 48%, #0e0b12 100%)",
];

function formatDate(value) {
  if (!value) return "غير متاح";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "غير متاح";
  try {
    return parsed.toLocaleString("ar-SA");
  } catch (_error) {
    return parsed.toISOString();
  }
}

function elapsedSince(value) {
  if (!value) return "الآن";
  const parsedMs = new Date(value).getTime();
  if (Number.isNaN(parsedMs)) return "الآن";
  const sec = Math.max(1, Math.floor((Date.now() - parsedMs) / 1000));
  if (sec < 60) return `${sec}ث`;
  if (sec < 3600) return `${Math.floor(sec / 60)}د`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}س`;
  return `${Math.floor(sec / 86400)}ي`;
}

function toSafeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch (_error) {
    return null;
  }
}

function detectHeadlineTone(item) {
  const title = String(item?.title || "").toLowerCase();
  const summary = String(item?.summary || "").toLowerCase();
  if (/(summit|agreement|diplomatic|اتفاق|قمة|مفاوضات)/.test(`${title} ${summary}`)) return "diplomacy";
  if (/(market|inflation|oil|أسواق|نفط|تضخم|بورصة)/.test(`${title} ${summary}`)) return "markets";
  if (/(war|strike|attack|قصف|هجوم|اشتباك)/.test(`${title} ${summary}`)) return "conflict";
  return "general";
}

function buildSpotlightNote(item) {
  const tone = detectHeadlineTone(item);
  const verification = item?.provenance?.verification?.state || "single_source";
  const diversity = Number(item?.provenance?.cluster?.source_diversity || 1);
  if (verification === "corroborated" && diversity >= 3) return "تم تأكيد القصة عبر مصادر متعددة وتقاطعات سياقية.";
  if (tone === "markets") return "الأسواق تتفاعل سريعاً مع هذه الإشارة، المراقبة اللحظية مهمة.";
  if (tone === "diplomacy") return "هذا المسار الدبلوماسي قد يغير ترتيب أولويات غرف الأخبار خلال ساعات.";
  if (tone === "conflict") return "القصة ذات إيقاع تصعيدي وتحتاج متابعة دقيقة للتحديثات المتتابعة.";
  return "القصة في واجهة النشرة بسبب تأثيرها المباشر على دورة الأخبار الحالية.";
}

function scoreNews(item) {
  const rank = Number(item?.provenance?.editorial?.rank_score || 0);
  const confidence = Number(item?.provenance?.verification?.confidence_score || 0);
  const urgency = item?.urgency === "high" ? 0.35 : item?.urgency === "medium" ? 0.2 : 0.1;
  return rank + confidence + urgency;
}

function dedupeItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = item?.provenance?.cluster?.id || item?.provenance?.normalized_hash || item?.id || item?.title;
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function callClaudeProxy(promptType, category, signal) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptType, category }),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `request_failed_${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.items)) throw new Error("invalid_video_payload");
  return payload.items;
}

function mapLiveEntry(entry, index) {
  const stream = entry?.stream || {};
  const source = entry?.source || {};
  const storyLink = entry?.story_link || null;
  const streamId = entry?.stream_id || `stream-${index}`;
  return {
    id: String(streamId),
    title: source.name || `Channel ${index + 1}`,
    category: String(source.category || "general").toLowerCase(),
    region: source.region || "global",
    language: source.language || "ar",
    trust: Number(source.trust_score || 0),
    playbackMode: stream.playback_mode || "external_only",
    detailStatus: stream.detail_status || "unknown",
    uptime: stream.uptime_status || "down",
    score: Number(stream.score || 0),
    endpoint: toSafeHttpUrl(stream.endpoint),
    embedUrl: toSafeHttpUrl(stream.embed_url),
    externalUrl: toSafeHttpUrl(stream.external_watch_url) || toSafeHttpUrl(stream.official_page_url),
    statusLabel: stream.detail_status === "playable"
      ? "قابل للتشغيل"
      : stream.detail_status === "playable_external"
        ? "قابل للتشغيل (خارجي)"
      : stream.detail_status === "external_only"
        ? "خارجي فقط"
        : stream.detail_status === "healthy"
          ? "مستقر"
          : stream.detail_status === "stale"
            ? "متأخر"
            : "غير متاح",
    storyTitle: storyLink?.title || null,
    storyAt: storyLink?.published_at || null,
    featured: Boolean(stream.featured),
  };
}

const StatPill = memo(({ label, value, tone }) => (
  <div className="stat-pill">
    <span className="stat-pill__label">{label}</span>
    <span className={`stat-pill__value stat-pill__value--${tone}`}>{value}</span>
  </div>
));

const NewsCard = memo(({ item }) => {
  const urgency = URGENCY_META[item?.urgency] || URGENCY_META.medium;
  const confidence = Number(item?.provenance?.verification?.confidence_score || 0);
  const corroboration = Number(item?.provenance?.cluster?.corroboration_count || 0);
  return (
    <article className="news-card">
      <header className="news-card__meta">
        <span className="badge" style={{ borderColor: `${urgency.color}66`, color: urgency.color }}>
          {urgency.label}
        </span>
        <span className="news-card__time">{elapsedSince(item?.time)}</span>
      </header>
      <h3 className="news-card__title">{item?.title}</h3>
      <p className="news-card__summary">{item?.summary}</p>
      <footer className="news-card__footer">
        <span>ثقة {Math.round(confidence * 100)}%</span>
        <span>تعزيز {corroboration}</span>
      </footer>
    </article>
  );
});

const VideoCard = memo(({ item }) => {
  const safeYtId = /^[A-Za-z0-9_-]{11}$/.test(item?.youtubeId || "") ? item.youtubeId : null;
  if (!safeYtId) return null;
  return (
    <article className="video-card">
      <a href={`https://www.youtube.com/watch?v=${safeYtId}`} target="_blank" rel="noreferrer" className="video-card__thumbWrap">
        <img
          className="video-card__thumb"
          src={`https://img.youtube.com/vi/${safeYtId}/mqdefault.jpg`}
          alt={item?.title || "video"}
          loading="lazy"
        />
        <span className="video-card__play">▶</span>
      </a>
      <div className="video-card__body">
        <h3>{item?.title}</h3>
        <p>{item?.description || ""}</p>
      </div>
    </article>
  );
});

const LiveCard = memo(({ item, active, onSelect }) => (
  <article className={`live-card ${active ? "live-card--active" : ""}`} onClick={() => onSelect(item)}>
    <header>
      <h4>{item.title}</h4>
      <span className={`live-dot live-dot--${item.uptime}`}>{item.statusLabel}</span>
    </header>
    <p>{LIVE_CATEGORY_LABELS[item.category] || item.category} · {item.region}</p>
    <div className="live-score">Score {Math.round(item.score * 100)}</div>
  </article>
));

export default function App() {
  const [tab, setTab] = useState("news");
  const [category, setCategory] = useState("all");
  const [news, setNews] = useState([]);
  const [videos, setVideos] = useState([]);
  const [streams, setStreams] = useState([]);
  const [liveSummary, setLiveSummary] = useState(null);
  const [liveCategory, setLiveCategory] = useState("all");
  const [activeStream, setActiveStream] = useState(null);
  const [feedMeta, setFeedMeta] = useState({ mode: "legacy", fallback_used: false, freshness: {}, category_counts: {} });
  const [updatedAt, setUpdatedAt] = useState(null);
  const [errorNews, setErrorNews] = useState(null);
  const [errorVideos, setErrorVideos] = useState(null);
  const [errorLive, setErrorLive] = useState(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [loadingOps, setLoadingOps] = useState(false);
  const [errorOps, setErrorOps] = useState(null);
  const [newsroomStatus, setNewsroomStatus] = useState(null);
  const [metricsBasic, setMetricsBasic] = useState(null);
  const [opsUpdatedAt, setOpsUpdatedAt] = useState(null);

  const newsController = useRef(null);
  const videosController = useRef(null);
  const liveController = useRef(null);
  const opsController = useRef(null);

  const visualTheme = useMemo(() => BG_GRADIENTS[new Date().getDate() % BG_GRADIENTS.length], []);

  const loadNews = useCallback(async (nextCategory) => {
    newsController.current?.abort();
    const controller = new AbortController();
    newsController.current = controller;
    setLoadingNews(true);
    setErrorNews(null);
    try {
      const envelope = await fetchNewsFeedEnvelope(nextCategory, controller.signal);
      const prepared = dedupeItems(envelope.items).sort((a, b) => scoreNews(b) - scoreNews(a));
      setNews(prepared);
      setFeedMeta(envelope.metadata || { mode: "legacy", fallback_used: false, freshness: {}, category_counts: {} });
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorNews("تعذر تحميل الأخبار المخزنة حالياً");
    } finally {
      if (!controller.signal.aborted) setLoadingNews(false);
    }
  }, []);

  const loadVideos = useCallback(async (nextCategory) => {
    videosController.current?.abort();
    const controller = new AbortController();
    videosController.current = controller;
    setLoadingVideos(true);
    setErrorVideos(null);
    try {
      const items = await callClaudeProxy("videos", nextCategory, controller.signal);
      setVideos(items);
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorVideos("تعذر تحميل الفيديوهات حالياً");
    } finally {
      if (!controller.signal.aborted) setLoadingVideos(false);
    }
  }, []);

  const loadLive = useCallback(async () => {
    liveController.current?.abort();
    const controller = new AbortController();
    liveController.current = controller;
    setLoadingLive(true);
    setErrorLive(null);
    try {
      const response = await fetch("/api/health/streams", { signal: controller.signal });
      if (!response.ok) throw new Error("live_unavailable");
      const payload = await response.json();
      setLiveSummary(payload?.summary || null);
      const mapped = (Array.isArray(payload?.streams) ? payload.streams : [])
        .map(mapLiveEntry)
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
      setStreams(mapped);
      setActiveStream((prev) => mapped.find((entry) => entry.id === prev?.id) || mapped.find((entry) => entry.featured) || mapped[0] || null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorLive("تعذر تحميل القنوات الآن");
    } finally {
      if (!controller.signal.aborted) setLoadingLive(false);
    }
  }, []);

  const loadOps = useCallback(async () => {
    opsController.current?.abort();
    const controller = new AbortController();
    opsController.current = controller;
    setLoadingOps(true);
    setErrorOps(null);
    try {
      const [newsroomRes, metricsRes] = await Promise.all([
        fetch("/api/health/newsroom", { signal: controller.signal }),
        fetch("/api/health/metrics-basic", { signal: controller.signal }),
      ]);

      if (!newsroomRes.ok || !metricsRes.ok) {
        throw new Error("ops_snapshot_unavailable");
      }

      const [newsroomBody, metricsBody] = await Promise.all([
        newsroomRes.json(),
        metricsRes.json(),
      ]);

      setNewsroomStatus(newsroomBody);
      setMetricsBasic(metricsBody);
      setOpsUpdatedAt(new Date().toISOString());
    } catch (_error) {
      if (controller.signal.aborted) return;
      setErrorOps("تعذر تحميل لوحة التشغيل الآن");
    } finally {
      if (!controller.signal.aborted) setLoadingOps(false);
    }
  }, []);

  useEffect(() => { loadNews(category); }, [category, loadNews]);
  useEffect(() => { if (tab === "videos") loadVideos(category); }, [category, tab, loadVideos]);
  useEffect(() => { loadLive(); }, [loadLive]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useEffect(() => {
    if (tab !== "ops") return undefined;
    const interval = setInterval(() => {
      loadOps();
    }, 45000);
    return () => clearInterval(interval);
  }, [tab, loadOps]);

  useEffect(() => () => {
    newsController.current?.abort();
    videosController.current?.abort();
    liveController.current?.abort();
    opsController.current?.abort();
  }, []);

  const heroStory = news[0] || null;
  const subStories = news.slice(1, 9);
  const analysisStories = news.filter((item) => String(item?.category || "") === "analysis").slice(0, 4);
  const breakingStories = news.filter((item) => item?.urgency === "high").slice(0, 4);

  const liveCategories = useMemo(() => {
    const set = new Set(["all"]);
    for (const stream of streams) set.add(stream.category || "general");
    return Array.from(set);
  }, [streams]);

  const visibleStreams = useMemo(() => {
    if (liveCategory === "all") return streams;
    return streams.filter((stream) => stream.category === liveCategory);
  }, [liveCategory, streams]);

  const aiRoomSummary = useMemo(() => {
    if (!heroStory) return "لا توجد قصة رئيسية حالياً.";
    return buildSpotlightNote(heroStory);
  }, [heroStory]);

  const onRefresh = () => {
    loadNews(category);
    if (tab === "videos") loadVideos(category);
    loadLive();
    loadOps();
  };

  const readiness = newsroomStatus?.readiness_summary || {};
  const staleSignals = newsroomStatus?.stale_signals || {};
  const recentFailures = newsroomStatus?.recent_failures || {};
  const alertThresholds = newsroomStatus?.alert_thresholds || {};
  const sourceFailureSummary = newsroomStatus?.source_failure_summary || {};
  const worstSources = Array.isArray(sourceFailureSummary?.worst_sources) ? sourceFailureSummary.worst_sources : [];
  const recentFailureRows = Array.isArray(recentFailures?.recent_failures) ? recentFailures.recent_failures : [];
  const readinessLabel = readiness.level === "ready"
    ? "جاهز"
    : readiness.level === "degraded"
      ? "متدهور"
      : "محجوب";
  const readinessColor = readiness.level === "ready"
    ? "#20c9a5"
    : readiness.level === "degraded"
      ? "#f39c12"
      : "#ff6b4a";

  const alertItems = useMemo(() => {
    const items = [];
    const feedAgeSec = Number(staleSignals.latest_feed_item_age_sec ?? -1);
    const ingestionAgeSec = Number(staleSignals.latest_ingestion_age_sec ?? -1);
    const feedWarn = Number(alertThresholds.feed_stale_after_sec || 6 * 3600);
    const ingestionWarn = Number(alertThresholds.ingestion_stale_after_sec || 3 * 3600);
    const failedJobs = Number(recentFailures.failed_jobs_24h || 0);
    const failedWarn = Number(alertThresholds.failed_jobs_24h_warning || 1);
    const failedCritical = Number(alertThresholds.failed_jobs_24h_critical || 5);
    const downStreams = Number(readiness.down_streams || 0);
    const degradedStreams = Number(readiness.degraded_streams || 0);
    const failingSources = Number(sourceFailureSummary.sources_with_failures || 0);

    if (feedAgeSec >= 0 && feedAgeSec > feedWarn) {
      items.push({
        id: "feed-stale",
        severity: feedAgeSec > feedWarn * 2 ? "critical" : "warning",
        title: "تأخر تغذية الأخبار",
        message: `عمر آخر خبر ${elapsedSince(staleSignals.latest_feed_item_at)} وتجاوز عتبة ${Math.floor(feedWarn / 3600)} ساعات.`,
      });
    }

    if (ingestionAgeSec >= 0 && ingestionAgeSec > ingestionWarn) {
      items.push({
        id: "ingestion-stale",
        severity: ingestionAgeSec > ingestionWarn * 2 ? "critical" : "warning",
        title: "تأخر عملية Ingestion",
        message: `آخر ingestion منذ ${elapsedSince(staleSignals.latest_ingestion_at)} مما يزيد احتمالية stale feed.`,
      });
    }

    if (failedJobs >= failedCritical) {
      items.push({
        id: "jobs-failed-critical",
        severity: "critical",
        title: "ارتفاع حرج في فشل المهام",
        message: `تم رصد ${failedJobs} مهمة فاشلة خلال 24 ساعة (الحد الحرج ${failedCritical}).`,
      });
    } else if (failedJobs >= failedWarn) {
      items.push({
        id: "jobs-failed-warning",
        severity: "warning",
        title: "تحذير فشل مهام",
        message: `تم رصد ${failedJobs} مهمة فاشلة خلال 24 ساعة.`,
      });
    }

    if (downStreams > 0) {
      items.push({
        id: "streams-down",
        severity: downStreams >= 3 ? "critical" : "warning",
        title: "قنوات هابطة",
        message: `عدد القنوات الهابطة الآن: ${downStreams}.`,
      });
    }

    if (degradedStreams > 0 && downStreams === 0) {
      items.push({
        id: "streams-degraded",
        severity: "warning",
        title: "قنوات في وضع متدهور",
        message: `هناك ${degradedStreams} قناة تحتاج متابعة تشغيلية.`,
      });
    }

    if (failingSources > 0) {
      items.push({
        id: "sources-failing",
        severity: failingSources >= 5 ? "critical" : "warning",
        title: "مصادر بها أعطال",
        message: `عدد المصادر ذات الأعطال النشطة: ${failingSources}.`,
      });
    }

    if (items.length === 0) {
      items.push({
        id: "all-good",
        severity: "ok",
        title: "استقرار تشغيلي",
        message: "لا توجد إشارات تحذير حالياً، المؤشرات ضمن الحدود الطبيعية.",
      });
    }

    return items;
  }, [alertThresholds, readiness, recentFailures, sourceFailureSummary, staleSignals]);

  return (
    <div className="app" style={{ background: visualTheme }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap');
        :root {
          --bg-card: rgba(11,15,22,.78);
          --bg-card-strong: rgba(9,12,18,.94);
          --line: rgba(255,255,255,.12);
          --text-soft: #a5b0bf;
          --text-main: #f4f7fb;
          --hot: #ff6b4a;
          --mint: #20c9a5;
          --sky: #39a8ff;
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .app {
          min-height: 100vh;
          color: var(--text-main);
          direction: rtl;
          font-family: "IBM Plex Sans Arabic", "Cairo", sans-serif;
          padding: 18px;
        }
        .layout {
          max-width: 1380px;
          margin: 0 auto;
          display: grid;
          gap: 14px;
        }
        .shell {
          backdrop-filter: blur(12px);
          background: linear-gradient(150deg, rgba(8,11,16,.9) 0%, rgba(10,8,15,.86) 100%);
          border: 1px solid var(--line);
          border-radius: 22px;
          overflow: hidden;
          box-shadow: 0 20px 70px rgba(0,0,0,.45);
        }
        .topbar {
          display: grid;
          grid-template-columns: 1.2fr .9fr;
          gap: 16px;
          padding: 18px;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(130deg, rgba(255,107,74,.12), rgba(57,168,255,.08));
        }
        .brand h1 {
          margin: 0;
          font-family: "Cairo", sans-serif;
          font-size: 29px;
          font-weight: 900;
          letter-spacing: .2px;
        }
        .brand p {
          margin: 5px 0 0;
          color: var(--text-soft);
          font-size: 13px;
          line-height: 1.7;
        }
        .ai-room {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 13px 14px;
          display: grid;
          gap: 10px;
          align-content: start;
        }
        .ai-room h3 {
          margin: 0;
          font-size: 14px;
          color: #f8c987;
        }
        .ai-room p {
          margin: 0;
          color: #d4dbea;
          font-size: 13px;
          line-height: 1.8;
        }
        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }
        .meta-chip {
          background: rgba(255,255,255,.05);
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 5px 11px;
          color: #c5cfde;
          font-size: 11px;
        }
        .tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 12px 18px 0;
        }
        .tab-btn {
          border: 1px solid var(--line);
          background: rgba(255,255,255,.03);
          color: #c6d1df;
          border-radius: 999px;
          padding: 9px 14px;
          font-family: inherit;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
        }
        .tab-btn.active {
          color: #fff;
          border-color: rgba(255,107,74,.62);
          background: linear-gradient(130deg, rgba(255,107,74,.28), rgba(57,168,255,.18));
        }
        .content { padding: 16px 18px 20px; }
        .cat-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .cat-btn {
          border: 1px solid var(--line);
          background: rgba(255,255,255,.03);
          color: #b8c5d5;
          border-radius: 999px;
          padding: 7px 12px;
          font-family: inherit;
          cursor: pointer;
          font-size: 12px;
          display: inline-flex;
          gap: 7px;
          align-items: center;
        }
        .cat-btn.active {
          color: #fff;
          border-color: rgba(32,201,165,.62);
          background: rgba(32,201,165,.16);
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.2fr .8fr;
          gap: 12px;
          margin-bottom: 13px;
        }
        .hero-main {
          background: var(--bg-card-strong);
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 18px;
          display: grid;
          gap: 10px;
          position: relative;
          overflow: hidden;
        }
        .hero-main:before {
          content: "";
          position: absolute;
          inset: auto -60px -100px auto;
          width: 280px;
          height: 280px;
          background: radial-gradient(circle, rgba(255,107,74,.24), rgba(255,107,74,0));
          pointer-events: none;
        }
        .hero-main h2 {
          margin: 0;
          font-size: 27px;
          line-height: 1.55;
          font-family: "Cairo", sans-serif;
          font-weight: 900;
        }
        .hero-main p {
          margin: 0;
          color: #cfdaea;
          line-height: 1.9;
          font-size: 14px;
        }
        .hero-side {
          display: grid;
          gap: 10px;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }
        .stat-pill {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 5px;
        }
        .stat-pill__label { color: var(--text-soft); font-size: 11px; }
        .stat-pill__value { font-size: 19px; font-weight: 900; }
        .stat-pill__value--hot { color: var(--hot); }
        .stat-pill__value--mint { color: var(--mint); }
        .stat-pill__value--sky { color: var(--sky); }
        .stat-pill__value--soft { color: #dae4f2; }
        .panel {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
        }
        .panel h3 {
          margin: 0 0 9px;
          font-size: 14px;
          color: #e6edf9;
        }
        .panel ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .panel li { color: #bdc8d9; font-size: 12.5px; line-height: 1.75; }
        .news-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }
        .news-card {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 8px;
          min-height: 198px;
        }
        .news-card__meta { display: flex; justify-content: space-between; align-items: center; }
        .badge {
          background: rgba(255,255,255,.03);
          border: 1px solid;
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 10.5px;
          font-weight: 800;
        }
        .news-card__time { color: #8d98aa; font-size: 11px; }
        .news-card__title { margin: 0; font-size: 15px; line-height: 1.7; min-height: 54px; }
        .news-card__summary { margin: 0; color: #b9c5d7; font-size: 12.5px; line-height: 1.85; }
        .news-card__footer { display: flex; justify-content: space-between; color: #95a3b8; font-size: 11px; }
        .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
        .split-panel { background: var(--bg-card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
        .split-panel h3 { margin: 0 0 10px; font-size: 14px; }
        .split-panel ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
        .split-panel li { color: #c0cbdb; font-size: 12.5px; line-height: 1.7; }
        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 10px;
        }
        .video-card { background: var(--bg-card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
        .video-card__thumbWrap { position: relative; display: block; text-decoration: none; }
        .video-card__thumb { width: 100%; display: block; aspect-ratio: 16/9; object-fit: cover; }
        .video-card__play {
          position: absolute;
          inset: auto auto 10px 10px;
          background: rgba(255,84,73,.9);
          color: #fff;
          border-radius: 50%;
          width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
        }
        .video-card__body { padding: 11px; }
        .video-card__body h3 { margin: 0 0 8px; font-size: 13.5px; line-height: 1.7; }
        .video-card__body p { margin: 0; color: #a9b5c8; font-size: 12px; line-height: 1.8; }
        .live-layout { display: grid; grid-template-columns: .86fr 1.14fr; gap: 11px; }
        .live-list { display: grid; gap: 8px; }
        .live-card {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px;
          cursor: pointer;
          display: grid;
          gap: 6px;
        }
        .live-card--active {
          border-color: rgba(57,168,255,.66);
          box-shadow: 0 0 0 1px rgba(57,168,255,.36);
        }
        .live-card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .live-card h4 { margin: 0; font-size: 13px; }
        .live-card p { margin: 0; color: #9fabc0; font-size: 11.5px; }
        .live-score { color: #bfd8fb; font-size: 11.5px; font-weight: 700; }
        .live-dot { border-radius: 999px; padding: 3px 7px; font-size: 10.5px; border: 1px solid transparent; }
        .live-dot--up { color: #20c9a5; border-color: rgba(32,201,165,.45); }
        .live-dot--degraded { color: #f39c12; border-color: rgba(243,156,18,.45); }
        .live-dot--down { color: #ff6b4a; border-color: rgba(255,107,74,.45); }
        .live-player {
          background: var(--bg-card-strong);
          border: 1px solid var(--line);
          border-radius: 16px;
          min-height: 330px;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr auto;
        }
        .live-player__head {
          padding: 12px;
          border-bottom: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .live-player__head h3 { margin: 0; font-size: 14px; }
        .live-player__body {
          padding: 12px;
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 10px;
          text-align: center;
        }
        .live-player__body p { margin: 0; color: #c4cfdf; line-height: 1.85; font-size: 13px; }
        .live-link {
          background: rgba(57,168,255,.18);
          border: 1px solid rgba(57,168,255,.55);
          color: #d8ecff;
          text-decoration: none;
          border-radius: 10px;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 700;
        }
        .ops-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 10px;
          margin-bottom: 10px;
        }
        .ops-kpi {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 11px;
          display: grid;
          gap: 5px;
        }
        .ops-kpi__label { color: #9cadc2; font-size: 11px; }
        .ops-kpi__value { color: #eaf2ff; font-size: 22px; font-weight: 900; }
        .ops-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 8px;
        }
        .ops-list li {
          background: rgba(255,255,255,.03);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 10px;
          color: #c3cfdf;
          font-size: 12.5px;
          line-height: 1.75;
        }
        .ops-alerts {
          display: grid;
          gap: 8px;
          margin-bottom: 10px;
        }
        .ops-alert {
          border-radius: 12px;
          padding: 11px 12px;
          border: 1px solid var(--line);
          display: grid;
          gap: 4px;
        }
        .ops-alert--critical {
          background: rgba(255, 84, 73, .14);
          border-color: rgba(255, 84, 73, .5);
        }
        .ops-alert--warning {
          background: rgba(243, 156, 18, .13);
          border-color: rgba(243, 156, 18, .45);
        }
        .ops-alert--ok {
          background: rgba(32, 201, 165, .12);
          border-color: rgba(32, 201, 165, .45);
        }
        .ops-alert__title {
          font-size: 13px;
          font-weight: 800;
        }
        .ops-alert__msg {
          color: #d3dcef;
          font-size: 12.5px;
          line-height: 1.8;
        }
        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 9px;
          margin-bottom: 10px;
        }
        .refresh-btn {
          border: 1px solid rgba(255,107,74,.55);
          background: rgba(255,107,74,.16);
          color: #ffd8ce;
          border-radius: 999px;
          padding: 7px 12px;
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          font-weight: 700;
        }
        .hint, .error {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          color: #bac6d8;
          line-height: 1.8;
          font-size: 13px;
        }
        .error { border-color: rgba(255,84,73,.45); color: #ffd5ce; }
        @media (max-width: 1120px) {
          .topbar { grid-template-columns: 1fr; }
          .hero-grid { grid-template-columns: 1fr; }
          .live-layout { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .app { padding: 10px; }
          .content { padding: 13px 12px 16px; }
          .topbar { padding: 14px 12px; }
          .tabs { padding: 10px 12px 0; }
          .split-grid { grid-template-columns: 1fr; }
          .brand h1 { font-size: 23px; }
          .hero-main h2 { font-size: 22px; }
        }
      `}</style>

      <main className="layout">
        <section className="shell">
          <header className="topbar">
            <div className="brand">
              <h1>World Pulse Hub</h1>
              <p>
                تصميم تحريري جديد يجمع أسلوب الـ Hero headline، شريط المتابعات السريعة، وغرفة القنوات المباشرة في واجهة واحدة.
              </p>
              <div className="meta-row">
                <span className="meta-chip">مصدر الأخبار: {feedMeta.mode || "legacy"}</span>
                <span className="meta-chip">Fallback: {feedMeta.fallback_used ? "مفعل" : "غير مفعل"}</span>
                <span className="meta-chip">آخر تحديث: {updatedAt ? formatDate(updatedAt) : "--"}</span>
              </div>
            </div>

            <aside className="ai-room">
              <h3>AI Newsroom Signal</h3>
              <p>{aiRoomSummary}</p>
              <div className="meta-row">
                <span className="meta-chip">قصص معروضة: {news.length}</span>
                <span className="meta-chip">قنوات فعالة: {streams.length}</span>
                <span className="meta-chip">بيانات عمرها: {elapsedSince(feedMeta?.freshness?.latest_item_at)}</span>
              </div>
            </aside>
          </header>

          <div className="tabs">
            {TAB_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tab-btn ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>

          <section className="content">
            <div className="toolbar">
              <div className="meta-row">
                <span className="meta-chip">العمر الزمني للفيد: {elapsedSince(feedMeta?.freshness?.latest_item_at)}</span>
                <span className="meta-chip">آخر Ingestion: {formatDate(feedMeta?.freshness?.last_ingestion_at)}</span>
              </div>
              <button className="refresh-btn" type="button" onClick={onRefresh}>تحديث شامل</button>
            </div>

            {tab === "news" && (
              <>
                <div className="cat-row">
                  {NEWS_CATEGORIES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`cat-btn ${category === item.id ? "active" : ""}`}
                      onClick={() => setCategory(item.id)}
                    >
                      <span>{item.icon} {item.label}</span>
                      <span>{feedMeta?.category_counts?.[item.id] ?? 0}</span>
                    </button>
                  ))}
                </div>

                {loadingNews && <div className="hint">جاري تحميل الأخبار...</div>}
                {errorNews && <div className="error">{errorNews}</div>}

                {!loadingNews && !errorNews && heroStory && (
                  <>
                    <div className="hero-grid">
                      <section className="hero-main">
                        <span className="badge" style={{ borderColor: "rgba(255,107,74,.65)", color: "#ff9f89" }}>
                          {URGENCY_META[heroStory.urgency]?.label || "قصة رئيسية"}
                        </span>
                        <h2>{heroStory.title}</h2>
                        <p>{heroStory.summary}</p>
                        <p>{buildSpotlightNote(heroStory)}</p>
                        <div className="meta-row">
                          <span className="meta-chip">ثقة: {Math.round(Number(heroStory?.provenance?.verification?.confidence_score || 0) * 100)}%</span>
                          <span className="meta-chip">تعزيز: {Number(heroStory?.provenance?.cluster?.corroboration_count || 0)}</span>
                          <span className="meta-chip">الوقت: {elapsedSince(heroStory.time)}</span>
                        </div>
                      </section>

                      <aside className="hero-side">
                        <div className="stat-grid">
                          <StatPill label="عاجل" value={news.filter((item) => item.urgency === "high").length} tone="hot" />
                          <StatPill label="مدعوم" value={news.filter((item) => item?.provenance?.verification?.state === "corroborated").length} tone="mint" />
                          <StatPill label="تحليل" value={news.filter((item) => item.category === "analysis").length} tone="sky" />
                          <StatPill label="إجمالي" value={news.length} tone="soft" />
                        </div>
                        <div className="panel">
                          <h3>مؤشر غرفة التحرير</h3>
                          <ul>
                            <li>القصص مرتبة حسب درجة rank_score + confidence + urgency.</li>
                            <li>الدمج يمنع تكرار القصة نفسها عبر cluster id أو normalized hash.</li>
                            <li>الواجهة مصممة لتشبه نمط الصفحات الأولى في المواقع العالمية.</li>
                          </ul>
                        </div>
                      </aside>
                    </div>

                    <div className="split-grid">
                      <section className="split-panel">
                        <h3>عاجل الآن</h3>
                        <ul>
                          {breakingStories.length === 0 && <li>لا توجد قصص عاجلة حالياً.</li>}
                          {breakingStories.map((item) => (
                            <li key={`breaking:${item.id || item.title}`}>{item.title}</li>
                          ))}
                        </ul>
                      </section>
                      <section className="split-panel">
                        <h3>تحليلات منتقاة</h3>
                        <ul>
                          {analysisStories.length === 0 && <li>لا توجد تحليلات بارزة حالياً.</li>}
                          {analysisStories.map((item) => (
                            <li key={`analysis:${item.id || item.title}`}>{item.title}</li>
                          ))}
                        </ul>
                      </section>
                    </div>

                    <div className="news-grid">
                      {subStories.map((item) => (
                        <NewsCard key={item.id || item.title} item={item} />
                      ))}
                    </div>
                  </>
                )}

                {!loadingNews && !errorNews && !heroStory && (
                  <div className="hint">لا توجد بيانات أخبار حالياً لهذا التصنيف.</div>
                )}
              </>
            )}

            {tab === "videos" && (
              <>
                {loadingVideos && <div className="hint">جاري تحميل الفيديو...</div>}
                {errorVideos && <div className="error">{errorVideos}</div>}
                {!loadingVideos && !errorVideos && (
                  <div className="video-grid">
                    {videos.map((item, index) => (
                      <VideoCard key={item.youtubeId || `${item.title}-${index}`} item={item} />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "live" && (
              <>
                <div className="meta-row" style={{ marginBottom: "10px" }}>
                  <span className="meta-chip">
                    {Number(liveSummary?.playable_streams ?? streams.length)}/{Number(liveSummary?.active_streams ?? streams.length)} قابل للتشغيل
                  </span>
                  <span className="meta-chip">
                    playable: {Number(liveSummary?.playable_streams ?? streams.length)}
                  </span>
                  <span className="meta-chip">
                    active: {Number(liveSummary?.active_streams ?? streams.length)}
                  </span>
                  <span className="meta-chip">
                    down: {Number(liveSummary?.down_streams ?? 0)}
                  </span>
                </div>

                <div className="cat-row">
                  {liveCategories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`cat-btn ${liveCategory === item ? "active" : ""}`}
                      onClick={() => setLiveCategory(item)}
                    >
                      {LIVE_CATEGORY_LABELS[item] || item} ({item === "all" ? streams.length : streams.filter((entry) => entry.category === item).length})
                    </button>
                  ))}
                </div>

                {loadingLive && <div className="hint">جاري تحميل القنوات...</div>}
                {errorLive && <div className="error">{errorLive}</div>}

                {!loadingLive && !errorLive && (
                  <div className="live-layout">
                    <section className="live-list">
                      {visibleStreams.map((item) => (
                        <LiveCard key={item.id} item={item} active={activeStream?.id === item.id} onSelect={setActiveStream} />
                      ))}
                      {visibleStreams.length === 0 && <div className="hint">لا توجد قنوات في هذا التصنيف حالياً.</div>}
                    </section>

                    <section className="live-player">
                      <header className="live-player__head">
                        <h3>{activeStream?.title || "اختر قناة"}</h3>
                        {activeStream && <span className={`live-dot live-dot--${activeStream.uptime}`}>{activeStream.statusLabel}</span>}
                      </header>

                      <div className="live-player__body">
                        {!activeStream && <p>اختر قناة من القائمة اليمنى لعرض التفاصيل.</p>}

                        {activeStream && activeStream.playbackMode === "playable" && activeStream.embedUrl && (
                          <iframe
                            style={{ width: "100%", minHeight: "280px", border: "none", borderRadius: "10px" }}
                            src={activeStream.embedUrl}
                            title={activeStream.title}
                            allow="autoplay; encrypted-media; fullscreen"
                            allowFullScreen
                            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                            referrerPolicy="strict-origin-when-cross-origin"
                          />
                        )}

                        {activeStream && !(activeStream.playbackMode === "playable" && activeStream.embedUrl) && (
                          <>
                            <p>
                              القناة تعمل بوضع خارجي. هذا طبيعي للقنوات التي تمنع التضمين المباشر داخل iframe.
                            </p>
                            {activeStream.storyTitle && <p>آخر قصة مرتبطة: {activeStream.storyTitle}</p>}
                            {activeStream.storyAt && <p>زمن آخر قصة: {formatDate(activeStream.storyAt)}</p>}
                            {activeStream.externalUrl && (
                              <a className="live-link" href={activeStream.externalUrl} target="_blank" rel="noreferrer">
                                فتح القناة خارجياً
                              </a>
                            )}
                          </>
                        )}
                      </div>

                      <footer className="live-player__head" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>
                        <span>الفئة: {LIVE_CATEGORY_LABELS[activeStream?.category] || activeStream?.category || "--"}</span>
                        <span>الثقة: {Math.round(Number(activeStream?.trust || 0))}</span>
                      </footer>
                    </section>
                  </div>
                )}
              </>
            )}

            {tab === "ops" && (
              <>
                {loadingOps && <div className="hint">جاري تحميل لوحة Newsroom Pro...</div>}
                {errorOps && <div className="error">{errorOps}</div>}

                {!loadingOps && !errorOps && (
                  <>
                    <div className="ops-alerts">
                      {alertItems.map((item) => (
                        <article key={item.id} className={`ops-alert ops-alert--${item.severity}`}>
                          <span className="ops-alert__title">
                            {item.severity === "critical" ? "⛔ " : item.severity === "warning" ? "⚠️ " : "✅ "}
                            {item.title}
                          </span>
                          <span className="ops-alert__msg">{item.message}</span>
                        </article>
                      ))}
                    </div>

                    <div className="ops-grid">
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">الحالة العامة</span>
                        <span className="ops-kpi__value" style={{ color: readinessColor }}>{readinessLabel}</span>
                      </article>
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">تأخر آخر خبر</span>
                        <span className="ops-kpi__value">{elapsedSince(staleSignals.latest_feed_item_at)}</span>
                      </article>
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">تأخر آخر ingestion</span>
                        <span className="ops-kpi__value">{elapsedSince(staleSignals.latest_ingestion_at)}</span>
                      </article>
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">فشل jobs خلال 24س</span>
                        <span className="ops-kpi__value">{Number(recentFailures.failed_jobs_24h || 0)}</span>
                      </article>
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">القنوات الهابطة</span>
                        <span className="ops-kpi__value">{Number(readiness.down_streams || 0)}</span>
                      </article>
                      <article className="ops-kpi">
                        <span className="ops-kpi__label">العناصر المعيارية</span>
                        <span className="ops-kpi__value">{Number(metricsBasic?.counters?.normalized_items || 0)}</span>
                      </article>
                    </div>

                    <div className="split-grid">
                      <section className="split-panel">
                        <h3>ملخص جاهزية غرفة الأخبار</h3>
                        <ul>
                          <li>{readiness.operator_message || "لا توجد رسالة تشغيلية"}</li>
                          <li>آخر تحديث تشغيلي: {opsUpdatedAt ? formatDate(opsUpdatedAt) : "--"}</li>
                          <li>feed mode: {metricsBasic?.feed_mode || "--"}</li>
                          <li>fallback enabled: {String(metricsBasic?.feed_fallback_enabled ?? "--")}</li>
                          <li>verify mode: {String(metricsBasic?.verify_mode ?? "--")}</li>
                        </ul>
                      </section>

                      <section className="split-panel">
                        <h3>مصادر متأثرة</h3>
                        <ul>
                          <li>إجمالي المصادر: {Number(sourceFailureSummary.sources_total || 0)}</li>
                          <li>مصادر بها أعطال: {Number(sourceFailureSummary.sources_with_failures || 0)}</li>
                          <li>مصادر فشلت خلال 24س: {Number(sourceFailureSummary.recent_failed_sources || 0)}</li>
                        </ul>
                      </section>
                    </div>

                    <div className="split-grid">
                      <section className="split-panel">
                        <h3>آخر فشل Jobs</h3>
                        <ul className="ops-list">
                          {recentFailureRows.length === 0 && <li>لا توجد أخطاء Jobs خلال آخر 24 ساعة.</li>}
                          {recentFailureRows.map((row, index) => (
                            <li key={`${row.id || index}-job-failure`}>
                              job #{row.id} · {row.job_type || "unknown"} · {formatDate(row.created_at)}
                              <br />
                              {row.error_message || "خطأ غير معروف"}
                            </li>
                          ))}
                        </ul>
                      </section>

                      <section className="split-panel">
                        <h3>أعلى المصادر فشلًا</h3>
                        <ul className="ops-list">
                          {worstSources.length === 0 && <li>لا توجد مصادر متأثرة حالياً.</li>}
                          {worstSources.map((row, index) => (
                            <li key={`${row.source_id || index}-source-failure`}>
                              {row.source_name || "Unknown"} · failing feeds: {Number(row.failing_feed_count || 0)}/{Number(row.active_feed_count || 0)}
                              <br />
                              {row.latest_error_message || "لا توجد رسالة خطأ"}
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
