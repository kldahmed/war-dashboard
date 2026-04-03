import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { fetchNewsFeedEnvelope } from "./data/newsAdapter";

const TABS = [
  { id: "news",   label: "الأخبار",  icon: "📰" },
  { id: "videos", label: "فيديوهات", icon: "🎬" },
  { id: "live",   label: "بث مباشر", icon: "📡" },
];

const CATEGORIES = [
  { id: "all",    label: "الكل",     emoji: "🌐" },
  { id: "iran",   label: "إيران",    emoji: "🇮🇷" },
  { id: "gulf",   label: "الخليج",   emoji: "🇸🇦" },
  { id: "usa",    label: "أمريكا",   emoji: "🇺🇸" },
  { id: "israel", label: "إسرائيل",  emoji: "🇮🇱" },
];

const CAT_COLORS = {
  iran:   { accent:"#c0392b", glow:"rgba(192,57,43,.35)",  light:"#e74c3c", bg:"#180808" },
  gulf:   { accent:"#16a085", glow:"rgba(22,160,133,.35)", light:"#1abc9c", bg:"#081813" },
  usa:    { accent:"#2471a3", glow:"rgba(36,113,163,.35)", light:"#3498db", bg:"#080f18" },
  israel: { accent:"#7d3c98", glow:"rgba(125,60,152,.35)", light:"#9b59b6", bg:"#0d0814" },
  all:    { accent:"#c0392b", glow:"rgba(192,57,43,.35)",  light:"#e74c3c", bg:"#0d0d0d" },
};

const URGENCY_MAP = {
  high:   { label:"عاجل",   color:"#e74c3c", pulse:true  },
  medium: { label:"مهم",    color:"#f39c12", pulse:false },
  low:    { label:"متابعة", color:"#7f8c8d", pulse:false },
};

const CAT_UNSPLASH = {
  iran:   ["photo-1597852074816-d57796d60ea6","photo-1564419320461-6870880221ad","photo-1576086213369-97a306d36557"],
  gulf:   ["photo-1512632578888-169bbbc64f33","photo-1555448248-2571daf6344b","photo-1469041797191-50ace28483c3"],
  usa:    ["photo-1515187029135-18ee286d815b","photo-1501594907352-04cda38ebc29","photo-1473091534298-04dcbce3278c"],
  israel: ["photo-1544967082-d9d25d867d66","photo-1582555172866-f73bb12a2ab3","photo-1570957392122-7768e3cfc3d6"],
};

// AI prompts are defined server-side in /api/claude.js — not exposed in client bundle.

function getImg(catId, seed) {
  const arr = CAT_UNSPLASH[catId] || CAT_UNSPLASH.iran;
  const id = arr[seed % arr.length];
  return `https://images.unsplash.com/${id}?w=480&q=70&auto=format&fit=crop`;
}

function asValidDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeLocaleFormat(value, locale, formatter, fallback = "غير متاح") {
  const parsed = asValidDate(value);
  if (!parsed) return fallback;
  try {
    return formatter(parsed, locale);
  } catch (_error) {
    try {
      return formatter(parsed);
    } catch (_innerError) {
      return fallback;
    }
  }
}

function formatDateTime(value, fallback = "غير متاح") {
  return safeLocaleFormat(value, "ar-SA", (date, locale) => date.toLocaleString(locale), fallback);
}

function formatTimeLabel(value, fallback = "منذ قليل") {
  return safeLocaleFormat(value, "ar-SA", (date, locale) => date.toLocaleTimeString(locale), fallback);
}

function safeHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch (_error) {
    return null;
  }
}

function toSourceHomepage(domain, fallbackUrl) {
  if (typeof domain === "string" && domain.trim()) {
    const directUrl = safeHttpUrl(domain);
    if (directUrl) return directUrl;
    return safeHttpUrl(`https://${domain.trim().replace(/^https?:\/\//, "")}`);
  }
  return safeHttpUrl(fallbackUrl);
}

function getRegionFlag(region) {
  switch (region) {
    case "usa": return "🇺🇸";
    case "mena": return "🌍";
    case "global": return "🌐";
    default: return "📡";
  }
}

function getStreamColor(status) {
  switch (status) {
    case "up": return "#16a085";
    case "degraded": return "#f39c12";
    default: return "#c0392b";
  }
}

function getStreamStatusLabel(status, detailStatus) {
  if (detailStatus === "playable") return "قابل للتشغيل";
  if (detailStatus === "external_only") return "خارجي فقط";
  if (status === "up") return "جاهز";
  if (status === "degraded") return "وضع منخفض المخاطر";
  if (detailStatus === "inactive") return "غير نشط";
  return "غير متاح";
}

function getStreamHealthHint(stream) {
  if (!stream) return "لا توجد بيانات تشغيلية متاحة.";
  if (stream.stream.detail_status === "playable") return "هذا البث موثّق وقابل للتشغيل مباشرة من registry الرسمي.";
  if (stream.stream.detail_status === "external_only") return "هذا المصدر موثّق لكن التشغيل الداخلي غير مدعوم، لذلك سيتم فتحه خارجيًا فقط.";
  if (stream.stream.uptime_status === "up") return "المصدر التشغيلي متاح الآن.";
  if (stream.stream.detail_status === "inactive") return "هذا المصدر غير نشط حاليًا في registry التشغيلي.";
  if (stream.stream.detail_status === "stale") return "آخر نجاح قديم، لذلك تم تعطيل embed التلقائي لتجنب شاشة broken.";
  return "المصدر لا يقدم رابط video embeddable صالحًا من snapshot الحالي.";
}

function sanitizeUserFacingError(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim();
  if (/^[a-z0-9_:-]+$/i.test(normalized)) return fallback;
  return normalized;
}

function mapStreamSnapshotEntry(entry, index) {
  const embedUrl = safeHttpUrl(entry?.stream?.embed_url);
  const endpointUrl = safeHttpUrl(entry?.stream?.endpoint);
  const externalUrl = safeHttpUrl(entry?.stream?.external_watch_url)
    || safeHttpUrl(entry?.stream?.official_page_url)
    || toSourceHomepage(entry?.source?.domain, endpointUrl);
  const color = getStreamColor(entry?.stream?.uptime_status);
  const storyTitle = typeof entry?.story_link?.title === "string" ? entry.story_link.title.trim() : "";
  const channelId = entry?.stream_id || `stream-${index}`;

  return {
    id: String(channelId),
    name: entry?.source?.name || `Stream ${index + 1}`,
    flag: getRegionFlag(entry?.source?.region),
    color,
    desc: storyTitle || (entry?.source?.domain || "مصدر تشغيلي"),
    statusLabel: getStreamStatusLabel(entry?.stream?.uptime_status, entry?.stream?.detail_status),
    statusHint: getStreamHealthHint(entry),
    detailStatus: entry?.stream?.detail_status || "unknown",
    healthReason: entry?.stream?.health_reason || null,
    embedUrl,
    externalUrl,
    endpointUrl,
    featured: Boolean(entry?.stream?.featured),
    playable: entry?.stream?.playback_mode === "playable" && Boolean(embedUrl),
    externalOnly: Boolean(entry?.stream?.external_only) || entry?.stream?.playback_mode === "external_only",
    lastSuccessAt: entry?.stream?.last_success_at || null,
    lastErrorAt: entry?.stream?.last_error_at || null,
    sourceDomain: entry?.source?.domain || null,
    storyTitle,
    storyPublishedAt: entry?.story_link?.published_at || null,
    uptimeStatus: entry?.stream?.uptime_status || "down",
  };
}

function pickInitialLiveChannel(channels) {
  return channels.find((channel) => channel.featured && channel.embedUrl)
    || channels.find((channel) => channel.embedUrl)
    || channels.find((channel) => channel.featured)
    || channels[0]
    || null;
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("[ErrorBoundary]", err, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding:"32px", textAlign:"center" }}>
          <p style={{ color:"#e74c3c", fontSize:"14px", marginBottom:"14px", direction:"rtl" }}>⚠️ حدث خطأ غير متوقع في هذا القسم</p>
          <button className="retry-btn" onClick={() => this.setState({ hasError:false })}>🔄 إعادة المحاولة</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Server-side proxy caller (API key lives ONLY in /api/claude) ──────────────
async function callProxy(promptType, category, signal) {
  const res = await fetch("/api/claude", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ promptType, category }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `خطأ في الخادم (${res.status})`);
  }
  const { items } = await res.json();
  if (!Array.isArray(items) || items.length === 0) throw new Error("لا توجد بيانات متاحة حالياً");
  return items;
}

function getVerificationLabel(state) {
  switch (state) {
    case "corroborated": return "موثّق";
    case "partially_corroborated": return "مدعوم";
    case "needs_review": return "قيد المراجعة";
    default: return "مصدر واحد";
  }
}

function getVerificationColor(state) {
  switch (state) {
    case "corroborated": return { fg: "#16a085", bg: "rgba(22,160,133,.14)", border: "rgba(22,160,133,.36)" };
    case "partially_corroborated": return { fg: "#2980b9", bg: "rgba(41,128,185,.14)", border: "rgba(41,128,185,.36)" };
    case "needs_review": return { fg: "#c0392b", bg: "rgba(192,57,43,.14)", border: "rgba(192,57,43,.36)" };
    default: return { fg: "#7f8c8d", bg: "rgba(127,140,141,.14)", border: "rgba(127,140,141,.3)" };
  }
}

function getEditorialLabel(priority) {
  switch (priority) {
    case "high": return "أولوية عالية";
    case "review": return "تحريرياً";
    case "elevated": return "متابعة";
    default: return "نشر";
  }
}

function getEditorialColor(priority) {
  switch (priority) {
    case "high": return { fg: "#f39c12", bg: "rgba(243,156,18,.14)", border: "rgba(243,156,18,.35)" };
    case "review": return { fg: "#e74c3c", bg: "rgba(231,76,60,.14)", border: "rgba(231,76,60,.35)" };
    case "elevated": return { fg: "#9b59b6", bg: "rgba(155,89,182,.14)", border: "rgba(155,89,182,.35)" };
    default: return { fg: "#95a5a6", bg: "rgba(149,165,166,.12)", border: "rgba(149,165,166,.3)" };
  }
}

function getConfidenceHint(item) {
  const confidence = item?.provenance?.verification?.confidence_score;
  const corroboration = item?.provenance?.cluster?.corroboration_count;
  if (Number.isFinite(corroboration) && corroboration > 0) return `${corroboration} تعزيز`;
  if (Number.isFinite(confidence)) return `ثقة ${Math.round(confidence * 100)}%`;
  return "ثقة محدودة";
}

function getClusterSizeHint(item) {
  const corroboration = Number(item?.provenance?.cluster?.corroboration_count || 0);
  return `${Math.max(1, corroboration + 1)} داخل القصة`;
}

function getLastUpdateHint(item) {
  const rawValue = item?.provenance?.published_at_source || item?.provenance?.fetched_at;
  const label = formatDateTime(rawValue, null);
  return label ? `آخر تحديث ${label}` : "تحديث غير واضح";
}

function getWhyThisStory(item) {
  const urgency = item?.urgency;
  const priority = item?.provenance?.editorial?.priority;
  const verificationState = item?.provenance?.verification?.state;
  const corroboration = Number(item?.provenance?.cluster?.corroboration_count || 0);
  const contradictionFlag = Boolean(item?.provenance?.cluster?.contradiction_flag);

  if (urgency === "high") return "قصة بارزة بسبب الإلحاح الزمني.";
  if (priority === "high" || priority === "review") return "قصة مرفوعة تحريرياً للمتابعة المباشرة.";
  if (contradictionFlag) return "القصة تحتاج متابعة لأن الروايات ليست متطابقة بالكامل.";
  if (verificationState === "corroborated" && corroboration > 1) return "القصة مدعومة بعدة إشارات متقاطعة.";
  if (verificationState === "partially_corroborated") return "القصة ظهرت في أكثر من إشارة وتحتاج متابعة إضافية.";
  return "القصة ظاهرة لأنها الأعلى ترتيباً ضمن السياق الحالي.";
}

function getTimelineHint(item) {
  const decision = item?.provenance?.editorial?.decision;
  if (decision === "update") return "مسار التحديث مفتوح";
  if (decision === "merge") return "مرشحة للدمج مع تحديثات قريبة";
  return "جاهزة لخط زمني خفيف";
}

function getStoryMetaHints(item) {
  const cluster = item?.provenance?.cluster || {};
  return [
    getClusterSizeHint(item),
    `${Number(cluster.corroboration_count || 0)} تعزيز`,
    getLastUpdateHint(item),
  ];
}

function dedupeVisualItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const clusterId = item?.provenance?.cluster?.id;
    const fingerprint = item?.provenance?.normalized_hash || item?.title;
    const key = clusterId ? `cluster:${clusterId}` : `item:${fingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRankScore(item) {
  return Number(item?.provenance?.editorial?.rank_score || 0);
}

function pickHeroStory(items) {
  const deduped = dedupeVisualItems(items);
  return [...deduped].sort((left, right) => getRankScore(right) - getRankScore(left))[0] || null;
}

function pickPriorityRail(items, heroItem) {
  const heroKey = heroItem?.id || heroItem?.title;
  return dedupeVisualItems(items)
    .filter((item) => (item?.id || item?.title) !== heroKey)
    .filter((item) => {
      const priority = item?.provenance?.editorial?.priority;
      const urgency = item?.urgency;
      return priority === "high" || priority === "review" || priority === "elevated" || urgency === "high";
    })
    .sort((left, right) => getRankScore(right) - getRankScore(left))
    .slice(0, 4);
}

// ── Components ───────────────────────────────────────────────────────────────

const NewsCard = memo(({ item, index }) => {
  const [open, setOpen] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const col = CAT_COLORS[item.category] || CAT_COLORS.all;
  const urg = URGENCY_MAP[item.urgency] || URGENCY_MAP.medium;
  const cat = CATEGORIES.find(c => c.id === item.category);
  const verificationState = item?.provenance?.verification?.state || "single_source";
  const editorialPriority = item?.provenance?.editorial?.priority || "normal";
  const verificationTone = getVerificationColor(verificationState);
  const editorialTone = getEditorialColor(editorialPriority);
  const storyMetaHints = getStoryMetaHints(item);
  const whyThisStory = getWhyThisStory(item);
  const timelineHint = getTimelineHint(item);

  return (
    <div
      onClick={() => setOpen(v => !v)}
      style={{
        background: `linear-gradient(160deg,${col.bg} 0%,#0a0a0a 100%)`,
        border: `1px solid ${open ? col.accent+"99" : "rgba(255,255,255,.07)"}`,
        borderRadius: "14px", overflow: "hidden", cursor: "pointer",
        transition: "box-shadow .25s,border-color .25s",
        boxShadow: open ? `0 0 22px ${col.glow}` : "0 2px 10px rgba(0,0,0,.5)",
        animation: `fadeUp .45s ease ${index*.07}s both`,
        position: "relative",
      }}
    >
      {!imgErr && (
        <div style={{ position: "relative", height: "150px", overflow: "hidden" }}>
          <img src={getImg(item.category, index)} alt="" onError={() => setImgErr(true)}
            style={{ width:"100%", height:"100%", objectFit:"cover", filter:"brightness(.72) saturate(.8)" }} loading="lazy" />
          <div style={{ position:"absolute", inset:0, background:`linear-gradient(to bottom,transparent 40%,${col.bg} 100%)` }} />
          <div style={{
            position:"absolute", top:"9px", right:"9px",
            background: urg.color+"dd", color:"#fff",
            borderRadius:"20px", padding:"3px 10px", fontSize:"11px", fontWeight:"800",
            display:"flex", alignItems:"center", gap:"5px", backdropFilter:"blur(4px)",
          }}>
            {urg.pulse && <span style={{ width:6, height:6, borderRadius:"50%", background:"#fff", display:"inline-block", animation:"pulse 1.1s infinite" }} />}
            {urg.label}
          </div>
          {cat && (
            <div style={{
              position:"absolute", top:"9px", left:"9px",
              background:"rgba(0,0,0,.65)", color:col.light,
              borderRadius:"20px", padding:"3px 10px", fontSize:"12px", backdropFilter:"blur(4px)",
            }}>
              {cat.emoji} {cat.label}
            </div>
          )}
        </div>
      )}
      <div style={{ padding:"14px 16px 10px" }}>
        <div style={{ color:"#484848", fontSize:"11px", marginBottom:"6px", textAlign:"right", fontFamily:"monospace" }}>{item.time}</div>
        <div style={{ display:"flex", gap:"6px", justifyContent:"flex-start", flexWrap:"wrap", marginBottom:"8px" }}>
          <span style={{ background:verificationTone.bg, border:`1px solid ${verificationTone.border}`, color:verificationTone.fg, borderRadius:"999px", padding:"3px 8px", fontSize:"10.5px", fontWeight:"700" }}>
            {getVerificationLabel(verificationState)}
          </span>
          <span style={{ background:editorialTone.bg, border:`1px solid ${editorialTone.border}`, color:editorialTone.fg, borderRadius:"999px", padding:"3px 8px", fontSize:"10.5px", fontWeight:"700" }}>
            {getEditorialLabel(editorialPriority)}
          </span>
          <span style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", color:"#8c8c8c", borderRadius:"999px", padding:"3px 8px", fontSize:"10.5px", fontWeight:"700" }}>
            {getConfidenceHint(item)}
          </span>
        </div>
        <h3 style={{ color:"#f0ece4", fontSize:"14.5px", fontWeight:"700", lineHeight:"1.65", margin:0, direction:"rtl", textAlign:"right" }}>
          {item.title}
        </h3>
        <div style={{ marginTop:"8px", color:"#746b63", fontSize:"11.5px", lineHeight:"1.8", direction:"rtl", textAlign:"right" }}>
          لماذا هذه القصة: {whyThisStory}
        </div>
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginTop:"8px", justifyContent:"flex-start" }}>
          {storyMetaHints.map((hint) => (
            <span key={`${item.id || item.title}:${hint}`} style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.06)", color:"#6e6a66", borderRadius:"999px", padding:"3px 8px", fontSize:"10px", fontWeight:"700" }}>
              {hint}
            </span>
          ))}
        </div>
        {open && (
          <div style={{ borderTop:`1px solid ${col.accent}33`, paddingTop:"10px", marginTop:"10px", animation:"expandIn .2s ease" }}>
            <p style={{
              color:"#777", fontSize:"13px", lineHeight:"1.9", margin:"0 0 10px",
              direction:"rtl", textAlign:"right",
            }}>
              {item.summary}
            </p>
            <div style={{ display:"flex", justifyContent:"space-between", gap:"8px", flexWrap:"wrap", color:"#615a53", fontSize:"11px" }}>
              <span>{timelineHint}</span>
              <span>{getLastUpdateHint(item)}</span>
            </div>
          </div>
        )}
        <div style={{ color:"#2e2e2e", fontSize:"10px", textAlign:"center", marginTop:"8px" }}>{open ? "▲" : "▼"}</div>
      </div>
      <div style={{ position:"absolute", left:0, top:0, bottom:0, width:"3px", background:`linear-gradient(180deg,${col.accent},transparent)` }} />
    </div>
  );
});

const HeroStory = memo(({ item }) => {
  if (!item) return null;
  const col = CAT_COLORS[item.category] || CAT_COLORS.all;
  const verificationState = item?.provenance?.verification?.state || "single_source";
  const editorialPriority = item?.provenance?.editorial?.priority || "normal";
  const editorialDecision = item?.provenance?.editorial?.decision || "publish";
  const verificationTone = getVerificationColor(verificationState);
  const editorialTone = getEditorialColor(editorialPriority);
  const storyMetaHints = getStoryMetaHints(item);

  return (
    <div style={{
      background:`linear-gradient(145deg, ${col.bg} 0%, #111 100%)`,
      border:`1px solid ${col.accent}55`, borderRadius:"18px", overflow:"hidden",
      boxShadow:`0 0 24px ${col.glow}`,
      marginBottom:"18px",
      position:"relative",
    }}>
      <div style={{ display:"grid", gridTemplateColumns:"1.25fr .9fr", gap:"0", alignItems:"stretch" }}>
        <div style={{ padding:"20px 22px" }}>
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginBottom:"12px" }}>
            <span style={{ background:urgencyBadge(item).bg, color:urgencyBadge(item).fg, border:`1px solid ${urgencyBadge(item).border}`, borderRadius:"999px", padding:"4px 10px", fontSize:"11px", fontWeight:"800" }}>
              {urgencyBadge(item).label}
            </span>
            <span style={{ background:verificationTone.bg, color:verificationTone.fg, border:`1px solid ${verificationTone.border}`, borderRadius:"999px", padding:"4px 10px", fontSize:"11px", fontWeight:"800" }}>
              {getVerificationLabel(verificationState)}
            </span>
            <span style={{ background:editorialTone.bg, color:editorialTone.fg, border:`1px solid ${editorialTone.border}`, borderRadius:"999px", padding:"4px 10px", fontSize:"11px", fontWeight:"800" }}>
              {editorialDecision}
            </span>
          </div>
          <h2 style={{ color:"#f4efe8", fontSize:"25px", lineHeight:"1.6", margin:"0 0 12px", fontWeight:"900", direction:"rtl", textAlign:"right" }}>
            {item.title}
          </h2>
          <p style={{ color:"#9b9187", fontSize:"14px", lineHeight:"2", direction:"rtl", textAlign:"right", margin:"0 0 14px" }}>
            {item.summary}
          </p>
          <div style={{ color:"#c0b7ac", fontSize:"12px", lineHeight:"1.9", direction:"rtl", textAlign:"right", margin:"0 0 12px" }}>
            لماذا هذه القصة: {getWhyThisStory(item)}
          </div>
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginBottom:"12px" }}>
            {storyMetaHints.map((hint) => (
              <span key={`hero:${item.id || item.title}:${hint}`} style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", color:"#a89d91", borderRadius:"999px", padding:"4px 10px", fontSize:"10.5px", fontWeight:"700" }}>
                {hint}
              </span>
            ))}
          </div>
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", color:"#7c746b", fontSize:"12px" }}>
            <span>{item.time}</span>
            <span>•</span>
            <span>{getConfidenceHint(item)}</span>
            <span>•</span>
            <span>{item?.provenance?.cluster?.corroboration_count || 0} تعزيز</span>
            <span>•</span>
            <span>{getTimelineHint(item)}</span>
          </div>
        </div>
        <div style={{ minHeight:"240px", position:"relative", background:`linear-gradient(160deg, ${col.accent}22, transparent)` }}>
          <img src={getImg(item.category, 0)} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"brightness(.55) saturate(.9)" }} loading="lazy" />
          <div style={{ position:"absolute", inset:0, background:`linear-gradient(90deg, transparent 0%, ${col.bg} 100%)` }} />
        </div>
      </div>
    </div>
  );
});

function urgencyBadge(item) {
  const urg = URGENCY_MAP[item?.urgency] || URGENCY_MAP.medium;
  return {
    label: urg.label,
    fg: urg.color,
    bg: `${urg.color}14`,
    border: `${urg.color}44`,
  };
}

function PriorityRail({ items }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom:"18px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"10px" }}>
        <h3 style={{ color:"#e8e4dc", fontSize:"15px", fontWeight:"800" }}>المسار الساخن</h3>
        <span style={{ color:"#555", fontSize:"11px" }}>أولوية تحريرية</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:"12px" }}>
        {items.map((item) => {
          const editorial = item?.provenance?.editorial || {};
          const verification = item?.provenance?.verification || {};
          return (
            <div key={`rail:${item.id || item.title}`} style={{ background:"#0f0f0f", border:"1px solid rgba(255,255,255,.07)", borderRadius:"14px", padding:"12px 14px" }}>
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"8px" }}>
                <span style={{ color:"#f39c12", fontSize:"10.5px", fontWeight:"800" }}>{getEditorialLabel(editorial.priority)}</span>
                <span style={{ color:"#5d6d7e", fontSize:"10.5px", fontWeight:"700" }}>{getVerificationLabel(verification.state)}</span>
              </div>
              <div style={{ color:"#efebe3", fontSize:"13px", fontWeight:"700", lineHeight:"1.7", direction:"rtl", textAlign:"right", marginBottom:"8px" }}>{item.title}</div>
              <div style={{ color:"#6e665f", fontSize:"11px", lineHeight:"1.8", direction:"rtl", textAlign:"right", marginBottom:"8px" }}>
                {getWhyThisStory(item)}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", color:"#5b5b5b", fontSize:"11px" }}>
                <span>{getConfidenceHint(item)}</span>
                <span>{item.time}</span>
              </div>
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginTop:"8px" }}>
                {getStoryMetaHints(item).slice(0, 2).map((hint) => (
                  <span key={`rail-hint:${item.id || item.title}:${hint}`} style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.06)", color:"#64605b", borderRadius:"999px", padding:"3px 8px", fontSize:"10px", fontWeight:"700" }}>
                    {hint}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const VideoCard = memo(({ item, index }) => {
  const [playing, setPlaying] = useState(false);
  const safeYtId = YOUTUBE_ID_RE.test(item?.youtubeId) ? item.youtubeId : null;
  const col = CAT_COLORS[item?.category] || CAT_COLORS.all;
  const cat = CATEGORIES.find(c => c.id === item?.category);
  if (!safeYtId) return null;

  return (
    <div style={{
      background:"#0e0e0e",
      border:`1px solid ${playing ? col.accent+"88" : "rgba(255,255,255,.07)"}`,
      borderRadius:"14px", overflow:"hidden",
      animation:`fadeUp .45s ease ${index*.07}s both`,
      boxShadow: playing ? `0 0 24px ${col.glow}` : "0 2px 10px rgba(0,0,0,.5)",
    }}>
      {playing ? (
        <div style={{ position:"relative", paddingBottom:"56.25%", background:"#000" }}>
          <iframe
            style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:"none" }}
            src={`https://www.youtube.com/embed/${safeYtId}?autoplay=1&rel=0`}
            title={item.title || "video"} allow="autoplay; encrypted-media" allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div onClick={() => setPlaying(true)} style={{ position:"relative", cursor:"pointer" }}>
          <img
            src={`https://img.youtube.com/vi/${safeYtId}/mqdefault.jpg`}
            alt={item.title || "video thumbnail"}
            style={{ width:"100%", aspectRatio:"16/9", objectFit:"cover", display:"block", filter:"brightness(.8)" }}
            loading="lazy"
          />
          <div style={{
            position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(0,0,0,.25)",
          }}>
            <div style={{
              width:"52px", height:"52px", borderRadius:"50%",
              background:"rgba(220,0,0,.9)",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 20px rgba(255,0,0,.5)",
            }}>
              <span style={{ color:"#fff", fontSize:"20px", marginRight:"-3px" }}>▶</span>
            </div>
          </div>
          {item.duration && (
            <div style={{ position:"absolute", bottom:"8px", left:"8px", background:"rgba(0,0,0,.82)", color:"#fff", borderRadius:"4px", padding:"2px 7px", fontSize:"11px", fontWeight:"700" }}>
              {item.duration}
            </div>
          )}
          {cat && (
            <div style={{ position:"absolute", top:"8px", right:"8px", background:"rgba(0,0,0,.72)", color:col.light, borderRadius:"20px", padding:"2px 9px", fontSize:"12px" }}>
              {cat.emoji} {cat.label}
            </div>
          )}
        </div>
      )}
      <div style={{ padding:"12px 14px 10px" }}>
        <h3 style={{ color:"#eee", fontSize:"13.5px", fontWeight:"600", lineHeight:"1.6", margin:0, direction:"rtl", textAlign:"right" }}>
          {item.title}
        </h3>
        {item.description && (
          <p style={{ color:"#4a4a4a", fontSize:"12px", margin:"6px 0 0", direction:"rtl", textAlign:"right", lineHeight:"1.6" }}>
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
});

function ChannelCard({ ch, active, onSelect }) {
  return (
    <div
      onClick={() => onSelect(ch)}
      style={{
        background: active ? ch.color+"20" : "#101010",
        border:`1px solid ${active ? ch.color+"88" : "rgba(255,255,255,.07)"}`,
        borderRadius:"12px", padding:"12px 14px", cursor:"pointer",
        transition:"all .2s",
        display:"flex", alignItems:"center", gap:"11px",
        boxShadow: active ? `0 0 14px ${ch.color}44` : "none",
      }}
    >
      <div style={{
        width:"40px", height:"40px", borderRadius:"50%",
        background:ch.color+"28", border:`2px solid ${ch.color}`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:"18px", flexShrink:0, position:"relative",
      }}>
        {ch.flag}
        {active && <span style={{ position:"absolute", top:-3, right:-3, width:9, height:9, borderRadius:"50%", background:"#e74c3c", border:"2px solid #090909", animation:"pulse 1.1s infinite" }} />}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ color: active?"#fff":"#ccc", fontWeight:"700", fontSize:"13.5px" }}>{ch.name}</div>
        <div style={{ color:"#444", fontSize:"11.5px" }}>{ch.desc}</div>
      </div>
      <div style={{
        background: active?"#e74c3c":"#1a1a1a",
        color: active?"#fff":"#444",
        borderRadius:"6px", padding:"4px 10px", fontSize:"11px", fontWeight:"700", flexShrink:0,
      }}>
        {active ? "● بث" : "▶"}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:"16px" }}>
      {Array.from({length:6}).map((_,i) => (
        <div key={i} style={{ background:"#101010", borderRadius:"14px", overflow:"hidden", animation:`shimmer 1.4s ease ${i*.1}s infinite alternate` }}>
          <div style={{ height:"142px", background:"#161616" }} />
          <div style={{ padding:"14px 16px" }}>
            <div style={{ height:"11px", width:"55px", background:"#1c1c1c", borderRadius:"4px", marginBottom:"10px" }} />
            <div style={{ height:"14px", background:"#181818", borderRadius:"4px", marginBottom:"7px" }} />
            <div style={{ height:"14px", width:"72%", background:"#181818", borderRadius:"4px" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab]             = useState("news");
  const [cat, setCat]             = useState("all");
  const [news, setNews]           = useState([]);
  const [videos, setVideos]       = useState([]);
  const [loadN, setLoadN]         = useState(false);
  const [loadV, setLoadV]         = useState(false);
  const [loadLive, setLoadLive]   = useState(false);
  const [errN, setErrN]           = useState(null);
  const [errV, setErrV]           = useState(null);
  const [errLive, setErrLive]     = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [liveSummary, setLiveSummary] = useState(null);
  const [liveCh, setLiveCh]       = useState(null);
  const [ticker, setTicker]       = useState("⚡ جارٍ تحميل الأخبار...");
  const [updated, setUpdated]     = useState(null);
  const [feedMeta, setFeedMeta]   = useState({
    mode: "legacy",
    fallback_used: false,
    verify_mode: false,
    item_count: 0,
    freshness: {
      latest_item_at: null,
      oldest_item_at: null,
      data_age_sec: null,
      last_ingestion_at: null,
    },
    correlation_id: null,
    error_reason: null,
  });
  const nCache = useRef({});
  const vCache = useRef({});
  const newsReqId = useRef(0);
  const videosReqId = useRef(0);
  const liveReqId = useRef(0);
  const newsControllerRef = useRef(null);
  const videosControllerRef = useRef(null);
  const liveControllerRef = useRef(null);

  const getNewsKey = (item) =>
    item?.id || item?.url || `${item?.category || "news"}:${item?.time || ""}:${item?.title || ""}`;

  const getVideoKey = (item) =>
    item?.id || item?.url || item?.youtubeId || `${item?.category || "video"}:${item?.title || ""}`;

  const getLiveKey = (item) => item?.id || item?.externalUrl || item?.name || "live-stream";

  const formatAge = (seconds) => {
    if (!Number.isFinite(seconds)) return "غير متاح";
    if (seconds < 60) return `${seconds}ث`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}د`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}س`;
    return `${Math.floor(seconds / 86400)}ي`;
  };

  const sourceBadge = (() => {
    if (feedMeta.verify_mode && feedMeta.mode === "stored" && !feedMeta.fallback_used) {
      return { label: "Verify Mode", color: "#f39c12", bg: "rgba(243,156,18,.14)", border: "rgba(243,156,18,.42)" };
    }
    if (feedMeta.fallback_used) {
      return { label: "Legacy Fallback", color: "#e67e22", bg: "rgba(230,126,34,.14)", border: "rgba(230,126,34,.42)" };
    }
    if (feedMeta.mode === "stored") {
      return { label: "Stored Production", color: "#16a085", bg: "rgba(22,160,133,.14)", border: "rgba(22,160,133,.42)" };
    }
    return { label: "Legacy", color: "#7f8c8d", bg: "rgba(127,140,141,.14)", border: "rgba(127,140,141,.42)" };
  })();

  const newsErrorHint = (() => {
    if (!errN) return null;
    if (feedMeta?.verify_mode && feedMeta?.mode === "stored" && !feedMeta?.fallback_used) {
      return "Stored failure في وضع Verify: تم تعطيل fallback الصامت. تحقق من /api/news/feed و ingestion.";
    }
    if (feedMeta?.fallback_used) {
      return "تم التحويل إلى Legacy Fallback بعد فشل stored path. راجع سبب الفشل التشغيلي.";
    }
    return null;
  })();

  const displayNews = dedupeVisualItems(news);
  const heroStory = pickHeroStory(displayNews);
  const priorityRail = pickPriorityRail(displayNews, heroStory);
  const remainingNews = displayNews.filter((item) => (item?.id || item?.title) !== (heroStory?.id || heroStory?.title));

  const fetchNews = useCallback(async (c) => {
    if (nCache.current[c]) { setNews(nCache.current[c]); return; }
    const reqId = ++newsReqId.current;
    newsControllerRef.current?.abort();
    const controller = new AbortController();
    newsControllerRef.current = controller;
    setLoadN(true); setErrN(null);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const envelope = await fetchNewsFeedEnvelope(c, controller.signal);
      const items = Array.isArray(envelope.items) ? envelope.items.filter(Boolean) : [];
      if (controller.signal.aborted || reqId !== newsReqId.current) return;
      clearTimeout(timer);
      nCache.current[c] = items;
      setNews(items);
      setFeedMeta(envelope.metadata);
      setUpdated(formatTimeLabel(Date.now()));
      if (items.length === 0) {
        setTicker("⚠️ لا توجد بيانات مخزنة بعد — شغّل ingestion");
      } else {
        setTicker(items.map(i => `🔴 ${typeof i.title === "string" ? i.title : ""}`).join("   ◆   "));
      }
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted || reqId !== newsReqId.current) return;
      if (err?.feedMeta) setFeedMeta(err.feedMeta);
      setErrN(err.name === "AbortError"
        ? "انتهت مهلة الاتصال (30 ث) — تحقق من اتصال الإنترنت وحاول مجدداً"
        : "تعذّر تحميل الأخبار المخزنة الآن — حاول مجددًا بعد التحقق من ingestion");
      setTicker("⚠️ تعذّر تحميل الأخبار");
    } finally {
      clearTimeout(timer);
      if (reqId === newsReqId.current) setLoadN(false);
    }
  }, []);

  const fetchVideos = useCallback(async (c) => {
    if (vCache.current[c]) { setVideos(vCache.current[c]); return; }
    const reqId = ++videosReqId.current;
    videosControllerRef.current?.abort();
    const controller = new AbortController();
    videosControllerRef.current = controller;
    setLoadV(true); setErrV(null);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const items = await callProxy("videos", c, controller.signal);
      if (controller.signal.aborted || reqId !== videosReqId.current) return;
      clearTimeout(timer);
      vCache.current[c] = items;
      setVideos(items);
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted || reqId !== videosReqId.current) return;
      setErrV(err.name === "AbortError"
        ? "انتهت مهلة الاتصال (30 ث) — تحقق من اتصال الإنترنت وحاول مجدداً"
        : sanitizeUserFacingError(err.message, "تعذّر تحميل الفيديوهات — حاول مجددًا"));
    } finally {
      clearTimeout(timer);
      if (reqId === videosReqId.current) setLoadV(false);
    }
  }, []);

  const fetchLiveStreams = useCallback(async () => {
    const reqId = ++liveReqId.current;
    liveControllerRef.current?.abort();
    const controller = new AbortController();
    liveControllerRef.current = controller;
    setLoadLive(true);
    setErrLive(null);
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch("/api/health/streams", { signal: controller.signal });
      if (!res.ok) {
        throw new Error("stream_snapshot_unavailable");
      }

      const body = await res.json();
      if (!Array.isArray(body?.streams)) throw new Error("صيغة streams غير صالحة");
      const channels = body.streams.map(mapStreamSnapshotEntry).filter(Boolean);
      if (controller.signal.aborted || reqId !== liveReqId.current) return;
      clearTimeout(timer);
      setLiveStreams(channels);
      setLiveSummary(body.summary || null);
      setLiveCh((current) => channels.find((channel) => channel.id === current?.id) || pickInitialLiveChannel(channels));
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted || reqId !== liveReqId.current) return;
      setErrLive(err.name === "AbortError"
        ? "انتهت مهلة تحميل حالة البث (30 ث)"
        : "تعذّر تحميل حالة البث الآن");
    } finally {
      clearTimeout(timer);
      if (reqId === liveReqId.current) setLoadLive(false);
    }
  }, []);

  useEffect(() => { fetchNews(cat); }, [cat, fetchNews]);
  useEffect(() => { if (tab === "videos") fetchVideos(cat); }, [tab, cat, fetchVideos]);
  useEffect(() => {
    if (tab === "live" && !loadLive && !errLive && liveStreams.length === 0) fetchLiveStreams();
  }, [tab, loadLive, errLive, liveStreams.length, fetchLiveStreams]);
  useEffect(() => () => {
    newsControllerRef.current?.abort();
    videosControllerRef.current?.abort();
    liveControllerRef.current?.abort();
  }, []);

  const changeCat = (id) => {
    if (id === cat) return;
    nCache.current = {}; vCache.current = {};
    setCat(id);
  };

  const refresh = () => {
    nCache.current = {}; vCache.current = {};
    fetchNews(cat);
    if (tab === "videos") fetchVideos(cat);
    if (tab === "live") fetchLiveStreams();
  };

  return (
    <div style={{ minHeight:"100vh", background:"#080808", color:"#e8e4dc", direction:"rtl", fontFamily:"'Noto Sans Arabic','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes fadeUp   {from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes expandIn {from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse    {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}
        @keyframes shimmer  {from{opacity:.4}to{opacity:.8}}
        @keyframes ticker   {from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes glow     {0%,100%{text-shadow:0 0 18px rgba(192,57,43,.5)}50%{text-shadow:0 0 36px rgba(192,57,43,.9)}}
        .tab:hover{background:rgba(255,255,255,.05)!important}
        .catbtn:hover{filter:brightness(1.3)}
        .refbtn:hover{background:rgba(192,57,43,.28)!important}
        .news-grid,.vid-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0d0d0d}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}
        .retry-btn{background:rgba(192,57,43,.18);border:1px solid rgba(192,57,43,.45);color:#e74c3c;border-radius:8px;padding:7px 18px;cursor:pointer;font-size:13px;font-family:inherit;transition:background .2s}
        .retry-btn:hover{background:rgba(192,57,43,.32)}
        @media(max-width:700px){.live-grid{grid-template-columns:1fr!important}}
        @media(max-width:600px){.news-grid,.vid-grid{grid-template-columns:1fr!important}}
      `}</style>

      {/* HEADER */}
      <div style={{ background:"linear-gradient(180deg,#100303 0%,#090909 100%)", borderBottom:"1px solid rgba(192,57,43,.22)", padding:"18px 24px 0" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"16px", flexWrap:"wrap", gap:"10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"11px" }}>
            <div style={{ width:36, height:36, borderRadius:"9px", background:"linear-gradient(135deg,#c0392b,#7b241c)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"17px", boxShadow:"0 0 16px rgba(192,57,43,.5)" }}>⚔️</div>
            <div>
              <h1 style={{ fontSize:"19px", fontWeight:"900", color:"#f0ece4", animation:"glow 3s infinite" }}>داشبورد أخبار المنطقة</h1>
              <p style={{ color:"#484848", fontSize:"11px", marginTop:"2px" }}>إيران · الخليج · أمريكا · إسرائيل</p>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"9px" }}>
            {updated && <span style={{ color:"#303030", fontSize:"11px" }}>⏱ {updated}</span>}
            <button className="refbtn" onClick={refresh} disabled={loadN||loadV} style={{ background:"rgba(192,57,43,.14)", border:"1px solid rgba(192,57,43,.3)", color:"#c0392b", borderRadius:"8px", padding:"7px 13px", cursor:"pointer", fontSize:"13px", fontWeight:"600", fontFamily:"inherit", transition:"all .2s", display:"flex", alignItems:"center", gap:"5px" }}>
              {loadN||loadV?"⏳":"🔄"} تحديث
            </button>
          </div>
        </div>

        <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginBottom:"12px" }}>
          <div style={{ background:sourceBadge.bg, border:`1px solid ${sourceBadge.border}`, color:sourceBadge.color, borderRadius:"999px", padding:"4px 10px", fontSize:"11.5px", fontWeight:"700" }}>
            {sourceBadge.label}
          </div>
          <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.09)", color:"#8a8a8a", borderRadius:"999px", padding:"4px 10px", fontSize:"11.5px" }}>
            source mode: {feedMeta.mode}
          </div>
          <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.09)", color:"#8a8a8a", borderRadius:"999px", padding:"4px 10px", fontSize:"11.5px" }}>
            عمر البيانات: {formatAge(feedMeta?.freshness?.data_age_sec)}
          </div>
          <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.09)", color:"#8a8a8a", borderRadius:"999px", padding:"4px 10px", fontSize:"11.5px" }}>
            آخر ingestion: {formatDateTime(feedMeta?.freshness?.last_ingestion_at)}
          </div>
          {feedMeta?.correlation_id && (
            <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.09)", color:"#6a6a6a", borderRadius:"999px", padding:"4px 10px", fontSize:"11px", fontFamily:"monospace" }}>
              cid: {feedMeta.correlation_id.slice(0, 8)}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:"4px", marginBottom:"10px" }}>
          {TABS.map(t => (
            <button key={t.id} className="tab" onClick={() => setTab(t.id)} style={{ background: tab===t.id?"rgba(192,57,43,.2)":"transparent", border:`1px solid ${tab===t.id?"rgba(192,57,43,.6)":"rgba(255,255,255,.07)"}`, color: tab===t.id?"#e74c3c":"#555", borderRadius:"8px 8px 0 0", padding:"8px 18px", cursor:"pointer", fontSize:"13.5px", fontWeight: tab===t.id?"700":"400", fontFamily:"inherit", transition:"all .2s", display:"flex", alignItems:"center", gap:"6px" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab !== "live" && (
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
            {CATEGORIES.map(c => (
              <button key={c.id} className="catbtn" onClick={() => changeCat(c.id)} style={{ background: cat===c.id?CAT_COLORS[c.id].accent+"22":"rgba(255,255,255,.03)", border:`1px solid ${cat===c.id?CAT_COLORS[c.id].accent+"66":"rgba(255,255,255,.07)"}`, color: cat===c.id?CAT_COLORS[c.id].light:"#555", borderRadius:"6px", padding:"5px 13px", cursor:"pointer", fontSize:"12.5px", fontWeight: cat===c.id?"700":"400", fontFamily:"inherit", transition:"all .2s" }}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TICKER */}
      <div style={{ background:"#0b0505", borderBottom:"1px solid rgba(192,57,43,.15)", padding:"8px 0", overflow:"hidden" }}>
        <div style={{ whiteSpace:"nowrap", animation:"ticker 50s linear infinite", display:"inline-block" }}>
          <span style={{ color:"#c0392b", fontSize:"12px", padding:"0 36px" }}>{ticker}&nbsp;&nbsp;&nbsp;&nbsp;{ticker}</span>
        </div>
      </div>

      {/* CONTENT */}
      <ErrorBoundary>
      <div style={{ padding:"20px 24px 40px" }}>

        {/* NEWS */}
        {tab === "news" && (
          <>
            {loadN && <Skeleton />}
            {errN && !loadN && (
              <div style={{ textAlign:"center", padding:"40px" }}>
                <p style={{ color:"#e74c3c", fontSize:"14px", marginBottom:"14px", direction:"rtl" }}>⚠️ {errN}</p>
                {newsErrorHint && (
                  <p style={{ color:"#a36f2b", fontSize:"12px", marginBottom:"14px", direction:"rtl" }}>
                    {newsErrorHint}
                  </p>
                )}
                <button className="retry-btn" onClick={() => { delete nCache.current[cat]; fetchNews(cat); }}>🔄 إعادة المحاولة</button>
              </div>
            )}
            {!loadN && !errN && news.length > 0 && (
              <>
                <div style={{ display:"flex", gap:"9px", marginBottom:"16px", flexWrap:"wrap", alignItems:"center" }}>
                  {["high","medium","low"].map(u => {
                    const n = displayNews.filter(x => x.urgency===u).length;
                    if (!n) return null;
                    return (
                      <div key={u} style={{ background:URGENCY_MAP[u].color+"14", border:`1px solid ${URGENCY_MAP[u].color}33`, borderRadius:"8px", padding:"4px 11px", display:"flex", alignItems:"center", gap:"6px" }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:URGENCY_MAP[u].color, flexShrink:0, animation:u==="high"?"pulse 1.1s infinite":"none" }} />
                        <span style={{ color:URGENCY_MAP[u].color, fontSize:"12px", fontWeight:"700" }}>{n} {URGENCY_MAP[u].label}</span>
                      </div>
                    );
                  })}
                  <span style={{ color:"#282828", fontSize:"12px", marginRight:"auto" }}>{displayNews.length} خبر</span>
                </div>
                <HeroStory item={heroStory} />
                <PriorityRail items={priorityRail} />
                <div className="news-grid">
                  {remainingNews.map((item,i) => <NewsCard key={getNewsKey(item)} item={item} index={i} />)}
                </div>
              </>
            )}
            {!loadN && !errN && news.length === 0 && (
              <div style={{ textAlign:"center", padding:"40px" }}>
                <p style={{ color:"#f39c12", fontSize:"14px", marginBottom:"8px", direction:"rtl" }}>
                  ⚠️ {feedMeta?.fallback_used ? "لا توجد بيانات fallback حالياً" : "لا توجد بيانات مخزنة بعد"}
                </p>
                <p style={{ color:"#555", fontSize:"12px", direction:"rtl" }}>
                  {feedMeta?.fallback_used
                    ? "Legacy fallback مفعل لكن لا توجد عناصر صالحة حالياً."
                    : "شغّل ingestion ثم أعد التحديث. في وضع Verify لا يتم fallback الصامت."}
                </p>
              </div>
            )}
          </>
        )}

        {/* VIDEOS */}
        {tab === "videos" && (
          <>
            {loadV && <Skeleton />}
            {errV && !loadV && (
              <div style={{ textAlign:"center", padding:"40px" }}>
                <p style={{ color:"#e74c3c", fontSize:"14px", marginBottom:"14px", direction:"rtl" }}>⚠️ {errV}</p>
                <button className="retry-btn" onClick={() => { delete vCache.current[cat]; fetchVideos(cat); }}>🔄 إعادة المحاولة</button>
              </div>
            )}
            {!loadV && !errV && videos.length > 0 && (
              <div className="vid-grid">
                {videos.map((v,i) => <VideoCard key={getVideoKey(v)} item={v} index={i} />)}
              </div>
            )}
            {!loadV && !errV && videos.length === 0 && (
              <div style={{ textAlign:"center", padding:"60px" }}>
                <p style={{ color:"#444", fontSize:"14px", marginBottom:"14px", direction:"rtl" }}>لم يتم تحميل فيديوهات بعد</p>
                <button className="retry-btn" onClick={() => fetchVideos(cat)}>▶ تحميل الفيديوهات</button>
              </div>
            )}
          </>
        )}

        {/* LIVE */}
        {tab === "live" && (
          <div className="live-grid" style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:"18px", alignItems:"start" }}>
            {loadLive && (
              <div style={{ gridColumn:"1 / -1" }}>
                <Skeleton />
              </div>
            )}

            {errLive && !loadLive && (
              <div style={{ gridColumn:"1 / -1", textAlign:"center", padding:"40px" }}>
                <p style={{ color:"#e74c3c", fontSize:"14px", marginBottom:"14px", direction:"rtl" }}>⚠️ {errLive}</p>
                <button className="retry-btn" onClick={fetchLiveStreams}>🔄 إعادة المحاولة</button>
              </div>
            )}

            {!loadLive && !errLive && liveCh && (
              <>
                <div style={{ background:"#0d0d0d", borderRadius:"16px", overflow:"hidden", border:"1px solid rgba(255,255,255,.07)" }}>
                  <div style={{ padding:"11px 15px", background:"#0f0f0f", borderBottom:"1px solid rgba(255,255,255,.05)", display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:liveCh.color, display:"inline-block", animation:liveCh.uptimeStatus === "up" ? "pulse 1.1s infinite" : "none" }} />
                    <span style={{ color:liveCh.color, fontWeight:"800", fontSize:"12.5px", letterSpacing:"1px" }}>حالة البث</span>
                    <span style={{ color:"#666", fontSize:"13px", marginRight:"6px" }}>{liveCh.flag} {liveCh.name}</span>
                    <span style={{ marginRight:"auto", color:liveCh.color, fontSize:"11.5px", fontWeight:"700" }}>{liveCh.statusLabel}</span>
                  </div>

                  {liveCh.playable && liveCh.embedUrl ? (
                    <div style={{ position:"relative", paddingBottom:"56.25%", background:"#000" }}>
                      <iframe
                        key={liveCh.id}
                        style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:"none" }}
                        src={liveCh.embedUrl}
                        title={liveCh.name}
                        allow="autoplay; encrypted-media; fullscreen"
                        allowFullScreen
                        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  ) : (
                    <div style={{ padding:"28px 22px", background:"linear-gradient(160deg,#130909 0%,#0b0b0b 100%)", direction:"rtl", textAlign:"right" }}>
                      <div style={{ color:"#f0ece4", fontSize:"18px", fontWeight:"800", marginBottom:"10px" }}>لا يوجد embed صالح لهذا المصدر الآن</div>
                      <div style={{ color:"#8c8176", fontSize:"13px", lineHeight:"1.9", marginBottom:"14px" }}>{liveCh.statusHint}</div>
                      <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", marginBottom:"14px" }}>
                        <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", color:"#9a8f83", borderRadius:"999px", padding:"4px 10px", fontSize:"11px" }}>الحالة: {liveCh.detailStatus}</span>
                        <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", color:"#9a8f83", borderRadius:"999px", padding:"4px 10px", fontSize:"11px" }}>{liveCh.externalOnly ? "mode: external-only" : "mode: degraded"}</span>
                        <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", color:"#9a8f83", borderRadius:"999px", padding:"4px 10px", fontSize:"11px" }}>آخر نجاح: {formatDateTime(liveCh.lastSuccessAt)}</span>
                        {liveCh.storyPublishedAt && <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", color:"#9a8f83", borderRadius:"999px", padding:"4px 10px", fontSize:"11px" }}>آخر قصة: {formatDateTime(liveCh.storyPublishedAt)}</span>}
                      </div>
                      {liveCh.storyTitle && <div style={{ color:"#d1c6bb", fontSize:"13px", lineHeight:"1.8", marginBottom:"12px" }}>آخر قصة مرتبطة: {liveCh.storyTitle}</div>}
                      {liveCh.externalUrl ? (
                        <a href={liveCh.externalUrl} target="_blank" rel="noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:"8px", background:"rgba(192,57,43,.16)", border:"1px solid rgba(192,57,43,.34)", color:"#e3b9b3", textDecoration:"none", borderRadius:"10px", padding:"10px 14px", fontSize:"13px", fontWeight:"700" }}>
                          فتح المصدر خارجيًا
                        </a>
                      ) : (
                        <div style={{ color:"#665f57", fontSize:"12px" }}>لا يوجد رابط خارجي صالح في snapshot الحالي.</div>
                      )}
                    </div>
                  )}

                  <div style={{ padding:"12px 15px", color:"#5c5c5c", fontSize:"11.5px", textAlign:"center" }}>
                    {liveCh.playable ? "يوجد رابط خارجي بديل أسفل القائمة إذا منع المزود الـ embed." : "تم تفعيل degraded mode بدل عرض player مكسور أو Video unavailable."}
                  </div>
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:"9px" }}>
                  <div style={{ color:"#3a3a3a", fontSize:"11.5px", marginBottom:"4px", fontWeight:"700", letterSpacing:"1px" }}>📡 المصادر المتاحة</div>
                  {liveSummary && (
                    <div style={{ background:"#101010", border:"1px solid rgba(255,255,255,.06)", borderRadius:"12px", padding:"12px 14px", color:"#666", fontSize:"11.5px", lineHeight:"1.8" }}>
                      active: {liveSummary.active_streams} · playable: {liveSummary.playable_streams} · external-only: {liveSummary.external_only_streams} · featured: {liveSummary.featured_stream_id || "-"}
                    </div>
                  )}
                  {liveStreams.map(ch => (
                    <div key={getLiveKey(ch)}>
                      <ChannelCard ch={ch} active={liveCh?.id===ch.id} onSelect={setLiveCh} />
                      {ch.externalUrl && (
                        <a href={ch.externalUrl} target="_blank" rel="noreferrer" style={{ display:"inline-flex", marginTop:"6px", color:"#88766a", fontSize:"11.5px", textDecoration:"none" }}>
                          فتح خارجي
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {!loadLive && !errLive && !liveCh && (
              <div style={{ gridColumn:"1 / -1", textAlign:"center", padding:"40px", color:"#666" }}>
                لا توجد streams قابلة للعرض حالياً.
              </div>
            )}
          </div>
        )}
      </div>
      </ErrorBoundary>

      {/* FOOTER */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,.04)", padding:"13px 24px", display:"flex", justifyContent:"space-between", color:"#333", fontSize:"11.5px", flexWrap:"wrap", gap:"6px" }}>
        <span>⚡ مدعوم بالذكاء الاصطناعي · <span style={{ color:"#c0392b" }}>البيانات مُولَّدة بواسطة AI وليست أخباراً رسمية</span></span>
        <span>للأغراض الإخبارية والمعلوماتية فقط</span>
      </div>
    </div>
  );
}
