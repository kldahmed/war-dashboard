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

## النشر على Vercel (3 خطوات)

### الخطوة 1 — رفع المشروع على GitHub
1. أنشئ repository جديد على [github.com](https://github.com) باسم `war-dashboard`
2. ارفع كل الملفات بنفس البنية الحالية

### الخطوة 2 — ربط Vercel
1. افتح [vercel.com](https://vercel.com) → Sign Up with GitHub
2. اضغط **Add New Project** → اختر `war-dashboard` → **Deploy**

### الخطوة 3 — إضافة متغيرات البيئة
في Vercel → Project → Settings → **Environment Variables**:

| الاسم | القيمة |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (مفتاحك الحقيقي) |

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
