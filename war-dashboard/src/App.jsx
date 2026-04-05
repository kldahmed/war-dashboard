import React, {
  useState,
  useEffect,
  useCallback,
  useDeferredValue,
  useRef,
  useMemo,
} from 'react';
import { fetchNewsFeedEnvelope } from './data/newsAdapter';
import Hls from 'hls.js';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import HTMLFlipBook from 'react-pageflip';

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
  { id: 'podcast',    label: 'البودكاست',        icon: '🎙️' },
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

const LIVE_CATEGORY_META = {
  news: { label: 'أخبار' },
  sports: { label: 'رياضة' },
  entertainment: { label: 'ترفيه' },
  economy: { label: 'اقتصاد' },
  documentary: { label: 'وثائقي' },
  live: { label: 'مباشر' },
  other: { label: 'أخرى' },
};

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

function handleCardTilt(event, maxTiltX = 7, maxTiltY = 9) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const px = (event.clientX - rect.left) / rect.width;
  const py = (event.clientY - rect.top) / rect.height;
  const tiltY = (px - 0.5) * 2 * maxTiltY;
  const tiltX = (0.5 - py) * 2 * maxTiltX;
  el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
  el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
  el.style.setProperty('--glow-x', `${(px * 100).toFixed(1)}%`);
  el.style.setProperty('--glow-y', `${(py * 100).toFixed(1)}%`);
}

function resetCardTilt(event) {
  const el = event.currentTarget;
  el.style.setProperty('--tilt-x', '0deg');
  el.style.setProperty('--tilt-y', '0deg');
  el.style.setProperty('--glow-x', '50%');
  el.style.setProperty('--glow-y', '50%');
}

function headlineTone(title) {
  const n = String(title || '').trim().length;
  if (n <= 42) return 'strong';
  if (n <= 86) return 'balanced';
  return 'airy';
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

function formatNumeric(value, options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ar-AE', options).format(num);
}

function formatSignedNumeric(value, fractionDigits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num > 0 ? '+' : '';
  return `${sign}${formatNumeric(num, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function formatPercentChange(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${formatSignedNumeric(num, 2)}%`;
}

function panelStateTone(updatedAt) {
  if (!updatedAt) return 'neutral';
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000));
  if (ageSeconds <= 120) return 'positive';
  if (ageSeconds <= 900) return 'neutral';
  return 'negative';
}

function marketMoveTone(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return 'neutral';
  return num > 0 ? 'positive' : 'negative';
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
  return (
    <article
      className="hero-card"
      dir="rtl"
      onMouseMove={(e) => handleCardTilt(e, 8, 10)}
      onMouseLeave={resetCardTilt}
    >
      <div className="hero-card__viz" aria-hidden="true">
        <div className="hero-card__gridline" />
        <div className="hero-card__orb" />
        <div className="hero-card__meta">
          <CategoryBadge category={item.category} />
          {item.urgency === 'high' && <span className="badge badge--breaking">⚡ عاجل</span>}
        </div>
      </div>
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
  return (
    <article
      className={`news-card news-card--${size}`}
      dir="rtl"
      onMouseMove={(e) => handleCardTilt(e, 6, 8)}
      onMouseLeave={resetCardTilt}
    >
      <div className="news-card__viz" aria-hidden="true">
        <div className="news-card__beam" />
        <div className="news-card__badges">
          <UrgencyDot urgency={item.urgency} />
          <CategoryBadge category={item.category} />
        </div>
      </div>
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

/* ═══════════════════════════════════════════════════════
   NEWSPAPER PAGE  — forwardRef for react-pageflip
═══════════════════════════════════════════════════════ */
const NP_DATE_STR = new Intl.DateTimeFormat('ar', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date());

const NewspaperPage = React.forwardRef(function NewspaperPage({ items, pageNum, totalPages, onSelectItem }, ref) {
  const featured  = items?.[0];
  const secondary = items?.slice(1, 3) ?? [];
  const briefs    = items?.slice(3) ?? [];
  return (
    <div className="np-page" ref={ref}>
      {pageNum === 1 ? (
        <div className="np-masthead">
          <div className="np-masthead__eyebrow">مرصد الأحداث العالمية</div>
          <h1 className="np-masthead__title">الإخبار</h1>
          <div className="np-masthead__subline">
            <span>{NP_DATE_STR}</span>
            <span>إصدار رقمي</span>
          </div>
          <div className="np-masthead__rule" />
        </div>
      ) : (
        <div className="np-page-hdr">
          <span className="np-page-hdr__name">مرصد الإخبار</span>
          <span className="np-page-hdr__num">صفحة {pageNum}</span>
        </div>
      )}
      {featured && (
        <div className="np-lead" onClick={() => onSelectItem?.(featured)}>
          <div className="np-lead__kicker">{featured.category || 'عاجل'}</div>
          <h2 className={`np-lead__headline np-headline--${headlineTone(featured.title)}`}>{featured.title}</h2>
          <div className="np-lead__byline">
            <span>{featured.source?.name}</span>
            <span>{relativeTime(featured.time || featured.publishedAt || featured.published_at)}</span>
          </div>
          {featured.summary && <p className="np-lead__excerpt">{String(featured.summary).slice(0, 200)}</p>}
        </div>
      )}
      <div className="np-rule" />
      <div className="np-secondary-row">
        {secondary.map((item, i) => (
          <div key={item.id ?? i} className="np-secondary" onClick={() => onSelectItem?.(item)}>
            <div className="np-secondary__kicker">{item.category || 'أخبار'}</div>
            <h3 className={`np-secondary__headline np-headline--${headlineTone(item.title)}`}>{item.title}</h3>
            <span className="np-secondary__meta">{item.source?.name} · {relativeTime(item.time || item.publishedAt || item.published_at)}</span>
          </div>
        ))}
      </div>
      {briefs.length > 0 && <div className="np-rule" />}
      <div className="np-briefs">
        {briefs.map((item, i) => (
          <div key={item.id ?? i} className="np-brief" onClick={() => onSelectItem?.(item)}>
            <span className="np-brief__headline">{item.title}</span>
            <span className="np-brief__meta"> — {item.source?.name}</span>
          </div>
        ))}
      </div>
      <div className="np-page-footer">
        صفحة {pageNum} / {totalPages}
      </div>
    </div>
  );
});

function ListItem({ item, idx }) {
  if (!item) return null;
  return (
    <a
      href={item.link || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="list-item"
      dir="rtl"
      onMouseMove={(e) => handleCardTilt(e, 4, 5)}
      onMouseLeave={resetCardTilt}
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

function getStreamRecord(entry) {
  return entry?.stream || entry || {};
}

function getStreamId(entry) {
  const stream = getStreamRecord(entry);
  return String(stream.registry_id || stream.id || entry?.registry_id || entry?.id || '');
}

function getStreamName(entry) {
  const stream = getStreamRecord(entry);
  return entry?.source?.name || stream.name || stream.registry_id || 'قناة غير معروفة';
}

function getStreamLanguage(entry) {
  const stream = getStreamRecord(entry);
  return entry?.source?.language || stream.language || '';
}

function getStreamCategory(entry) {
  return entry?.source?.category || getStreamRecord(entry).category || 'other';
}

function getLiveCategoryLabel(category) {
  return LIVE_CATEGORY_META[category]?.label || LIVE_CATEGORY_META.other.label;
}

function isStreamUp(stream) {
  return stream?.uptime_status === 'up';
}

function isStreamDegraded(stream) {
  return stream?.uptime_status === 'degraded';
}

function isStreamAvailable(stream) {
  return isStreamUp(stream) || isStreamDegraded(stream);
}

function isStreamVerified(stream) {
  const state = stream?.verification_status || stream?.last_verification_status;
  return state === 'embed_ok';
}

function formatStreamReason(reason) {
  const labels = {
    verified_embed_available: 'تم التحقق من البث المباشر',
    recent_success: 'الإشارة حديثة ومستقرة',
    success_aging: 'الإشارة تعمل لكن تحتاج مراقبة',
    recent_error_after_success: 'ظهرت أخطاء بعد آخر نجاح',
    stream_inactive: 'القناة غير مفعلة',
    success_too_old: 'آخر نجاح قديم',
    external_watch_available: 'المشاهدة المباشرة متاحة',
    external_watch_only: 'الفتح الخارجي فقط',
    awaiting_first_success: 'بانتظار أول نجاح فعلي',
    no_success_recent_error: 'لا يوجد نجاح مع أخطاء حديثة',
  };
  return labels[reason] || 'قيد المراقبة';
}

function formatStreamVerification(state) {
  const labels = {
    embed_ok: 'متحقق',
    frame_blocked_verified: 'محجوب تضمين',
    removed_from_registry: 'أزيل من السجل',
  };
  return labels[state] || 'غير موثق';
}

function getChStatus(s) {
  if (isStreamUp(s)) return CH_STATUS.up;
  if (isStreamDegraded(s)) return CH_STATUS.degraded;
  if (s.uptime_status === 'down') return CH_STATUS.down;
  return CH_STATUS.unknown;
}

/* ─────────────────────────────────────────────────
   TV STATIC CANVAS  — animated noise on channel switch
───────────────────────────────────────────────── */
function TvStaticCanvas({ active }) {
  const canvasRef = React.useRef(null);
  const rafRef    = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!active) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const draw = () => {
      const w = (canvas.width  = canvas.offsetWidth  || 200);
      const h = (canvas.height = canvas.offsetHeight || 150);
      const imgData = ctx.createImageData(w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v; d[i+1] = v; d[i+2] = v;
        d[i+3] = i % 8 === 0 ? 255 : 180; /* slight scanline banding */
      }
      ctx.putImageData(imgData, 0, 0);
      /* add a random horizontal white streak for authenticity */
      if (Math.random() < 0.25) {
        const y = (Math.random() * h) | 0;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.4})`;
        ctx.fillRect(0, y, w, 1 + (Math.random() * 2 | 0));
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={`tv-static${active ? ' tv-static--on' : ''}`}
      aria-hidden="true"
    />
  );
}

/* ─────────────────────────────────────────────────
   LUXURY CHANNEL CARD  — retro CRT TV set
───────────────────────────────────────────────── */
function LuxChannelCard({ stream, onSelect, isActive, isSwitching }) {
  if (!stream) return null;
  const s      = stream.stream || stream;
  const name   = stream.source?.name || s.name || s.registry_id || '';
  const lang   = stream.source?.language || s.language || '';
  const status   = getChStatus(s);
  const isOnline = status.cls === 'online' || status.cls === 'degraded';
  const [imgErr, setImgErr] = React.useState(false);

  return (
    <button
      className={`lxc${isActive ? ' lxc--active' : ''} lxc--${status.cls}`}
      onClick={() => onSelect(stream)}
      title={name}
      aria-pressed={isActive}
    >
      {/* ── TV Antennae ── */}
      <div className="lxc__ant-wrap" aria-hidden="true">
        <span className="lxc__ant lxc__ant--l" />
        <span className="lxc__ant lxc__ant--r" />
      </div>

      {/* ── TV Cabinet body ── */}
      <div className="lxc__cabinet">

        {/* CRT Bezel + Screen */}
        <div className="lxc__bezel">
          <div className="lxc__screen-face">

            {/* Channel content */}
            <div className="lxc__screen-inner">
              <div className="lxc__tv-logo">
                {s.logo_url && !imgErr
                  ? <img src={s.logo_url} alt={name} loading="lazy" onError={() => setImgErr(true)} />
                  : <span className="lxc__tv-initials">{name.slice(0, 2)}</span>
                }
              </div>
              <span className="lxc__tv-name">{name}</span>
              {lang && <span className="lxc__tv-lang">{lang.toUpperCase()}</span>}
            </div>

            {/* CRT texture overlays */}
            <div className="lxc__crt-lines" aria-hidden="true" />
            <div className="lxc__crt-vgn"   aria-hidden="true" />
            {isOnline && <div className="lxc__crt-glow" aria-hidden="true" />}

            {/* Static noise on channel switch */}
            <TvStaticCanvas active={!!isSwitching} />
          </div>
        </div>

        {/* Controls strip: status pill + channel knobs */}
        <div className="lxc__ctrls">
          <span
            className="lxc__status-pill"
            style={{ '--dot-color': status.dot, '--dot-shadow': status.shadow }}
          >
            <span className={`lxc__status-dot${isOnline ? ' lxc__status-dot--live' : ''}`} />
            {status.label}
          </span>
          <div className="lxc__knobs" aria-hidden="true">
            <span className="lxc__knob" />
            <span className="lxc__knob lxc__knob--sm" />
          </div>
        </div>
      </div>

      {/* ── TV Feet ── */}
      <div className="lxc__feet" aria-hidden="true">
        <span className="lxc__foot" />
        <span className="lxc__foot" />
      </div>
    </button>
  );
}

function CinematicPlayer({ stream, onClose, switching }) {
  if (!stream) return null;
  const s       = getStreamRecord(stream);
  const name    = getStreamName(stream);
  const lang    = getStreamLanguage(stream);
  const embedUrl = s.embed_url || s.embedUrl;
  const watchUrl = s.external_watch_url || s.official_page_url;
  const status  = getChStatus(s);
  const isLive  = isStreamUp(s);
  const [imgErr, setImgErr] = React.useState(false);
  const videoRef = React.useRef(null);
  const hlsRef   = React.useRef(null);
  const isHls    = typeof embedUrl === 'string' && embedUrl.includes('.m3u8');
  const [playerState, setPlayerState] = React.useState(embedUrl ? 'loading' : 'idle');
  const [playerError, setPlayerError] = React.useState(null);
  const [retryNonce, setRetryNonce] = React.useState(0);

  React.useEffect(() => {
    setPlayerState(embedUrl ? 'loading' : 'idle');
    setPlayerError(null);
  }, [embedUrl, retryNonce, name]);

  React.useEffect(() => {
    if (!isHls || !videoRef.current) return;
    const video = videoRef.current;
    let recoveredOnce = false;
    const markReady = () => {
      setPlayerState('ready');
      setPlayerError(null);
    };
    const markBuffering = () => {
      setPlayerState((current) => (current === 'error' ? current : 'buffering'));
    };
    const fail = (message) => {
      setPlayerState('error');
      setPlayerError(message);
    };

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();

    video.addEventListener('playing', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('waiting', markBuffering);
    video.addEventListener('stalled', markBuffering);
    video.addEventListener('error', () => fail('تعذر تشغيل البث داخل المشغل')); 

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(embedUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerState('ready');
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (!recoveredOnce && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          recoveredOnce = true;
          setPlayerState('buffering');
          hls.startLoad();
          return;
        }
        if (!recoveredOnce && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          recoveredOnce = true;
          setPlayerState('buffering');
          hls.recoverMediaError();
          return;
        }
        fail('فشل تشغيل الإشارة المباشرة لهذه القناة');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = embedUrl;
      video.load();
      video.play().catch(() => {});
    } else {
      fail('هذا المتصفح لا يدعم تشغيل هذا النوع من البث');
    }

    return () => {
      video.removeEventListener('playing', markReady);
      video.removeEventListener('canplay', markReady);
      video.removeEventListener('waiting', markBuffering);
      video.removeEventListener('stalled', markBuffering);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [embedUrl, isHls, retryNonce]);

  const reasonLabel = formatStreamReason(s.health_reason);
  const verificationLabel = formatStreamVerification(s.verification_status);
  const scorePct = `${Math.round(Number(s.score || 0) * 100)}%`;

  return (
    <div className={`cp${switching ? ' cp--switching' : ''}`} dir="rtl" role="region" aria-label={`مشاهدة ${name}`}>

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
        {embedUrl && isHls ? (
          <video
            ref={videoRef}
            className="cp__iframe"
            controls
            autoPlay
            playsInline
            muted
            style={{ background: '#000', width: '100%', height: '100%' }}
          />
        ) : embedUrl ? (
          <iframe
            key={`${getStreamId(stream)}:${retryNonce}`}
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
        {embedUrl && isHls && playerState !== 'ready' && !playerError && (
          <div className="cp__overlay cp__overlay--loading">
            <span className="cp__overlay-spinner" aria-hidden="true" />
            <span className="cp__overlay-text">
              {playerState === 'buffering' ? 'يتم تثبيت الإشارة الحية…' : 'جار تجهيز البث المباشر…'}
            </span>
          </div>
        )}
        {playerError && (
          <div className="cp__overlay cp__overlay--error">
            <div className="cp__overlay-card">
              <strong>تعذر تشغيل القناة داخل المشغل</strong>
              <p>{playerError}</p>
              <div className="cp__overlay-actions">
                <button className="cp__retry-btn" onClick={() => setRetryNonce((value) => value + 1)}>
                  إعادة المحاولة
                </button>
                {watchUrl && (
                  <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="cp__overlay-link">
                    فتح المصدر الرسمي
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
        {/* TV static overlay during channel switch */}
        <TvStaticCanvas active={!!switching} />
        {/* CRT scanlines texture */}
        <div className="cp__scanlines" aria-hidden="true" />
        {/* Bottom gradient vignette */}
        <div className="cp__vignette" aria-hidden="true" />
      </div>

      <div className="cp__footer">
        <div className="cp__footer-grid">
          <span><strong>الثقة:</strong> {scorePct}</span>
          <span><strong>التحقق:</strong> {verificationLabel}</span>
          <span><strong>الحالة:</strong> {reasonLabel}</span>
          {s.last_verified_at && <span><strong>آخر تحقق:</strong> {relativeTime(s.last_verified_at)}</span>}
        </div>
        {s.description && <div className="cp__footer-note">{s.description}</div>}
      </div>
    </div>
  );
}

function LiveFocusPanel({ stream, queue, updatedAt, onSelect }) {
  if (!stream) return null;
  const s = getStreamRecord(stream);
  const status = getChStatus(s);
  const story = stream.story_link;
  const scorePct = `${Math.round(Number(s.score || 0) * 100)}%`;

  return (
    <aside className="live-focus-panel" dir="rtl">
      <div className="live-focus-panel__top">
        <div>
          <span className="live-focus-panel__eyebrow">لوحة القناة</span>
          <h3 className="live-focus-panel__title">{getStreamName(stream)}</h3>
          <p className="live-focus-panel__sub">
            {getLiveCategoryLabel(getStreamCategory(stream))}
            {getStreamLanguage(stream) ? ` · ${getStreamLanguage(stream).toUpperCase()}` : ''}
          </p>
        </div>
        <span className={`live-focus-panel__status live-focus-panel__status--${status.cls}`}>{status.label}</span>
      </div>

      <div className="live-focus-panel__stats">
        <div className="live-focus-stat">
          <span className="live-focus-stat__label">جودة الإشارة</span>
          <strong className="live-focus-stat__value">{scorePct}</strong>
        </div>
        <div className="live-focus-stat">
          <span className="live-focus-stat__label">القصص المرتبطة</span>
          <strong className="live-focus-stat__value">{stream.stats?.story_count ?? 0}</strong>
        </div>
        <div className="live-focus-stat">
          <span className="live-focus-stat__label">التكتلات</span>
          <strong className="live-focus-stat__value">{stream.stats?.linked_cluster_count ?? 0}</strong>
        </div>
      </div>

      <div className="live-focus-panel__badges">
        <span className="live-focus-badge">{formatStreamVerification(s.verification_status)}</span>
        <span className="live-focus-badge">{formatStreamReason(s.health_reason)}</span>
        {updatedAt && <span className="live-focus-badge">آخر تحديث {relativeTime(updatedAt)}</span>}
      </div>

      <div className={`live-focus-story${story ? '' : ' live-focus-story--empty'}`}>
        <span className="live-focus-story__eyebrow">أقرب قصة مرتبطة</span>
        {story ? (
          <>
            <strong className="live-focus-story__title">{story.title}</strong>
            <p className="live-focus-story__meta">
              {story.published_at ? relativeTime(story.published_at) : 'بدون توقيت'}
              {typeof story.corroboration_count === 'number' ? ` · ${story.corroboration_count} تأكيد` : ''}
            </p>
          </>
        ) : (
          <p className="live-focus-story__meta">لا توجد قصة مرتبطة كفاية بهذه القناة حاليًا.</p>
        )}
      </div>

      {queue.length > 0 && (
        <div className="live-focus-queue">
          <span className="live-focus-queue__title">انتقال سريع</span>
          <div className="live-focus-queue__items">
            {queue.map((item) => (
              <button key={getStreamId(item)} className="live-focus-queue__item" onClick={() => onSelect(item)}>
                <span className="live-focus-queue__dot" />
                {getStreamName(item)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
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

function UAEWeatherPanel({
  data,
  loading,
  available,
  error,
  selectedLocationId,
  onSelectLocation,
  onRetry,
}) {
  const locations = data?.locations || [];
  const selectedLocation = locations.find((item) => item.id === selectedLocationId) || locations[0] || null;
  const hourly = selectedLocation?.hourly?.slice(0, 6) || [];
  const daily = selectedLocation?.daily?.slice(0, 3) || [];
  const alerts = selectedLocation?.alerts || [];

  return (
    <section className="signal-panel signal-panel--weather">
      <div className="signal-panel__header">
        <div>
          <div className="signal-panel__eyebrow">الطقس المباشر</div>
          <h3 className="signal-panel__title">الإمارات الآن</h3>
        </div>
        <div className="signal-panel__meta">
          <SignalPill tone={panelStateTone(data?.updated_at || selectedLocation?.current?.last_updated)}>
            {selectedLocation?.current?.last_updated
              ? `آخر تحديث ${relativeTime(selectedLocation.current.last_updated)}`
              : data?.updated_at
                ? `آخر مزامنة ${relativeTime(data.updated_at)}`
                : 'بانتظار الخدمة'}
          </SignalPill>
          {onRetry && (
            <button className="signal-panel__refresh" onClick={onRetry}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingSpinner label="جارٍ تحميل طقس الإمارات…" />}

      {!loading && !available && (
        <div className="signal-panel__empty">
          <strong>واجهة الطقس غير مفعلة بعد</strong>
          <p>تم تركيب اللوحة داخل الواجهة، وستعرض المدن، التحديث الفعلي، التنبيهات، والتوقعات بمجرد تفعيل endpoint الطقس الحي.</p>
        </div>
      )}

      {!loading && available && error && (
        <div className="signal-panel__empty signal-panel__empty--error">
          <strong>تعذر قراءة بيانات الطقس</strong>
          <p>{error}</p>
        </div>
      )}

      {!loading && available && !error && selectedLocation && (
        <>
          <div className="signal-city-tabs">
            {locations.map((location) => (
              <button
                key={location.id}
                className={`signal-city-tab${selectedLocation.id === location.id ? ' signal-city-tab--active' : ''}`}
                onClick={() => onSelectLocation(location.id)}
              >
                {location.name}
              </button>
            ))}
          </div>

          <div className="weather-hero">
            <div className="weather-hero__main">
              <div className="weather-hero__temp">{formatNumeric(selectedLocation.current?.temp_c, { maximumFractionDigits: 0 })}°</div>
              <div className="weather-hero__summary">
                <strong>{selectedLocation.current?.condition_text || '—'}</strong>
                <span>المحسوسة {formatNumeric(selectedLocation.current?.feelslike_c, { maximumFractionDigits: 0 })}°</span>
                <span>{selectedLocation.name}</span>
              </div>
            </div>
            <div className="weather-hero__stats">
              <div className="weather-chip"><span>الرطوبة</span><strong>{formatNumeric(selectedLocation.current?.humidity, { maximumFractionDigits: 0 })}%</strong></div>
              <div className="weather-chip"><span>الرياح</span><strong>{formatNumeric(selectedLocation.current?.wind_kph, { maximumFractionDigits: 0 })} كم/س</strong></div>
              <div className="weather-chip"><span>الضغط</span><strong>{formatNumeric(selectedLocation.current?.pressure_mb, { maximumFractionDigits: 0 })} mb</strong></div>
              <div className="weather-chip"><span>الرؤية</span><strong>{formatNumeric(selectedLocation.current?.vis_km, { maximumFractionDigits: 0 })} كم</strong></div>
            </div>
          </div>

          <div className="weather-grid">
            <div className="weather-card">
              <div className="weather-card__title">الساعات القادمة</div>
              <div className="weather-hour-list">
                {hourly.length > 0 ? hourly.map((entry, index) => (
                  <div key={entry.time || index} className="weather-hour-item">
                    <span>{entry.time_label || entry.time || '—'}</span>
                    <strong>{formatNumeric(entry.temp_c, { maximumFractionDigits: 0 })}°</strong>
                    <small>{entry.condition_text || '—'}</small>
                  </div>
                )) : <div className="signal-panel__mini-empty">سيظهر هنا خط الساعات القادمة</div>}
              </div>
            </div>

            <div className="weather-card">
              <div className="weather-card__title">توقع الأيام القادمة</div>
              <div className="weather-day-list">
                {daily.length > 0 ? daily.map((entry, index) => (
                  <div key={entry.date || index} className="weather-day-item">
                    <div>
                      <strong>{entry.label || entry.date || '—'}</strong>
                      <small>{entry.condition_text || '—'}</small>
                    </div>
                    <div className="weather-day-item__temps">
                      <span>{formatNumeric(entry.max_c, { maximumFractionDigits: 0 })}°</span>
                      <span>{formatNumeric(entry.min_c, { maximumFractionDigits: 0 })}°</span>
                    </div>
                  </div>
                )) : <div className="signal-panel__mini-empty">سيظهر هنا ملخص 3 أيام</div>}
              </div>
            </div>
          </div>

          <div className="signal-panel__footer">
            <span>المصدر: {data?.provider || '—'}</span>
            <span>التنبيهات: {alerts.length}</span>
            <span>التوقيت المحلي: {selectedLocation.local_time || '—'}</span>
          </div>
        </>
      )}
    </section>
  );
}

function UAEMarketsPanel({ data, loading, available, error, onRetry }) {
  const gold = data?.gold || null;
  const oilBenchmarks = data?.oil?.benchmarks || [];

  return (
    <section className="signal-panel signal-panel--markets">
      <div className="signal-panel__header">
        <div>
          <div className="signal-panel__eyebrow">الذهب والطاقة</div>
          <h3 className="signal-panel__title">أسعار الإمارات المرجعية</h3>
        </div>
        <div className="signal-panel__meta">
          <SignalPill tone={panelStateTone(data?.updated_at)}>
            {data?.updated_at ? `آخر مزامنة ${relativeTime(data.updated_at)}` : 'بانتظار الخدمة'}
          </SignalPill>
          {onRetry && (
            <button className="signal-panel__refresh" onClick={onRetry}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingSpinner label="جارٍ تحميل أسعار الذهب والنفط…" />}

      {!loading && !available && (
        <div className="signal-panel__empty">
          <strong>واجهة الأسواق غير مفعلة بعد</strong>
          <p>اللوحة جاهزة لعرض الذهب المشتق بالدرهم، زوج USD/AED، ومراجع النفط مثل Murban وBrent فور تفعيل endpoint السوق.</p>
        </div>
      )}

      {!loading && available && error && (
        <div className="signal-panel__empty signal-panel__empty--error">
          <strong>تعذر قراءة بيانات الأسواق</strong>
          <p>{error}</p>
        </div>
      )}

      {!loading && available && !error && (
        <div className="markets-layout">
          <div className="markets-card markets-card--gold">
            <div className="markets-card__title-row">
              <strong>الذهب</strong>
              <span>{gold?.provider || '—'}</span>
            </div>
            <div className="markets-price-grid">
              <div className="markets-price-block">
                <span>سبوت XAU/USD</span>
                <strong>{formatNumeric(gold?.spot_usd_oz, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</strong>
                <small>للأونصة</small>
              </div>
              <div className="markets-price-block">
                <span>USD / AED</span>
                <strong>{formatNumeric(gold?.fx_usd_aed, { maximumFractionDigits: 4, minimumFractionDigits: 2 })}</strong>
                <small>تحويل</small>
              </div>
            </div>
            <div className="gold-rate-grid">
              {[
                ['24K', gold?.derived_aed_gram?.k24],
                ['22K', gold?.derived_aed_gram?.k22],
                ['21K', gold?.derived_aed_gram?.k21],
                ['18K', gold?.derived_aed_gram?.k18],
              ].map(([label, value]) => (
                <div key={label} className="gold-rate-tile">
                  <span>{label}</span>
                  <strong>{formatNumeric(value, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</strong>
                  <small>درهم/غرام</small>
                </div>
              ))}
            </div>
            <div className="signal-panel__footer">
              <span>{gold?.mode_label || 'سعر مشتق مرجعي'}</span>
              <span>{gold?.updated_at ? `تم تحديثه ${relativeTime(gold.updated_at)}` : '—'}</span>
            </div>
          </div>

          <div className="markets-card markets-card--oil">
            <div className="markets-card__title-row">
              <strong>النفط</strong>
              <span>{data?.oil?.provider || '—'}</span>
            </div>
            <div className="oil-benchmark-list">
              {oilBenchmarks.length > 0 ? oilBenchmarks.map((item, index) => (
                <div key={item.symbol || index} className="oil-benchmark-item">
                  <div>
                    <strong>{item.label || item.symbol || '—'}</strong>
                    <small>{item.unit || 'USD'}</small>
                  </div>
                  <div className="oil-benchmark-item__price">
                    <span>{formatNumeric(item.price, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>
                    <small className={`oil-benchmark-item__move oil-benchmark-item__move--${marketMoveTone(item.change_pct || item.change)}`}>
                      {formatSignedNumeric(item.change, 2)} · {formatPercentChange(item.change_pct)}
                    </small>
                  </div>
                </div>
              )) : <div className="signal-panel__mini-empty">سيظهر هنا Murban وBrent وWTI</div>}
            </div>
            <div className="signal-panel__footer">
              <span>عدد المؤشرات: {oilBenchmarks.length}</span>
              <span>{data?.oil?.updated_at ? `تم تحديثه ${relativeTime(data.oil.updated_at)}` : '—'}</span>
            </div>
          </div>
        </div>
      )}
    </section>
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
  const [selectedStreamId, setSelectedStreamId] = useState(null);
  const [loadingLive,  setLoadingLive]   = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [errorLive,    setErrorLive]     = useState(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);
  const [channelSearch, setChannelSearch] = useState('');
  const deferredChannelSearch = useDeferredValue(channelSearch);
  const [liveCategoryFilter, setLiveCategoryFilter] = useState('all');
  const [liveHealthFilter, setLiveHealthFilter] = useState('all');
  const [tvSwitching,  setTvSwitching]   = useState(false);
  const tvSwitchTimerRef = React.useRef(null);
  const liveRequestRef = React.useRef(0);
  const hasAutoSelectedLiveRef = React.useRef(false);

  /* ── Podcast ── */
  const [podcastSources,    setPodcastSources]    = useState([]);
  const [selectedPodcastId, setSelectedPodcastId] = useState(null);
  const [podcastEpisodes,   setPodcastEpisodes]   = useState([]);
  const [podcastMeta,       setPodcastMeta]       = useState(null);
  const [loadingPodcast,    setLoadingPodcast]    = useState(false);
  const [errorPodcast,      setErrorPodcast]      = useState(null);
  const [playingEpisode,    setPlayingEpisode]    = useState(null);

  /* ── Ops ── */
  const [newsroomStatus, setNewsroomStatus] = useState(null);
  const [metricsBasic,   setMetricsBasic]   = useState(null);
  const [loadingOps,     setLoadingOps]     = useState(false);
  const [errorOps,       setErrorOps]       = useState(null);
  const [opsUpdatedAt,   setOpsUpdatedAt]   = useState(null);
  const [weatherHub,     setWeatherHub]     = useState(null);
  const [weatherHubAvailable, setWeatherHubAvailable] = useState(null);
  const [weatherHubError, setWeatherHubError] = useState(null);
  const [marketsHub,     setMarketsHub]     = useState(null);
  const [marketsHubAvailable, setMarketsHubAvailable] = useState(null);
  const [marketsHubError, setMarketsHubError] = useState(null);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [selectedWeatherLocationId, setSelectedWeatherLocationId] = useState(null);

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
  const loadLive = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++liveRequestRef.current;
    if (silent) setRefreshingLive(true);
    else setLoadingLive(true);
    setErrorLive(null);
    try {
      const res = await fetch('/api/health/streams');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (requestId !== liveRequestRef.current) return;
      const rawStreams = payload?.streams ?? [];
      setStreams(rawStreams);
      setLiveSummary(payload?.summary ?? null);
      setLiveUpdatedAt(payload?.time ?? new Date().toISOString());
    } catch (err) {
      if (requestId !== liveRequestRef.current) return;
      setErrorLive(err.message);
    } finally {
      if (requestId === liveRequestRef.current) {
        setLoadingLive(false);
        setRefreshingLive(false);
      }
    }
  }, []);

  /* ─── Podcast Loaders ─── */
  const loadPodcastSources = useCallback(async () => {
    try {
      const res = await fetch('/api/podcasts/list');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sources = data.sources || [];
      setPodcastSources(sources);
      if (!selectedPodcastId) {
        const firstRss = sources.find(s => s.type === 'rss');
        if (firstRss) setSelectedPodcastId(firstRss.id);
      }
    } catch (err) {
      setErrorPodcast(err.message);
    }
  }, [selectedPodcastId]);

  const loadPodcastFeed = useCallback(async (sourceId) => {
    const source = podcastSources.find(s => s.id === sourceId);
    if (!source || source.type !== 'rss') return;
    setLoadingPodcast(true);
    setErrorPodcast(null);
    setPodcastEpisodes([]);
    try {
      const res = await fetch(`/api/podcasts/feed?url=${encodeURIComponent(source.rss)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPodcastMeta({ title: data.feed_title, description: data.feed_description, image: data.image });
      setPodcastEpisodes(data.episodes || []);
    } catch (err) {
      setErrorPodcast(err.message || 'فشل تحميل الحلقات');
    } finally {
      setLoadingPodcast(false);
    }
  }, [podcastSources]);

  /* ─── TV Channel Switcher (with static noise animation) ─── */
  const handleTvSelect = React.useCallback((stream) => {
    const nextId = getStreamId(stream);
    if (!nextId) return;
    if (tvSwitchTimerRef.current) clearTimeout(tvSwitchTimerRef.current);
    setTvSwitching(true);
    tvSwitchTimerRef.current = setTimeout(() => {
      setSelectedStreamId(nextId);
      tvSwitchTimerRef.current = setTimeout(() => {
        setTvSwitching(false);
      }, 380);
    }, 520);
  }, []);

  useEffect(() => () => {
    if (tvSwitchTimerRef.current) clearTimeout(tvSwitchTimerRef.current);
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

  /* ─── Weather & Markets — instant HTTP fetch + SSE live push ─── */
  // Step 1: loadSignalPanels() fires two parallel HTTP GETs → data appears in < 500ms.
  // Step 2: EventSource pushes new snapshots every time the server's polling cycle runs.
  // Step 3: setInterval re-fetches every 60s as a reliable backup.
  const loadSignalPanels = useCallback(async () => {
    const readSlot = async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.status === 404 || res.status === 501 || res.status === 503) {
          return { available: res.status === 503, data: null, error: res.status === 503 ? 'not_ready' : null };
        }
        if (!res.ok) return { available: true, data: null, error: `HTTP ${res.status}` };
        return { available: true, data: await res.json(), error: null };
      } catch (e) {
        return { available: true, data: null, error: e.message || 'network_error' };
      }
    };

    setSignalsLoading(true);
    const [w, m] = await Promise.all([
      readSlot('/api/weather/uae'),
      readSlot('/api/markets/uae'),
    ]);
    setWeatherHubAvailable(w.available);
    setWeatherHub(w.data);
    setWeatherHubError(w.error);
    setMarketsHubAvailable(m.available);
    setMarketsHub(m.data);
    setMarketsHubError(m.error);
    setSignalsLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab !== 'ops') return;

    // Immediate fetch — data renders as soon as the server responds
    loadSignalPanels();

    // SSE stream for zero-latency push updates (best-effort, doesn't block UI)
    let es;
    try {
      es = new EventSource('/api/signals/stream');
      es.addEventListener('weather', (e) => {
        try {
          const { available, data } = JSON.parse(e.data);
          if (available !== false && data) {
            setWeatherHubAvailable(true);
            setWeatherHub(data);
            setWeatherHubError(null);
          }
        } catch { /* malformed — ignore */ }
      });
      es.addEventListener('markets', (e) => {
        try {
          const { available, data } = JSON.parse(e.data);
          if (available !== false && data) {
            setMarketsHubAvailable(true);
            setMarketsHub(data);
            setMarketsHubError(null);
          }
        } catch { /* malformed — ignore */ }
      });
      es.onerror = () => { /* browser auto-reconnects; HTTP polling covers any gap */ };
    } catch { /* EventSource not available — HTTP polling handles everything */ }

    // HTTP polling every 60s — works on all environments including Vercel
    const poll = setInterval(loadSignalPanels, 60_000);

    return () => {
      clearInterval(poll);
      try { if (es) es.close(); } catch { }
    };
  }, [activeTab, loadSignalPanels]);

  const refreshOpsView = useCallback(() => {
    loadOps();
    loadSignalPanels();
  }, [loadOps, loadSignalPanels]);

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
  useEffect(() => { loadLive({ silent: false }); }, [loadLive]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useEffect(() => { loadSitrep(); }, [loadSitrep]);
  useEffect(() => {
    if (selectedWeatherLocationId) return;
    const firstLocationId = weatherHub?.locations?.[0]?.id;
    if (firstLocationId) setSelectedWeatherLocationId(firstLocationId);
  }, [weatherHub, selectedWeatherLocationId]);

  /* ─── Category Change ─── */
  useEffect(() => {
    setPage(1);
    setNewsItems([]);
    loadNews(category, searchQ, 1);
  }, [category]); // eslint-disable-line

  /* ─── Newspaper flipbook ─── */
  const flipBookRef = useRef(null);
  const npFlipTimerRef = useRef(null);
  const [npCurrentPage, setNpCurrentPage] = useState(0);
  const [npFlipPulse, setNpFlipPulse] = useState(false);
  const [npFocusItem, setNpFocusItem] = useState(null);
  const [viewportW, setViewportW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1440);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  /* ─── Podcast tab: load sources on first visit ─── */
  useEffect(() => {
    if (activeTab !== 'podcast') return;
    if (podcastSources.length === 0) loadPodcastSources();
  }, [activeTab]); // eslint-disable-line

  /* ─── Podcast feed: fetch when selection changes ─── */
  useEffect(() => {
    if (!selectedPodcastId || podcastSources.length === 0) return;
    loadPodcastFeed(selectedPodcastId);
  }, [selectedPodcastId, podcastSources]); // eslint-disable-line

  /* ─── Auto-refresh ─── */
  useEffect(() => {
    if (activeTab !== 'ops') return;
    const id = setInterval(loadOps, 45_000);
    return () => clearInterval(id);
  }, [activeTab, loadOps]);

  useEffect(() => {
    if (activeTab !== 'live') return;
    const id = setInterval(() => loadLive({ silent: true }), 60_000);
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

  const featuredStream = useMemo(() => {
    return streams.find((st) => getStreamRecord(st).featured)
      || streams.find((st) => isStreamAvailable(getStreamRecord(st)))
      || streams[0]
      || null;
  }, [streams]);

  const selectedStream = useMemo(() => {
    if (!selectedStreamId) return null;
    return streams.find((st) => getStreamId(st) === selectedStreamId) || null;
  }, [streams, selectedStreamId]);

  useEffect(() => {
    if (streams.length === 0) {
      setSelectedStreamId(null);
      hasAutoSelectedLiveRef.current = false;
      return;
    }
    if (selectedStreamId && streams.some((st) => getStreamId(st) === selectedStreamId)) return;
    if (!selectedStreamId && hasAutoSelectedLiveRef.current) return;
    const fallback = featuredStream || streams[0];
    hasAutoSelectedLiveRef.current = true;
    setSelectedStreamId(getStreamId(fallback));
  }, [streams, selectedStreamId, featuredStream]);

  /* ─── Filtered Streams ─── */
  const filteredStreams = useMemo(() => {
    const q = deferredChannelSearch.trim().toLowerCase();
    const base = q
      ? streams.filter(st => {
          const name = getStreamName(st);
          const lang = getStreamLanguage(st);
          return name.toLowerCase().includes(q) || lang.toLowerCase().includes(q);
        })
      : streams;

    const categoryFiltered = liveCategoryFilter === 'all'
      ? base
      : base.filter((st) => getStreamCategory(st) === liveCategoryFilter);

    const healthFiltered = liveHealthFilter === 'all'
      ? categoryFiltered
      : categoryFiltered.filter((st) => {
          const stream = getStreamRecord(st);
          if (liveHealthFilter === 'up') return isStreamUp(stream);
          if (liveHealthFilter === 'degraded') return isStreamDegraded(stream);
          if (liveHealthFilter === 'verified') return isStreamVerified(stream);
          return true;
        });

    const score = (st) => {
      const s = getStreamRecord(st);
      const isLive = isStreamUp(s);
      const isDegraded = isStreamDegraded(s);
      const hasEmbed = Boolean(s.embed_url || s.embedUrl);
      const isVerified = isStreamVerified(s);
      const isFeatured = Boolean(s.featured);
      return (isFeatured ? 120 : 0) + (isLive ? 100 : 0) + (isDegraded ? 70 : 0) + (isVerified ? 35 : 0) + (hasEmbed ? 30 : 0) + Number(s.score || 0) * 20;
    };

    return [...healthFiltered].sort((a, b) => score(b) - score(a));
  }, [streams, deferredChannelSearch, liveCategoryFilter, liveHealthFilter]);

  const featuredLiveStreams = useMemo(() => {
    return streams
      .filter((st) => {
        const s = getStreamRecord(st);
        return isStreamUp(s);
      })
      .sort((a, b) => Number(getStreamRecord(b).score || 0) - Number(getStreamRecord(a).score || 0))
      .slice(0, 6);
  }, [streams]);

  const liveCategoryOptions = useMemo(() => {
    const counts = streams.reduce((acc, stream) => {
      const category = getStreamCategory(stream);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    return [
      { id: 'all', label: 'الكل', count: streams.length },
      ...Object.keys(counts).sort((left, right) => counts[right] - counts[left]).map((category) => ({
        id: category,
        label: getLiveCategoryLabel(category),
        count: counts[category],
      })),
    ];
  }, [streams]);

  const relatedLiveQueue = useMemo(() => {
    if (!selectedStreamId) return [];
    const current = selectedStream ? getStreamCategory(selectedStream) : null;
    return filteredStreams
      .filter((stream) => getStreamId(stream) !== selectedStreamId)
      .filter((stream) => !current || getStreamCategory(stream) === current)
      .slice(0, 4);
  }, [filteredStreams, selectedStream, selectedStreamId]);

  /* ─── Theme toggle ─── */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* ─── Newspaper pages ─── */
  const NP_PER_PAGE = 6;
  const npPages = useMemo(() => {
    if (!newsItems.length) return [];
    const out = [];
    for (let i = 0; i < newsItems.length; i += NP_PER_PAGE) {
      out.push(newsItems.slice(i, i + NP_PER_PAGE));
    }
    return out;
  }, [newsItems]);

  const npUsePortrait = viewportW < 980;
  const npBookPageWidth = useMemo(() => {
    if (npUsePortrait) {
      return Math.max(300, Math.min(820, viewportW - 20));
    }
    return Math.max(620, Math.min(1180, Math.floor((viewportW - 70) / 2)));
  }, [npUsePortrait, viewportW]);
  const npBookPageHeight = Math.floor(npBookPageWidth * 1.28);
  const npTypographyScale = useMemo(() => {
    if (npUsePortrait) return Math.max(0.92, Math.min(1.03, npBookPageWidth / 700));
    return Math.max(0.98, Math.min(1.28, npBookPageWidth / 820));
  }, [npBookPageWidth, npUsePortrait]);

  const handleNpFlip = useCallback((e) => {
    setNpCurrentPage(e.data);
    setNpFlipPulse(true);
    if (npFlipTimerRef.current) clearTimeout(npFlipTimerRef.current);
    npFlipTimerRef.current = setTimeout(() => setNpFlipPulse(false), 420);
  }, []);
  const npGoNext = useCallback(() => flipBookRef.current?.pageFlip()?.flipNext(), []);
  const npGoPrev = useCallback(() => flipBookRef.current?.pageFlip()?.flipPrev(), []);
  const npOpenFocus = useCallback((item) => item && setNpFocusItem(item), []);
  const npCloseFocus = useCallback(() => setNpFocusItem(null), []);

  useEffect(() => () => {
    if (npFlipTimerRef.current) clearTimeout(npFlipTimerRef.current);
  }, []);

  useEffect(() => {
    if (activeTab !== 'news') return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') npCloseFocus();
      if (e.key === 'ArrowRight') npGoPrev();
      if (e.key === 'ArrowLeft') npGoNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, npCloseFocus, npGoNext, npGoPrev]);

  // Reset to page 0 when filters change
  useEffect(() => { setNpCurrentPage(0); }, [category, searchQ]);
  useEffect(() => { setNpFocusItem(null); }, [category, searchQ, npCurrentPage]);

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
      <main className={`site-main ${activeTab === 'news' ? 'site-main--news' : ''}`}>

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


            {/* ── NEWSPAPER VIEW ── */}
            {!loadingNews && newsItems.length > 0 && (
              <div className="np-arena">
                {/* Nav bar */}
                <div className="np-nav-bar">
                  <button
                    className="np-nav__btn"
                    disabled={npCurrentPage === 0}
                    onClick={npGoPrev}
                  >‹ رجوع</button>
                  <span className="np-nav__info">
                    <span className="np-nav__label">صفحة</span>
                    <span className="np-nav__num">{Math.ceil((npCurrentPage + 1) / 2)}</span>
                    <span className="np-nav__label">من</span>
                    <span className="np-nav__num">{Math.ceil(npPages.length / 2)}</span>
                    <span className="np-nav__sep"> · </span>
                    <span className="np-nav__count">{newsItems.length} خبر</span>
                  </span>
                  <button
                    className="np-nav__btn"
                    disabled={npCurrentPage >= npPages.length - 1}
                    onClick={npGoNext}
                  >متابعة ›</button>
                </div>
                {/* Flip book */}
                <div className="np-book-wrap">
                  <button
                    className="np-edge-hit np-edge-hit--prev"
                    onClick={npGoPrev}
                    disabled={npCurrentPage === 0}
                    aria-label="الصفحة السابقة"
                    title="انقر حافة الصفحة للرجوع"
                  />
                  <button
                    className="np-edge-hit np-edge-hit--next"
                    onClick={npGoNext}
                    disabled={npCurrentPage >= npPages.length - 1}
                    aria-label="الصفحة التالية"
                    title="انقر حافة الصفحة للمتابعة"
                  />
                  <div
                    className={`np-book-shell ${npFlipPulse ? 'np-book-shell--flip' : ''} ${npCurrentPage % 2 === 0 ? 'np-book-shell--even' : 'np-book-shell--odd'}`}
                    style={{ '--np-font-scale': npTypographyScale }}
                  >
                    <HTMLFlipBook
                      key={`${category}-${searchQ}`}
                      ref={flipBookRef}
                      width={npBookPageWidth}
                      height={npBookPageHeight}
                      size="fixed"
                      drawShadow={true}
                      flippingTime={700}
                      usePortrait={npUsePortrait}
                      startPage={0}
                      showCover={false}
                      mobileScrollSupport={false}
                      maxShadowOpacity={0.55}
                      className="np-flipbook"
                      onFlip={handleNpFlip}
                    >
                      {npPages.map((pageItems, i) => (
                        <NewspaperPage
                          key={i}
                          items={pageItems}
                          pageNum={i + 1}
                          totalPages={npPages.length}
                          onSelectItem={npOpenFocus}
                        />
                      ))}
                    </HTMLFlipBook>
                  </div>
                </div>

                {npFocusItem && (
                  <div className="np-focus-layer" role="dialog" aria-modal="true" onClick={npCloseFocus}>
                    <article className="np-focus-card" onClick={(e) => e.stopPropagation()}>
                      <button className="np-focus-close" onClick={npCloseFocus} aria-label="إغلاق">×</button>
                      <span className="np-focus-kicker">{npFocusItem.category || 'أخبار'}</span>
                      <h3 className={`np-focus-title np-headline--${headlineTone(npFocusItem.title)}`}>{npFocusItem.title}</h3>
                      <div className="np-focus-meta">
                        <span>{npFocusItem.source?.name || 'مصدر'}</span>
                        <span>{relativeTime(npFocusItem.time || npFocusItem.publishedAt || npFocusItem.published_at)}</span>
                      </div>
                      {npFocusItem.summary && (
                        <p className="np-focus-summary">{stripHtml(String(npFocusItem.summary))}</p>
                      )}
                      <div className="np-focus-actions">
                        <button className="np-focus-btn" onClick={() => npFocusItem.link && window.open(npFocusItem.link, '_blank', 'noopener,noreferrer')}>
                          قراءة من المصدر
                        </button>
                      </div>
                    </article>
                  </div>
                )}
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
            OPS TAB
        ═══════════════════════════════ */}
        {activeTab === 'ops' && (
          <div className="ops-view">
            {errorOps && <ErrorBanner message={errorOps} onRetry={loadOps} />}
            <div className="ops-signal-grid">
              <UAEWeatherPanel
                data={weatherHub}
                loading={signalsLoading && weatherHubAvailable === null}
                available={weatherHubAvailable}
                error={weatherHubError}
                selectedLocationId={selectedWeatherLocationId}
                onSelectLocation={setSelectedWeatherLocationId}
                onRetry={loadSignalPanels}
              />
              <UAEMarketsPanel
                data={marketsHub}
                loading={signalsLoading && marketsHubAvailable === null}
                available={marketsHubAvailable}
                error={marketsHubError}
                onRetry={loadSignalPanels}
              />
            </div>
            <NewsroomDashboard
              newsroomStatus={newsroomStatus}
              metricsBasic={metricsBasic}
              updatedAt={opsUpdatedAt}
              onRefresh={refreshOpsView}
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
                    ? `${liveSummary.playable_streams ?? streams.length} قناة صالحة للتشغيل · ${liveSummary.total_streams ?? streams.length} إجمالاً`
                    : 'تغطية استخباراتية على مدار الساعة'}
                </p>
              </div>
              <button className="live-hdr__refresh" onClick={() => loadLive({ silent: streams.length > 0 })}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                {refreshingLive ? 'جار التحديث…' : 'تحديث'}
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
                    <span className="lhb-stat__key">متاح الآن</span>
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
                  <span className="live-hud-bar__status-text">{liveUpdatedAt ? `آخر مزامنة ${relativeTime(liveUpdatedAt)}` : 'نظام المراقبة: نشط'}</span>
                </div>
              </div>
            )}

            {errorLive && <ErrorBanner message={errorLive} onRetry={loadLive} />}

            {!loadingLive && streams.length > 0 && (
              <div className="live-command-grid">
                <div className="live-filter-panel">
                  <div className="live-filter-section">
                    <span className="live-filter-section__title">الفئات</span>
                    <div className="live-chip-row">
                      {liveCategoryOptions.map((option) => (
                        <button
                          key={option.id}
                          className={`live-chip${liveCategoryFilter === option.id ? ' live-chip--active' : ''}`}
                          onClick={() => setLiveCategoryFilter(option.id)}
                        >
                          {option.label}
                          <span>{option.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="live-filter-section">
                    <span className="live-filter-section__title">الحالة</span>
                    <div className="live-chip-row">
                      {[
                        { id: 'all', label: 'الكل' },
                        { id: 'up', label: 'مباشر فقط' },
                        { id: 'degraded', label: 'جزئي' },
                        { id: 'verified', label: 'موثق' },
                      ].map((option) => (
                        <button
                          key={option.id}
                          className={`live-chip${liveHealthFilter === option.id ? ' live-chip--active' : ''}`}
                          onClick={() => setLiveHealthFilter(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="live-filter-meta">
                    <span>{filteredStreams.length} قناة بعد التصفية</span>
                    <span>{liveSummary?.verified_streams ?? 0} قناة موثقة</span>
                    <span>{liveSummary?.up_streams ?? 0} مباشرة بالكامل</span>
                  </div>
                </div>

                {featuredStream && (
                  <button className="live-spotlight-card" onClick={() => handleTvSelect(featuredStream)}>
                    <span className="live-spotlight-card__eyebrow">القناة المرجعية</span>
                    <strong className="live-spotlight-card__title">{getStreamName(featuredStream)}</strong>
                    <p className="live-spotlight-card__sub">
                      {getLiveCategoryLabel(getStreamCategory(featuredStream))} · {Math.round(Number(getStreamRecord(featuredStream).score || 0) * 100)}% ثقة
                    </p>
                  </button>
                )}
              </div>
            )}

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
                        onClick={() => handleTvSelect(st)}
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
              <div className="live-focus-layout">
                <CinematicPlayer
                  stream={selectedStream}
                  switching={tvSwitching}
                  onClose={() => { setSelectedStreamId(null); setTvSwitching(false); }}
                />
                <LiveFocusPanel
                  stream={selectedStream}
                  queue={relatedLiveQueue}
                  updatedAt={liveUpdatedAt}
                  onSelect={handleTvSelect}
                />
              </div>
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
                      onSelect={handleTvSelect}
                      isActive={selectedStreamId === getStreamId(st)}
                      isSwitching={selectedStreamId === getStreamId(st) && tvSwitching}
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

        {/* ═══════════════════════════════════════════
            PODCAST TAB  🎙️
        ═══════════════════════════════════════════ */}
        {activeTab === 'podcast' && (() => {
          const selectedSource = podcastSources.find(s => s.id === selectedPodcastId);
          const featuredPodcastSource = podcastSources.find((s) => s.id === 'abu-talal-external') || null;
          const isExternal = selectedSource?.type === 'external';
          return (
            <div className="pod-arena" dir="rtl">

              {/* ── Header ── */}
              <div className="pod-header">
                <div>
                  <div className="pod-header__eyebrow">
                    <span className="pod-header__pulse" />
                    محتوى صوتي
                  </div>
                  <h2 className="pod-header__title">البودكاست العربي</h2>
                  <p className="pod-header__sub">تحليلات وأخبار وتقارير صوتية من أبرز المصادر العربية والدولية</p>
                </div>
              </div>

              {featuredPodcastSource && (
                <section className={`pod-feature-card${selectedPodcastId === featuredPodcastSource.id ? ' pod-feature-card--active' : ''}`}>
                  <div className="pod-feature-card__signal">ملف صوتي مميز</div>
                  <div className="pod-feature-card__grid">
                    <div className="pod-feature-card__body">
                      <span className="pod-feature-card__eyebrow">أبو طلال الحمراني</span>
                      <h3 className="pod-feature-card__title">سوالف طريق متاح الآن من داخل الموقع</h3>
                      <p className="pod-feature-card__desc">
                        تم ربط المصدر عبر RSS صوتي فعلي، ما يعني إمكانية تصفح الحلقات وتشغيلها داخل مشغل البودكاست نفسه بدون الخروج من الصفحة.
                      </p>
                      <div className="pod-feature-card__meta">
                        <span>تحليل</span>
                        <span>•</span>
                        <span>حلقات صوتية مباشرة</span>
                        <span>•</span>
                        <span>تشغيل داخلي</span>
                      </div>
                    </div>
                    <div className="pod-feature-card__actions">
                      <button
                        className="pod-feature-card__cta"
                        onClick={() => setSelectedPodcastId(featuredPodcastSource.id)}
                      >
                        {selectedPodcastId === featuredPodcastSource.id ? 'أنت داخل المصدر الآن' : 'افتح حلقات أبو طلال'}
                      </button>
                      <span className="pod-feature-card__note">يتم تشغيل الحلقات عبر مشغل الموقع نفسه أسفل الصفحة.</span>
                    </div>
                  </div>
                </section>
              )}

              <div className="pod-layout">

                {/* ── Source list sidebar ── */}
                <aside className="pod-sidebar">
                  <div className="pod-sidebar__label">المصادر</div>
                  {podcastSources.map((source) => (
                    <button
                      key={source.id}
                      className={`pod-source-btn${selectedPodcastId === source.id ? ' pod-source-btn--active' : ''}`}
                      onClick={() => setSelectedPodcastId(source.id)}
                    >
                      <div className="pod-source-btn__icon">
                        {source.type === 'external' ? '🔗' : '🎙️'}
                      </div>
                      <div className="pod-source-btn__body">
                        <span className="pod-source-btn__name">{source.name}</span>
                        <span className="pod-source-btn__cat">
                          {source.category === 'news' ? 'أخبار' : source.category === 'analysis' ? 'تحليل' : source.category}
                        </span>
                      </div>
                      {source.type === 'external' && <span className="pod-source-btn__ext">↗</span>}
                    </button>
                  ))}
                </aside>

                {/* ── Main content area ── */}
                <div className="pod-main">

                  {/* External source card */}
                  {isExternal && selectedSource && (
                    <div className="pod-external-card">
                      <div className="pod-external-card__icon">🎙️</div>
                      <div className="pod-external-card__body">
                        <h3 className="pod-external-card__name">{selectedSource.name}</h3>
                        <p className="pod-external-card__desc">{selectedSource.description}</p>
                        <a
                          href={selectedSource.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pod-external-card__cta"
                        >
                          مشاهدة المحتوى
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                        <p className="pod-external-card__note">⚠ لا تتوفر حلقات قابلة للتشغيل مباشرة. يُنصح بمتابعة المحتوى من المنصة الأصلية.</p>
                      </div>
                    </div>
                  )}

                  {/* RSS episodes */}
                  {!isExternal && (
                    <>
                      {loadingPodcast && <LoadingSpinner label="جارٍ تحميل الحلقات…" />}
                      {errorPodcast && !loadingPodcast && (
                        <ErrorBanner
                          message={errorPodcast}
                          onRetry={() => loadPodcastFeed(selectedPodcastId)}
                        />
                      )}
                      {!loadingPodcast && !errorPodcast && podcastMeta && (
                        <div className="pod-feed-meta">
                          {podcastMeta.image && (
                            <img src={podcastMeta.image} alt={podcastMeta.title} className="pod-feed-meta__img" />
                          )}
                          <div>
                            <h3 className="pod-feed-meta__title">{podcastMeta.title}</h3>
                            {podcastMeta.description && (
                              <p className="pod-feed-meta__desc">{podcastMeta.description.slice(0, 180)}</p>
                            )}
                          </div>
                        </div>
                      )}
                      {!loadingPodcast && podcastEpisodes.length > 0 && (
                        <div className="pod-episodes">
                          {podcastEpisodes.map((ep) => (
                            <button
                              key={ep.id}
                              className={`pod-ep${playingEpisode?.id === ep.id ? ' pod-ep--playing' : ''}`}
                              onClick={() => setPlayingEpisode(ep.audio_url ? ep : null)}
                            >
                              <div className="pod-ep__play">
                                {playingEpisode?.id === ep.id
                                  ? <span className="pod-ep__play-bars"><span/><span/><span/></span>
                                  : <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                                }
                              </div>
                              <div className="pod-ep__body">
                                <p className="pod-ep__title">{ep.title}</p>
                                <div className="pod-ep__meta">
                                  {ep.published_at && <span>{new Date(ep.published_at).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
                                  {ep.duration && <span>· {ep.duration}</span>}
                                  {!ep.audio_url && <span className="pod-ep__no-audio">· بدون رابط صوتي</span>}
                                </div>
                                {ep.description && (
                                  <p className="pod-ep__desc">{ep.description.slice(0, 120)}{ep.description.length > 120 ? '…' : ''}</p>
                                )}
                              </div>
                              {ep.link && (
                                <a
                                  href={ep.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="pod-ep__link"
                                  onClick={(e) => e.stopPropagation()}
                                  title="فتح في المصدر"
                                >
                                  ↗
                                </a>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {!loadingPodcast && !errorPodcast && podcastEpisodes.length === 0 && selectedSource && (
                        <div className="pod-empty">لا توجد حلقات متاحة</div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── Persistent audio player bar ── */}
              {playingEpisode && (
                <div className="pod-player-bar" dir="rtl">
                  <div className="pod-player-bar__info">
                    <span className="pod-player-bar__icon">🎙️</span>
                    <span className="pod-player-bar__title">{playingEpisode.title}</span>
                  </div>
                  <audio
                    key={playingEpisode.id}
                    src={playingEpisode.audio_url}
                    controls
                    autoPlay
                    className="pod-player-bar__audio"
                  />
                  <button
                    className="pod-player-bar__close"
                    onClick={() => setPlayingEpisode(null)}
                    aria-label="إغلاق المشغل"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              )}

            </div>
          );
        })()}

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
.site-main--news { max-width: 100%; padding-inline: 0; }

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
  --tilt-x: 0deg;
  --tilt-y: 0deg;
  --glow-x: 50%;
  --glow-y: 50%;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(155deg, rgba(18,22,38,.97) 0%, rgba(9,12,22,.98) 100%);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 22px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  transform-style: preserve-3d;
  perspective: 1200px;
  transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
  transition: transform .28s cubic-bezier(.2,.9,.2,1), box-shadow .24s, border-color .22s;
}
.hero-card:hover {
  transform: translateY(-4px) rotateX(calc(var(--tilt-x) + 1deg)) rotateY(calc(var(--tilt-y) - 1deg));
  border-color: rgba(59,130,246,.28);
  box-shadow: 0 30px 72px rgba(0,0,0,.55), 0 0 0 1px rgba(59,130,246,.16), inset 0 1px 0 rgba(255,255,255,.07);
}
.hero-card__viz {
  position: relative;
  aspect-ratio: 16/7;
  overflow: hidden;
  background:
    radial-gradient(circle at 78% 18%, rgba(59,130,246,.2) 0%, rgba(59,130,246,0) 48%),
    radial-gradient(circle at 20% 82%, rgba(245,158,11,.16) 0%, rgba(245,158,11,0) 52%),
    linear-gradient(145deg, rgba(14,18,32,.95) 0%, rgba(7,10,18,.97) 100%);
}
.hero-card__gridline {
  position: absolute;
  inset: -30% -20%;
  background-image:
    linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
  background-size: 46px 46px;
  transform: perspective(900px) rotateX(74deg) translateY(18px);
  opacity: .24;
  animation: holo-drift 14s linear infinite;
}
.hero-card__orb {
  position: absolute;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  left: 12%;
  top: 18%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.35), rgba(59,130,246,.14) 34%, rgba(59,130,246,0) 72%);
  filter: blur(1px);
  box-shadow: 0 0 32px rgba(59,130,246,.24);
  animation: orb-float 6.5s ease-in-out infinite;
}
.hero-card__viz::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(360px 220px at var(--glow-x) var(--glow-y), rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 70%);
  opacity: .55;
  transition: opacity .2s;
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
  --tilt-x: 0deg;
  --tilt-y: 0deg;
  --glow-x: 50%;
  --glow-y: 50%;
  background: linear-gradient(155deg, rgba(17,21,36,.96) 0%, rgba(9,12,22,.98) 100%);
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.07);
  box-shadow: 0 14px 34px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.05);
  transition: transform .24s cubic-bezier(.2,.9,.2,1), box-shadow .24s, border-color .2s;
  display: flex; flex-direction: column;
  transform-style: preserve-3d;
  transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
}
.news-card:hover {
  transform: translateY(-3px) rotateX(calc(var(--tilt-x) + .8deg)) rotateY(calc(var(--tilt-y) - .8deg));
  border-color: rgba(245,158,11,.24);
  box-shadow: 0 20px 46px rgba(0,0,0,.45), 0 0 0 1px rgba(245,158,11,.1), inset 0 1px 0 rgba(255,255,255,.06);
}
.news-card__viz {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 80% 15%, rgba(59,130,246,.18) 0%, rgba(59,130,246,0) 46%),
    radial-gradient(circle at 16% 84%, rgba(245,158,11,.14) 0%, rgba(245,158,11,0) 50%),
    linear-gradient(150deg, rgba(13,16,29,.95) 0%, rgba(8,11,20,.97) 100%);
}
.news-card--sm .news-card__viz { aspect-ratio: 3/1; }
.news-card--md .news-card__viz { aspect-ratio: 16/6; }
.news-card__beam {
  position: absolute;
  inset: auto -10% -42% -10%;
  height: 120%;
  background: radial-gradient(ellipse at center, rgba(255,255,255,.1) 0%, rgba(255,255,255,0) 60%);
  transform: perspective(900px) rotateX(72deg);
  opacity: .35;
}
.news-card__viz::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(260px 160px at var(--glow-x) var(--glow-y), rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 72%);
  opacity: .5;
}
.news-card__badges { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; align-items: center; }
.news-card__body { padding: 12px 14px 14px; flex: 1; display: flex; flex-direction: column; }
.news-card__title { font-size: .95rem; font-weight: 600; line-height: 1.45; margin-bottom: 6px; flex: 1; }
.news-card--sm .news-card__title { font-size: .88rem; }
.news-card__title a:hover { color: var(--accent2); }
.news-card__summary { font-size: .82rem; color: var(--text2); line-height: 1.55; margin-bottom: 8px; }
.news-card__footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; }

@keyframes holo-drift {
  0% { transform: perspective(900px) rotateX(74deg) translateY(18px) translateX(0); }
  100% { transform: perspective(900px) rotateX(74deg) translateY(18px) translateX(46px); }
}

@keyframes orb-float {
  0%, 100% { transform: translate3d(0,0,0); }
  50% { transform: translate3d(0,-8px,0); }
}

/* ── LIST ITEM ── */
.list-item {
  --tilt-x: 0deg; --tilt-y: 0deg; --glow-x: 50%; --glow-y: 50%;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius-sm);
  position: relative; overflow: hidden;
  transform-style: preserve-3d;
  transform: perspective(600px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
  transition: transform .08s ease-out, background .15s;
  will-change: transform;
}
.list-item:hover { background: var(--card-hover); }
.list-item::after {
  content: '';
  position: absolute; inset: 0; border-radius: var(--radius-sm); pointer-events: none;
  background: radial-gradient(circle 60px at var(--glow-x) var(--glow-y), rgba(255,200,80,.12) 0%, transparent 70%);
  opacity: 0; transition: opacity .15s;
}
.list-item:hover::after { opacity: 1; }
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

.live-command-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.75fr) minmax(260px, .95fr);
  gap: 16px;
  margin-bottom: 22px;
}
.live-filter-panel,
.live-spotlight-card,
.live-focus-panel {
  background: linear-gradient(135deg, rgba(10,12,22,.94) 0%, rgba(17,20,34,.92) 100%);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  box-shadow: 0 18px 44px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05);
}
.live-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}
.live-filter-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.live-filter-section__title {
  font-size: .68rem;
  color: rgba(255,255,255,.45);
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 800;
}
.live-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.live-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.66);
  font-size: .76rem;
  font-weight: 700;
  cursor: pointer;
  transition: all .2s;
}
.live-chip span {
  display: inline-flex;
  min-width: 20px;
  justify-content: center;
  color: rgba(255,255,255,.3);
  font-size: .68rem;
}
.live-chip:hover,
.live-chip--active {
  background: rgba(59,130,246,.16);
  border-color: rgba(59,130,246,.36);
  color: #dbeafe;
}
.live-chip--active span { color: rgba(219,234,254,.75); }
.live-filter-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 6px;
  color: rgba(255,255,255,.36);
  font-size: .72rem;
}
.live-spotlight-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 9px;
  padding: 18px;
  cursor: pointer;
  text-align: right;
  transition: transform .22s, border-color .22s, box-shadow .22s;
}
.live-spotlight-card:hover {
  transform: translateY(-2px);
  border-color: rgba(59,130,246,.32);
  box-shadow: 0 24px 48px rgba(0,0,0,.42), 0 0 0 1px rgba(59,130,246,.14);
}
.live-spotlight-card__eyebrow {
  color: rgba(96,165,250,.75);
  font-size: .68rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 800;
}
.live-spotlight-card__title {
  color: #f8fbff;
  font-size: 1.12rem;
  line-height: 1.25;
}
.live-spotlight-card__sub {
  color: rgba(255,255,255,.5);
  font-size: .82rem;
  margin: 0;
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
.cp__overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, rgba(6,8,16,.66) 0%, rgba(6,8,16,.86) 100%);
  backdrop-filter: blur(6px);
}
.cp__overlay--loading {
  flex-direction: column;
  gap: 12px;
  color: rgba(255,255,255,.82);
}
.cp__overlay-spinner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,.12);
  border-top-color: #93c5fd;
  animation: spin 1s linear infinite;
}
.cp__overlay-text {
  font-size: .86rem;
  color: rgba(255,255,255,.72);
}
.cp__overlay-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  text-align: center;
  max-width: 320px;
  padding: 24px;
  border-radius: 18px;
  background: rgba(9,12,24,.92);
  border: 1px solid rgba(239,68,68,.18);
  box-shadow: 0 18px 50px rgba(0,0,0,.5);
}
.cp__overlay-card strong { color: #fff; }
.cp__overlay-card p {
  margin: 0;
  color: rgba(255,255,255,.62);
  line-height: 1.6;
}
.cp__overlay-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.cp__retry-btn,
.cp__overlay-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 700;
  font-size: .8rem;
  text-decoration: none;
}
.cp__retry-btn {
  border: 1px solid rgba(59,130,246,.32);
  background: rgba(59,130,246,.16);
  color: #dbeafe;
  cursor: pointer;
}
.cp__overlay-link {
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.05);
  color: rgba(255,255,255,.74);
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
  border-top: 1px solid rgba(255,255,255,.05);
  background: rgba(0,0,0,.3);
  line-height: 1.5;
}
.cp__footer-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: rgba(255,255,255,.32);
  font-size: .74rem;
}
.cp__footer-grid strong { color: rgba(255,255,255,.6); }
.cp__footer-note {
  margin-top: 8px;
  color: rgba(255,255,255,.24);
  font-size: .76rem;
}

.live-focus-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, .95fr);
  gap: 18px;
  align-items: start;
  margin-bottom: 28px;
}
.live-focus-layout > .cp { margin-bottom: 0; }
.live-focus-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  min-height: 100%;
}
.live-focus-panel__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.live-focus-panel__eyebrow {
  display: inline-block;
  font-size: .66rem;
  color: rgba(255,255,255,.42);
  letter-spacing: .14em;
  text-transform: uppercase;
  font-weight: 800;
  margin-bottom: 8px;
}
.live-focus-panel__title {
  margin: 0 0 4px;
  font-size: 1.15rem;
  color: #fff;
}
.live-focus-panel__sub {
  margin: 0;
  color: rgba(255,255,255,.45);
  font-size: .8rem;
}
.live-focus-panel__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: .72rem;
  font-weight: 800;
  white-space: nowrap;
}
.live-focus-panel__status--online { background: rgba(34,197,94,.14); color: #86efac; }
.live-focus-panel__status--degraded { background: rgba(245,158,11,.14); color: #fcd34d; }
.live-focus-panel__status--offline { background: rgba(239,68,68,.12); color: #fca5a5; }
.live-focus-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.live-focus-stat {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px;
  padding: 12px;
}
.live-focus-stat__label {
  display: block;
  color: rgba(255,255,255,.38);
  font-size: .68rem;
  margin-bottom: 8px;
}
.live-focus-stat__value {
  color: #f8fbff;
  font-size: 1.1rem;
}
.live-focus-panel__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.live-focus-badge {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  color: rgba(255,255,255,.7);
  font-size: .72rem;
}
.live-focus-story {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.06);
}
.live-focus-story--empty { opacity: .8; }
.live-focus-story__eyebrow {
  font-size: .66rem;
  font-weight: 800;
  color: rgba(147,197,253,.72);
  letter-spacing: .12em;
  text-transform: uppercase;
}
.live-focus-story__title {
  color: #f3f7ff;
  line-height: 1.6;
}
.live-focus-story__meta {
  margin: 0;
  color: rgba(255,255,255,.46);
  font-size: .78rem;
}
.live-focus-queue {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.live-focus-queue__title {
  font-size: .72rem;
  color: rgba(255,255,255,.4);
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 800;
}
.live-focus-queue__items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.live-focus-queue__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.76);
  cursor: pointer;
  text-align: right;
}
.live-focus-queue__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 10px rgba(96,165,250,.55);
  flex-shrink: 0;
}
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
@media (max-width: 1180px) {
  .live-command-grid,
  .live-focus-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .live-focus-panel__stats {
    grid-template-columns: 1fr;
  }
  .live-filter-meta {
    flex-direction: column;
    gap: 6px;
  }
}

.live-empty {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 60px 20px;
  color: var(--text2);
  font-size: .88rem;
}

/* ════════════════════════════════════════
   RETRO TV CHANNEL CARDS ★★★★★★★
════════════════════════════════════════ */

/* ── lxc: TV Cabinet outer shell ── */
.lxc {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border-radius: 18px 18px 10px 10px;
  border: 2px solid rgba(255,255,255,.09);
  background:
    linear-gradient(175deg, #252639 0%, #191b28 50%, #0e0f18 100%);
  cursor: pointer;
  text-align: center;
  overflow: hidden;
  transition: transform .28s cubic-bezier(.34,1.56,.64,1),
              border-color .24s,
              box-shadow .28s;
  outline: none;
  box-shadow:
    0 6px 24px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.07);
}
/* Piano-gloss highlight on top edge */
.lxc::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  background: linear-gradient(175deg, rgba(255,255,255,.06) 0%, transparent 30%);
  pointer-events: none;
  z-index: 0;
}
/* Hover lift */
.lxc:hover {
  transform: translateY(-6px) scale(1.015);
  border-color: rgba(100,180,255,.4);
  box-shadow:
    0 20px 50px rgba(0,0,0,.65),
    0 0 0 1px rgba(100,180,255,.18),
    0 0 32px rgba(59,130,246,.08);
}
/* Active (selected) TV — accent ring */
.lxc--active {
  transform: translateY(-4px);
  border-color: rgba(59,130,246,.7);
  background:
    linear-gradient(175deg, #1e2848 0%, #131927 50%, #0a0d18 100%);
  box-shadow:
    0 16px 44px rgba(0,0,0,.7),
    0 0 0 2px rgba(59,130,246,.55),
    0 0 40px rgba(59,130,246,.14);
}
/* Offline: dead set */
.lxc--offline {
  opacity: .35;
  filter: grayscale(.85) brightness(.7);
}
.lxc--offline { pointer-events: auto; }
.lxc--degraded { border-color: rgba(245,158,11,.25); }

/* ── Antennae ── */
.lxc__ant-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  gap: 14px;
  height: 22px;
  padding-top: 4px;
  z-index: 1;
  flex-shrink: 0;
}
.lxc__ant {
  width: 3px;
  height: 100%;
  background: linear-gradient(to top, rgba(255,255,255,.22), rgba(255,255,255,.06));
  border-radius: 2px 2px 0 0;
  flex-shrink: 0;
  transform-origin: bottom center;
}
.lxc__ant--l { transform: rotate(-22deg); }
.lxc__ant--r { transform: rotate(22deg); }
.lxc--active .lxc__ant {
  background: linear-gradient(to top, rgba(96,165,250,.8), rgba(96,165,250,.2));
  box-shadow: 0 0 6px rgba(59,130,246,.4);
}

/* ── Cabinet body (wraps bezel + ctrls) ── */
.lxc__cabinet {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 8px 0;
  position: relative;
  z-index: 1;
  flex: 1;
}

/* ── CRT Bezel ── */
.lxc__bezel {
  background:
    linear-gradient(160deg, #1a1c2e 0%, #10121c 100%);
  border-radius: 10px;
  padding: 6px;
  border: 2px solid rgba(0,0,0,.6);
  box-shadow:
    inset 0 2px 8px rgba(0,0,0,.7),
    inset 0 -1px 3px rgba(255,255,255,.03),
    0 2px 6px rgba(0,0,0,.4);
  position: relative;
}
.lxc--active .lxc__bezel {
  border-color: rgba(40,80,160,.5);
  box-shadow:
    inset 0 2px 8px rgba(0,0,0,.7),
    inset 0 0 12px rgba(0,100,220,.04),
    0 0 10px rgba(59,130,246,.06);
}

/* ── CRT Screen Face ── */
.lxc__screen-face {
  aspect-ratio: 4 / 3;
  background: #01030a;
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  box-shadow:
    inset 0 0 28px rgba(0,0,0,.9),
    inset 0 0 8px rgba(0,0,0,.5);
}
/* Phosphor glow on live channels */
.lxc--active .lxc__screen-face,
.lxc--online .lxc__screen-face {
  box-shadow:
    inset 0 0 28px rgba(0,0,0,.9),
    inset 0 0 20px rgba(0,160,100,.1),
    0 0 8px rgba(0,140,80,.06);
}

/* ── Screen content ── */
.lxc__screen-inner {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 5px;
  padding: 8px;
  z-index: 1;
}
.lxc__tv-logo {
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  border-radius: 9px;
  background: rgba(255,255,255,.03);
  flex-shrink: 0;
}
.lxc__tv-logo img {
  width: 100%; height: 100%;
  object-fit: contain;
  filter: brightness(.85) saturate(.6);
}
.lxc__tv-initials {
  font-size: 1rem; font-weight: 900;
  color: rgba(0,230,140,.5);   /* phosphor green */
  letter-spacing: -.02em;
  text-shadow: 0 0 10px rgba(0,220,120,.3);
}
.lxc__tv-name {
  font-size: .68rem; font-weight: 700;
  color: rgba(180,240,200,.45);   /* phosphor tint */
  text-align: center;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 0 8px rgba(0,220,120,.2);
  letter-spacing: 0;
}
.lxc__tv-lang {
  font-size: .52rem; font-weight: 800;
  color: rgba(0,200,110,.28);
  letter-spacing: .14em;
  text-transform: uppercase;
}
/* When card is offline, use amber/dead-CRT tint */
.lxc--offline .lxc__tv-initials { color: rgba(200,160,60,.35); }
.lxc--offline .lxc__tv-name     { color: rgba(200,160,60,.25); }

/* ── CRT Texture Overlays ── */
.lxc__crt-lines {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px, transparent 2px,
    rgba(0,0,0,.14) 2px, rgba(0,0,0,.14) 3px
  );
  pointer-events: none;
  z-index: 2;
}
.lxc__crt-vgn {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.72) 100%);
  pointer-events: none;
  z-index: 3;
}
.lxc__crt-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 65% 55% at 50% 50%,
    rgba(0,200,120,.055) 0%, transparent 70%);
  pointer-events: none;
  z-index: 2;
  animation: crt-breathe 3.5s ease-in-out infinite;
}
@keyframes crt-breathe {
  0%, 100% { opacity: .6; }
  50%       { opacity: 1; }
}

/* ── TV Static Canvas ── */
.tv-static {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 10;
  opacity: 0;
  transition: opacity .12s;
  border-radius: inherit;
}
.tv-static--on { opacity: 1; }

/* ── Controls strip ── */
.lxc__ctrls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 2px 5px;
  flex-shrink: 0;
}

/* Status pill — shared from old design, minor update */
.lxc__status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: .55rem;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
  background: rgba(0,0,0,.5);
  border: 1px solid rgba(255,255,255,.08);
  color: var(--dot-color, rgba(255,255,255,.3));
  border-color: color-mix(in srgb, var(--dot-color, #888) 28%, transparent);
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

/* ── Channel Knobs ── */
.lxc__knobs {
  display: flex;
  gap: 5px;
  align-items: center;
}
.lxc__knob {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #3e4058, #16172a);
  border: 1.5px solid rgba(255,255,255,.13);
  box-shadow: 0 2px 5px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.07);
  position: relative;
  flex-shrink: 0;
}
.lxc__knob::after {
  content: '';
  position: absolute;
  top: 50%; left: 2px;
  width: 4px; height: 1.5px;
  background: rgba(255,255,255,.22);
  border-radius: 1px;
  transform: translateY(-50%);
}
.lxc__knob--sm {
  width: 10px; height: 10px;
}
.lxc--active .lxc__knob {
  border-color: rgba(59,130,246,.45);
  box-shadow: 0 0 8px rgba(59,130,246,.2), 0 2px 5px rgba(0,0,0,.7);
}

/* ── TV Feet ── */
.lxc__feet {
  display: flex;
  justify-content: space-evenly;
  padding: 0 18px 2px;
  flex-shrink: 0;
}
.lxc__foot {
  width: 22px; height: 7px;
  background: linear-gradient(to bottom, #1c1e2e, #0e0f18);
  border-radius: 0 0 5px 5px;
  border: 1px solid rgba(255,255,255,.07);
  border-top: none;
  box-shadow: 0 3px 8px rgba(0,0,0,.5);
}

/* ── CinematicPlayer: static overlay during switching ── */
.cp--switching .cp__screen { animation: tv-hsync .18s steps(2) infinite; }
.cp--switching .cp__scanlines {
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px, transparent 1px,
    rgba(0,0,0,.08) 1px, rgba(0,0,0,.08) 2px
  );
}
@keyframes tv-hsync {
  0%   { transform: translateY(0); }
  25%  { transform: translateY(-2px); }
  75%  { transform: translateY(1px); }
  100% { transform: translateY(0); }
}

/* ── Channel turn-on animation on activation ── */
@keyframes tv-turn-on {
  0%   { clip-path: inset(50% 0); filter: brightness(2); }
  40%  { clip-path: inset(2% 0);  filter: brightness(1.3); }
  100% { clip-path: inset(0% 0);  filter: brightness(1); }
}
.lxc--active .lxc__bezel {
  animation: tv-turn-on .4s ease-out 1;
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
  .news-view .np-arena { grid-column: 1 / -1; }
  .news-view .editorial-grid { grid-column: 1; }
  .news-view .section-label { grid-column: 1; }
  .news-view .news-grid { grid-column: 1; }
  .news-view .load-more-wrap { grid-column: 1; }
  .news-view .empty-state { grid-column: 1; }
}

/* ════════════════════════════════════════════
   NEWSPAPER BOOK  —  LUXURY DARK EDITION
════════════════════════════════════════════ */
@import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Playfair+Display:wght@400;600;700;900&display=swap');

.np-arena {
  --np-font-head: 'Amiri', 'Noto Naskh Arabic', 'Times New Roman', serif;
  --np-font-body: 'Noto Naskh Arabic', 'Amiri', 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100vw;
  margin-inline: calc(50% - 50vw);
  padding: 16px clamp(4px, .9vw, 14px) 40px;
  gap: 18px;
}

/* ── Navigation bar ── */
.np-nav-bar {
  display: flex; align-items: center; gap: 14px;
  justify-content: space-between;
  background: rgba(11,13,21,0.92);
  border: 1px solid rgba(212,175,55,0.28);
  border-radius: 8px;
  padding: 8px 22px;
  backdrop-filter: blur(12px);
  user-select: none;
  width: min(100%, 1920px);
  margin: 0 auto;
}
.np-nav__btn {
  background: transparent;
  border: 1px solid rgba(212,175,55,0.32);
  color: var(--gold);
  padding: 5px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: .85rem;
  font-family: inherit;
  transition: all .18s;
}
.np-nav__btn:hover:not(:disabled) {
  background: rgba(212,175,55,0.1);
  border-color: var(--gold);
  box-shadow: 0 0 10px rgba(212,175,55,0.22);
}
.np-nav__btn:disabled { opacity: .3; cursor: not-allowed; }
.np-nav__info { display: flex; align-items: center; gap: 5px; font-size: .8rem; }
.np-nav__label { color: var(--text3); }
.np-nav__num   { color: var(--gold); font-weight: 700; }
.np-nav__sep   { color: var(--text3); }
.np-nav__count { color: var(--text2); }

/* ── Book wrapper ── */
.np-book-wrap {
  position: relative;
  width: min(100%, 1920px);
  margin: 0 auto;
  display: flex;
  justify-content: center;
  filter:
    drop-shadow(0 24px 60px rgba(0,0,0,.85))
    drop-shadow(0 4px 14px rgba(0,0,0,.55));
}
.np-book-shell {
  --np-font-scale: 1;
  position: relative;
  z-index: 2;
}
.np-book-shell::before {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: clamp(12px, 1.4vw, 22px);
  transform: translateX(-50%);
  pointer-events: none;
  background:
    radial-gradient(ellipse at center, rgba(0,0,0,.45) 0%, rgba(0,0,0,.22) 40%, transparent 80%),
    linear-gradient(to right, rgba(255,255,255,.03), rgba(0,0,0,.3), rgba(255,255,255,.03));
  opacity: .42;
  z-index: 3;
  transition: opacity .22s, transform .22s;
}
.np-book-shell--even::before { transform: translateX(-44%); }
.np-book-shell--odd::before { transform: translateX(-56%); }
.np-book-shell--flip::before {
  opacity: .9;
  animation: np-crease-pulse .42s ease-out;
}
.np-book-shell::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 28% 16%, rgba(255,255,255,.07), transparent 26%);
  mix-blend-mode: screen;
  opacity: .45;
  z-index: 1;
}
.np-flipbook { border-radius: 1px; max-width: 100%; }
.np-edge-hit {
  position: absolute;
  top: 0;
  bottom: 0;
  width: clamp(26px, 2.8vw, 54px);
  border: none;
  z-index: 3;
  background: transparent;
  cursor: pointer;
  transition: opacity .2s, filter .2s;
}
.np-edge-hit::after {
  content: '';
  position: absolute;
  top: 18%;
  bottom: 18%;
  width: 2px;
  opacity: 0;
  transition: opacity .2s;
}
.np-edge-hit--prev { right: 50%; transform: translateX(0); }
.np-edge-hit--next { left: 50%; transform: translateX(0); }
.np-edge-hit--prev:hover {
  background: linear-gradient(to left, rgba(212,175,55,.12), transparent 72%);
  filter: drop-shadow(0 0 10px rgba(212,175,55,.2));
}
.np-edge-hit--next:hover {
  background: linear-gradient(to right, rgba(212,175,55,.12), transparent 72%);
  filter: drop-shadow(0 0 10px rgba(212,175,55,.2));
}
.np-edge-hit--prev::after { left: 6px; background: linear-gradient(to bottom, transparent, rgba(212,175,55,.7), transparent); }
.np-edge-hit--next::after { right: 6px; background: linear-gradient(to bottom, transparent, rgba(212,175,55,.7), transparent); }
.np-edge-hit:hover::after { opacity: 1; }
.np-edge-hit:disabled { opacity: .25; cursor: not-allowed; }

/* ── Individual newspaper page ── */
.np-page {
  font-family: var(--np-font-body);
  direction: rtl;
  text-align: right;
  font-kerning: normal;
  font-feature-settings: 'liga' 1, 'clig' 1, 'calt' 1, 'kern' 1;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  background: #0b0d15;
  background-image:
    radial-gradient(ellipse at 15% 40%, rgba(212,175,55,.018) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 70%, rgba(80,55,15,.025) 0%, transparent 50%);
  border: 1px solid rgba(212,175,55,.1);
  box-sizing: border-box;
  padding: 18px 20px 12px;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  cursor: pointer;
}
.np-page::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      0deg,
      rgba(255,255,255,.022) 0,
      rgba(255,255,255,.022) 1px,
      rgba(0,0,0,.01) 1px,
      rgba(0,0,0,.01) 3px
    ),
    radial-gradient(circle at 8% 12%, rgba(255,255,255,.025), transparent 42%);
  mix-blend-mode: overlay;
  opacity: .6;
  z-index: 0;
}
/* Spine shadow — left pages */
.np-page:nth-child(odd)::before {
  content: '';
  position: absolute; top: 0; right: 0; bottom: 0; width: 14px;
  background: linear-gradient(to left, rgba(0,0,0,.3), transparent);
  pointer-events: none; z-index: 1;
}
/* Spine shadow — right pages */
.np-page:nth-child(even)::before {
  content: '';
  position: absolute; top: 0; left: 0; bottom: 0; width: 14px;
  background: linear-gradient(to right, rgba(0,0,0,.3), transparent);
  pointer-events: none; z-index: 1;
}

/* ── Masthead (page 1) ── */
.np-masthead {
  text-align: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.np-masthead__eyebrow {
  font-size: calc(.56rem * var(--np-font-scale)); letter-spacing: 0; text-transform: none;
  color: var(--gold); margin-bottom: 5px; font-weight: 700;
}
.np-masthead__title {
  font-family: var(--np-font-head);
  font-size: calc(2.5rem * var(--np-font-scale)); font-weight: 900; color: #f0e6c8;
  letter-spacing: 0; word-spacing: .08em; margin: 0; line-height: 1.14;
  text-wrap: balance;
  text-shadow: 0 0 50px rgba(212,175,55,.18);
}
.np-masthead__subline {
  display: flex; justify-content: space-between;
  font-size: calc(.6rem * var(--np-font-scale)); color: var(--text3);
  margin-top: 6px; letter-spacing: .8px;
}
.np-masthead__rule {
  margin: 9px 0 0; height: 1px; border: none;
  background: linear-gradient(90deg, transparent, rgba(212,175,55,.55), var(--gold), rgba(212,175,55,.55), transparent);
  position: relative;
}
.np-masthead__rule::after {
  content: ''; display: block; margin-top: 3px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(212,175,55,.25), transparent);
}

/* ── Non-cover page header ── */
.np-page-hdr {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(212,175,55,.22);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.np-page-hdr__name {
  font-size: calc(.58rem * var(--np-font-scale)); letter-spacing: 0; text-transform: none; color: var(--gold);
}
.np-page-hdr__num { font-size: calc(.58rem * var(--np-font-scale)); color: var(--text3); letter-spacing: 0; }

/* ── Lead story ── */
.np-lead { padding-bottom: 9px; cursor: pointer; flex-shrink: 0; }
.np-lead:hover .np-lead__headline { color: var(--gold); }
.np-lead__kicker {
  font-size: calc(.55rem * var(--np-font-scale)); letter-spacing: 0; text-transform: none;
  color: var(--gold); margin-bottom: 5px; font-weight: 700;
}
.np-lead__headline {
  font-family: var(--np-font-head);
  font-size: calc(1.15rem * var(--np-font-scale)); font-weight: 800; color: #f0e6c8;
  line-height: 1.52; letter-spacing: 0; word-spacing: .03em;
  text-wrap: balance;
  margin: 0 0 6px; transition: color .2s;
}
.np-lead__byline {
  display: flex; gap: 10px;
  font-size: calc(.6rem * var(--np-font-scale)); color: var(--text3); margin-bottom: 6px; letter-spacing: .3px;
}
.np-lead__excerpt {
  font-size: calc(.68rem * var(--np-font-scale)); line-height: 1.82; color: #9a9280;
  text-align: justify;
  text-justify: inter-word;
  text-wrap: pretty;
  column-count: 2; column-gap: 12px;
  column-rule: 1px solid rgba(212,175,55,.12);
}

/* ── Horizontal rule ── */
.np-rule {
  height: 1px; flex-shrink: 0; margin: 7px 0;
  background: linear-gradient(90deg, transparent, rgba(212,175,55,.32), transparent);
}

/* ── Secondary stories — 2 columns ── */
.np-secondary-row {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 0; flex-shrink: 0;
  border: 1px solid rgba(212,175,55,.1);
}
.np-secondary {
  padding: 8px 10px; cursor: pointer; transition: background .15s;
  border-right: 1px solid rgba(212,175,55,.1);
}
.np-secondary:last-child { border-right: none; }
.np-secondary:hover { background: rgba(212,175,55,.05); }
.np-secondary__kicker {
  font-size: calc(.52rem * var(--np-font-scale)); letter-spacing: 0; text-transform: none;
  color: var(--gold); margin-bottom: 3px; font-weight: 700;
}
.np-secondary__headline {
  font-family: var(--np-font-head);
  font-size: calc(.78rem * var(--np-font-scale)); font-weight: 700; color: #cec4a4;
  line-height: 1.56; letter-spacing: 0; word-spacing: .02em;
  text-wrap: balance;
  margin: 0 0 4px;
}
.np-secondary__meta { font-size: calc(.56rem * var(--np-font-scale)); color: var(--text3); display: block; }

/* ── Adaptive Arabic headline rhythm ── */
.np-lead__headline.np-headline--strong { font-weight: 900; line-height: 1.45; font-size: calc(1.19rem * var(--np-font-scale)); }
.np-lead__headline.np-headline--balanced { font-weight: 800; line-height: 1.52; font-size: calc(1.15rem * var(--np-font-scale)); }
.np-lead__headline.np-headline--airy { font-weight: 700; line-height: 1.64; font-size: calc(1.07rem * var(--np-font-scale)); }

.np-secondary__headline.np-headline--strong { font-weight: 780; line-height: 1.48; font-size: calc(.82rem * var(--np-font-scale)); }
.np-secondary__headline.np-headline--balanced { font-weight: 700; line-height: 1.56; font-size: calc(.78rem * var(--np-font-scale)); }
.np-secondary__headline.np-headline--airy { font-weight: 620; line-height: 1.68; font-size: calc(.74rem * var(--np-font-scale)); }

/* ── Brief items ── */
.np-briefs {
  display: flex; flex-direction: column; gap: 0;
  flex: 1; overflow: hidden;
}
.np-brief {
  font-size: calc(.67rem * var(--np-font-scale)); line-height: 1.42;
  padding: 5px 4px;
  border-bottom: 1px dotted rgba(255,255,255,.07);
  cursor: pointer; transition: background .12s;
}
.np-brief:hover { background: rgba(212,175,55,.04); }
.np-brief:hover .np-brief__headline { color: var(--gold); }
.np-brief__headline { color: #b0a890; transition: color .15s; letter-spacing: 0; word-spacing: .02em; }
.np-brief__meta { color: var(--text3); font-size: calc(.58rem * var(--np-font-scale)); }

/* ── Page footer ── */
.np-page-footer {
  margin-top: auto; padding-top: 7px;
  border-top: 1px solid rgba(212,175,55,.16);
  text-align: center;
  font-size: calc(.56rem * var(--np-font-scale)); color: var(--text3); letter-spacing: 2px;
  flex-shrink: 0;
}

/* ── Reader focus layer ── */
.np-focus-layer {
  position: fixed;
  inset: 0;
  background: rgba(6,8,14,.62);
  backdrop-filter: blur(6px);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: np-fade-in .24s ease-out;
}
.np-focus-card {
  width: min(900px, 96vw);
  max-height: 86vh;
  overflow: auto;
  background: linear-gradient(155deg, rgba(10,12,18,.98), rgba(17,20,30,.98));
  border: 1px solid rgba(212,175,55,.26);
  border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08);
  padding: 26px 24px 20px;
  position: relative;
  animation: np-focus-rise .26s ease-out;
}
.np-focus-close {
  position: absolute;
  top: 8px;
  left: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(212,175,55,.3);
  background: rgba(255,255,255,.03);
  color: #f4deb2;
  cursor: pointer;
  font-size: 1.2rem;
}
.np-focus-kicker {
  display: inline-block;
  font-size: .65rem;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 10px;
  font-weight: 700;
}
.np-focus-title {
  font-family: var(--np-font-head);
  font-size: clamp(1.25rem, 2.2vw, 2.1rem);
  line-height: 1.5;
  letter-spacing: 0;
  word-spacing: .03em;
  text-wrap: balance;
  color: #f1e5c5;
  margin-bottom: 10px;
}
.np-focus-title.np-headline--strong { font-weight: 900; line-height: 1.42; }
.np-focus-title.np-headline--balanced { font-weight: 800; line-height: 1.5; }
.np-focus-title.np-headline--airy { font-weight: 700; line-height: 1.62; font-size: clamp(1.18rem, 1.95vw, 1.82rem); }
.np-focus-meta {
  display: flex;
  gap: 14px;
  font-size: .8rem;
  color: var(--text3);
  margin-bottom: 14px;
}
.np-focus-summary {
  font-family: var(--np-font-body);
  color: #d5ccb2;
  line-height: 1.95;
  font-size: .96rem;
  text-align: justify;
  text-justify: inter-word;
  text-wrap: pretty;
  white-space: pre-wrap;
}
.np-focus-actions { margin-top: 16px; }
.np-focus-btn {
  border: 1px solid rgba(212,175,55,.36);
  background: rgba(212,175,55,.1);
  color: #f7dfaa;
  border-radius: 8px;
  padding: 9px 16px;
  font-weight: 700;
  cursor: pointer;
}

@keyframes np-crease-pulse {
  0% { opacity: .18; }
  25% { opacity: .95; }
  100% { opacity: .42; }
}
@keyframes np-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes np-focus-rise {
  from { opacity: 0; transform: translateY(14px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Responsive refinements ── */
@media (max-width: 980px) {
  .np-nav-bar { padding: 8px 12px; }
  .np-nav__info { flex-wrap: wrap; justify-content: center; }
}
@media (max-width: 640px) {
  .np-arena { padding: 12px 0 30px; }
  .np-edge-hit { width: 24px; }
  .np-nav-bar {
    width: 100%;
    border-left: none;
    border-right: none;
    border-radius: 0;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .np-page { padding: 14px 14px 10px; }
  .np-lead__headline { font-size: 1.02rem; }
  .np-secondary__headline { font-size: .73rem; }
  .np-focus-card { padding: 18px 14px 14px; }
}

/* ══════════════════════════════════════════════════════
   PODCAST TAB  🎙️
══════════════════════════════════════════════════════ */
.pod-arena {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 16px;
  padding-bottom: 80px; /* space for player bar */
}
.pod-header {
  padding: 24px 0 20px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  margin-bottom: 24px;
}
.pod-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(139,92,246,.8);
  margin-bottom: 6px;
}
.pod-header__pulse {
  width: 7px; height: 7px; border-radius: 50%;
  background: #8b5cf6;
  box-shadow: 0 0 8px rgba(139,92,246,.7);
  animation: pod-pulse 2s ease infinite;
}
@keyframes pod-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .5; transform: scale(.75); }
}
.pod-header__title {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 4px;
}
.pod-header__sub {
  font-size: .84rem;
  color: rgba(255,255,255,.45);
}

/* Layout */
.pod-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 680px) {
  .pod-layout { grid-template-columns: 1fr; }
}

/* Sidebar */
.pod-sidebar {
  position: sticky;
  top: 80px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pod-sidebar__label {
  font-size: .67rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: rgba(255,255,255,.28);
  padding: 0 2px 8px;
}
.pod-source-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.07);
  background: rgba(255,255,255,.03);
  color: rgba(255,255,255,.6);
  cursor: pointer;
  text-align: right;
  transition: all .18s;
  position: relative;
}
.pod-source-btn:hover { background: rgba(139,92,246,.1); border-color: rgba(139,92,246,.28); color: #e9d5ff; }
.pod-source-btn--active {
  background: rgba(139,92,246,.14);
  border-color: rgba(139,92,246,.38);
  color: #f5f3ff;
}
.pod-source-btn__icon { font-size: 1.1rem; flex-shrink: 0; }
.pod-source-btn__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.pod-source-btn__name { font-size: .82rem; font-weight: 700; line-height: 1.2; }
.pod-source-btn__cat { font-size: .68rem; color: rgba(255,255,255,.32); }
.pod-source-btn--active .pod-source-btn__cat { color: rgba(167,139,250,.6); }
.pod-source-btn__ext { font-size: .9rem; color: rgba(255,255,255,.3); flex-shrink: 0; }

/* Feed meta */
.pod-feed-meta {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 12px;
  margin-bottom: 20px;
}
.pod-feed-meta__img {
  width: 68px; height: 68px; border-radius: 10px; object-fit: cover; flex-shrink: 0;
}
.pod-feed-meta__title {
  font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 4px;
}
.pod-feed-meta__desc {
  font-size: .8rem; color: rgba(255,255,255,.45); line-height: 1.5;
}

/* Featured Abu Talal card */
.pod-feature-card {
  margin-bottom: 22px;
  padding: 22px 24px;
  border-radius: 16px;
  border: 1px solid rgba(245,158,11,.18);
  background:
    radial-gradient(circle at top left, rgba(245,158,11,.16), transparent 34%),
    linear-gradient(135deg, rgba(30,20,8,.94), rgba(20,12,8,.9));
  box-shadow: 0 18px 40px rgba(0,0,0,.28);
}
.pod-feature-card--active {
  border-color: rgba(245,158,11,.4);
  box-shadow: 0 20px 50px rgba(0,0,0,.35), 0 0 0 1px rgba(245,158,11,.14);
}
.pod-feature-card__signal {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  margin-bottom: 12px;
  border-radius: 999px;
  background: rgba(245,158,11,.14);
  color: #fcd34d;
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.pod-feature-card__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
}
.pod-feature-card__eyebrow {
  display: block;
  margin-bottom: 6px;
  color: rgba(252,211,77,.82);
  font-size: .76rem;
  font-weight: 800;
}
.pod-feature-card__title {
  color: #fff7ed;
  font-size: 1.28rem;
  line-height: 1.25;
  margin-bottom: 8px;
}
.pod-feature-card__desc {
  color: rgba(255,244,214,.74);
  font-size: .88rem;
  line-height: 1.7;
  max-width: 760px;
}
.pod-feature-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  color: rgba(255,237,213,.5);
  font-size: .74rem;
}
.pod-feature-card__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.pod-feature-card__cta {
  padding: 11px 18px;
  border: 1px solid rgba(245,158,11,.34);
  border-radius: 999px;
  background: rgba(245,158,11,.16);
  color: #fef3c7;
  font-size: .84rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform .18s, background .18s, border-color .18s;
}
.pod-feature-card__cta:hover {
  transform: translateY(-1px);
  background: rgba(245,158,11,.26);
  border-color: rgba(245,158,11,.5);
}
.pod-feature-card__note {
  color: rgba(255,237,213,.42);
  font-size: .72rem;
}
@media (max-width: 760px) {
  .pod-feature-card__grid {
    grid-template-columns: 1fr;
  }
  .pod-feature-card__actions {
    align-items: stretch;
  }
  .pod-feature-card__cta {
    width: 100%;
  }
}

/* Episode list */
.pod-episodes { display: flex; flex-direction: column; gap: 6px; }
.pod-ep {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.07);
  background: rgba(255,255,255,.03);
  color: var(--text);
  cursor: pointer;
  text-align: right;
  transition: all .18s;
  position: relative;
}
.pod-ep:hover { background: rgba(139,92,246,.07); border-color: rgba(139,92,246,.22); }
.pod-ep--playing {
  background: rgba(139,92,246,.14);
  border-color: rgba(139,92,246,.4);
}
.pod-ep__play {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: rgba(139,92,246,.18);
  color: #c4b5fd;
}
.pod-ep__play svg { width: 14px; height: 14px; }
.pod-ep--playing .pod-ep__play { background: rgba(139,92,246,.35); }
.pod-ep__play-bars {
  display: flex; gap: 2.5px; align-items: flex-end; height: 14px;
}
.pod-ep__play-bars span {
  width: 3px; border-radius: 2px; background: #a78bfa;
  animation: pod-bars .9s ease infinite;
}
.pod-ep__play-bars span:nth-child(1) { height: 8px; animation-delay: 0s; }
.pod-ep__play-bars span:nth-child(2) { height: 14px; animation-delay: .15s; }
.pod-ep__play-bars span:nth-child(3) { height: 6px; animation-delay: .3s; }
@keyframes pod-bars {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(.4); }
}
.pod-ep__body { flex: 1; min-width: 0; }
.pod-ep__title { font-size: .875rem; font-weight: 700; color: var(--text); margin-bottom: 4px; line-height: 1.4; }
.pod-ep__meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: .72rem; color: rgba(255,255,255,.38); margin-bottom: 4px; }
.pod-ep__no-audio { color: rgba(239,68,68,.5); }
.pod-ep__desc { font-size: .78rem; color: rgba(255,255,255,.38); line-height: 1.5; margin: 0; }
.pod-ep__link {
  font-size: .88rem; color: rgba(139,92,246,.7); flex-shrink: 0;
  padding: 4px 6px; border-radius: 6px; background: rgba(139,92,246,.08);
  transition: background .15s;
}
.pod-ep__link:hover { background: rgba(139,92,246,.2); color: #c4b5fd; }

/* External card */
.pod-external-card {
  display: flex;
  gap: 20px;
  padding: 28px;
  border: 1px solid rgba(139,92,246,.25);
  border-radius: 14px;
  background: rgba(139,92,246,.07);
}
.pod-external-card__icon { font-size: 2.4rem; flex-shrink: 0; }
.pod-external-card__body { flex: 1; }
.pod-external-card__name { font-size: 1.2rem; font-weight: 800; color: var(--text); margin-bottom: 8px; }
.pod-external-card__desc { font-size: .86rem; color: rgba(255,255,255,.55); line-height: 1.6; margin-bottom: 16px; }
.pod-external-card__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 999px;
  background: rgba(139,92,246,.2);
  border: 1px solid rgba(139,92,246,.4);
  color: #c4b5fd;
  font-size: .84rem;
  font-weight: 700;
  transition: all .2s;
}
.pod-external-card__cta:hover { background: rgba(139,92,246,.35); color: #ede9fe; }
.pod-external-card__note { font-size: .75rem; color: rgba(255,255,255,.3); margin-top: 10px; }

/* Empty */
.pod-empty { padding: 40px; text-align: center; color: rgba(255,255,255,.3); font-size: .9rem; }

/* Persistent player bar */
.pod-player-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 20px;
  background: rgba(10, 8, 20, .97);
  border-top: 1px solid rgba(139,92,246,.25);
  backdrop-filter: blur(18px);
}
.pod-player-bar__info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 280px;
  flex-shrink: 0;
}
.pod-player-bar__icon { font-size: 1.2rem; flex-shrink: 0; }
.pod-player-bar__title {
  font-size: .8rem;
  font-weight: 600;
  color: rgba(255,255,255,.75);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pod-player-bar__audio {
  flex: 1;
  height: 36px;
  min-width: 0;
  accent-color: #8b5cf6;
}
.pod-player-bar__close {
  flex-shrink: 0;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: rgba(255,255,255,.08);
  border: none;
  color: rgba(255,255,255,.5);
  cursor: pointer;
  transition: background .15s;
}
.pod-player-bar__close:hover { background: rgba(239,68,68,.2); color: #fca5a5; }
@media (max-width: 560px) {
  .pod-player-bar { flex-wrap: wrap; }
  .pod-player-bar__info { max-width: 100%; }
  .pod-player-bar__audio { width: 100%; }
}

/* Ops signal panels */
.ops-signal-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, .95fr);
  gap: 16px;
  margin-bottom: 18px;
}
.signal-panel {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.08);
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.03));
  box-shadow: 0 18px 42px rgba(0,0,0,.22);
  padding: 18px;
}
.signal-panel--weather {
  background:
    radial-gradient(circle at top right, rgba(59,130,246,.18), transparent 32%),
    linear-gradient(180deg, rgba(11,20,40,.94), rgba(10,14,28,.95));
}
.signal-panel--markets {
  background:
    radial-gradient(circle at top left, rgba(245,158,11,.18), transparent 28%),
    linear-gradient(180deg, rgba(28,18,10,.94), rgba(18,14,12,.95));
}
.signal-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.signal-panel__eyebrow {
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: rgba(255,255,255,.42);
  margin-bottom: 6px;
}
.signal-panel__title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text);
}
.signal-panel__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.signal-panel__refresh {
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: var(--text);
  border-radius: 999px;
  padding: 8px 14px;
  font-size: .78rem;
  font-weight: 700;
  cursor: pointer;
}
.signal-panel__refresh:hover {
  background: rgba(255,255,255,.12);
}
.signal-panel__empty,
.signal-panel__mini-empty {
  border-radius: 14px;
  border: 1px dashed rgba(255,255,255,.12);
  background: rgba(255,255,255,.03);
  color: rgba(255,255,255,.68);
}
.signal-panel__empty {
  padding: 18px;
}
.signal-panel__empty strong {
  display: block;
  margin-bottom: 6px;
  color: var(--text);
}
.signal-panel__empty p {
  font-size: .84rem;
  line-height: 1.7;
}
.signal-panel__empty--error {
  border-color: rgba(239,68,68,.22);
  background: rgba(127,29,29,.16);
}
.signal-panel__mini-empty {
  padding: 14px;
  font-size: .78rem;
  text-align: center;
}
.signal-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  color: rgba(255,255,255,.45);
  font-size: .74rem;
}

.signal-city-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.signal-city-tab {
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.7);
  border-radius: 999px;
  padding: 7px 12px;
  font-size: .78rem;
  font-weight: 700;
  cursor: pointer;
}
.signal-city-tab--active {
  background: rgba(96,165,250,.18);
  border-color: rgba(96,165,250,.34);
  color: #dbeafe;
}

.weather-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, .9fr);
  gap: 14px;
  margin-bottom: 14px;
}
.weather-hero__main,
.weather-hero__stats,
.weather-card,
.markets-card {
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.04);
}
.weather-hero__main {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
}
.weather-hero__temp {
  font-size: 3rem;
  line-height: 1;
  font-weight: 900;
  color: #e0f2fe;
}
.weather-hero__summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: rgba(255,255,255,.72);
  font-size: .82rem;
}
.weather-hero__summary strong {
  color: var(--text);
  font-size: 1rem;
}
.weather-hero__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 14px;
}
.weather-chip {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.05);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.weather-chip span {
  font-size: .7rem;
  color: rgba(255,255,255,.48);
}
.weather-chip strong {
  font-size: .95rem;
  color: var(--text);
}
.weather-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.weather-card,
.markets-card {
  padding: 16px;
}
.weather-card__title,
.markets-card__title-row strong {
  font-size: .95rem;
  font-weight: 800;
  color: var(--text);
}
.weather-hour-list,
.weather-day-list,
.oil-benchmark-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.weather-hour-item,
.weather-day-item,
.oil-benchmark-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.04);
}
.weather-hour-item span,
.weather-day-item small,
.oil-benchmark-item small {
  color: rgba(255,255,255,.5);
  font-size: .72rem;
}
.weather-hour-item strong,
.weather-day-item strong,
.oil-benchmark-item strong,
.oil-benchmark-item__price span {
  color: var(--text);
}
.weather-hour-item {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.weather-hour-item small {
  text-align: left;
}
.weather-day-item__temps {
  display: flex;
  gap: 8px;
  font-weight: 700;
}

.markets-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.markets-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(255,255,255,.48);
  font-size: .74rem;
}
.markets-price-grid,
.gold-rate-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.markets-price-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.gold-rate-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.markets-price-block,
.gold-rate-tile {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.markets-price-block span,
.gold-rate-tile span,
.gold-rate-tile small {
  font-size: .72rem;
  color: rgba(255,255,255,.48);
}
.markets-price-block strong,
.gold-rate-tile strong {
  font-size: 1.08rem;
  color: var(--text);
}
.oil-benchmark-item__price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.oil-benchmark-item__move--positive { color: #86efac; }
.oil-benchmark-item__move--negative { color: #fca5a5; }
.oil-benchmark-item__move--neutral { color: rgba(255,255,255,.48); }

@media (max-width: 1080px) {
  .ops-signal-grid,
  .weather-hero,
  .weather-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .signal-panel__header,
  .signal-panel__footer,
  .markets-card__title-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .signal-panel__meta {
    justify-content: flex-start;
  }
  .weather-hour-item {
    grid-template-columns: 1fr auto;
  }
  .weather-hour-item small {
    grid-column: 1 / -1;
    text-align: right;
  }
  .gold-rate-grid,
  .markets-price-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .signal-panel { padding: 14px; }
  .weather-hero__main { flex-direction: column; align-items: flex-start; }
  .weather-hero__temp { font-size: 2.5rem; }
  .weather-hero__stats,
  .gold-rate-grid,
  .markets-price-grid {
    grid-template-columns: 1fr;
  }
}
`;

/* Inject CSS once */
if (typeof document !== 'undefined' && !document.getElementById('wp-styles')) {
  const el = document.createElement('style');
  el.id = 'wp-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
