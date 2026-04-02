# داشبورد أخبار المنطقة ⚔️

داشبورد إخباري مباشر يغطي أخبار إيران، الخليج، أمريكا، وإسرائيل — مدعوم بـ Claude AI مع دعم البث المباشر من يوتيوب.

---

## متطلبات التشغيل

- Node.js 18 أو أحدث ([nodejs.org](https://nodejs.org))
- مفتاح Anthropic API من [console.anthropic.com](https://console.anthropic.com)

---

## الإعداد

```bash
# 1. تثبيت كل الاعتماديات
npm install

# 2. نسخ ملف المتغيرات البيئية
cp .env.example .env.local

# 3. افتح .env.local وضع مفتاح API الحقيقي:
#    ANTHROPIC_API_KEY=sk-ant-...
```

---

## تشغيل بيئة التطوير المحلية

```bash
npm run dev
```

يشغّل هذا الأمر في وقت واحد:
- **React dev server** على `http://localhost:3000` (الواجهة)
- **API proxy server** على `http://localhost:3001` (يخدم `/api/claude`)

أي طلب من الـ frontend إلى `/api/claude` يتوجّه تلقائياً إلى الـ API server عبر الـ `proxy` في `package.json`.

> **أمان:** مفتاح API لا يُرسل أبداً للمتصفح — كل استدعاءات Anthropic تتم من `server.js` / `api/claude.js` على الخادم فقط.

---

## Sprint 1 — Operating Backend (تم التنفيذ)

تمت إضافة backend مرحلي (modular monolith) داخل المشروع مع تخزين دائم وفصل ingestion عن العرض، مع الحفاظ على المسار القديم كـ fallback.

### البنية الجديدة المضافة

```
backend/
	app/
	modules/
		sources/
		ingestion/
		normalization/
		news-feed/
		observability/
	jobs/
	db/
		migrations/
		seeds/
	config/
	lib/
```

### تجهيز Postgres محلياً

1. شغّل PostgreSQL محلياً (أو container).
2. انسخ `.env.example` إلى `.env.local` وحدّث `DATABASE_URL`.

### أوامر Sprint 1

```bash
# تثبيت الاعتماديات
npm install

# تطبيق migrations
npm run migrate:up

# إدخال seed أولي للمصادر وRSS feeds
npm run seed

# تشغيل السيرفر والواجهة
npm run dev

# تشغيل ingestion يدوي
npm run ingest:rss

# فحوصات smoke أساسية
npm run smoke:backend

# فحص تكاملي end-to-end لسبرنت 1
npm run check:integration:sprint1
```

### Hardening Review Checklist (Sprint 1)

نفّذ هذا التسلسل قبل إغلاق Sprint 1:

```bash
# 1) rollback ثم up للتأكد من up/down
npm run migrate:down
npm run migrate:up

# 2) seed
npm run seed

# 3) backend smoke checks
npm run smoke:backend

# 4) تشغيل السيرفر
npm run server

# 5) تحقق endpoints
curl -s http://localhost:3001/api/health | jq .
curl -s http://localhost:3001/api/health/metrics-basic | jq .
curl -s 'http://localhost:3001/api/news/feed?limit=10' | jq .

# 6) تشغيل ingestion يدوي
curl -s -X POST http://localhost:3001/api/ingestion/jobs/run | jq .

# 7) فحص تكاملي تلقائي
npm run check:integration:sprint1
```

### Feature Flags (Legacy vs Stored)

- `REACT_APP_FEED_MODE=legacy|stored`
- `REACT_APP_FEED_FALLBACK=true|false`
- `FEED_MODE=legacy|stored` (للتوافق التشغيلي)
- `FEED_FALLBACK_ENABLED=true|false`

الوضع الافتراضي الآمن: `legacy`.

### Endpoints الجديدة في Sprint 1

- `GET /api/sources`
- `POST /api/sources`
- `POST /api/source-feeds`
- `POST /api/ingestion/jobs/run`
- `GET /api/ingestion/jobs/:id`
- `GET /api/news/feed`
- `GET /api/health`
- `GET /api/health/metrics-basic`

## Wave 1 — Production Readiness Runbook

هدف هذا الـ runbook هو التأكد أن المسار الإنتاجي يعمل من stored feed وليس fallback.

لإطلاق ناعم محدث ومختصر راجع أيضًا:

- [docs/soft-launch-runbook.md](docs/soft-launch-runbook.md)

### 1) تحقق من Health على Vercel

افتح:

- `/api/health`

يجب أن ترى:

- `status: "ok"`
- `db: true`
- `runtime: "vercel"`
- `feed_mode`
- `feed_fallback_enabled`
- `verify_mode`
- `correlation_id`

### 2) تحقق من Metrics على Vercel

افتح:

- `/api/health/metrics-basic`

يجب أن ترى:

- `counters.raw_items`
- `counters.normalized_items`
- `last_job`
- `runtime: "vercel"`
- `feed_mode`
- `verify_mode`
- `correlation_id`

### 3) تحقق من Feed Stored Path

افتح:

- `/api/news/feed?limit=10`

يجب أن ترى:

- `mode: "stored"`
- `fallback_used: false`
- `freshness`
- `item_count`
- `correlation_id`
- `error_reason` (null عند النجاح)

### 4) تحقق واجهة المستخدم

في تبويب الأخبار ستظهر badges مباشرة:

- `Stored Production` عند نجاح stored feed.
- `Legacy Fallback` إذا تم fallback.
- `Verify Mode` عند تفعيل التحقق الصارم.

وتظهر metadata إضافية:

- عمر البيانات
- آخر ingestion
- source mode

### 5) سيناريو Verify Strict

في Vercel Environment Variables:

- `REACT_APP_FEED_MODE=stored`
- `REACT_APP_PRODUCTION_VERIFY_MODE=true`
- `REACT_APP_FEED_FALLBACK=true`

في هذا الوضع سيتم تعطيل fallback الصامت تلقائياً عند فشل stored path، ويظهر فشل واضح في الواجهة بدلاً من التبديل الخفي.

### 6) فحص آلي سريع لـ Wave 1

شغّل:

```bash
WAVE1_BASE_URL=https://your-app.vercel.app npm run check:vercel:wave1
```

النتيجة المتوقعة:

- `wave1 vercel check passed`

### ما تم بناؤه فعلياً

- تخزين دائم للمصادر والأخبار الخام والمطبّعة.
- RSS ingestion worker بسيط مع job tracking.
- Normalization v1 يجهز البيانات لـ dedup لاحقاً.
- Structured logging + correlation ids + latency basics.
- Data adapter في الواجهة للتبديل بين stored feed وlegacy.
- الإبقاء على `POST /api/claude` بدون حذف.

### خارج نطاق Sprint 1 (غير مبني بعد)

- dedup semantic كامل.
- clustering كامل.
- verification engine حقيقي.
- decision engine تحريري كامل.
- stream monitoring احترافي.

---

## النشر على Vercel (3 خطوات)

### الخطوة 1 — رفع المشروع على GitHub
1. أنشئ repository جديد على [github.com](https://github.com) باسم `war-dashboard`
2. ارفع كل الملفات بنفس البنية الحالية

### الخطوة 2 — ربط Vercel
1. افتح [vercel.com](https://vercel.com) → Sign Up with GitHub
2. اضغط **Add New Project** → اختر `war-dashboard` → **Deploy**
3. اضبط **Root Directory** على `war-dashboard`

### الخطوة 3 — إضافة متغيرات البيئة
في Vercel → Project → Settings → **Environment Variables**:

| الاسم | القيمة |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (مفتاحك الحقيقي) |
| `DATABASE_URL` | اتصال PostgreSQL الإنتاجي |
| `REACT_APP_FEED_MODE` | `stored` |
| `REACT_APP_FEED_FALLBACK` | `true` (أو `false` أثناء التحقق الصارم) |
| `REACT_APP_PRODUCTION_VERIFY_MODE` | `true` لتعطيل fallback الصامت أثناء التحقق |

في الإنتاج على Vercel، ملف `api/claude.js` يعمل تلقائياً كـ serverless function.

---

## بنية المشروع

```
war-dashboard/
├── api/
│   └── claude.js        ← Vercel serverless function (مفتاح API هنا فقط)
├── src/
│   ├── App.jsx          ← الواجهة الرئيسية
│   └── index.js
├── public/
│   └── index.html
├── server.js            ← سيرفر Express للتطوير المحلي فقط
├── .env.example         ← نموذج المتغيرات (آمن للـ Git)
├── .env.local           ← مفاتيحك الحقيقية (لا تُرفع على Git)
├── package.json
└── vercel.json          ← Security Headers + Vercel config
```

---

## تنبيه مهم

البيانات الإخبارية مُولَّدة بواسطة Claude AI وليست أخباراً رسمية موثّقة. للأغراض الإخبارية والمعلوماتية فقط.


---

## 🚀 رفع على Vercel (3 خطوات فقط)

### الخطوة 1 — إنشاء حساب GitHub ورفع المشروع
1. افتح [github.com](https://github.com) وسجّل حساب جديد
2. اضغط **New repository** → اسمه `war-dashboard` → **Create**
3. في صفحة الـ repo اضغط **uploading an existing file**
4. ارفع **جميع** ملفات هذا المجلد (كما هي بنفس البنية)
5. اضغط **Commit changes**

### الخطوة 2 — ربط Vercel بـ GitHub
1. افتح [vercel.com](https://vercel.com) → **Sign Up with GitHub**
2. اضغط **Add New Project**
3. اختر `war-dashboard` من القائمة
4. اضغط **Deploy** — لا تغيّر أي إعداد

### الخطوة 3 — انتظر دقيقة ✅
Vercel سيعطيك رابطاً مثل:
```
https://war-dashboard-xxxx.vercel.app
```
شاركه مع أي أحد في العالم!

---

## 💻 تشغيل محلي
```bash
npm install
npm start
```
ثم افتح المتصفح على `http://localhost:3000`

---

## ⚙️ المتطلبات
- Node.js 16+ ([nodejs.org](https://nodejs.org))
- حساب Vercel مجاني

## 📦 البنية
```
war-dashboard/
├── public/
│   └── index.html
├── src/
│   ├── index.js
│   └── App.jsx        ← الداشبورد الرئيسي
├── package.json
├── vercel.json
└── README.md
```
