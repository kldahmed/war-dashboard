import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { fetchNewsFeedEnvelope } from './data/newsAdapter';

/* ─────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'all',        label: 'الكل' },
  { id: 'breaking',   label: 'عاجل' },
  { id: 'war',        label: 'حرب' },
  { id: 'politics',   label: 'سياسة' },
  { id: 'economy',    label: 'اقتصاد' },
  { id: 'gulf',       label: 'الخليج' },
  { id: 'iran',       label: 'إيران' },
  { id: 'israel',     label: 'إسرائيل' },
  { id: 'usa',        label: 'أمريكا' },
  { id: 'world',      label: 'العالم' },
  { id: 'energy',     label: 'طاقة' },
  { id: 'analysis',   label: 'تحليل' },
  { id: 'technology', label: 'تقنية' },
];

const TABS = [
  { id: 'news',  label: 'الأخبار',        icon: '📰' },
  { id: 'live',  label: 'البث المباشر',   icon: '📡' },
  { id: 'ops',   label: 'غرفة الأخبار',   icon: '🧭' },
  { id: 'ai',    label: 'مساعد ذكي',      icon: '🤖' },
];

const URGENCY_WEIGHT = { high: 3, medium: 2, low: 1 };

const ALERT_THRESHOLDS = {
  feed_stale_critical:      3600,
  feed_stale_warning:       1800,
  ingestion_stale_critical: 7200,
  ingestion_stale_warning:  3600,
  job_failures_critical:    3,
  job_failures_warning:     1,
  down_streams_critical:    5,
  down_streams_warning:     2,
  failing_sources_critical: 5,
  failing_sources_warning:  2,
};

const SUGGESTED_PROMPTS = [
  { label: '⚡ العاجل',          q: 'ما أبرز الأخبار العاجلة الآن؟ رتّبها حسب الأهمية.' },
  { label: '🔍 تحليل الموقف', q: 'حلّل التوترات في الشرق الأوسط من الأخبار الحالية.' },
  { label: '⚖️ تناقضات',       q: 'هل هناك تناقضات بين المصادر حول نفس الحدث؟' },
  { label: '📊 الأوثق',          q: 'ما الأخبار الأكثر توثيقاً ومصداقية في هذه الدفعة؟' },
  { label: '🌍 الصورة الكبيرة', q: 'كيف تلخص المشهد الجيوسياسي الراهن في المنطقة؟' },
];

const PLACEHOLDER_IMGS = [
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=60',
  'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=800&q=60',
  'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&q=60',
  'https://images.unsplash.com/photo-1526628953301-3cd40f68f9e3?w=800&q=60',
  'https://images.unsplash.com/photo-1611605698335-8b1569810432?w=800&q=60',
];

/* ─────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────── */
function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)  return 'منذ لحظات';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

function fmtSeconds(s) {
  if (!s && s !== 0) return '—';
  const n = Number(s);
  if (n < 60)   return `${n}ث`;
  if (n < 3600) return `${Math.floor(n / 60)}د`;
  return `${Math.floor(n / 3600)}س ${Math.floor((n % 3600) / 60)}د`;
}

function categoryColor(cat) {
  const map = {
    breaking: '#e53e3e', war: '#c53030', politics: '#3182ce',
    economy: '#38a169', gulf: '#d69e2e', iran: '#805ad5',
    israel: '#2b6cb0', usa: '#2c7a7b', world: '#4a5568',
    energy: '#dd6b20', analysis: '#6b46c1', technology: '#0987a0',
  };
  return map[cat] || '#4a5568';
}

function urgencyLabel(u) {
  return u === 'high' ? 'عاجل' : u === 'medium' ? 'مهم' : '';
}

function stripHtml(str) {
  return str ? str.replace(/<[^>]*>/g, '') : '';
}

function getPlaceholderImg(idx) {
  return PLACEHOLDER_IMGS[idx % PLACEHOLDER_IMGS.length];
}

function pct(value) {
  const num = Number(value || 0);
  return `${Math.round(num * 100)}%`;
}

function verificationLabel(state) {
  const labels = {
    corroborated: 'موثق',
    partially_corroborated: 'مدعوم جزئيا',
    single_source: 'مصدر واحد',
    needs_review: 'يحتاج مراجعة',
  };
  return labels[state] || 'غير محدد';
}

function editorialPriorityLabel(priority) {
  const labels = {
    review: 'مراجعة',
    high: 'مرتفع',
    elevated: 'مهم',
    normal: 'طبيعي',
  };
  return labels[priority] || 'طبيعي';
}

function editorialDecisionLabel(decision) {
  const labels = {
    hold: 'إيقاف',
    update: 'تحديث',
    merge: 'دمج',
    publish: 'نشر',
  };
  return labels[decision] || 'نشر';
}

/* ─────────────────────────────────────────────────
   SMALL COMPONENTS
───────────────────────────────────────────────── */
function BreakingTicker({ items }) {
  if (!items || items.length === 0) return null;
  const headlines = items.filter(i => i.urgency === 'high').slice(0, 8);
  if (headlines.length === 0) return null;
  return (
    <div className="ticker-bar" dir="rtl">
      <span className="ticker-label">⚡ عاجل</span>
      <div className="ticker-track">
        <div className="ticker-inner">
          {[...headlines, ...headlines].map((h, i) => (
            <span key={i} className="ticker-item">
              {h.title}
              <span className="ticker-sep">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryBadge({ category }) {
  if (!category || category === 'all') return null;
  return (
    <span
      className="cat-badge"
      style={{ background: categoryColor(category) }}
    >
      {CATEGORIES.find(c => c.id === category)?.label || category}
    </span>
  );
}

function UrgencyDot({ urgency }) {
  if (!urgency || urgency === 'low') return null;
  return (
    <span className={`urgency-dot urgency-dot--${urgency}`} title={urgencyLabel(urgency)} />
  );
}

function TrustBar({ score }) {
  if (score == null) return null;
  const pct = Math.min(100, Math.max(0, Number(score) * 100));
  const color = pct > 70 ? '#38a169' : pct > 40 ? '#d69e2e' : '#e53e3e';
  return (
    <div className="trust-bar" title={`مصداقية ${pct.toFixed(0)}%`}>
      <div className="trust-bar__fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function LoadingSpinner({ label = 'جاري التحميل…' }) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner" dir="rtl">
      <span>⚠ {message}</span>
      {onRetry && <button className="btn btn--ghost btn--sm" onClick={onRetry}>إعادة المحاولة</button>}
    </div>
  );
}

function SignalPill({ tone = 'neutral', children }) {
  return <span className={`signal-pill signal-pill--${tone}`}>{children}</span>;
}

function BriefingMetric({ label, value, tone = 'neutral' }) {
  return (
    <div className="briefing-metric">
      <span className="briefing-metric__label">{label}</span>
      <span className={`briefing-metric__value briefing-metric__value--${tone}`}>{value}</span>
    </div>
  );
}

function BriefingPanel({ briefing }) {
  if (!briefing) return null;

  const lead = briefing.lead_story;
  const radar = briefing.verification_radar || {};
  const queue = briefing.editorial_queue || {};
  const momentum = briefing.momentum || {};

  return (
    <section className="briefing-panel" dir="rtl">
      <div className="briefing-panel__header">
        <div>
          <div className="section-label section-label--flush">لوحة التحرير الذكية</div>
          <p className="briefing-panel__subhead">ترتيب القصص حسب الزخم، التحقق، والتعارض بين المصادر.</p>
        </div>
        <div className="briefing-panel__signals">
          <SignalPill tone="blue">{momentum.high_priority_count || 0} قصص عالية الأولوية</SignalPill>
          <SignalPill tone="green">{momentum.corroborated_count || 0} موثقة</SignalPill>
          {(momentum.review_count || 0) > 0 && <SignalPill tone="red">{momentum.review_count} تحتاج مراجعة</SignalPill>}
        </div>
      </div>

      <div className="briefing-panel__grid">
        <div className="briefing-card briefing-card--lead">
          <div className="briefing-card__eyebrow">القصة القائدة</div>
          {lead ? (
            <>
              <h3 className="briefing-card__title">{lead.title}</h3>
              <div className="briefing-card__chips">
                <SignalPill tone={lead.contradiction_flag ? 'red' : 'green'}>{verificationLabel(lead.verification_state)}</SignalPill>
                <SignalPill tone="amber">{editorialPriorityLabel(lead.editorial_priority)}</SignalPill>
                <SignalPill tone="blue">{editorialDecisionLabel(lead.editorial_decision)}</SignalPill>
              </div>
              <div className="briefing-card__meta">
                <span>{lead.source_name}</span>
                <span>·</span>
                <span>{relativeTime(lead.published_at)}</span>
              </div>
              <div className="briefing-metrics">
                <BriefingMetric label="الثقة" value={pct(lead.confidence_score)} tone="green" />
                <BriefingMetric label="الترتيب" value={pct(lead.rank_score)} tone="blue" />
                <BriefingMetric label="التعضيد" value={lead.corroboration_count || 0} tone="amber" />
                <BriefingMetric label="تنوع المصادر" value={lead.source_diversity || 1} />
              </div>
            </>
          ) : (
            <p className="briefing-empty">لا توجد قصة قائدة حاليا.</p>
          )}
        </div>

        <div className="briefing-card">
          <div className="briefing-card__eyebrow">رادار التحقق</div>
          <div className="briefing-metrics briefing-metrics--compact">
            <BriefingMetric label="موثق" value={radar.corroborated || 0} tone="green" />
            <BriefingMetric label="جزئي" value={radar.partially_corroborated || 0} tone="amber" />
            <BriefingMetric label="مصدر واحد" value={radar.single_source || 0} />
            <BriefingMetric label="متوسط الثقة" value={pct(radar.average_confidence || 0)} tone="blue" />
          </div>
        </div>

        <div className="briefing-card">
          <div className="briefing-card__eyebrow">قرار التحرير</div>
          <div className="briefing-metrics briefing-metrics--compact">
            <BriefingMetric label="نشر" value={queue.publish || 0} tone="green" />
            <BriefingMetric label="تحديث" value={queue.update || 0} tone="blue" />
            <BriefingMetric label="دمج" value={queue.merge || 0} tone="amber" />
            <BriefingMetric label="إيقاف" value={queue.hold || 0} tone="red" />
          </div>
        </div>

        <div className="briefing-card briefing-card--list">
          <div className="briefing-card__eyebrow">قصص تحتاج مراجعة</div>
          {briefing.disputed_stories?.length ? (
            briefing.disputed_stories.map((story) => (
              <div key={story.id} className="briefing-list-item">
                <div>
                  <p className="briefing-list-item__title">{story.title}</p>
                  <span className="briefing-list-item__meta">{story.source_name} · {relativeTime(story.published_at)}</span>
                </div>
                <SignalPill tone="red">{verificationLabel(story.verification_state)}</SignalPill>
              </div>
            ))
          ) : (
            <p className="briefing-empty">لا توجد قصص متنازع عليها في هذه الدفعة.</p>
          )}
        </div>

        <div className="briefing-card briefing-card--list">
          <div className="briefing-card__eyebrow">رادار التجميع</div>
          {briefing.cluster_watch?.length ? (
            briefing.cluster_watch.map((story) => (
              <div key={story.id} className="briefing-list-item">
                <div>
                  <p className="briefing-list-item__title">{story.title}</p>
                  <span className="briefing-list-item__meta">{story.corroboration_count} دعم · {story.source_diversity} مصادر</span>
                </div>
                <SignalPill tone="blue">{pct(story.rank_score)}</SignalPill>
              </div>
            ))
          ) : (
            <p className="briefing-empty">لا توجد عناقيد بارزة حاليا.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────
   NEWS CARDS
───────────────────────────────────────────────── */
function HeroCard({ item, idx }) {
  if (!item) return null;
  const imgUrl = item.image_url || getPlaceholderImg(idx);
  return (
    <article className="hero-card" dir="rtl">
      <a href={item.link || '#'} target="_blank" rel="noopener noreferrer" className="hero-card__img-wrap">
        <img src={imgUrl} alt={item.title} className="hero-card__img" loading="eager"
          onError={e => { e.target.src = getPlaceholderImg(idx + 1); }} />
        <div className="hero-card__overlay" />
        <div className="hero-card__meta">
          <CategoryBadge category={item.category} />
          {item.urgency === 'high' && <span className="badge badge--breaking">⚡ عاجل</span>}
        </div>
      </a>
      <div className="hero-card__body">
        <h2 className="hero-card__title">
          <a href={item.link || '#'} target="_blank" rel="noopener noreferrer">{item.title}</a>
        </h2>
        {item.summary && (
          <p className="hero-card__summary">{stripHtml(item.summary).slice(0, 180)}…</p>
        )}
        <div className="hero-card__footer">
          <span className="source-name">{item.source?.name || 'مصدر'}</span>
          <span className="dot">·</span>
          <time className="time-ago">{relativeTime(item.time || item.publishedAt || item.published_at)}</time>
          <TrustBar score={item.source?.trust_score} />
        </div>
      </div>
    </article>
  );
}

function NewsCard({ item, idx, size = 'md' }) {
  if (!item) return null;
  const imgUrl = item.image_url || getPlaceholderImg(idx);
  return (
    <article className={`news-card news-card--${size}`} dir="rtl">
      <a href={item.link || '#'} target="_blank" rel="noopener noreferrer" className="news-card__img-wrap">
        <img src={imgUrl} alt={item.title} className="news-card__img" loading="lazy"
          onError={e => { e.target.src = getPlaceholderImg(idx + 2); }} />
        <div className="news-card__overlay" />
        <div className="news-card__badges">
          <UrgencyDot urgency={item.urgency} />
          <CategoryBadge category={item.category} />
        </div>
      </a>
      <div className="news-card__body">
        <h3 className="news-card__title">
          <a href={item.link || '#'} target="_blank" rel="noopener noreferrer">{item.title}</a>
        </h3>
        {size !== 'sm' && item.summary && (
          <p className="news-card__summary">{stripHtml(item.summary).slice(0, 100)}…</p>
        )}
        <div className="news-card__footer">
          <span className="source-name">{item.source?.name || 'مصدر'}</span>
          <time className="time-ago">{relativeTime(item.time || item.publishedAt || item.published_at)}</time>
        </div>
      </div>
    </article>
  );
}

function ListItem({ item, idx }) {
  if (!item) return null;
  return (
    <a
      href={item.link || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="list-item"
      dir="rtl"
    >
      <div className="list-item__indicator" style={{ background: categoryColor(item.category) }} />
      <div className="list-item__body">
        <p className="list-item__title">{item.title}</p>
        <span className="list-item__meta">
          {item.source?.name} · {relativeTime(item.time || item.publishedAt || item.published_at)}
        </span>
      </div>
      {item.urgency === 'high' && <span className="badge badge--breaking badge--xs">⚡</span>}
    </a>
  );
}

/* ─────────────────────────────────────────────────
   LIVE CHANNEL COMPONENTS
───────────────────────────────────────────────── */
function ChannelCard({ stream, onSelect, isActive }) {
  if (!stream) return null;
  const s = stream.stream || stream;
  const name = stream.source?.name || s.name || s.registry_id || '';
  const isOnline = s.uptime_status === 'up' || s.uptime_status === 'degraded' || s.status === 'active';
  return (
    <button
      className={`ch-card ${isActive ? 'ch-card--active' : ''} ${isOnline ? '' : 'ch-card--offline'}`}
      onClick={() => onSelect(stream)}
      title={name}
    >
      <div className="ch-card__logo">
        {s.logo_url
          ? <img src={s.logo_url} alt={name} loading="lazy" onError={e => { e.target.style.display='none'; }} />
          : <span className="ch-card__logo-text">{name.slice(0, 3)}</span>
        }
        <span className={`ch-status-dot ${isOnline ? 'ch-status-dot--live' : ''}`} />
      </div>
      <div className="ch-card__info">
        <span className="ch-card__name">{name}</span>
        <span className="ch-card__country">{stream.source?.language || s.language || ''}</span>
      </div>
    </button>
  );
}

function PlayerPanel({ stream, onClose }) {
  if (!stream) return null;
  const s = stream.stream || stream;
  const name = stream.source?.name || s.name || s.registry_id || '';
  const embedUrl = s.embed_url || s.embedUrl;
  const watchUrl = s.external_watch_url || s.official_page_url;
  return (
    <div className="player-panel" dir="rtl">
      <div className="player-panel__header">
        <div className="player-panel__title">
          {s.logo_url && <img src={s.logo_url} alt={name} className="player-panel__logo" />}
          <span>{name}</span>
          {(s.uptime_status === 'up' || s.status === 'active') && (
            <span className="live-badge">● مباشر</span>
          )}
        </div>
        <div className="player-panel__actions">
          {(embedUrl || watchUrl) && (
            <a href={embedUrl || watchUrl} target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--sm">
              ↗ فتح خارجي
            </a>
          )}
          <button className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="player-panel__screen">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={name}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="player-iframe"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <div className="player-no-embed">
            <div className="player-no-embed__icon">📡</div>
            <p>لا يتوفر رابط تضمين مباشر لهذه القناة</p>
            {watchUrl && (
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
                مشاهدة على الموقع الرسمي ↗
              </a>
            )}
          </div>
        )}
      </div>
      {s.description && (
        <p className="player-panel__desc">{s.description}</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   NEWSROOM ALERTS
───────────────────────────────────────────────── */
function AlertsPanel({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  const criticals = alerts.filter(a => a.severity === 'critical');
  const warnings  = alerts.filter(a => a.severity === 'warning');
  const oks       = alerts.filter(a => a.severity === 'ok');
  const icon = { critical: '⛔', warning: '⚠️', ok: '✅' };
  return (
    <div className="alerts-panel" dir="rtl">
      {criticals.length > 0 && (
        <div className="alerts-group alerts-group--critical">
          {criticals.map((a, i) => (
            <div key={i} className="alert-row alert-row--critical">
              <span className="alert-icon">{icon.critical}</span>
              <span className="alert-msg">{a.message}</span>
            </div>
          ))}
        </div>
      )}
      {warnings.map((a, i) => (
        <div key={i} className="alert-row alert-row--warning">
          <span className="alert-icon">{icon.warning}</span>
          <span className="alert-msg">{a.message}</span>
        </div>
      ))}
      {oks.map((a, i) => (
        <div key={i} className="alert-row alert-row--ok">
          <span className="alert-icon">{icon.ok}</span>
          <span className="alert-msg">{a.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   AI CHAT
───────────────────────────────────────────────── */
function AiChat({ newsItems }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'مرحباً! أنا محللك الجيوسياسي. يمكنك سؤالي عن أي حدث أو تطلب تحليلاً بناءً على أخبار اليوم الفعلية.' }
  ]);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (forcedText = '') => {
    const text = (forcedText || input).trim();
    if (!text || loading) return;
    if (!forcedText) setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const items = (newsItems || []).slice(0, 25);
      const ctx = items.map(h => {
        const cat     = CATEGORIES.find(c => c.id === h.category)?.label || h.category;
        const urgTag  = h.urgency === 'high' ? ' ⚡عاجل' : h.urgency === 'medium' ? ' ●مهم' : '';
        const trust   = h.source?.trust_score != null
          ? ` [ثقة: ${Math.round(h.source.trust_score * 100)}%]` : '';
        const vState  = h.provenance?.verification?.state
          ? ` [${verificationLabel(h.provenance.verification.state)}]` : '';
        const corr    = Number(h.provenance?.cluster?.corroboration_count || 0);
        const corrTag = corr > 1 ? ` (${corr} مصادر داعمة)` : '';
        const sum     = h.summary
          ? `\n   الملخص: ${stripHtml(h.summary).slice(0, 120)}` : '';
        return `• [${cat}]${urgTag}${trust}${vState}${corrTag}\n   ${h.title}${sum}\n   المصدر: ${h.source?.name || '؟'}`;
      }).join('\n\n');
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: ctx ? `أخبار اليوم (${items.length} خبر):\n${ctx}` : '',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data.response || data.content || data.text || 'لم أتمكن من توليد رد.';
      setMessages(m => [...m, { role: 'assistant', text: reply }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: `⚠ خطأ: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, newsItems]);

  const handleKey = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  return (
    <div className="ai-chat" dir="rtl">
      <div className="ai-chat__history">
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.role}`}>
            <div className="ai-msg__bubble">{m.text}</div>
          </div>
        ))}
        {loading && (
          <div className="ai-msg ai-msg--assistant">
            <div className="ai-msg__bubble ai-msg__bubble--typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="ai-chat__suggestions">
        {SUGGESTED_PROMPTS.map((p, i) => (
          <button
            key={i}
            className="ai-suggest-btn"
            onClick={() => send(p.q)}
            disabled={loading}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="ai-chat__input-row">
        <textarea
          className="ai-chat__input"
          placeholder="اكتب سؤالك…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          disabled={loading}
          dir="rtl"
        />
        <button className="btn btn--primary" onClick={() => send()} disabled={loading || !input.trim()}>
          {loading ? '…' : 'إرسال'}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   NEWSROOM PRO DASHBOARD
───────────────────────────────────────────────── */
function KpiCard({ title, value, sub, color = 'var(--accent)' }) {
  return (
    <div className="kpi-card" dir="rtl">
      <span className="kpi-title">{title}</span>
      <span className="kpi-value" style={{ color }}>{value ?? '–'}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function NewsroomDashboard({ newsroomStatus, metricsBasic, updatedAt, onRefresh, loading }) {
  const nr = newsroomStatus || {};
  const mb = metricsBasic || {};
  const counters = mb.counters || {};
  const lastJob  = mb.last_job;
  const feedMs   = nr.feed_staleness?.seconds_since_last_feed;
  const ingMs    = nr.ingestion_staleness?.seconds_since_last_ingestion;
  const failures = nr.recent_failures || [];
  const srcFails = nr.source_failure_summary || [];
  const readiness = nr.operator_readiness;

  const alertItems = useMemo(() => {
    const items = [];
    if (feedMs != null) {
      if (feedMs > ALERT_THRESHOLDS.feed_stale_critical)
        items.push({ severity: 'critical', message: `التغذية متوقفة منذ ${fmtSeconds(feedMs)} — تحقق فوري` });
      else if (feedMs > ALERT_THRESHOLDS.feed_stale_warning)
        items.push({ severity: 'warning', message: `التغذية بطيئة (${fmtSeconds(feedMs)})` });
      else
        items.push({ severity: 'ok', message: `التغذية حية (${fmtSeconds(feedMs)})` });
    }
    if (ingMs != null) {
      if (ingMs > ALERT_THRESHOLDS.ingestion_stale_critical)
        items.push({ severity: 'critical', message: `الاستيعاب متوقف منذ ${fmtSeconds(ingMs)}` });
      else if (ingMs > ALERT_THRESHOLDS.ingestion_stale_warning)
        items.push({ severity: 'warning', message: `الاستيعاب بطيء (${fmtSeconds(ingMs)})` });
      else
        items.push({ severity: 'ok', message: `الاستيعاب حي (${fmtSeconds(ingMs)})` });
    }
    if (failures.length >= ALERT_THRESHOLDS.job_failures_critical)
      items.push({ severity: 'critical', message: `${failures.length} إخفاقات حديثة في المهام` });
    else if (failures.length >= ALERT_THRESHOLDS.job_failures_warning)
      items.push({ severity: 'warning', message: `${failures.length} إخفاقات في المهام` });
    else if (failures.length === 0)
      items.push({ severity: 'ok', message: 'جميع المهام تعمل بشكل طبيعي' });
    return items;
  }, [feedMs, ingMs, failures]);

  if (loading) return <LoadingSpinner label="تحديث غرفة الأخبار…" />;

  return (
    <div className="ops-dashboard" dir="rtl">
      {/* Header */}
      <div className="ops-header">
        <div>
          <h2 className="ops-title">🧭 غرفة الأخبار التشغيلية</h2>
          {updatedAt && (
            <span className="ops-updated">آخر تحديث: {relativeTime(updatedAt)}</span>
          )}
        </div>
        <div className="ops-header-actions">
          {readiness && (
            <span className={`readiness-badge readiness-badge--${readiness.status}`}>
              {readiness.status === 'green' ? '✅ مستعد' : readiness.status === 'yellow' ? '⚠️ تحذير' : '⛔ إنذار'}
            </span>
          )}
          <button className="btn btn--ghost btn--sm" onClick={onRefresh}>↻ تحديث</button>
        </div>
      </div>

      {/* Alerts */}
      <AlertsPanel alerts={alertItems} />

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard title="المصادر" value={counters.sources} sub="sources" />
        <KpiCard title="التغذيات" value={counters.source_feeds} sub="feeds" />
        <KpiCard title="العناصر الخام" value={counters.raw_items} sub="raw items" color="var(--gold)" />
        <KpiCard title="عناصر مُعالَجة" value={counters.normalized_items} sub="normalized" color="#38a169" />
        <KpiCard title="جمود التغذية" value={fmtSeconds(feedMs)} sub="staleness" color={feedMs > ALERT_THRESHOLDS.feed_stale_critical ? '#e53e3e' : 'inherit'} />
        <KpiCard title="جمود الاستيعاب" value={fmtSeconds(ingMs)} sub="staleness" color={ingMs > ALERT_THRESHOLDS.ingestion_stale_critical ? '#e53e3e' : 'inherit'} />
      </div>

      {/* Last Job */}
      {lastJob && (
        <div className="ops-section">
          <h3 className="ops-section-title">آخر مهمة</h3>
          <div className="job-row">
            <span className={`job-status-badge job-status-badge--${lastJob.status}`}>{lastJob.status}</span>
            <span className="job-type">{lastJob.job_type}</span>
            {lastJob.latency_ms != null && (
              <span className="job-latency">{lastJob.latency_ms}ms</span>
            )}
            <time className="time-ago">{relativeTime(lastJob.created_at)}</time>
          </div>
        </div>
      )}

      {/* Recent Failures */}
      {failures.length > 0 && (
        <div className="ops-section">
          <h3 className="ops-section-title ops-section-title--warn">إخفاقات حديثة ({failures.length})</h3>
          <div className="failures-list">
            {failures.slice(0, 8).map((f, i) => (
              <div key={i} className="failure-row">
                <span className="failure-type">{f.job_type || f.type || 'unknown'}</span>
                <span className="failure-msg">{f.error_message || f.message || '—'}</span>
                <time className="time-ago">{relativeTime(f.created_at || f.at)}</time>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source Failures */}
      {srcFails.length > 0 && (
        <div className="ops-section">
          <h3 className="ops-section-title ops-section-title--warn">مصادر متعثرة ({srcFails.length})</h3>
          <div className="src-failures-grid">
            {srcFails.slice(0, 12).map((s, i) => (
              <div key={i} className="src-failure-card">
                <span className="src-name">{s.source_name || s.name || s.domain || '—'}</span>
                <span className="src-fail-count">{s.failure_count ?? s.count ?? '?'} إخفاق</span>
                {s.last_failure_at && <time className="time-ago">{relativeTime(s.last_failure_at)}</time>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   SEARCH BAR
───────────────────────────────────────────────── */
function SearchBar({ value, onChange }) {
  return (
    <div className="search-bar" dir="rtl">
      <span className="search-icon">🔍</span>
      <input
        type="search"
        className="search-input"
        placeholder="ابحث في الأخبار…"
        value={value}
        onChange={e => onChange(e.target.value)}
        dir="rtl"
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')}>✕</button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   MAIN APP
───────────────────────────────────────────────── */
export default function App() {
  /* ── Tab ── */
  const [activeTab, setActiveTab] = useState('news');

  /* ── News ── */
  const [newsItems,    setNewsItems]    = useState([]);
  const [editorialBriefing, setEditorialBriefing] = useState(null);
  const [loadingNews,  setLoadingNews]  = useState(false);
  const [errorNews,    setErrorNews]    = useState(null);
  const [category,     setCategory]     = useState('all');
  const [searchQ,      setSearchQ]      = useState('');
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(false);
  const [totalCount,   setTotalCount]   = useState(0);

  /* ── Live ── */
  const [streams,      setStreams]       = useState([]);
  const [liveSummary,  setLiveSummary]   = useState(null);
  const [selectedStream, setSelectedStream] = useState(null);
  const [loadingLive,  setLoadingLive]   = useState(false);
  const [errorLive,    setErrorLive]     = useState(null);
  const [channelSearch, setChannelSearch] = useState('');

  /* ── Ops ── */
  const [newsroomStatus, setNewsroomStatus] = useState(null);
  const [metricsBasic,   setMetricsBasic]   = useState(null);
  const [loadingOps,     setLoadingOps]     = useState(false);
  const [errorOps,       setErrorOps]       = useState(null);
  const [opsUpdatedAt,   setOpsUpdatedAt]   = useState(null);

  /* ── UI ── */
  const [theme, setTheme]   = useState('dark');
  const [globalAlert, setGlobalAlert] = useState(null);

  const PAGE_SIZE = 20;

  /* ─── News Loader ─── */
  const loadNews = useCallback(async (cat, q, pg) => {
    setLoadingNews(true);
    setErrorNews(null);
    try {
      const params = { limit: PAGE_SIZE, offset: (pg - 1) * PAGE_SIZE };
      if (cat && cat !== 'all') params.category = cat;
      if (q && q.trim()) params.q = q.trim();
      const envelope = await fetchNewsFeedEnvelope(params);
      const items = envelope?.items ?? envelope?.data ?? [];
      const total = envelope?.total ?? envelope?.metadata?.total_available_items ?? envelope?.metadata?.item_count ?? items.length;
      const briefing = envelope?.briefing ?? envelope?.metadata?.briefing ?? null;
      setTotalCount(total);
      setHasMore(items.length === PAGE_SIZE && (pg * PAGE_SIZE) < total);
      if (pg === 1) {
        setEditorialBriefing(briefing);
        setNewsItems(items);
      } else {
        setNewsItems(prev => [...prev, ...items]);
      }
    } catch (err) {
      if (pg === 1) setEditorialBriefing(null);
      setErrorNews(err.message || 'فشل تحميل الأخبار');
    } finally {
      setLoadingNews(false);
    }
  }, []);

  /* ─── Live Loader ─── */
  const loadLive = useCallback(async () => {
    setLoadingLive(true);
    setErrorLive(null);
    try {
      const res = await fetch('/api/health/streams');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const rawStreams = payload?.streams ?? [];
      setStreams(rawStreams);
      setLiveSummary(payload?.summary ?? null);
    } catch (err) {
      setErrorLive(err.message);
    } finally {
      setLoadingLive(false);
    }
  }, []);

  /* ─── Ops Loader ─── */
  const loadOps = useCallback(async () => {
    setLoadingOps(true);
    setErrorOps(null);
    try {
      const [nrRes, mbRes] = await Promise.all([
        fetch('/api/health/newsroom'),
        fetch('/api/health/metrics-basic'),
      ]);
      const [nrData, mbData] = await Promise.all([
        nrRes.ok ? nrRes.json() : Promise.resolve(null),
        mbRes.ok ? mbRes.json() : Promise.resolve(null),
      ]);
      setNewsroomStatus(nrData);
      setMetricsBasic(mbData);
      setOpsUpdatedAt(new Date().toISOString());
      // Global critical banner?
      const feedMs = nrData?.feed_staleness?.seconds_since_last_feed;
      if (feedMs != null && feedMs > ALERT_THRESHOLDS.feed_stale_critical) {
        setGlobalAlert({ severity: 'critical', message: `⛔ التغذية متوقفة منذ ${fmtSeconds(feedMs)}` });
      } else {
        setGlobalAlert(null);
      }
    } catch (err) {
      setErrorOps(err.message);
    } finally {
      setLoadingOps(false);
    }
  }, []);

  /* ─── Initial Loads ─── */
  useEffect(() => { loadNews('all', '', 1); }, [loadNews]);
  useEffect(() => { loadLive(); }, [loadLive]);
  useEffect(() => { loadOps(); }, [loadOps]);

  /* ─── Category Change ─── */
  useEffect(() => {
    setPage(1);
    setNewsItems([]);
    loadNews(category, searchQ, 1);
  }, [category]); // eslint-disable-line

  /* ─── Search (debounced) ─── */
  const searchTimer = useRef(null);
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      setNewsItems([]);
      loadNews(category, searchQ, 1);
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [searchQ]); // eslint-disable-line

  /* ─── Auto-refresh ─── */
  useEffect(() => {
    if (activeTab !== 'ops') return;
    const id = setInterval(loadOps, 45_000);
    return () => clearInterval(id);
  }, [activeTab, loadOps]);

  useEffect(() => {
    if (activeTab !== 'live') return;
    const id = setInterval(loadLive, 60_000);
    return () => clearInterval(id);
  }, [activeTab, loadLive]);

  /* ─── Auto-refresh news (silent, page 1 only, no active search) ─── */
  useEffect(() => {
    if (activeTab !== 'news') return;
    const id = setInterval(() => {
      if (page === 1 && !searchQ.trim()) loadNews(category, '', 1);
    }, 5 * 60 * 1_000);
    return () => clearInterval(id);
  }, [activeTab, category, searchQ, page, loadNews]);

  /* ─── Load More ─── */
  const loadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    loadNews(category, searchQ, next);
  }, [page, category, searchQ, loadNews]);

  /* ─── Breaking Headlines for AI ─── */
  const breakingHeadlines = useMemo(() =>
    newsItems.filter(i => i.urgency === 'high').slice(0, 15),
    [newsItems]
  );

  /* ─── Filtered Streams ─── */
  const filteredStreams = useMemo(() => {
    if (!channelSearch.trim()) return streams;
    const q = channelSearch.trim().toLowerCase();
    return streams.filter(st => {
      const name = st.source?.name || (st.stream || st).name || (st.stream || st).registry_id || '';
      const lang = st.source?.language || (st.stream || st).language || '';
      return name.toLowerCase().includes(q) || lang.toLowerCase().includes(q);
    });
  }, [streams, channelSearch]);

  /* ─── Theme toggle ─── */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* ─── News layout ─── */
  const heroItem = newsItems[0];
  const spotlightItems = newsItems.slice(1, 4);
  const gridItems = newsItems.slice(4);

  /* ── RENDER ── */
  return (
    <div className="app" dir="rtl">

      {/* GLOBAL CRITICAL BANNER */}
      {globalAlert && (
        <div className={`global-alert global-alert--${globalAlert.severity}`} dir="rtl">
          <span>{globalAlert.message}</span>
          <button className="global-alert__close" onClick={() => setGlobalAlert(null)}>✕</button>
        </div>
      )}

      {/* HEADER */}
      <header className="site-header" dir="rtl">
        <div className="site-header__inner">
          <div className="site-header__brand">
            <span className="site-logo">
              <span className="site-logo__pulse">●</span>
              World<span className="brand-accent">Pulse</span>
            </span>
            <span className="site-tagline">أخبار عالمية مباشرة</span>
          </div>

          <nav className="site-nav">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`nav-tab ${activeTab === tab.id ? 'nav-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="nav-tab__icon">{tab.icon}</span>
                <span className="nav-tab__label">{tab.label}</span>
                {tab.id === 'live' && liveSummary && (
                  <span className="nav-badge">{liveSummary.active_streams ?? streams.length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="site-header__tools">
            <button
              className="theme-toggle"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title="تبديل الوضع"
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* BREAKING TICKER */}
      <BreakingTicker items={newsItems} />

      {/* ── MAIN CONTENT ── */}
      <main className="site-main">

        {/* ═══════════════════════════════
            NEWS TAB
        ═══════════════════════════════ */}
        {activeTab === 'news' && (
          <div className="news-view">
            {/* Filters */}
            <div className="filters-bar" dir="rtl">
              <SearchBar value={searchQ} onChange={setSearchQ} />
              <div className="cat-tabs">
                {CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    className={`cat-tab ${category === c.id ? 'cat-tab--active' : ''}`}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {errorNews && <ErrorBanner message={errorNews} onRetry={() => loadNews(category, searchQ, 1)} />}

            {!loadingNews && page === 1 && <BriefingPanel briefing={editorialBriefing} />}

            {/* Hero + Spotlight */}
            {!loadingNews && newsItems.length > 0 && page === 1 && (
              <div className="editorial-grid">
                {/* Hero */}
                <div className="editorial-grid__hero">
                  <HeroCard item={heroItem} idx={0} />
                </div>
                {/* Spotlight column */}
                <div className="editorial-grid__spotlight">
                  {spotlightItems.map((item, i) => (
                    <NewsCard key={item.id || i} item={item} idx={i + 1} size="sm" />
                  ))}
                </div>
              </div>
            )}

            {/* Grid */}
            {!loadingNews && gridItems.length > 0 && (
              <>
                <div className="section-label" dir="rtl">
                  {searchQ
                    ? `نتائج البحث عن "${searchQ}" (${totalCount})`
                    : category !== 'all'
                    ? `${CATEGORIES.find(c => c.id === category)?.label} (${totalCount})`
                    : `أحدث الأخبار (${totalCount})`
                  }
                </div>
                <div className="news-grid">
                  {gridItems.map((item, i) => (
                    <NewsCard key={item.id || i} item={item} idx={i + 4} size="md" />
                  ))}
                </div>
              </>
            )}

            {/* List for remainder */}
            {!loadingNews && newsItems.length > 0 && (
              <div className="list-sidebar">
                <div className="section-label">عناوين سريعة</div>
                {newsItems.slice(0, 12).map((item, i) => (
                  <ListItem key={item.id || i} item={item} idx={i} />
                ))}
              </div>
            )}

            {loadingNews && <LoadingSpinner />}

            {/* Pagination */}
            {!loadingNews && hasMore && (
              <div className="load-more-wrap">
                <button className="btn btn--outline btn--lg" onClick={loadMore}>
                  تحميل المزيد
                </button>
              </div>
            )}

            {!loadingNews && newsItems.length === 0 && !errorNews && (
              <div className="empty-state">
                <span className="empty-state__icon">📭</span>
                <p>لا توجد أخبار مطابقة</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════
            LIVE TAB
        ═══════════════════════════════ */}
        {activeTab === 'live' && (
          <div className="live-view" dir="rtl">
            {/* Summary badges */}
            {liveSummary && (
              <div className="live-summary-bar">
                <span className="live-badge live-badge--green">● {liveSummary.playable_streams ?? liveSummary.active_streams ?? '?'} قابل للتشغيل</span>
                <span className="live-badge live-badge--blue">{liveSummary.active_streams ?? '?'} نشط</span>
                {(liveSummary.down_streams ?? 0) > 0 && (
                  <span className="live-badge live-badge--red">⛔ {liveSummary.down_streams} متوقف</span>
                )}
                <span className="live-badge live-badge--gray">{(liveSummary.total_streams ?? streams.length)} إجمالي</span>
              </div>
            )}

            {errorLive && <ErrorBanner message={errorLive} onRetry={loadLive} />}

            {/* Player */}
            {selectedStream && (
              <PlayerPanel
                stream={selectedStream}
                onClose={() => setSelectedStream(null)}
              />
            )}

            {/* Channel search */}
            <div className="ch-search-bar" dir="rtl">
              <SearchBar value={channelSearch} onChange={setChannelSearch} />
            </div>

            {/* Channel grid */}
            {loadingLive
              ? <LoadingSpinner label="تحميل القنوات…" />
              : (
                <div className="ch-grid">
                  {filteredStreams.map((st, i) => (
                    <ChannelCard
                      key={st.stream?.id || st.id || i}
                      stream={st}
                      onSelect={setSelectedStream}
                      isActive={selectedStream === st}
                    />
                  ))}
                  {filteredStreams.length === 0 && (
                    <div className="empty-state">
                      <span className="empty-state__icon">📡</span>
                      <p>لا توجد قنوات مطابقة</p>
                    </div>
                  )}
                </div>
              )
            }
          </div>
        )}

        {/* ═══════════════════════════════
            OPS TAB
        ═══════════════════════════════ */}
        {activeTab === 'ops' && (
          <div className="ops-view">
            {errorOps && <ErrorBanner message={errorOps} onRetry={loadOps} />}
            <NewsroomDashboard
              newsroomStatus={newsroomStatus}
              metricsBasic={metricsBasic}
              updatedAt={opsUpdatedAt}
              onRefresh={loadOps}
              loading={loadingOps}
            />
          </div>
        )}

        {/* ═══════════════════════════════
            AI TAB
        ═══════════════════════════════ */}
        {activeTab === 'ai' && (
          <div className="ai-view">
            <div className="ai-view__header" dir="rtl">
              <h2>🤖 المساعد الذكي</h2>
              <p className="ai-view__sub">مدعوم بـ Claude AI — اسألني عن أي خبر أو حدث</p>
            </div>
            <AiChat newsItems={newsItems} />
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="site-footer" dir="rtl">
        <div className="site-footer__inner">
          <span className="site-logo">World<span className="brand-accent">Pulse</span></span>
          <span className="footer-sep">·</span>
          <span>منصة أخبار عربية مباشرة</span>
          <span className="footer-sep">·</span>
          <a href="https://new.khalidae.com" className="footer-link">new.khalidae.com</a>
        </div>
      </footer>

    </div>
  );
}

/* ─────────────────────────────────────────────────
   CSS-IN-JS  (injected as <style> via global scope)
───────────────────────────────────────────────── */
const CSS = `
/* ── RESET & ROOT ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; }

/* ── THEME TOKENS ── */
:root, [data-theme="dark"] {
  --bg:          #0d0f14;
  --bg2:         #141720;
  --bg3:         #1c2030;
  --border:      #2a2f3e;
  --text:        #e8eaf0;
  --text2:       #8b92a8;
  --text3:       #555e78;
  --accent:      #3b82f6;
  --accent2:     #60a5fa;
  --gold:        #f59e0b;
  --red:         #ef4444;
  --green:       #22c55e;
  --purple:      #a78bfa;
  --card-bg:     #181c28;
  --card-hover:  #1e2438;
  --shadow:      0 4px 24px rgba(0,0,0,.45);
  --shadow-sm:   0 2px 8px rgba(0,0,0,.3);
  --radius:      10px;
  --radius-sm:   6px;
  --header-h:    60px;
}
[data-theme="light"] {
  --bg:          #f4f5f7;
  --bg2:         #ffffff;
  --bg3:         #eef0f4;
  --border:      #d8dce8;
  --text:        #1a1d2e;
  --text2:       #4a5172;
  --text3:       #8890ab;
  --accent:      #2563eb;
  --accent2:     #1d4ed8;
  --card-bg:     #ffffff;
  --card-hover:  #f0f4ff;
  --shadow:      0 4px 20px rgba(0,0,0,.08);
  --shadow-sm:   0 2px 6px rgba(0,0,0,.06);
}

/* ── BASE ── */
.app {
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── GLOBAL ALERT BANNER ── */
.global-alert {
  position: sticky; top: 0; z-index: 999;
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 20px; font-size: .85rem; font-weight: 600;
}
.global-alert--critical { background: #991b1b; color: #fef2f2; }
.global-alert--warning  { background: #92400e; color: #fffbeb; }
.global-alert__close {
  background: none; border: none; cursor: pointer; font-size: 1rem;
  color: inherit; opacity: .7; padding: 0 4px;
}

/* ── HEADER ── */
.site-header {
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  height: var(--header-h);
}
.site-header__inner {
  max-width: 1400px; margin: 0 auto;
  height: 100%; padding: 0 20px;
  display: flex; align-items: center; gap: 24px;
}
.site-header__brand { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
.site-logo { font-size: 1.35rem; font-weight: 800; color: var(--text); letter-spacing: -.5px; }
.site-logo__pulse { color: var(--red); animation: blink 1.2s ease-in-out infinite; margin-left: 2px; font-size: .7em; }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: .2; } }
.brand-accent { color: var(--accent); }
.site-tagline { font-size: .72rem; color: var(--text3); display: none; }
@media (min-width: 768px) { .site-tagline { display: inline; } }
.site-nav { display: flex; gap: 4px; flex: 1; justify-content: center; }
.nav-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: var(--radius-sm);
  background: none; border: none; cursor: pointer;
  color: var(--text2); font-size: .85rem; font-weight: 500;
  transition: all .18s; white-space: nowrap; position: relative;
}
.nav-tab:hover { background: var(--bg3); color: var(--text); }
.nav-tab--active { background: var(--accent); color: #fff; }
.nav-tab__icon { font-size: .95em; }
.nav-badge {
  background: var(--green); color: #fff; border-radius: 999px;
  font-size: .68rem; padding: 1px 6px; font-weight: 700;
}
.site-header__tools { margin-right: auto; display: flex; align-items: center; gap: 8px; }
.theme-toggle {
  background: none; border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 4px 8px;
  cursor: pointer; font-size: 1rem; color: var(--text2);
}

/* ── TICKER ── */
.ticker-bar {
  background: var(--red); color: #fff;
  display: flex; align-items: center;
  overflow: hidden; height: 32px;
}
.ticker-label {
  flex-shrink: 0; padding: 0 14px;
  font-weight: 700; font-size: .8rem; letter-spacing: .5px;
  background: rgba(0,0,0,.25); height: 100%; display: flex; align-items: center;
}
.ticker-track { flex: 1; overflow: hidden; }
.ticker-inner {
  display: inline-flex; white-space: nowrap;
  animation: ticker-scroll 40s linear infinite;
}
@keyframes ticker-scroll { 0% { transform: translateX(100vw); } 100% { transform: translateX(-100%); } }
.ticker-item { padding: 0 12px; font-size: .82rem; }
.ticker-sep { margin-left: 12px; opacity: .4; }

/* ── MAIN ── */
.site-main { flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; padding: 20px 16px; }

/* ── FILTERS ── */
.filters-bar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.cat-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-tab {
  padding: 5px 14px; border-radius: 999px; font-size: .8rem;
  border: 1px solid var(--border); background: var(--bg2);
  color: var(--text2); cursor: pointer; transition: all .15s;
}
.cat-tab:hover { border-color: var(--accent); color: var(--accent); }
.cat-tab--active { background: var(--accent); color: #fff; border-color: var(--accent); }

/* ── SEARCH ── */
.search-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 12px;
  transition: border-color .15s;
}
.search-bar:focus-within { border-color: var(--accent); }
.search-icon { font-size: .9rem; color: var(--text3); flex-shrink: 0; }
.search-input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text); font-size: .9rem;
}
.search-clear { background: none; border: none; cursor: pointer; color: var(--text3); font-size: .8rem; }

/* ── EDITORIAL GRID ── */
.editorial-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px; margin-bottom: 28px;
}
@media (min-width: 900px) {
  .editorial-grid {
    grid-template-columns: 2fr 1fr;
    align-items: start;
  }
}
.editorial-grid__hero { }
.editorial-grid__spotlight { display: flex; flex-direction: column; gap: 10px; }

.briefing-panel {
  background: linear-gradient(135deg, var(--bg2), color-mix(in srgb, var(--bg2) 82%, var(--accent) 18%));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  margin-bottom: 22px;
  box-shadow: var(--shadow-sm);
}
.briefing-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}
.briefing-panel__subhead { color: var(--text3); font-size: .85rem; margin-top: 4px; }
.briefing-panel__signals { display: flex; flex-wrap: wrap; gap: 8px; }
.briefing-panel__grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 14px;
}
@media (min-width: 980px) {
  .briefing-panel__grid {
    grid-template-columns: 1.4fr 1fr 1fr;
  }
  .briefing-card--lead { grid-column: span 2; }
}
.briefing-card {
  background: color-mix(in srgb, var(--card-bg) 86%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.briefing-card__eyebrow {
  font-size: .75rem;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text3);
  margin-bottom: 10px;
}
.briefing-card__title { font-size: 1.05rem; line-height: 1.55; margin-bottom: 10px; }
.briefing-card__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.briefing-card__meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text3); font-size: .8rem; margin-bottom: 12px; }
.briefing-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.briefing-metrics--compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.briefing-metric {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.briefing-metric__label { color: var(--text3); font-size: .76rem; }
.briefing-metric__value { font-size: 1rem; font-weight: 700; color: var(--text); }
.briefing-metric__value--green { color: var(--green); }
.briefing-metric__value--blue { color: var(--accent); }
.briefing-metric__value--amber { color: var(--gold); }
.briefing-metric__value--red { color: var(--red); }
.briefing-list-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}
.briefing-list-item:first-of-type { border-top: none; padding-top: 0; }
.briefing-list-item__title { font-size: .9rem; line-height: 1.5; margin-bottom: 4px; }
.briefing-list-item__meta { color: var(--text3); font-size: .76rem; }
.briefing-empty { color: var(--text3); font-size: .84rem; }
.signal-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: .73rem;
  font-weight: 700;
  border: 1px solid transparent;
}
.signal-pill--neutral { background: var(--bg3); color: var(--text2); border-color: var(--border); }
.signal-pill--green { background: rgba(56, 161, 105, .14); color: var(--green); border-color: rgba(56, 161, 105, .2); }
.signal-pill--blue { background: rgba(33, 130, 218, .14); color: var(--accent); border-color: rgba(33, 130, 218, .2); }
.signal-pill--amber { background: rgba(214, 158, 46, .15); color: var(--gold); border-color: rgba(214, 158, 46, .2); }
.signal-pill--red { background: rgba(229, 62, 62, .14); color: var(--red); border-color: rgba(229, 62, 62, .2); }
.section-label--flush { margin: 0; }

/* ── HERO CARD ── */
.hero-card {
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--card-bg);
  box-shadow: var(--shadow);
  transition: transform .2s;
}
.hero-card:hover { transform: translateY(-2px); }
.hero-card__img-wrap {
  position: relative; display: block;
  aspect-ratio: 16/9; overflow: hidden;
}
.hero-card__img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s; }
.hero-card:hover .hero-card__img { transform: scale(1.03); }
.hero-card__overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 60%);
}
.hero-card__meta {
  position: absolute; top: 12px; right: 12px;
  display: flex; gap: 6px;
}
.hero-card__body { padding: 16px 20px 20px; }
.hero-card__title { font-size: 1.35rem; font-weight: 700; line-height: 1.4; margin-bottom: 8px; }
.hero-card__title a:hover { color: var(--accent2); }
.hero-card__summary { font-size: .9rem; color: var(--text2); line-height: 1.6; margin-bottom: 12px; }
.hero-card__footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── NEWS CARD ── */
.news-card {
  background: var(--card-bg);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: transform .18s, box-shadow .18s;
  display: flex; flex-direction: column;
}
.news-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.news-card__img-wrap {
  position: relative; display: block;
  overflow: hidden;
}
.news-card--sm .news-card__img-wrap { aspect-ratio: 3/2; }
.news-card--md .news-card__img-wrap { aspect-ratio: 16/10; }
.news-card__img { width: 100%; height: 100%; object-fit: cover; transition: transform .35s; }
.news-card:hover .news-card__img { transform: scale(1.04); }
.news-card__overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,.5) 0%, transparent 50%);
}
.news-card__badges { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; align-items: center; }
.news-card__body { padding: 12px 14px 14px; flex: 1; display: flex; flex-direction: column; }
.news-card__title { font-size: .95rem; font-weight: 600; line-height: 1.45; margin-bottom: 6px; flex: 1; }
.news-card--sm .news-card__title { font-size: .88rem; }
.news-card__title a:hover { color: var(--accent2); }
.news-card__summary { font-size: .82rem; color: var(--text2); line-height: 1.55; margin-bottom: 8px; }
.news-card__footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; }

/* ── LIST ITEM ── */
.list-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: background .15s;
}
.list-item:hover { background: var(--card-hover); }
.list-item__indicator { width: 3px; height: 36px; border-radius: 2px; flex-shrink: 0; margin-top: 2px; }
.list-item__body { flex: 1; }
.list-item__title { font-size: .88rem; line-height: 1.45; font-weight: 500; margin-bottom: 3px; }
.list-item__meta { font-size: .75rem; color: var(--text3); }

/* ── NEWS GRID ── */
.section-label {
  font-size: .85rem; font-weight: 700; color: var(--text2);
  text-transform: uppercase; letter-spacing: .5px;
  border-right: 3px solid var(--accent); padding-right: 10px;
  margin-bottom: 14px; margin-top: 28px;
}
.news-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
.list-sidebar { margin-top: 32px; }

/* ── BADGES / DOTS ── */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  font-size: .72rem; font-weight: 700; white-space: nowrap;
}
.badge--breaking { background: var(--red); color: #fff; }
.badge--xs { padding: 1px 5px; font-size: .68rem; }
.cat-badge {
  display: inline-block; padding: 2px 8px;
  border-radius: 4px; font-size: .7rem; font-weight: 700; color: #fff;
}
.urgency-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.urgency-dot--high { background: var(--red); box-shadow: 0 0 6px var(--red); animation: blink 1s infinite; }
.urgency-dot--medium { background: var(--gold); }
.trust-bar {
  width: 50px; height: 3px; background: var(--border);
  border-radius: 2px; overflow: hidden; flex-shrink: 0;
}
.trust-bar__fill { height: 100%; border-radius: 2px; transition: width .3s; }

/* ── TEXT UTILS ── */
.source-name { font-size: .75rem; font-weight: 600; color: var(--text3); }
.time-ago { font-size: .75rem; color: var(--text3); }
.dot { color: var(--text3); }

/* ── LOAD MORE ── */
.load-more-wrap { display: flex; justify-content: center; padding: 24px; }

/* ── BUTTONS ── */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 8px 18px; border-radius: var(--radius-sm);
  font-size: .88rem; font-weight: 600; cursor: pointer;
  border: none; transition: all .18s; outline: none;
}
.btn--primary { background: var(--accent); color: #fff; }
.btn--primary:hover { background: var(--accent2); }
.btn--ghost { background: none; border: 1px solid var(--border); color: var(--text2); }
.btn--ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn--outline { background: none; border: 2px solid var(--accent); color: var(--accent); }
.btn--outline:hover { background: var(--accent); color: #fff; }
.btn--sm { padding: 4px 10px; font-size: .8rem; }
.btn--lg { padding: 12px 32px; font-size: 1rem; }
.btn:disabled { opacity: .5; cursor: not-allowed; }

/* ── LOADING ── */
.loading-state {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 60px 20px; color: var(--text2); font-size: .9rem;
}
.spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 3px solid var(--border); border-top-color: var(--accent);
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── ERROR ── */
.error-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px; background: #2d1a1a; border: 1px solid var(--red);
  border-radius: var(--radius-sm); margin-bottom: 16px;
  font-size: .85rem; color: #fca5a5;
}

/* ── EMPTY STATE ── */
.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 60px 20px; color: var(--text2);
}
.empty-state__icon { font-size: 3rem; }

/* ════════════════════════════════
   LIVE VIEW
════════════════════════════════ */
.live-view { }

.live-summary-bar {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center;
}
.live-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 999px; font-size: .8rem; font-weight: 600;
}
.live-badge--green { background: rgba(34,197,94,.15); color: var(--green); border: 1px solid rgba(34,197,94,.3); }
.live-badge--blue  { background: rgba(59,130,246,.15); color: var(--accent2); border: 1px solid rgba(59,130,246,.3); }
.live-badge--red   { background: rgba(239,68,68,.15);  color: #f87171; border: 1px solid rgba(239,68,68,.3); }
.live-badge--gray  { background: var(--bg3); color: var(--text2); border: 1px solid var(--border); }

/* Player panel */
.player-panel {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
  margin-bottom: 20px; box-shadow: var(--shadow);
}
.player-panel__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.player-panel__title {
  display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 1rem;
}
.player-panel__logo { width: 28px; height: 28px; object-fit: contain; border-radius: 4px; }
.player-panel__actions { display: flex; gap: 8px; }
.player-panel__screen { aspect-ratio: 16/9; background: #000; position: relative; }
.player-iframe { width: 100%; height: 100%; border: none; display: block; }
.player-no-embed {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--text2);
}
.player-no-embed__icon { font-size: 3rem; }
.player-panel__desc { padding: 10px 16px; font-size: .82rem; color: var(--text2); border-top: 1px solid var(--border); }

/* Channel grid */
.ch-search-bar { margin-bottom: 14px; }
.ch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.ch-card {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 12px 10px;
  cursor: pointer; transition: all .18s; text-align: right;
  display: flex; flex-direction: column; gap: 8px; dir: rtl;
}
.ch-card:hover { border-color: var(--accent); background: var(--card-hover); }
.ch-card--active { border-color: var(--accent); background: rgba(59,130,246,.1); }
.ch-card--offline { opacity: .55; }
.ch-card__logo { position: relative; display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; background: var(--bg3); border-radius: 8px; overflow: hidden; }
.ch-card__logo img { width: 100%; height: 100%; object-fit: contain; }
.ch-card__logo-text { font-size: .75rem; font-weight: 700; color: var(--text2); }
.ch-status-dot {
  position: absolute; bottom: 2px; right: 2px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text3); border: 1.5px solid var(--card-bg);
}
.ch-status-dot--live { background: var(--green); animation: blink 2s infinite; }
.ch-card__info { }
.ch-card__name { display: block; font-size: .82rem; font-weight: 600; margin-bottom: 2px; }
.ch-card__country { font-size: .72rem; color: var(--text3); }

/* LIVE BADGE in header */
.live-badge-inline {
  background: var(--red); color: #fff;
  padding: 2px 7px; border-radius: 999px;
  font-size: .7rem; font-weight: 700;
  animation: blink 1.5s infinite;
}

/* ════════════════════════════════
   OPS DASHBOARD
════════════════════════════════ */
.ops-view { }
.ops-dashboard { display: flex; flex-direction: column; gap: 20px; }
.ops-header {
  display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px;
}
.ops-title { font-size: 1.4rem; font-weight: 800; }
.ops-updated { font-size: .78rem; color: var(--text3); }
.ops-header-actions { display: flex; align-items: center; gap: 10px; }
.readiness-badge {
  padding: 4px 12px; border-radius: 999px; font-size: .8rem; font-weight: 600;
}
.readiness-badge--green  { background: rgba(34,197,94,.15); color: var(--green); border: 1px solid rgba(34,197,94,.3); }
.readiness-badge--yellow { background: rgba(245,158,11,.15); color: var(--gold); border: 1px solid rgba(245,158,11,.3); }
.readiness-badge--red    { background: rgba(239,68,68,.15);  color: #f87171;    border: 1px solid rgba(239,68,68,.3); }

/* KPI grid */
.kpi-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;
}
.kpi-card {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px; display: flex; flex-direction: column; gap: 4px;
}
.kpi-title { font-size: .75rem; color: var(--text3); font-weight: 500; }
.kpi-value { font-size: 1.6rem; font-weight: 800; line-height: 1; }
.kpi-sub   { font-size: .7rem; color: var(--text3); }

/* Alerts */
.alerts-panel { display: flex; flex-direction: column; gap: 6px; }
.alerts-group--critical { display: flex; flex-direction: column; gap: 6px; }
.alert-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: var(--radius-sm); font-size: .85rem;
}
.alert-row--critical { background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.4); color: #fca5a5; }
.alert-row--warning  { background: rgba(245,158,11,.1);  border: 1px solid rgba(245,158,11,.3); color: #fde68a; }
.alert-row--ok       { background: rgba(34,197,94,.08);  border: 1px solid rgba(34,197,94,.2);  color: #86efac; }
.alert-icon { flex-shrink: 0; }
.alert-msg  { flex: 1; }

/* Job row */
.ops-section { background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.ops-section-title { font-size: .85rem; font-weight: 700; margin-bottom: 12px; }
.ops-section-title--warn { color: #f87171; }
.job-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: .85rem; }
.job-status-badge { padding: 2px 8px; border-radius: 4px; font-size: .75rem; font-weight: 700; }
.job-status-badge--success   { background: rgba(34,197,94,.2);  color: var(--green); }
.job-status-badge--failed    { background: rgba(239,68,68,.2);  color: #f87171; }
.job-status-badge--running   { background: rgba(59,130,246,.2); color: var(--accent2); }
.job-status-badge--completed { background: rgba(34,197,94,.2);  color: var(--green); }
.job-type { font-weight: 500; }
.job-latency { font-size: .8rem; color: var(--text3); }

/* Failures */
.failures-list { display: flex; flex-direction: column; gap: 8px; }
.failure-row {
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  padding: 8px; background: var(--bg); border-radius: var(--radius-sm); font-size: .82rem;
}
.failure-type { font-weight: 600; color: #f87171; flex-shrink: 0; }
.failure-msg { flex: 1; color: var(--text2); }
.src-failures-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;
}
.src-failure-card {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px; font-size: .82rem;
}
.src-name { font-weight: 600; }
.src-fail-count { color: #f87171; font-size: .78rem; }

/* ════════════════════════════════
   AI CHAT
════════════════════════════════ */
.ai-view {
  max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px;
}
.ai-view__header { text-align: center; }
.ai-view__header h2 { font-size: 1.5rem; font-weight: 800; margin-bottom: 6px; }
.ai-view__sub { font-size: .85rem; color: var(--text2); }
.ai-chat {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column;
  height: calc(100vh - 280px); min-height: 420px;
}
.ai-chat__history {
  flex: 1; overflow-y: auto; padding: 20px;
  display: flex; flex-direction: column; gap: 14px;
  scroll-behavior: smooth;
}
.ai-msg { display: flex; }
.ai-msg--user { justify-content: flex-start; }
.ai-msg--assistant { justify-content: flex-end; }
.ai-msg__bubble {
  max-width: 78%; padding: 10px 14px; border-radius: 14px;
  font-size: .88rem; line-height: 1.6; white-space: pre-wrap;
}
.ai-msg--user .ai-msg__bubble {
  background: var(--accent); color: #fff; border-bottom-left-radius: 4px;
}
.ai-msg--assistant .ai-msg__bubble {
  background: var(--bg3); color: var(--text); border-bottom-right-radius: 4px;
}
.ai-msg__bubble--typing {
  display: flex; gap: 5px; align-items: center; padding: 12px 16px;
}
.ai-msg__bubble--typing span {
  width: 7px; height: 7px; background: var(--text3); border-radius: 50%;
  animation: typing-bounce .8s ease-in-out infinite;
}
.ai-msg__bubble--typing span:nth-child(2) { animation-delay: .15s; }
.ai-msg__bubble--typing span:nth-child(3) { animation-delay: .3s; }
@keyframes typing-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
.ai-chat__input-row {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--border); background: var(--bg2);
}
.ai-chat__input {
  flex: 1; background: var(--bg3); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 8px 12px; color: var(--text);
  font-size: .88rem; resize: none; outline: none;
  transition: border-color .15s;
}
.ai-chat__input:focus { border-color: var(--accent); }
.ai-chat__suggestions {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 14px; border-top: 1px solid var(--border);
  background: var(--bg2);
}
.ai-suggest-btn {
  padding: 5px 12px; border-radius: 999px; font-size: .78rem;
  border: 1px solid var(--border); background: var(--bg3);
  color: var(--text2); cursor: pointer; transition: all .15s; white-space: nowrap;
}
.ai-suggest-btn:hover:not(:disabled) {
  border-color: var(--accent); color: var(--accent); background: rgba(59,130,246,.1);
}
.ai-suggest-btn:disabled { opacity: .45; cursor: not-allowed; }

/* ════════════════════════════════
   FOOTER
════════════════════════════════ */
.site-footer {
  border-top: 1px solid var(--border);
  background: var(--bg2); padding: 14px 20px;
  font-size: .8rem; color: var(--text3);
}
.site-footer__inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.footer-sep { opacity: .4; }
.footer-link { color: var(--accent); }
.footer-link:hover { color: var(--accent2); }

/* ════════════════════════════════
   RESPONSIVE
════════════════════════════════ */
@media (max-width: 640px) {
  .site-header__inner { padding: 0 12px; gap: 10px; }
  .nav-tab__label { display: none; }
  .nav-tab { padding: 6px 10px; }
  .site-main { padding: 12px 10px; }
  .hero-card__title { font-size: 1.1rem; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .ch-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
}
@media (min-width: 1200px) {
  .news-view { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
  .news-view .list-sidebar { margin-top: 0; }
  .news-view .filters-bar { grid-column: 1 / -1; }
  .news-view .error-banner  { grid-column: 1 / -1; }
  .news-view .editorial-grid { grid-column: 1; }
  .news-view .section-label { grid-column: 1; }
  .news-view .news-grid { grid-column: 1; }
  .news-view .load-more-wrap { grid-column: 1; }
  .news-view .empty-state { grid-column: 1; }
}
`;

/* Inject CSS once */
if (typeof document !== 'undefined' && !document.getElementById('wp-styles')) {
  const el = document.createElement('style');
  el.id = 'wp-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
