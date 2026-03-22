import React, { useState, useEffect, useCallback, useRef, memo } from "react";

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

const LIVE_CHANNELS = [
  { id:"aljazeera_ar", name:"الجزيرة",           flag:"🇶🇦", color:"#8B6914", desc:"قناة الجزيرة الإخبارية",     youtubeId:"B0Bzmln-Z2Y" },
  { id:"alarabiya",    name:"العربية",            flag:"🇸🇦", color:"#1a4a8a", desc:"قناة العربية الإخبارية",     youtubeId:"oMoiMq9FnQs" },
  { id:"aljazeera_en", name:"Al Jazeera English", flag:"🌐", color:"#a07820", desc:"Al Jazeera English Live",     youtubeId:"h3MuIUNCCLI" },
  { id:"france24_ar",  name:"فرانس 24 عربي",     flag:"🇫🇷", color:"#c0392b", desc:"فرانس 24 عربي",             youtubeId:"vLjFSJFaHRk" },
  { id:"bbc_arabic",   name:"BBC عربي",           flag:"🇬🇧", color:"#b30000", desc:"بي بي سي عربي",             youtubeId:"8qoLDMH8pnk" },
  { id:"sky_news_ar",  name:"سكاي نيوز عربية",   flag:"🇦🇪", color:"#00529B", desc:"سكاي نيوز عربية",           youtubeId:"HHpTBCGQpgk" },
];

// AI prompts are defined server-side in /api/claude.js — not exposed in client bundle.

function getImg(catId, seed) {
  const arr = CAT_UNSPLASH[catId] || CAT_UNSPLASH.iran;
  const id = arr[seed % arr.length];
  return `https://images.unsplash.com/${id}?w=480&q=70&auto=format&fit=crop`;
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

// ── Components ───────────────────────────────────────────────────────────────

const NewsCard = memo(({ item, index }) => {
  const [open, setOpen] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const col = CAT_COLORS[item.category] || CAT_COLORS.all;
  const urg = URGENCY_MAP[item.urgency] || URGENCY_MAP.medium;
  const cat = CATEGORIES.find(c => c.id === item.category);

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
        <h3 style={{ color:"#f0ece4", fontSize:"14.5px", fontWeight:"700", lineHeight:"1.65", margin:0, direction:"rtl", textAlign:"right" }}>
          {item.title}
        </h3>
        {open && (
          <p style={{
            color:"#777", fontSize:"13px", lineHeight:"1.9", margin:"10px 0 0",
            direction:"rtl", textAlign:"right",
            borderTop:`1px solid ${col.accent}33`, paddingTop:"10px",
            animation:"expandIn .2s ease",
          }}>
            {item.summary}
          </p>
        )}
        <div style={{ color:"#2e2e2e", fontSize:"10px", textAlign:"center", marginTop:"8px" }}>{open ? "▲" : "▼"}</div>
      </div>
      <div style={{ position:"absolute", left:0, top:0, bottom:0, width:"3px", background:`linear-gradient(180deg,${col.accent},transparent)` }} />
    </div>
  );
});

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
  const [errN, setErrN]           = useState(null);
  const [errV, setErrV]           = useState(null);
  const [liveCh, setLiveCh]       = useState(LIVE_CHANNELS[0]);
  const [ticker, setTicker]       = useState("⚡ جارٍ تحميل الأخبار...");
  const [updated, setUpdated]     = useState(null);
  const nCache = useRef({});
  const vCache = useRef({});

  const fetchNews = useCallback(async (c) => {
    if (nCache.current[c]) { setNews(nCache.current[c]); return; }
    setLoadN(true); setErrN(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const items = await callProxy("news", c, controller.signal);
      clearTimeout(timer);
      nCache.current[c] = items;
      setNews(items);
      setUpdated(new Date().toLocaleTimeString("ar-SA"));
      setTicker(items.map(i => `🔴 ${typeof i.title === "string" ? i.title : ""}`).join("   ◆   "));
    } catch (err) {
      clearTimeout(timer);
      setErrN(err.name === "AbortError"
        ? "انتهت مهلة الاتصال (30 ث) — تحقق من اتصال الإنترنت وحاول مجدداً"
        : (err.message || "تعذّر تحميل الأخبار — حاول مجدداً"));
      setTicker("⚠️ تعذّر تحميل الأخبار");
    } finally { setLoadN(false); }
  }, []);

  const fetchVideos = useCallback(async (c) => {
    if (vCache.current[c]) { setVideos(vCache.current[c]); return; }
    setLoadV(true); setErrV(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const items = await callProxy("videos", c, controller.signal);
      clearTimeout(timer);
      vCache.current[c] = items;
      setVideos(items);
    } catch (err) {
      clearTimeout(timer);
      setErrV(err.name === "AbortError"
        ? "انتهت مهلة الاتصال (30 ث) — تحقق من اتصال الإنترنت وحاول مجدداً"
        : (err.message || "تعذّر تحميل الفيديوهات — حاول مجدداً"));
    } finally { setLoadV(false); }
  }, []);

  useEffect(() => { fetchNews(cat); }, [cat, fetchNews]);
  useEffect(() => { if (tab === "videos") fetchVideos(cat); }, [tab, cat, fetchVideos]);

  const changeCat = (id) => {
    if (id === cat) return;
    nCache.current = {}; vCache.current = {};
    setCat(id);
  };

  const refresh = () => {
    nCache.current = {}; vCache.current = {};
    fetchNews(cat);
    if (tab === "videos") fetchVideos(cat);
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
                <button className="retry-btn" onClick={() => { delete nCache.current[cat]; fetchNews(cat); }}>🔄 إعادة المحاولة</button>
              </div>
            )}
            {!loadN && !errN && news.length > 0 && (
              <>
                <div style={{ display:"flex", gap:"9px", marginBottom:"16px", flexWrap:"wrap", alignItems:"center" }}>
                  {["high","medium","low"].map(u => {
                    const n = news.filter(x => x.urgency===u).length;
                    if (!n) return null;
                    return (
                      <div key={u} style={{ background:URGENCY_MAP[u].color+"14", border:`1px solid ${URGENCY_MAP[u].color}33`, borderRadius:"8px", padding:"4px 11px", display:"flex", alignItems:"center", gap:"6px" }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:URGENCY_MAP[u].color, flexShrink:0, animation:u==="high"?"pulse 1.1s infinite":"none" }} />
                        <span style={{ color:URGENCY_MAP[u].color, fontSize:"12px", fontWeight:"700" }}>{n} {URGENCY_MAP[u].label}</span>
                      </div>
                    );
                  })}
                  <span style={{ color:"#282828", fontSize:"12px", marginRight:"auto" }}>{news.length} خبر</span>
                </div>
                <div className="news-grid">
                  {news.map((item,i) => <NewsCard key={i} item={item} index={i} />)}
                </div>
              </>
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
                {videos.map((v,i) => <VideoCard key={i} item={v} index={i} />)}
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
            {/* Player */}
            <div style={{ background:"#0d0d0d", borderRadius:"16px", overflow:"hidden", border:"1px solid rgba(255,255,255,.07)" }}>
              <div style={{ padding:"11px 15px", background:"#0f0f0f", borderBottom:"1px solid rgba(255,255,255,.05)", display:"flex", alignItems:"center", gap:"10px" }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:"#e74c3c", display:"inline-block", animation:"pulse 1.1s infinite" }} />
                <span style={{ color:"#e74c3c", fontWeight:"800", fontSize:"12.5px", letterSpacing:"1px" }}>بث مباشر</span>
                <span style={{ color:"#666", fontSize:"13px", marginRight:"6px" }}>{liveCh.flag} {liveCh.name}</span>
              </div>
              <div style={{ position:"relative", paddingBottom:"56.25%", background:"#000" }}>
                <iframe
                  key={liveCh.id}
                  style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:"none" }}
                  src={YOUTUBE_ID_RE.test(liveCh.youtubeId) ? `https://www.youtube.com/embed/${liveCh.youtubeId}?autoplay=1&rel=0` : "about:blank"}
                  title={liveCh.name}
                  allow="autoplay; encrypted-media; fullscreen"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div style={{ padding:"12px 15px", color:"#333", fontSize:"11.5px", textAlign:"center" }}>
                💡 إذا لم يعمل البث، اضغط على القناة مجدداً أو جرب قناة أخرى
              </div>
            </div>

            {/* Channels */}
            <div style={{ display:"flex", flexDirection:"column", gap:"9px" }}>
              <div style={{ color:"#3a3a3a", fontSize:"11.5px", marginBottom:"4px", fontWeight:"700", letterSpacing:"1px" }}>📡 القنوات المتاحة</div>
              {LIVE_CHANNELS.map(ch => (
                <ChannelCard key={ch.id} ch={ch} active={liveCh.id===ch.id} onSelect={setLiveCh} />
              ))}
            </div>
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
