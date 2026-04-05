import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { fetchNewsFeedEnvelope } from './data/newsAdapter';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';

/* ─────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'all',        label: 'الكل' },
  { id: 'breaking',   label: 'عاجل' },
  { id: 'war',        label: 'حرب' },
  { id: 'politics',   label: 'سياسة' },
  { id: 'economy',    label: 'اقتصاد' },
  { id: 'gulf',       label: 'gulf' },
  { id: 'iran',       label: 'إيران' },
  { id: 'israel',     label: 'إسرائيل' },
  { id: 'usa',        label: 'أمريكا' },
  { id: 'world',      label: 'العالم' },
  { id: 'energy',     label: 'طاقة' },
  { id: 'analysis',   label: 'تحليل' },
  { id: 'technology', label: 'تقنية' },
];

const TABS = [
  { id: 'news',       label: 'الأخبار',          icon: '📰' },
  { id: 'editorial',  label: 'التحرير الذكي',    icon: '🧠' },
  { id: 'live',       label: 'البث المباشر',     icon: '📡' },
  { id: 'ops',        label: 'غرفة الأخبار',     icon: '🧭' },
  { id: 'map',        label: 'خريطة الأحداث',    icon: '🗺️' },
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

const PLACEHOLDER_IMGS = [
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=60',
  'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=800&q=60',
  'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&q=60',
  'https://images.unsplash.com/photo-1526628953301-3cd40f68f9e3?w=800&q=60',
  'https://images.unsplash.com/photo-1611605698335-8b1569810432?w=800&q=60',
];

const CATEGORY_COORDS = {
  war:        [33.5, 43.7],
  iran:       [32.4, 53.7],
  israel:     [31.8, 35.2],
  gulf:       [24.7, 46.7],
  usa:        [38.9, -77.0],
  politics:   [51.5, -0.1],
  economy:    [40.7, -74.0],
  energy:     [27.0, 50.0],
  world:      [48.9, 2.3],
  breaking:   [31.5, 36.0],
  analysis:   [25.0, 55.0],
  technology: [37.3, -122.0],
};

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

/* ──────────────────────────────────────────────────────────────────
   SITREP PANEL — Automated Intelligence Situation Report
────────────────────────────────────────────────────────────────── */
const ESCALATION_META = {
  low:      { label: 'منخفض',   color: '#26c281', icon: '🟢' },
  medium:   { label: 'متوسط',   color: '#f0a500', icon: '🟡' },
  high:     { label: 'مرتفع',   color: '#e74c3c', icon: '🔴' },
  critical: { label: 'حرج',     color: '#9b0000', icon: '⛔' },
};

function SitrepPanel({ sitrep }) {
  const [expanded, setExpanded] = React.useState(false);

  if (!sitrep) return null;

  const meta  = ESCALATION_META[sitrep.escalation_level] || ESCALATION_META.medium;
  const actors = Array.isArray(sitrep.key_actors)    ? sitrep.key_actors    : [];
  const fronts = Array.isArray(sitrep.active_fronts) ? sitrep.active_fronts : [];
  const contras = Array.isArray(sitrep.contradictions) ? sitrep.contradictions : [];
  const age    = sitrep.generated_at
    ? Math.round((Date.now() - new Date(sitrep.generated_at).getTime()) / 60000)
    : null;

  const TREND_ICON = { escalating: '↑', stable: '→', 'de-escalating': '↓' };

  return (
    <section className="sitrep" dir="rtl" style={{ '--sitrep-color': meta.color }}>
      <div className="sitrep__header" onClick={() => setExpanded(e => !e)} role="button" tabIndex={0}
           onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpanded(v => !v)}>
        <div className="sitrep__title-row">
          <span className="sitrep__label">تقرير الموقف • SITREP</span>
          <span className="sitrep__badge" style={{ background: meta.color }}>
            {meta.icon} {meta.label}
          </span>
          {age !== null && (
            <span className="sitrep__age">منذ {age < 1 ? 'أقل من دقيقة' : `${age} د`}</span>
          )}
          <span className="sitrep__toggle">{expanded ? '▲' : '▼'}</span>
        </div>
        <h2 className="sitrep__headline">{sitrep.headline}</h2>
      </div>

      {expanded && (
        <div className="sitrep__body">
          <p className="sitrep__summary">{sitrep.situation_summary}</p>

          {actors.length > 0 && (
            <div className="sitrep__section">
              <h3 className="sitrep__section-title">الأطراف الفاعلة</h3>
              <ul className="sitrep__actors">
                {actors.map((a, i) => (
                  <li key={i} className="sitrep__actor">
                    <strong>{a.name}</strong>
                    {a.role && <span className="sitrep__actor-role"> — {a.role}</span>}
                    {a.latest_action && <span className="sitrep__actor-action">: {a.latest_action}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fronts.length > 0 && (
            <div className="sitrep__section">
              <h3 className="sitrep__section-title">الجبهات النشطة</h3>
              <ul className="sitrep__fronts">
                {fronts.map((f, i) => {
                  const trend = f.trend || 'stable';
                  const trendClass = `sitrep__trend--${trend}`;
                  return (
                    <li key={i} className="sitrep__front">
                      <span className={`sitrep__trend ${trendClass}`}>{TREND_ICON[trend] || '→'}</span>
                      <strong>{f.front}</strong>
                      {f.status && <span className="sitrep__front-status"> — {f.status}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {contras.length > 0 && (
            <div className="sitrep__section">
              <h3 className="sitrep__section-title">⚠ تناقضات بين المصادر</h3>
              <ul className="sitrep__contras">
                {contras.map((c, i) => (
                  <li key={i} className="sitrep__contra">
                    <strong>{c.topic}:</strong>
                    <span className="sitrep__contra-a"> {c.source_a}: «{c.version_a}»</span>
                    <span className="sitrep__contra-sep"> مقابل </span>
                    <span className="sitrep__contra-b"> {c.source_b}: «{c.version_b}»</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
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
   LIVE CHANNEL COMPONENTS  ★★★★★★★ LUXURY REBUILD
───────────────────────────────────────────────── */

/* Status colour palette per uptime state */
const CH_STATUS = {
  up:       { label: 'مباشر',  cls: 'online',    dot: '#22c55e', shadow: 'rgba(34,197,94,.55)' },
  degraded: { label: 'جزئي',   cls: 'degraded',  dot: '#f59e0b', shadow: 'rgba(245,158,11,.5)' },
  down:     { label: 'متوقف',  cls: 'offline',   dot: '#ef4444', shadow: 'rgba(239,68,68,.45)' },
  unknown:  { label: '—',      cls: 'offline',   dot: '#555e78', shadow: 'none' },
};

function getChStatus(s) {
  if (s.uptime_status === 'up' || s.status === 'active') return CH_STATUS.up;
  if (s.uptime_status === 'degraded') return CH_STATUS.degraded;
  if (s.uptime_status === 'down') return CH_STATUS.down;
  return CH_STATUS.unknown;
}

function LuxChannelCard({ stream, onSelect, isActive }) {
  if (!stream) return null;
  const s    = stream.stream || stream;
  const name = stream.source?.name || s.name || s.registry_id || '';
  const lang = stream.source?.language || s.language || '';
  const status   = getChStatus(s);
  const isOnline = status.cls === 'online' || status.cls === 'degraded';
  const hasEmbed = !!(s.embed_url || s.embedUrl);
  const [imgErr, setImgErr] = React.useState(false);

  return (
    <button
      className={`lxc${isActive ? ' lxc--active' : ''} lxc--${status.cls}`}
      onClick={() => onSelect(stream)}
      title={name}
      aria-pressed={isActive}
    >
      {/* ── Ambient glow layer (active/hover) ── */}
      <span className="lxc__glow" aria-hidden="true" />

      {/* ── Top row: status pill + embed icon ── */}
      <div className="lxc__top">
        <span
          className="lxc__status-pill"
          style={{
            '--dot-color': status.dot,
            '--dot-shadow': status.shadow,
          }}
        >
          <span className={`lxc__status-dot${isOnline ? ' lxc__status-dot--live' : ''}`} />
          {status.label}
        </span>
        {hasEmbed && isOnline && (
          <span className="lxc__embed-icon" title="يدعم التشغيل المدمج">▶</span>
        )}
      </div>

      {/* ── Logo ── */}
      <div className="lxc__logo">
        {s.logo_url && !imgErr
          ? <img src={s.logo_url} alt={name} loading="lazy" onError={() => setImgErr(true)} />
          : <span className="lxc__logo-initials">{name.slice(0, 2)}</span>
        }
        {isOnline && <span className="lxc__logo-ring" />}
      </div>

      {/* ── Name + lang ── */}
      <div className="lxc__info">
        <span className="lxc__name">{name}</span>
        {lang && <span className="lxc__lang">{lang.toUpperCase()}</span>}
      </div>

      {/* ── Slot line bottom (decorative) ── */}
      <span className="lxc__slot-line" aria-hidden="true" />
    </button>
  );
}

function CinematicPlayer({ stream, onClose }) {
  if (!stream) return null;
  const s       = stream.stream || stream;
  const name    = stream.source?.name || s.name || s.registry_id || '';
  const lang    = stream.source?.language || s.language || '';
  const embedUrl = s.embed_url || s.embedUrl;
  const watchUrl = s.external_watch_url || s.official_page_url;
  const status  = getChStatus(s);
  const isLive  = status.cls === 'online';
  const [imgErr, setImgErr] = React.useState(false);

  return (
    <div className="cp" dir="rtl" role="region" aria-label={`مشاهدة ${name}`}>

      {/* ── Ambient background beam ── */}
      <div className="cp__beam" aria-hidden="true" />

      {/* ── Top chrome bar ── */}
      <div className="cp__bar">
        <div className="cp__identity">
          <div className="cp__logo-frame">
            {s.logo_url && !imgErr
              ? <img src={s.logo_url} alt={name} onError={() => setImgErr(true)} />
              : <span>{name.slice(0, 2)}</span>
            }
          </div>
          <div className="cp__meta">
            <span className="cp__channel-name">{name}</span>
            <span className="cp__channel-sub">{lang ? lang.toUpperCase() : '—'}</span>
          </div>
          {isLive && (
            <div className="cp__live-pill">
              <span className="cp__live-dot" />
              ON AIR
            </div>
          )}
        </div>

        <div className="cp__actions">
          {(embedUrl || watchUrl) && (
            <a
              href={embedUrl || watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="cp__action-btn cp__action-btn--ghost"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              فتح خارجي
            </a>
          )}
          <button className="cp__action-btn cp__action-btn--close" onClick={onClose} aria-label="إغلاق">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* ── Main screen ── */}
      <div className="cp__screen">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={name}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="cp__iframe"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <div className="cp__no-embed">
            <div className="cp__no-embed-ring">
              <svg className="cp__no-embed-svg" viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="36" stroke="rgba(255,255,255,.08)" strokeWidth="1.5"/>
                <circle cx="40" cy="40" r="24" stroke="rgba(255,255,255,.05)" strokeWidth="1"/>
                <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle"
                  fontSize="22" fill="rgba(255,255,255,.2)">📡</text>
              </svg>
            </div>
            <h3 className="cp__no-embed-title">لا يتوفر بث مدمج</h3>
            <p className="cp__no-embed-sub">يمكنك مشاهدة هذه القناة عبر موقعها الرسمي</p>
            {watchUrl && (
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="cp__watch-cta">
                مشاهدة الآن
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            )}
          </div>
        )}
        {/* CRT scanlines texture */}
        <div className="cp__scanlines" aria-hidden="true" />
        {/* Bottom gradient vignette */}
        <div className="cp__vignette" aria-hidden="true" />
      </div>

      {s.description && (
        <div className="cp__footer">{s.description}</div>
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
   EVENTS MAP  ★★★★★★★
───────────────────────────────────────────────── */
function hashJitter(str, scale) {
  scale = scale || 1.6;
  var h = 0;
  for (var i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  var lat = (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * scale;
  var lng = ((((h * 1000003) >>> 0) % 1000) / 1000 - 0.5) * 2 * scale;
  return [lat, lng];
}

function MapFlyTo({ pos, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.flyTo(pos, zoom || 6, { duration: 1.2 });
  }, [pos, zoom, map]);
  return null;
}

function EventsMap({ newsItems }) {
  const [selected, setSelected] = useState(null);
  const [urgFilter, setUrgFilter] = useState('all');

  const allMapped = useMemo(() =>
    newsItems.slice(0, 250).filter(it => CATEGORY_COORDS[it.category]),
    [newsItems]
  );
  const items = useMemo(() =>
    urgFilter === 'all' ? allMapped : allMapped.filter(it => it.urgency === urgFilter),
    [allMapped, urgFilter]
  );

  const flyPos = useMemo(() => {
    if (!selected) return null;
    const base = CATEGORY_COORDS[selected.category];
    if (!base) return null;
    const [jLat, jLng] = hashJitter(String(selected.id || selected.title || ''));
    return [base[0] + jLat, base[1] + jLng];
  }, [selected]);

  return (
    <div className="mp-inner">
      {/* ── Map ── */}
      <div className="mp-map-wrap">
        <MapContainer
          center={[31, 38]}
          zoom={4}
          className="mp-map"
          zoomControl={false}
          scrollWheelZoom
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />
          {flyPos && <MapFlyTo pos={flyPos} zoom={6} />}
          {items.map((item, i) => {
            const base = CATEGORY_COORDS[item.category] || [31, 38];
            const [jLat, jLng] = hashJitter(String(item.id || item.title || i));
            const pos = [base[0] + jLat, base[1] + jLng];
            const isHigh = item.urgency === 'high';
            const isMed  = item.urgency === 'medium';
            const color  = isHigh ? '#ef4444' : isMed ? '#f59e0b' : '#3b82f6';
            const r      = isHigh ? 9 : isMed ? 6 : 5;
            return (
              <CircleMarker
                key={item.id || i}
                center={pos}
                radius={r}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.78, weight: isHigh ? 2 : 1.2 }}
                eventHandlers={{ click: () => setSelected(s => s === item ? null : item) }}
              >
                <Popup>
                  <div className="mp-popup" dir="rtl">
                    <p className="mp-popup__title">{item.title}</p>
                    <span className="mp-popup__meta">{item.source?.name} · {relativeTime(item.time)}</span>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Legend overlay */}
        <div className="mp-legend">
          <div className="mp-legend__item"><span className="mp-legend__dot mp-legend__dot--red" />عاجل</div>
          <div className="mp-legend__item"><span className="mp-legend__dot mp-legend__dot--amber" />مهم</div>
          <div className="mp-legend__item"><span className="mp-legend__dot mp-legend__dot--blue" />عادي</div>
        </div>
      </div>

      {/* ── Filter row ── */}
      <div className="mp-filter-row">
        <div className="mp-filter-tabs">
          {[
            { id: 'all',    label: `الكل (${allMapped.length})` },
            { id: 'high',   label: '⚡ عاجل' },
            { id: 'medium', label: '● مهم' },
            { id: 'low',    label: '◦ عادي' },
          ].map(f => (
            <button key={f.id} className={`mp-ftab ${urgFilter === f.id ? 'mp-ftab--active' : ''}`} onClick={() => setUrgFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="mp-count">{items.length} حدث على الخريطة</span>
      </div>

      {/* ── Selected detail ── */}
      {selected && (() => {
        const isHigh = selected.urgency === 'high';
        const isMed  = selected.urgency === 'medium';
        return (
          <div className={`mp-selected-card mp-selected-card--${selected.urgency}`}>
            <button className="mp-selected-card__close" onClick={() => setSelected(null)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <span className="mp-selected-card__urg">
              {isHigh ? '⚡ عاجل' : isMed ? '● مهم' : '◦ عادي'}
            </span>
            <h4 className="mp-selected-card__title">{selected.title}</h4>
            <p className="mp-selected-card__meta">{selected.source?.name} · {relativeTime(selected.time)}</p>
          </div>
        );
      })()}

      {/* ── Events list ── */}
      <div className="mp-events-list">
        <div className="mp-events-list__hdr">أحدث الأحداث</div>
        {newsItems.slice(0, 30).map((item, i) => {
          const isHigh = item.urgency === 'high';
          const isMed  = item.urgency === 'medium';
          const dotColor = isHigh ? '#ef4444' : isMed ? '#f59e0b' : '#3b82f6';
          return (
            <button
              key={item.id || i}
              className={`mp-event-item ${selected === item ? 'mp-event-item--active' : ''}`}
              onClick={() => setSelected(s => s === item ? null : item)}
              dir="rtl"
            >
              <span className="mp-event-item__dot" style={{ background: dotColor, boxShadow: isHigh ? `0 0 8px ${dotColor}` : 'none' }} />
              <div className="mp-event-item__body">
                <p className="mp-event-item__title">{item.title}</p>
                <span className="mp-event-item__meta">{item.source?.name} · {relativeTime(item.time)}</span>
              </div>
              <span className="mp-event-item__cat">{CATEGORIES.find(c => c.id === item.category)?.label || item.category}</span>
            </button>
          );
        })}
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

  /* ── SITREP ── */
  const [sitrep,        setSitrep]        = useState(null);
  const [sitrepLoading, setSitrepLoading] = useState(false);

  const PAGE_SIZE = 60;

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

  /* ─── SITREP Loader ─── */
  const loadSitrep = useCallback(async () => {
    setSitrepLoading(true);
    try {
      const res = await fetch('/api/intelligence/latest');
      if (res.status === 204) return; // no digest yet
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSitrep(data);
    } catch (_) {
      // silent — SITREP is supplementary
    } finally {
      setSitrepLoading(false);
    }
  }, []);

  /* ─── Initial Loads ─── */
  useEffect(() => { loadNews('all', '', 1); }, [loadNews]);
  useEffect(() => { loadLive(); }, [loadLive]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useEffect(() => { loadSitrep(); }, [loadSitrep]);

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

  /* ─── Load briefing when editorial tab opens ─── */
  useEffect(() => {
    if (activeTab !== 'editorial') return;
    if (!editorialBriefing && !loadingNews) loadNews('all', '', 1);
  }, [activeTab]); // eslint-disable-line

  /* ─── Load news when map tab opens ─── */
  useEffect(() => {
    if (activeTab !== 'map') return;
    if (newsItems.length === 0 && !loadingNews) loadNews('all', '', 1);
  }, [activeTab]); // eslint-disable-line

  /* ─── Auto-refresh SITREP every 30 min ─── */
  useEffect(() => {
    const id = setInterval(loadSitrep, 30 * 60 * 1_000);
    return () => clearInterval(id);
  }, [loadSitrep]);

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
    const q = channelSearch.trim().toLowerCase();
    const base = q
      ? streams.filter(st => {
          const name = st.source?.name || (st.stream || st).name || (st.stream || st).registry_id || '';
          const lang = st.source?.language || (st.stream || st).language || '';
          return name.toLowerCase().includes(q) || lang.toLowerCase().includes(q);
        })
      : streams;

    const score = (st) => {
      const s = st.stream || st;
      const isLive = s.uptime_status === 'up' || s.status === 'active';
      const isDegraded = s.uptime_status === 'degraded';
      const hasEmbed = Boolean(s.embed_url || s.embedUrl);
      return (isLive ? 100 : 0) + (isDegraded ? 70 : 0) + (hasEmbed ? 30 : 0);
    };

    return [...base].sort((a, b) => score(b) - score(a));
  }, [streams, channelSearch]);

  const featuredLiveStreams = useMemo(() => {
    return filteredStreams
      .filter((st) => {
        const s = st.stream || st;
        return s.uptime_status === 'up' || s.status === 'active';
      })
      .slice(0, 6);
  }, [filteredStreams]);

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

            {!loadingNews && !sitrepLoading && page === 1 && <SitrepPanel sitrep={sitrep} />}


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

        {/* ═══════════════════════════════════════════
            EDITORIAL TAB  ★★★★★★★ LUXURY
        ═══════════════════════════════════════════ */}
        {activeTab === 'editorial' && (
          <div className="eb-arena" dir="rtl">

            {/* ══ COMMAND HEADER ══ */}
            <div className="eb-hdr">
              <div className="eb-hdr__left">
                <div className="eb-hdr__eyebrow">
                  <span className="eb-hdr__pulse" />
                  تحرير استخباراتي
                </div>
                <h2 className="eb-hdr__title">لوحة التحرير الذكية</h2>
                <p className="eb-hdr__sub">ترتيب القصص حسب الزخم · التحقق · التعارض · تنوع المصادر</p>
              </div>
              <button className="eb-hdr__refresh" onClick={() => loadNews('all', '', 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                تحديث
              </button>
            </div>

            {/* ══ HUD MOMENTUM BAR ══ */}
            {editorialBriefing?.momentum && (
              <div className="eb-hud-bar">
                <div className="eb-hud-bar__inner">
                  <div className="eb-stat eb-stat--gold">
                    <span className="eb-stat__val">{editorialBriefing.momentum.high_priority_count ?? 0}</span>
                    <span className="eb-stat__key">أولوية عالية</span>
                  </div>
                  <div className="eb-sep" />
                  <div className="eb-stat eb-stat--green">
                    <span className="eb-stat__val">{editorialBriefing.momentum.corroborated_count ?? 0}</span>
                    <span className="eb-stat__key">موثق</span>
                  </div>
                  <div className="eb-sep" />
                  <div className="eb-stat eb-stat--blue">
                    <span className="eb-stat__val">{editorialBriefing.verification_radar?.partially_corroborated ?? 0}</span>
                    <span className="eb-stat__key">توثيق جزئي</span>
                  </div>
                  <div className="eb-sep" />
                  <div className="eb-stat eb-stat--red">
                    <span className="eb-stat__val">{editorialBriefing.momentum.review_count ?? 0}</span>
                    <span className="eb-stat__key">تحتاج مراجعة</span>
                  </div>
                  <div className="eb-sep" />
                  <div className="eb-stat eb-stat--purple">
                    <span className="eb-stat__val">{editorialBriefing.verification_radar?.single_source ?? 0}</span>
                    <span className="eb-stat__key">مصدر واحد</span>
                  </div>
                </div>
                <div className="eb-hud-bar__divider" />
                <div className="eb-hud-bar__confidence">
                  <span className="eb-hud-bar__conf-label">متوسط الثقة</span>
                  <span className="eb-hud-bar__conf-val">
                    {editorialBriefing.verification_radar?.average_confidence
                      ? `${Math.round(editorialBriefing.verification_radar.average_confidence * 100)}%`
                      : '—'}
                  </span>
                </div>
              </div>
            )}

            {loadingNews && <LoadingSpinner label="جارٍ تحليل الأخبار…" />}

            {!loadingNews && !editorialBriefing && (
              <div className="eb-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".25"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                <p>لا توجد بيانات تحريرية حاليا — قم بتشغيل الاستيعاب أولاً</p>
              </div>
            )}

            {!loadingNews && editorialBriefing && (
              <>
                {/* ══ LEAD STORY ══ */}
                {editorialBriefing.lead_story && (
                  <div className="eb-lead">
                    <div className="eb-lead__badge">القصة القائدة</div>
                    <h3 className="eb-lead__title">{editorialBriefing.lead_story.title}</h3>
                    <div className="eb-lead__chips">
                      <span className={`eb-chip eb-chip--${editorialBriefing.lead_story.contradiction_flag ? 'red' : 'green'}`}>
                        {verificationLabel(editorialBriefing.lead_story.verification_state)}
                      </span>
                      <span className="eb-chip eb-chip--amber">{editorialPriorityLabel(editorialBriefing.lead_story.editorial_priority)}</span>
                      <span className="eb-chip eb-chip--blue">{editorialDecisionLabel(editorialBriefing.lead_story.editorial_decision)}</span>
                    </div>
                    <div className="eb-lead__metrics">
                      <div className="eb-metric">
                        <span className="eb-metric__val eb-metric__val--green">{Math.round((editorialBriefing.lead_story.confidence_score || 0) * 100)}%</span>
                        <span className="eb-metric__key">الثقة</span>
                      </div>
                      <div className="eb-metric">
                        <span className="eb-metric__val eb-metric__val--blue">{Math.round((editorialBriefing.lead_story.rank_score || 0) * 100)}%</span>
                        <span className="eb-metric__key">الترتيب</span>
                      </div>
                      <div className="eb-metric">
                        <span className="eb-metric__val eb-metric__val--amber">{editorialBriefing.lead_story.corroboration_count || 0}</span>
                        <span className="eb-metric__key">التعضيد</span>
                      </div>
                      <div className="eb-metric">
                        <span className="eb-metric__val">{editorialBriefing.lead_story.source_diversity || 1}</span>
                        <span className="eb-metric__key">تنوع المصادر</span>
                      </div>
                    </div>
                    <div className="eb-lead__footer">
                      <span className="eb-lead__source">{editorialBriefing.lead_story.source_name}</span>
                      <span className="eb-lead__dot">·</span>
                      <span className="eb-lead__time">{relativeTime(editorialBriefing.lead_story.published_at)}</span>
                    </div>
                    <div className="eb-lead__glow" />
                  </div>
                )}

                {/* ══ SIGNAL GRID ══ */}
                <div className="eb-grid">

                  {/* Radar card */}
                  <div className="eb-card">
                    <div className="eb-card__icon eb-card__icon--blue">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                    </div>
                    <div className="eb-card__eyebrow">رادار التحقق</div>
                    <div className="eb-card__metrics">
                      <div className="eb-mini-metric eb-mini-metric--green">
                        <span>{editorialBriefing.verification_radar?.corroborated || 0}</span><small>موثق</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--amber">
                        <span>{editorialBriefing.verification_radar?.partially_corroborated || 0}</span><small>جزئي</small>
                      </div>
                      <div className="eb-mini-metric">
                        <span>{editorialBriefing.verification_radar?.single_source || 0}</span><small>مصدر واحد</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--blue">
                        <span>{editorialBriefing.verification_radar?.average_confidence
                          ? `${Math.round(editorialBriefing.verification_radar.average_confidence * 100)}%`
                          : '—'}</span>
                        <small>متوسط الثقة</small>
                      </div>
                    </div>
                  </div>

                  {/* Queue card */}
                  <div className="eb-card">
                    <div className="eb-card__icon eb-card__icon--gold">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    </div>
                    <div className="eb-card__eyebrow">قرار التحرير</div>
                    <div className="eb-card__metrics">
                      <div className="eb-mini-metric eb-mini-metric--green">
                        <span>{editorialBriefing.editorial_queue?.publish || 0}</span><small>نشر</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--blue">
                        <span>{editorialBriefing.editorial_queue?.update || 0}</span><small>تحديث</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--amber">
                        <span>{editorialBriefing.editorial_queue?.merge || 0}</span><small>دمج</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--red">
                        <span>{editorialBriefing.editorial_queue?.hold || 0}</span><small>إيقاف</small>
                      </div>
                    </div>
                  </div>

                  {/* Momentum card */}
                  <div className="eb-card">
                    <div className="eb-card__icon eb-card__icon--red">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    </div>
                    <div className="eb-card__eyebrow">زخم التحرير</div>
                    <div className="eb-card__metrics">
                      <div className="eb-mini-metric eb-mini-metric--gold">
                        <span>{editorialBriefing.momentum?.high_priority_count || 0}</span><small>أولوية عالية</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--green">
                        <span>{editorialBriefing.momentum?.corroborated_count || 0}</span><small>موثقة</small>
                      </div>
                      <div className="eb-mini-metric eb-mini-metric--red">
                        <span>{editorialBriefing.momentum?.review_count || 0}</span><small>مراجعة</small>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ══ DISPUTED + CLUSTER ROW ══ */}
                <div className="eb-list-row">

                  {/* Disputed stories */}
                  <div className="eb-list-card">
                    <div className="eb-list-card__hdr">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      قصص تحتاج مراجعة
                    </div>
                    {editorialBriefing.disputed_stories?.length ? (
                      editorialBriefing.disputed_stories.map(story => (
                        <div key={story.id} className="eb-list-item">
                          <div className="eb-list-item__body">
                            <p className="eb-list-item__title">{story.title}</p>
                            <span className="eb-list-item__meta">{story.source_name} · {relativeTime(story.published_at)}</span>
                          </div>
                          <span className="eb-chip eb-chip--red eb-chip--sm">{verificationLabel(story.verification_state)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="eb-list-empty">لا توجد قصص متنازع عليها</p>
                    )}
                  </div>

                  {/* Cluster watch */}
                  <div className="eb-list-card">
                    <div className="eb-list-card__hdr">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
                      رادار التجميع
                    </div>
                    {editorialBriefing.cluster_watch?.length ? (
                      editorialBriefing.cluster_watch.map(story => (
                        <div key={story.id} className="eb-list-item">
                          <div className="eb-list-item__body">
                            <p className="eb-list-item__title">{story.title}</p>
                            <span className="eb-list-item__meta">{story.corroboration_count} دعم · {story.source_diversity} مصادر</span>
                          </div>
                          <span className="eb-chip eb-chip--blue eb-chip--sm">{Math.round((story.rank_score || 0) * 100)}%</span>
                        </div>
                      ))
                    ) : (
                      <p className="eb-list-empty">لا توجد عناقيد بارزة</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════
            LIVE TAB  ★★★★★★★ LUXURY REBUILD
        ═══════════════════════════════════════════ */}
        {activeTab === 'live' && (
          <div className="live-arena" dir="rtl">

            {/* ══ COMMAND HEADER ══ */}
            <div className="live-hdr">
              <div className="live-hdr__left">
                <div className="live-hdr__eyebrow">
                  <span className="live-hdr__pulse" />
                  بث مباشر
                </div>
                <h2 className="live-hdr__title">مركز قنوات الأخبار</h2>
                <p className="live-hdr__sub">
                  {liveSummary
                    ? `${liveSummary.active_streams ?? streams.length} قناة نشطة · ${liveSummary.total_streams ?? streams.length} إجمالاً`
                    : 'تغطية استخباراتية على مدار الساعة'}
                </p>
              </div>
              <button className="live-hdr__refresh" onClick={loadLive}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                تحديث
              </button>
            </div>

            {/* ══ HUD COMMAND STRIP ══ */}
            {liveSummary && (
              <div className="live-hud-bar">
                <div className="live-hud-bar__inner">
                  <div className="lhb-stat lhb-stat--green">
                    <span className="lhb-stat__val">{liveSummary.playable_streams ?? liveSummary.active_streams ?? '?'}</span>
                    <span className="lhb-stat__key">قابل للبث</span>
                  </div>
                  <div className="lhb-sep" />
                  <div className="lhb-stat lhb-stat--blue">
                    <span className="lhb-stat__val">{liveSummary.active_streams ?? '?'}</span>
                    <span className="lhb-stat__key">نشط الآن</span>
                  </div>
                  {(liveSummary.down_streams ?? 0) > 0 && (
                    <>
                      <div className="lhb-sep" />
                      <div className="lhb-stat lhb-stat--red">
                        <span className="lhb-stat__val">{liveSummary.down_streams}</span>
                        <span className="lhb-stat__key">متوقف</span>
                      </div>
                    </>
                  )}
                  <div className="lhb-sep" />
                  <div className="lhb-stat lhb-stat--gold">
                    <span className="lhb-stat__val">{liveSummary.total_streams ?? streams.length}</span>
                    <span className="lhb-stat__key">الإجمالي</span>
                  </div>
                </div>
                <div className="live-hud-bar__divider" />
                <div className="live-hud-bar__status-row">
                  <span className="live-hud-bar__status-dot live-hud-bar__status-dot--green" />
                  <span className="live-hud-bar__status-text">نظام المراقبة: نشط</span>
                </div>
              </div>
            )}

            {errorLive && <ErrorBanner message={errorLive} onRetry={loadLive} />}

            {/* ══ FEATURED ON-AIR MARQUEE ══ */}
            {!loadingLive && featuredLiveStreams.length > 0 && (
              <div className="live-marquee-wrap">
                <span className="live-marquee-wrap__label">على الهواء الآن</span>
                <div className="live-marquee">
                  {[...featuredLiveStreams, ...featuredLiveStreams].map((st, i) => {
                    const sv = st.stream || st;
                    const nm = st.source?.name || sv.name || sv.registry_id || `قناة ${i + 1}`;
                    return (
                      <button
                        key={`${sv.id ?? i}-${i}`}
                        className="live-marquee__chip"
                        onClick={() => setSelectedStream(st)}
                      >
                        <span className="live-marquee__chip-dot" />
                        {nm}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ══ CINEMATIC PLAYER ══ */}
            {selectedStream && (
              <CinematicPlayer
                stream={selectedStream}
                onClose={() => setSelectedStream(null)}
              />
            )}

            {/* ══ CHANNEL COMMAND SEARCH ══ */}
            <div className="live-search-bar" dir="rtl">
              <svg className="live-search-bar__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="search"
                className="live-search-bar__input"
                placeholder="ابحث في القنوات…"
                value={channelSearch}
                onChange={e => setChannelSearch(e.target.value)}
                dir="rtl"
              />
              {channelSearch && (
                <button className="live-search-bar__clear" onClick={() => setChannelSearch('')} aria-label="مسح">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {/* ══ CHANNELS GRID ══ */}
            {loadingLive
              ? <LoadingSpinner label="جارٍ تحميل القنوات…" />
              : (
                <div className="live-ch-grid">
                  {filteredStreams.map((st, i) => (
                    <LuxChannelCard
                      key={st.stream?.id || st.id || i}
                      stream={st}
                      onSelect={setSelectedStream}
                      isActive={selectedStream === st}
                    />
                  ))}
                  {filteredStreams.length === 0 && (
                    <div className="live-empty">
                      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".3"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                      <p>لا توجد قنوات مطابقة</p>
                    </div>
                  )}
                </div>
              )
            }
          </div>
        )}

        {/* ═══════════════════════════════════════════
            MAP TAB  ★★★★★★★ LUXURY
        ═══════════════════════════════════════════ */}
        {activeTab === 'map' && (
          <div className="mp-arena" dir="rtl">

            {/* ══ COMMAND HEADER ══ */}
            <div className="mp-hdr">
              <div className="mp-hdr__left">
                <div className="mp-hdr__eyebrow">
                  <span className="mp-hdr__pulse" />
                  رصد جيوسياسي
                </div>
                <h2 className="mp-hdr__title">خريطة الأحداث</h2>
                <p className="mp-hdr__sub">
                  {newsItems.length > 0
                    ? `${newsItems.filter(i => CATEGORY_COORDS[i.category]).length} حدث على الخريطة · ${newsItems.filter(i => i.urgency === 'high').length} عاجل`
                    : 'رصد جيوسياسي على مدار الساعة'}
                </p>
              </div>
              <button className="mp-hdr__refresh" onClick={() => loadNews('all', '', 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                تحديث
              </button>
            </div>

            {/* ══ HUD STATS BAR ══ */}
            <div className="mp-hud-bar">
              <div className="mp-hud-bar__inner">
                <div className="mp-hud-stat mp-hud-stat--red">
                  <span className="mp-hud-stat__val">{newsItems.filter(i => i.urgency === 'high').length}</span>
                  <span className="mp-hud-stat__key">عاجل</span>
                </div>
                <div className="mp-hud-sep" />
                <div className="mp-hud-stat mp-hud-stat--amber">
                  <span className="mp-hud-stat__val">{newsItems.filter(i => i.urgency === 'medium').length}</span>
                  <span className="mp-hud-stat__key">مهم</span>
                </div>
                <div className="mp-hud-sep" />
                <div className="mp-hud-stat mp-hud-stat--blue">
                  <span className="mp-hud-stat__val">{newsItems.filter(i => i.urgency === 'low').length}</span>
                  <span className="mp-hud-stat__key">عادي</span>
                </div>
                <div className="mp-hud-sep" />
                <div className="mp-hud-stat mp-hud-stat--gold">
                  <span className="mp-hud-stat__val">{newsItems.length}</span>
                  <span className="mp-hud-stat__key">الإجمالي</span>
                </div>
              </div>
              <div className="mp-hud-bar__divider" />
              <div className="mp-hud-bar__status">
                <span className="mp-hud-bar__status-dot" />
                <span className="mp-hud-bar__status-text">نظام الرصد: نشط</span>
              </div>
            </div>

            {loadingNews
              ? <LoadingSpinner label="جارٍ تحميل بيانات الأحداث…" />
              : <EventsMap newsItems={newsItems} />
            }
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

/* ── SITREP Panel ── */
.sitrep {
  --sitrep-color: #f0a500;
  background: color-mix(in srgb, var(--bg2) 88%, var(--sitrep-color) 12%);
  border: 1px solid color-mix(in srgb, var(--border) 70%, var(--sitrep-color) 30%);
  border-left: 4px solid var(--sitrep-color);
  border-radius: var(--radius);
  margin-bottom: 18px;
  overflow: hidden;
  box-shadow: 0 2px 12px color-mix(in srgb, transparent 85%, var(--sitrep-color) 15%);
}
.sitrep__header {
  padding: 14px 18px;
  cursor: pointer;
  user-select: none;
}
.sitrep__header:hover { background: color-mix(in srgb, transparent 94%, var(--sitrep-color) 6%); }
.sitrep__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.sitrep__label {
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--text3);
}
.sitrep__badge {
  font-size: .75rem;
  font-weight: 700;
  color: #fff;
  border-radius: 4px;
  padding: 2px 8px;
}
.sitrep__age { font-size: .75rem; color: var(--text3); margin-right: auto; }
.sitrep__toggle { color: var(--text3); font-size: .75rem; }
.sitrep__headline {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.4;
  color: var(--text1);
}
.sitrep__body {
  padding: 0 18px 18px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, var(--sitrep-color) 30%);
  padding-top: 14px;
}
.sitrep__summary { color: var(--text2); line-height: 1.7; margin: 0 0 16px; font-size: .92rem; }
.sitrep__section { margin-bottom: 16px; }
.sitrep__section-title {
  font-size: .78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--sitrep-color);
  margin: 0 0 8px;
}
.sitrep__actors, .sitrep__fronts, .sitrep__contras {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.sitrep__actor, .sitrep__front {
  font-size: .88rem;
  color: var(--text2);
  padding: 6px 10px;
  background: color-mix(in srgb, var(--bg1) 60%, transparent 40%);
  border-radius: 6px;
}
.sitrep__actor-role { color: var(--text3); }
.sitrep__actor-action { color: var(--text1); }
.sitrep__trend { font-weight: 900; margin-left: 6px; }
.sitrep__trend--escalating   { color: #e74c3c; }
.sitrep__trend--stable        { color: var(--text3); }
.sitrep__trend--de-escalating { color: #26c281; }
.sitrep__front-status { color: var(--text3); }
.sitrep__contra {
  font-size: .85rem;
  color: var(--text2);
  background: color-mix(in srgb, #e74c3c 8%, var(--bg1) 92%);
  border-radius: 6px;
  padding: 8px 10px;
  line-height: 1.5;
}
.sitrep__contra-a { color: #f0a500; }
.sitrep__contra-b { color: #e74c3c; }
.sitrep__contra-sep { color: var(--text3); }

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

/* ════════════════════════════════════════════════════════
   LIVE ARENA — 7-STAR LUXURY REBUILD
════════════════════════════════════════════════════════ */

/* ── Arena wrapper ── */
.live-arena {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Command Header ── */
.live-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 0 22px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  margin-bottom: 24px;
}
.live-hdr__left { display: flex; flex-direction: column; gap: 4px; }
.live-hdr__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--red);
}
.live-hdr__pulse {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--red);
  box-shadow: 0 0 10px var(--red), 0 0 24px rgba(239,68,68,.4);
  animation: blink 1.1s ease-in-out infinite;
  flex-shrink: 0;
}
.live-hdr__title {
  font-size: 1.7rem;
  font-weight: 900;
  letter-spacing: -.04em;
  line-height: 1;
  color: var(--text);
  background: linear-gradient(100deg, #fff 30%, rgba(255,255,255,.55) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
[data-theme="light"] .live-hdr__title {
  background: linear-gradient(100deg, #1a1d2e 30%, #4a5172 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.live-hdr__sub {
  font-size: .78rem;
  color: var(--text3);
  letter-spacing: .01em;
}
.live-hdr__refresh {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  color: var(--text2);
  font-size: .78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all .22s;
  flex-shrink: 0;
  letter-spacing: .02em;
}
.live-hdr__refresh:hover {
  background: rgba(59,130,246,.12);
  border-color: rgba(59,130,246,.38);
  color: #93c5fd;
  box-shadow: 0 0 16px rgba(59,130,246,.1);
}

/* ── HUD Command Strip ── */
.live-hud-bar {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  background:
    linear-gradient(135deg, rgba(6,8,16,.96) 0%, rgba(14,18,30,.94) 100%);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 24px;
  box-shadow:
    0 12px 40px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.06),
    inset 0 -1px 0 rgba(255,255,255,.02);
  position: relative;
}
.live-hud-bar::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 80% at 20% 50%, rgba(59,130,246,.04) 0%, transparent 100%);
  pointer-events: none;
}
.live-hud-bar__inner {
  display: flex;
  align-items: stretch;
  flex: 1;
}
.lhb-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 20px 28px;
  flex: 1;
  transition: background .2s;
  cursor: default;
}
.lhb-stat:hover { background: rgba(255,255,255,.02); }
.lhb-stat__val {
  font-size: 2rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -.05em;
  font-variant-numeric: tabular-nums;
}
.lhb-stat--green .lhb-stat__val {
  color: #4ade80;
  text-shadow: 0 0 24px rgba(34,197,94,.5), 0 0 48px rgba(34,197,94,.2);
}
.lhb-stat--blue .lhb-stat__val {
  color: #93c5fd;
  text-shadow: 0 0 24px rgba(147,197,253,.45), 0 0 48px rgba(59,130,246,.2);
}
.lhb-stat--red .lhb-stat__val {
  color: #fca5a5;
  text-shadow: 0 0 24px rgba(239,68,68,.45);
}
.lhb-stat--gold .lhb-stat__val {
  color: #fcd34d;
  text-shadow: 0 0 24px rgba(245,158,11,.45);
}
.lhb-stat__key {
  font-size: .6rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.2);
}
.lhb-sep {
  width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,.07) 30%, rgba(255,255,255,.07) 70%, transparent);
  flex-shrink: 0;
}
.live-hud-bar__divider {
  width: 1px;
  background: rgba(255,255,255,.06);
  flex-shrink: 0;
}
.live-hud-bar__status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  flex-shrink: 0;
}
.live-hud-bar__status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.live-hud-bar__status-dot--green {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34,197,94,.7), 0 0 16px rgba(34,197,94,.3);
  animation: blink 2.4s ease-in-out infinite;
}
.live-hud-bar__status-text {
  font-size: .68rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(255,255,255,.22);
  white-space: nowrap;
}

/* ── Featured Marquee ── */
.live-marquee-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(90deg,
    rgba(10,12,22,.95) 0%,
    rgba(14,18,28,.90) 60%,
    rgba(10,12,22,.95) 100%);
  border: 1px solid rgba(34,197,94,.1);
  border-radius: 12px;
  padding: 10px 18px;
  margin-bottom: 20px;
  overflow: hidden;
  position: relative;
}
.live-marquee-wrap::before,
.live-marquee-wrap::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  width: 48px;
  z-index: 2;
  pointer-events: none;
}
.live-marquee-wrap::before {
  right: 0;
  background: linear-gradient(to left, rgba(10,12,22,.95), transparent);
}
.live-marquee-wrap::after {
  left: 76px;
  background: linear-gradient(to right, rgba(10,12,22,.95), transparent);
}
.live-marquee-wrap__label {
  font-size: .64rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(34,197,94,.65);
  white-space: nowrap;
  flex-shrink: 0;
  z-index: 3;
}
.live-marquee {
  display: flex;
  gap: 10px;
  animation: marquee-scroll 28s linear infinite;
  flex-shrink: 0;
}
.live-marquee:hover { animation-play-state: paused; }
@keyframes marquee-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.live-marquee__chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 13px;
  border-radius: 999px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.09);
  color: rgba(255,255,255,.5);
  font-size: .72rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: all .2s;
  text-decoration: none;
}
.live-marquee__chip:hover {
  background: rgba(59,130,246,.16);
  border-color: rgba(59,130,246,.4);
  color: #93c5fd;
  box-shadow: 0 0 12px rgba(59,130,246,.15);
}
.live-marquee__chip-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34,197,94,.7);
  flex-shrink: 0;
}

/* ── Cinematic Player (cp) ── */
.cp {
  background: #060810;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 20px;
  overflow: hidden;
  margin-bottom: 30px;
  position: relative;
  box-shadow:
    0 40px 100px rgba(0,0,0,.8),
    0 0 0 1px rgba(255,255,255,.04),
    inset 0 1px 0 rgba(255,255,255,.07);
}
.cp__beam {
  position: absolute;
  top: -60px; left: 50%;
  transform: translateX(-50%);
  width: 420px; height: 120px;
  background: radial-gradient(ellipse at center, rgba(59,130,246,.06) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}
.cp__bar {
  position: relative; z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px;
  background: linear-gradient(135deg, rgba(8,10,20,.98) 0%, rgba(12,15,26,.94) 100%);
  border-bottom: 1px solid rgba(255,255,255,.06);
  gap: 16px;
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
}
.cp__identity {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}
.cp__logo-frame {
  width: 48px; height: 48px;
  background: rgba(255,255,255,.05);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.1);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.07);
}
.cp__logo-frame img   { width: 100%; height: 100%; object-fit: contain; }
.cp__logo-frame span  { font-size: .88rem; font-weight: 800; color: rgba(255,255,255,.5); letter-spacing: -.02em; }
.cp__meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cp__channel-name {
  font-size: 1.05rem; font-weight: 700;
  color: #f0f4ff; letter-spacing: -.015em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cp__channel-sub {
  font-size: .66rem; font-weight: 700;
  color: rgba(255,255,255,.28);
  letter-spacing: .1em; text-transform: uppercase;
}
.cp__live-pill {
  display: inline-flex; align-items: center; gap: 7px;
  background: rgba(239,68,68,.1);
  border: 1px solid rgba(239,68,68,.32);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: .64rem; font-weight: 900;
  letter-spacing: .18em; text-transform: uppercase;
  color: #ff7a7a;
  flex-shrink: 0;
  box-shadow: 0 0 18px rgba(239,68,68,.08);
}
.cp__live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #ff4444;
  box-shadow: 0 0 8px #ff4444, 0 0 18px rgba(255,68,68,.5);
  animation: blink 1s ease-in-out infinite;
  flex-shrink: 0;
}
.cp__actions { display: flex; gap: 8px; flex-shrink: 0; }
.cp__action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 9px;
  font-size: .74rem; font-weight: 700;
  cursor: pointer; transition: all .2s;
  border: none; text-decoration: none; letter-spacing: .01em;
}
.cp__action-btn--ghost {
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.5);
  border: 1px solid rgba(255,255,255,.1);
}
.cp__action-btn--ghost:hover {
  background: rgba(255,255,255,.12);
  color: #fff;
  border-color: rgba(255,255,255,.2);
}
.cp__action-btn--close {
  background: rgba(239,68,68,.08);
  color: rgba(239,68,68,.65);
  border: 1px solid rgba(239,68,68,.18);
}
.cp__action-btn--close:hover {
  background: rgba(239,68,68,.2);
  color: #f87171;
  border-color: rgba(239,68,68,.38);
}
.cp__screen {
  aspect-ratio: 16 / 9;
  background: #000112;
  position: relative;
  overflow: hidden;
}
.cp__iframe {
  width: 100%; height: 100%;
  border: none; display: block;
  position: relative; z-index: 1;
}
.cp__scanlines {
  position: absolute; inset: 0; z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px, transparent 2px,
    rgba(0,0,0,.018) 2px, rgba(0,0,0,.018) 3px
  );
}
.cp__vignette {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,.35) 100%);
}
.cp__no-embed {
  position: absolute; inset: 0; z-index: 4;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 18px;
  background:
    radial-gradient(ellipse 80% 70% at 50% 50%, rgba(20,24,42,.95) 0%, rgba(6,8,16,.98) 100%);
}
.cp__no-embed-ring { position: relative; }
.cp__no-embed-svg  { width: 80px; height: 80px; }
.cp__no-embed-title {
  font-size: 1.05rem; font-weight: 700;
  color: rgba(255,255,255,.6); letter-spacing: -.01em;
}
.cp__no-embed-sub {
  font-size: .8rem; color: rgba(255,255,255,.25);
  text-align: center; max-width: 260px;
}
.cp__watch-cta {
  display: inline-flex; align-items: center; gap: 8px;
  background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
  color: #eff6ff;
  padding: 12px 28px; border-radius: 10px;
  font-size: .86rem; font-weight: 700;
  text-decoration: none; letter-spacing: .01em;
  box-shadow: 0 8px 24px rgba(37,99,235,.35), 0 0 0 1px rgba(255,255,255,.06) inset;
  transition: all .22s;
}
.cp__watch-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 36px rgba(37,99,235,.55), 0 0 0 1px rgba(255,255,255,.1) inset;
}
.cp__footer {
  padding: 10px 22px;
  font-size: .78rem;
  color: rgba(255,255,255,.22);
  border-top: 1px solid rgba(255,255,255,.05);
  background: rgba(0,0,0,.3);
  line-height: 1.5;
}

/* ── Live Search Bar ── */
.live-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 14px;
  padding: 11px 18px;
  margin-bottom: 22px;
  transition: border-color .2s, box-shadow .2s;
}
.live-search-bar:focus-within {
  border-color: rgba(59,130,246,.45);
  box-shadow: 0 0 0 3px rgba(59,130,246,.1), 0 4px 20px rgba(0,0,0,.3);
}
.live-search-bar__icon {
  color: rgba(255,255,255,.2);
  flex-shrink: 0;
  transition: color .2s;
}
.live-search-bar:focus-within .live-search-bar__icon { color: rgba(147,197,253,.6); }
.live-search-bar__input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: .88rem;
  caret-color: var(--accent);
}
.live-search-bar__input::placeholder { color: rgba(255,255,255,.18); }
.live-search-bar__clear {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255,255,255,.2);
  padding: 2px;
  display: flex;
  align-items: center;
  transition: color .18s;
}
.live-search-bar__clear:hover { color: rgba(255,255,255,.5); }

/* ── Channels Grid ── */
.live-ch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
@media (min-width: 540px)  { .live-ch-grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 14px; } }
@media (min-width: 900px)  { .live-ch-grid { grid-template-columns: repeat(auto-fill, minmax(186px, 1fr)); } }
@media (min-width: 1200px) { .live-ch-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; } }

.live-empty {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 60px 20px;
  color: var(--text2);
  font-size: .88rem;
}

/* ── Luxury Channel Card (lxc) ── */
.lxc {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 14px 14px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,.07);
  background:
    linear-gradient(160deg, rgba(22,26,40,.95) 0%, rgba(14,17,28,.98) 100%);
  cursor: pointer;
  text-align: inherit;
  min-height: 148px;
  overflow: hidden;
  transition: transform .28s cubic-bezier(.34,1.56,.64,1),
              border-color .24s,
              box-shadow .28s;
  outline: none;
  /* Shimmer highlight */
}
.lxc::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: 15px;
  background: linear-gradient(140deg, rgba(255,255,255,.045) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

/* Glow blob (JS-driven via --dot-color in lxc__glow) */
.lxc__glow {
  position: absolute;
  top: -30%; right: -20%;
  width: 120%; height: 100%;
  background: radial-gradient(ellipse 60% 50% at 80% 30%,
    rgba(59,130,246,.05) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
  transition: opacity .3s;
  opacity: 0;
}
.lxc:hover .lxc__glow { opacity: 1; }
.lxc--active .lxc__glow {
  opacity: 1;
  background: radial-gradient(ellipse 70% 60% at 70% 30%,
    rgba(59,130,246,.11) 0%, transparent 70%);
}

/* Hover & active states */
.lxc:hover {
  transform: translateY(-5px) scale(1.012);
  border-color: rgba(96,165,250,.45);
  box-shadow:
    0 20px 48px rgba(0,0,0,.55),
    0 0 0 1px rgba(96,165,250,.2),
    0 0 28px rgba(59,130,246,.07);
}
.lxc--active {
  transform: translateY(-3px);
  border-color: rgba(59,130,246,.65);
  background:
    linear-gradient(160deg, rgba(37,99,235,.12) 0%, rgba(14,17,28,.96) 100%);
  box-shadow:
    0 16px 40px rgba(0,0,0,.5),
    0 0 0 1.5px rgba(59,130,246,.5),
    0 0 36px rgba(59,130,246,.1);
}
.lxc--offline {
  opacity: .38;
  filter: grayscale(.7) brightness(.8);
  pointer-events: none;
}
.lxc--offline:not([aria-disabled='true']) { pointer-events: auto; }
.lxc--degraded { border-color: rgba(245,158,11,.2); }

/* Top row */
.lxc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  z-index: 1;
}
.lxc__status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: .57rem;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
  background: rgba(0,0,0,.35);
  border: 1px solid rgba(255,255,255,.1);
  color: var(--dot-color, rgba(255,255,255,.3));
  border-color: color-mix(in srgb, var(--dot-color, #888) 28%, transparent);
  backdrop-filter: blur(8px);
}
.lxc__status-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--dot-color, rgba(255,255,255,.3));
  flex-shrink: 0;
}
.lxc__status-dot--live {
  animation: blink 2s ease-in-out infinite;
  box-shadow: 0 0 6px var(--dot-shadow, transparent);
}
.lxc__embed-icon {
  font-size: .6rem;
  color: rgba(147,197,253,.45);
  font-weight: 900;
  letter-spacing: -.02em;
}

/* Logo area */
.lxc__logo {
  position: relative;
  width: 54px; height: 54px;
  background: rgba(255,255,255,.05);
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.08);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  z-index: 1;
  box-shadow: 0 4px 14px rgba(0,0,0,.35);
  transition: border-color .24s, box-shadow .24s;
}
.lxc:hover .lxc__logo {
  border-color: rgba(147,197,253,.22);
  box-shadow: 0 6px 18px rgba(0,0,0,.45);
}
.lxc__logo img     { width: 100%; height: 100%; object-fit: contain; }
.lxc__logo-initials {
  font-size: .9rem; font-weight: 800;
  color: rgba(255,255,255,.4); letter-spacing: -.02em;
}
.lxc__logo-ring {
  position: absolute; inset: -2px;
  border-radius: 16px;
  border: 1.5px solid rgba(34,197,94,.35);
  pointer-events: none;
}

/* Name + lang */
.lxc__info {
  display: flex; flex-direction: column; gap: 3px;
  position: relative; z-index: 1;
  flex: 1;
}
.lxc__name {
  font-size: .82rem; font-weight: 700;
  color: rgba(255,255,255,.82); line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color .2s;
  text-align: right;
}
.lxc:hover .lxc__name  { color: #bfdbfe; }
.lxc--active .lxc__name { color: #93c5fd; }
.lxc__lang {
  font-size: .6rem; font-weight: 800;
  color: rgba(255,255,255,.2);
  letter-spacing: .12em; text-transform: uppercase;
  text-align: right;
}

/* Bottom slot line */
.lxc__slot-line {
  position: absolute;
  bottom: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent);
  pointer-events: none;
}
.lxc--active .lxc__slot-line {
  background: linear-gradient(90deg, transparent, rgba(59,130,246,.3), transparent);
}

/* nav badge keep working */
.live-badge-inline {
  background: var(--red); color: #fff;
  padding: 2px 7px; border-radius: 999px;
  font-size: .7rem; font-weight: 700;
  animation: blink 1.5s infinite;
}

/* ════════════════════════════════════════
   EDITORIAL TAB  ★★★★★★★ LUXURY
════════════════════════════════════════ */
.eb-arena {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Command Header ── */
.eb-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 0 22px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  margin-bottom: 24px;
}
.eb-hdr__left { display: flex; flex-direction: column; gap: 4px; }
.eb-hdr__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #f59e0b;
}
.eb-hdr__pulse {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 10px #f59e0b, 0 0 24px rgba(245,158,11,.4);
  animation: blink 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
.eb-hdr__title {
  font-size: 1.7rem;
  font-weight: 900;
  letter-spacing: -.04em;
  line-height: 1;
  background: linear-gradient(100deg, #fff 30%, rgba(255,255,255,.5) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
[data-theme="light"] .eb-hdr__title {
  background: linear-gradient(100deg, #1a1d2e 30%, #4a5172 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.eb-hdr__sub { font-size: .78rem; color: var(--text3); letter-spacing: .01em; }
.eb-hdr__refresh {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  color: var(--text2);
  font-size: .78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all .22s;
  flex-shrink: 0;
  letter-spacing: .02em;
}
.eb-hdr__refresh:hover {
  background: rgba(245,158,11,.12);
  border-color: rgba(245,158,11,.35);
  color: #fcd34d;
  box-shadow: 0 0 16px rgba(245,158,11,.1);
}

/* ── HUD Momentum Bar ── */
.eb-hud-bar {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  background: linear-gradient(135deg, rgba(6,8,16,.96) 0%, rgba(14,18,30,.94) 100%);
  border: 1px solid rgba(245,158,11,.12);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 24px;
  box-shadow:
    0 12px 40px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.06),
    inset 0 -1px 0 rgba(255,255,255,.02);
  position: relative;
}
.eb-hud-bar::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 80% at 20% 50%, rgba(245,158,11,.03) 0%, transparent 100%);
  pointer-events: none;
}
.eb-hud-bar__inner {
  display: flex;
  align-items: stretch;
  flex: 1;
}
.eb-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 20px 22px;
  flex: 1;
  transition: background .2s;
}
.eb-stat:hover { background: rgba(255,255,255,.02); }
.eb-stat__val {
  font-size: 2rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -.05em;
  font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.5);
}
.eb-stat--gold  .eb-stat__val { color: #fcd34d; text-shadow: 0 0 24px rgba(245,158,11,.5), 0 0 48px rgba(245,158,11,.2); }
.eb-stat--green .eb-stat__val { color: #4ade80; text-shadow: 0 0 24px rgba(34,197,94,.5),  0 0 48px rgba(34,197,94,.2); }
.eb-stat--blue  .eb-stat__val { color: #93c5fd; text-shadow: 0 0 24px rgba(147,197,253,.45), 0 0 48px rgba(59,130,246,.2); }
.eb-stat--red   .eb-stat__val { color: #fca5a5; text-shadow: 0 0 24px rgba(239,68,68,.45); }
.eb-stat--purple .eb-stat__val { color: #c4b5fd; text-shadow: 0 0 24px rgba(167,139,250,.4); }
.eb-stat__key {
  font-size: .6rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.2);
}
.eb-sep {
  width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,.07) 30%, rgba(255,255,255,.07) 70%, transparent);
  flex-shrink: 0;
}
.eb-hud-bar__divider { width: 1px; background: rgba(255,255,255,.06); flex-shrink: 0; }
.eb-hud-bar__confidence {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 20px 28px;
  flex-shrink: 0;
}
.eb-hud-bar__conf-label {
  font-size: .6rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.2);
}
.eb-hud-bar__conf-val {
  font-size: 1.6rem;
  font-weight: 900;
  letter-spacing: -.04em;
  color: #93c5fd;
  text-shadow: 0 0 20px rgba(147,197,253,.4);
  font-variant-numeric: tabular-nums;
}

/* ── Lead Story ── */
.eb-lead {
  position: relative;
  background: linear-gradient(135deg, rgba(20,24,40,.97) 0%, rgba(10,12,22,.98) 100%);
  border: 1px solid rgba(245,158,11,.18);
  border-radius: 20px;
  padding: 32px 36px;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow:
    0 24px 64px rgba(0,0,0,.55),
    inset 0 1px 0 rgba(255,255,255,.07),
    0 0 0 1px rgba(245,158,11,.06);
}
.eb-lead::before {
  content: '';
  position: absolute;
  top: -40px; right: -40px;
  width: 280px; height: 280px;
  background: radial-gradient(ellipse, rgba(245,158,11,.05) 0%, transparent 70%);
  pointer-events: none;
}
.eb-lead__glow {
  position: absolute;
  bottom: -60px; left: 50%;
  transform: translateX(-50%);
  width: 500px; height: 140px;
  background: radial-gradient(ellipse at center, rgba(245,158,11,.04) 0%, transparent 70%);
  pointer-events: none;
}
.eb-lead__badge {
  display: inline-block;
  font-size: .64rem;
  font-weight: 800;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #f59e0b;
  border: 1px solid rgba(245,158,11,.3);
  border-radius: 6px;
  padding: 4px 10px;
  margin-bottom: 14px;
  background: rgba(245,158,11,.07);
}
.eb-lead__title {
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.42;
  margin: 0 0 18px;
  color: var(--text);
  letter-spacing: -.02em;
}
.eb-lead__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 22px;
}
.eb-lead__metrics {
  display: flex;
  gap: 0;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 18px;
  background: rgba(0,0,0,.2);
}
.eb-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 16px 24px;
  flex: 1;
  border-left: 1px solid rgba(255,255,255,.06);
}
.eb-metric:last-child { border-left: none; }
.eb-metric__val {
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.5);
}
.eb-metric__val--green  { color: #4ade80; text-shadow: 0 0 20px rgba(34,197,94,.5); }
.eb-metric__val--blue   { color: #93c5fd; text-shadow: 0 0 20px rgba(147,197,253,.45); }
.eb-metric__val--amber  { color: #fcd34d; text-shadow: 0 0 20px rgba(245,158,11,.45); }
.eb-metric__key {
  font-size: .62rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: rgba(255,255,255,.22);
}
.eb-lead__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  color: var(--text3);
}
.eb-lead__source { font-weight: 600; color: var(--text2); }
.eb-lead__dot { color: var(--text3); }

/* ── Signal Grid (3 cols) ── */
.eb-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
@media (max-width: 760px) { .eb-grid { grid-template-columns: 1fr; } }
@media (min-width: 760px) and (max-width: 1024px) { .eb-grid { grid-template-columns: repeat(2, 1fr); } }

.eb-card {
  background: linear-gradient(160deg, rgba(18,22,36,.97) 0%, rgba(10,13,22,.98) 100%);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  padding: 22px 22px 20px;
  position: relative;
  overflow: hidden;
  transition: border-color .24s, box-shadow .24s, transform .22s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 8px 30px rgba(0,0,0,.35);
}
.eb-card:hover {
  transform: translateY(-3px);
  border-color: rgba(255,255,255,.14);
  box-shadow: 0 16px 48px rgba(0,0,0,.48);
}
.eb-card__icon {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  margin-bottom: 14px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
}
.eb-card__icon--blue   { background: rgba(59,130,246,.1);  border-color: rgba(59,130,246,.2);  color: #93c5fd; }
.eb-card__icon--gold   { background: rgba(245,158,11,.1);  border-color: rgba(245,158,11,.2);  color: #fcd34d; }
.eb-card__icon--red    { background: rgba(239,68,68,.1);   border-color: rgba(239,68,68,.22);  color: #fca5a5; }
.eb-card__eyebrow {
  font-size: .67rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.28);
  margin-bottom: 16px;
}
.eb-card__metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.eb-mini-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.05);
}
.eb-mini-metric span {
  font-size: 1.35rem;
  font-weight: 900;
  letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.45);
}
.eb-mini-metric small {
  font-size: .62rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(255,255,255,.2);
}
.eb-mini-metric--green span { color: #4ade80; text-shadow: 0 0 16px rgba(34,197,94,.4); }
.eb-mini-metric--amber span { color: #fcd34d; text-shadow: 0 0 16px rgba(245,158,11,.4); }
.eb-mini-metric--gold  span { color: #fbbf24; text-shadow: 0 0 16px rgba(251,191,36,.4); }
.eb-mini-metric--blue  span { color: #93c5fd; text-shadow: 0 0 16px rgba(147,197,253,.4); }
.eb-mini-metric--red   span { color: #fca5a5; text-shadow: 0 0 16px rgba(239,68,68,.4); }

/* ── List Row ── */
.eb-list-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 8px;
}
@media (max-width: 760px) { .eb-list-row { grid-template-columns: 1fr; } }

.eb-list-card {
  background: linear-gradient(160deg, rgba(14,18,30,.97) 0%, rgba(8,10,18,.98) 100%);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(0,0,0,.35);
}
.eb-list-card__hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: rgba(255,255,255,.3);
}
.eb-list-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255,255,255,.03);
  transition: background .18s;
}
.eb-list-item:last-child { border-bottom: none; }
.eb-list-item:hover { background: rgba(255,255,255,.025); }
.eb-list-item__body { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.eb-list-item__title {
  font-size: .84rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.eb-list-item__meta {
  font-size: .72rem;
  color: var(--text3);
}
.eb-list-empty {
  padding: 24px 20px;
  font-size: .82rem;
  color: var(--text3);
  margin: 0;
}

/* ── Chips (reusable) ── */
.eb-chip {
  display: inline-flex;
  align-items: center;
  font-size: .72rem;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 999px;
  white-space: nowrap;
  letter-spacing: .03em;
}
.eb-chip--green  { background: rgba(34,197,94,.12);   color: #4ade80;  border: 1px solid rgba(34,197,94,.25); }
.eb-chip--red    { background: rgba(239,68,68,.12);   color: #fca5a5;  border: 1px solid rgba(239,68,68,.25); }
.eb-chip--amber  { background: rgba(245,158,11,.12);  color: #fcd34d;  border: 1px solid rgba(245,158,11,.25); }
.eb-chip--blue   { background: rgba(59,130,246,.12);  color: #93c5fd;  border: 1px solid rgba(59,130,246,.25); }
.eb-chip--sm { font-size: .67rem; padding: 3px 9px; flex-shrink: 0; }

/* ── Empty state ── */
.eb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 80px 20px;
  color: var(--text3);
  font-size: .88rem;
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

/* ════════════════════════════════════════
   MAP TAB  ★★★★★★★ LUXURY
════════════════════════════════════════ */
.mp-arena { display: flex; flex-direction: column; gap: 0; }

.mp-hdr {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 28px 0 22px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  margin-bottom: 24px;
}
.mp-hdr__left { display: flex; flex-direction: column; gap: 4px; }
.mp-hdr__eyebrow {
  display: flex; align-items: center; gap: 8px;
  font-size: .68rem; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
  color: #4ade80;
}
.mp-hdr__pulse {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 10px #22c55e, 0 0 24px rgba(34,197,94,.4);
  animation: blink 1.6s ease-in-out infinite; flex-shrink: 0;
}
.mp-hdr__title {
  font-size: 1.7rem; font-weight: 900; letter-spacing: -.04em; line-height: 1;
  background: linear-gradient(100deg, #fff 30%, rgba(255,255,255,.5) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
[data-theme="light"] .mp-hdr__title {
  background: linear-gradient(100deg, #1a1d2e 30%, #4a5172 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.mp-hdr__sub { font-size: .78rem; color: var(--text3); letter-spacing: .01em; }
.mp-hdr__refresh {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 10px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
  color: var(--text2); font-size: .78rem; font-weight: 700; cursor: pointer;
  transition: all .22s; flex-shrink: 0; letter-spacing: .02em;
}
.mp-hdr__refresh:hover {
  background: rgba(34,197,94,.12); border-color: rgba(34,197,94,.35); color: #4ade80;
  box-shadow: 0 0 16px rgba(34,197,94,.1);
}

/* HUD Bar */
.mp-hud-bar {
  display: flex; align-items: stretch; justify-content: space-between;
  background: linear-gradient(135deg, rgba(6,8,16,.96) 0%, rgba(14,18,30,.94) 100%);
  border: 1px solid rgba(34,197,94,.1); border-radius: 16px;
  overflow: hidden; margin-bottom: 20px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
}
.mp-hud-bar__inner { display: flex; align-items: stretch; flex: 1; }
.mp-hud-stat {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px; padding: 18px 24px; flex: 1; transition: background .2s;
}
.mp-hud-stat:hover { background: rgba(255,255,255,.02); }
.mp-hud-stat__val {
  font-size: 2rem; font-weight: 900; line-height: 1;
  letter-spacing: -.05em; font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.4);
}
.mp-hud-stat--red   .mp-hud-stat__val { color: #fca5a5; text-shadow: 0 0 20px rgba(239,68,68,.5); }
.mp-hud-stat--amber .mp-hud-stat__val { color: #fcd34d; text-shadow: 0 0 20px rgba(245,158,11,.5); }
.mp-hud-stat--blue  .mp-hud-stat__val { color: #93c5fd; text-shadow: 0 0 20px rgba(147,197,253,.45); }
.mp-hud-stat--gold  .mp-hud-stat__val { color: #4ade80; text-shadow: 0 0 20px rgba(34,197,94,.5); }
.mp-hud-stat__key {
  font-size: .6rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: rgba(255,255,255,.2);
}
.mp-hud-sep {
  width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,.07) 30%, rgba(255,255,255,.07) 70%, transparent);
  flex-shrink: 0;
}
.mp-hud-bar__divider { width: 1px; background: rgba(255,255,255,.06); flex-shrink: 0; }
.mp-hud-bar__status {
  display: flex; align-items: center; gap: 8px; padding: 18px 22px; flex-shrink: 0;
}
.mp-hud-bar__status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34,197,94,.7), 0 0 16px rgba(34,197,94,.3);
  animation: blink 2.2s ease-in-out infinite;
}
.mp-hud-bar__status-text {
  font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: rgba(255,255,255,.22); white-space: nowrap;
}

/* Map wrap */
.mp-inner { display: flex; flex-direction: column; gap: 16px; }
.mp-map-wrap {
  position: relative; border-radius: 18px; overflow: hidden;
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 24px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
}
.mp-map { height: 58vh; min-height: 400px; width: 100%; }

/* Legend overlay */
.mp-legend {
  position: absolute; bottom: 18px; right: 18px; z-index: 1000;
  background: rgba(6,8,16,.88); border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; padding: 10px 14px;
  display: flex; flex-direction: column; gap: 7px;
  backdrop-filter: blur(12px);
}
.mp-legend__item {
  display: flex; align-items: center; gap: 8px;
  font-size: .72rem; font-weight: 700; color: rgba(255,255,255,.5);
}
.mp-legend__dot {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
}
.mp-legend__dot--red   { background: #ef4444; box-shadow: 0 0 7px rgba(239,68,68,.7); }
.mp-legend__dot--amber { background: #f59e0b; }
.mp-legend__dot--blue  { background: #3b82f6; }

/* Leaflet dark overrides */
.leaflet-popup-content-wrapper {
  background: rgba(8,10,20,.96) !important;
  border: 1px solid rgba(255,255,255,.12) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,.65) !important;
  padding: 0 !important;
  color: #fff !important;
}
.leaflet-popup-content { margin: 0 !important; }
.leaflet-popup-tip-container { display: none !important; }
.leaflet-container { background: #060a14 !important; }
.mp-popup { padding: 12px 16px; }
.mp-popup__title {
  font-size: .82rem; font-weight: 600; color: rgba(255,255,255,.9);
  margin: 0 0 6px; line-height: 1.4; max-width: 240px;
}
.mp-popup__meta { font-size: .7rem; color: rgba(255,255,255,.38); }

/* Filter row */
.mp-filter-row {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
}
.mp-filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.mp-ftab {
  padding: 7px 16px; border-radius: 999px; font-size: .76rem; font-weight: 700;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
  color: rgba(255,255,255,.4); cursor: pointer; transition: all .2s; white-space: nowrap;
}
.mp-ftab:hover { background: rgba(255,255,255,.07); color: rgba(255,255,255,.65); }
.mp-ftab--active {
  background: rgba(34,197,94,.14); border-color: rgba(34,197,94,.35); color: #4ade80;
  box-shadow: 0 0 12px rgba(34,197,94,.1);
}
.mp-count { font-size: .75rem; color: var(--text3); font-weight: 600; white-space: nowrap; }

/* Selected card */
.mp-selected-card {
  position: relative;
  background: linear-gradient(135deg, rgba(18,22,36,.98) 0%, rgba(10,13,22,.99) 100%);
  border-radius: 16px; padding: 20px 24px;
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
}
.mp-selected-card--high   { border-color: rgba(239,68,68,.2); }
.mp-selected-card--medium { border-color: rgba(245,158,11,.2); }
.mp-selected-card--low    { border-color: rgba(59,130,246,.18); }
.mp-selected-card__close {
  position: absolute; top: 14px; left: 16px;
  width: 24px; height: 24px; border-radius: 50%;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text3); transition: all .2s;
}
.mp-selected-card__close:hover { background: rgba(239,68,68,.15); color: #fca5a5; }
.mp-selected-card__urg {
  display: inline-block; font-size: .64rem; font-weight: 800;
  letter-spacing: .12em; text-transform: uppercase;
  margin-bottom: 10px; color: var(--text3);
}
.mp-selected-card--high   .mp-selected-card__urg { color: #fca5a5; }
.mp-selected-card--medium .mp-selected-card__urg { color: #fcd34d; }
.mp-selected-card--low    .mp-selected-card__urg { color: #93c5fd; }
.mp-selected-card__title {
  font-size: 1.05rem; font-weight: 700; line-height: 1.45;
  margin: 0 0 8px; color: var(--text);
}
.mp-selected-card__meta { font-size: .78rem; color: var(--text3); margin: 0; }

/* Events list */
.mp-events-list {
  background: linear-gradient(160deg, rgba(12,16,26,.98) 0%, rgba(8,10,18,.99) 100%);
  border: 1px solid rgba(255,255,255,.07); border-radius: 18px; overflow: hidden;
  box-shadow: 0 8px 30px rgba(0,0,0,.35);
}
.mp-events-list__hdr {
  padding: 14px 20px 12px; border-bottom: 1px solid rgba(255,255,255,.05);
  font-size: .67rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: rgba(255,255,255,.28);
}
.mp-event-item {
  display: flex; align-items: flex-start; gap: 12px; width: 100%;
  padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,.03);
  text-align: inherit; background: transparent; cursor: pointer;
  transition: background .18s;
}
.mp-event-item:last-child { border-bottom: none; }
.mp-event-item:hover { background: rgba(255,255,255,.025); }
.mp-event-item--active { background: rgba(34,197,94,.05) !important; }
.mp-event-item__dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px;
}
.mp-event-item__body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.mp-event-item__title {
  font-size: .84rem; font-weight: 600; color: var(--text); margin: 0;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  line-height: 1.4;
}
.mp-event-item__meta { font-size: .71rem; color: var(--text3); }
.mp-event-item__cat {
  font-size: .65rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
  color: rgba(255,255,255,.22); white-space: nowrap; flex-shrink: 0; margin-top: 3px;
}

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
