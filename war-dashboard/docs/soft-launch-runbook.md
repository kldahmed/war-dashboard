# Soft Launch Runbook

هذا المستند يجهز war-dashboard لإطلاق ناعم آمن وقابل للمراجعة بدون إضافة features جديدة.

## Scope

- الحفاظ على `stored mode`
- الحفاظ على shape الحالي للـ feed
- الحفاظ على homepage behavior الحالي
- الحفاظ على observability endpoints الحالية
- عدم تغيير clustering أو ranking أو editorial logic

## Production Env Baseline

القيم المطلوبة في بيئة الإطلاق الناعم:

```env
ANTHROPIC_API_KEY=<server-side secret>
DATABASE_URL=<neon postgres connection string>
REACT_APP_FEED_MODE=stored
REACT_APP_FEED_FALLBACK=false
REACT_APP_PRODUCTION_VERIFY_MODE=true
FEED_MODE=stored
FEED_FALLBACK_ENABLED=false
RSS_REQUEST_TIMEOUT_MS=15000
INGESTION_DEFAULT_LIMIT=20
```

## Vercel Readiness

- `buildCommand`: `npm run build`
- `outputDirectory`: `build`
- API runtime: `nodejs18.x`
- CSP وsecurity headers معرفة داخل `vercel.json`
- تأكد أن Neon وAnthropic secrets موجودة في Vercel Project Settings

## Operational Endpoints

### `GET /api/health`

- الهدف: health عام + DB + mode flags
- المتوقع:
  - `status = ok`
  - `db = true`
  - `feed_mode = stored`
  - `feed_fallback_enabled = false`

### `GET /api/health/metrics-basic`

- الهدف: counters أساسية + آخر job + runtime metrics
- المتوقع:
  - `counters`
  - `last_job`
  - `runtime_metrics`

### `GET /api/health/streams`

- الهدف: stream registry + ranking + featured stream + status classification
- المتوقع:
  - `summary`
  - `featured_stream`
  - `streams[]`

### `GET /api/health/newsroom`

- الهدف: stale/failure/readiness visibility للمشغل
- المتوقع:
  - `alert_thresholds`
  - `stale_signals`
  - `recent_failures`
  - `source_failure_summary`
  - `readiness_summary`

### `GET /api/news/feed?limit=5`

- الهدف: التحقق من مسار stored feed الإنتاجي
- المتوقع:
  - `mode = stored`
  - `fallback_used = false`
  - top-level item keys تبقى:
    - `category`
    - `id`
    - `provenance`
    - `source`
    - `summary`
    - `time`
    - `title`
    - `urgency`

## Soft Launch Checklist

### Pre-launch

- تأكد أن Neon reachable و`DATABASE_URL` صحيحة.
- تأكد أن flags الإنتاج مضبوطة على `stored` وfallback معطل.
- تأكد أن آخر ingestion غير stale.
- تأكد أن `readiness_summary.level` ليس `blocked` إذا كان الإطلاق سيبدأ.

### Launch Gate

- افتح `/api/health` وتحقق من `status = ok`.
- افتح `/api/news/feed?limit=5` وتحقق من `mode = stored` و`fallback_used = false`.
- افتح `/api/health/streams` وتحقق من وجود `featured_stream` وstream classifications.
- افتح `/api/health/newsroom` وتحقق من stale/failure/readiness signals.
- افتح الصفحة الرئيسية وتأكد أن الواجهة تُعرض بدون compile/runtime regression.

### Post-launch Watch

- راقب `stale_signals.stale_ingestion`.
- راقب `recent_failures.failed_jobs_24h`.
- راقب `source_failure_summary.worst_sources`.
- راقب `summary.down_streams` و`summary.degraded_streams` في `/api/health/streams`.

### Rollback Trigger

- إذا فشل `/api/health` أو `db != true`.
- إذا رجع `/api/news/feed` مع `fallback_used = true` أو `mode != stored`.
- إذا أصبحت `readiness_summary.level = blocked` مع fresh failures أو stale ingestion.

## Notes

- تم تنظيف logs التشغيلية التاريخية من root قبل soft launch.
- بقيت ملفات التشغيل النشطة الحالية دون حذف لتفادي قطع session التشغيلية.