# داشبورد أخبار المنطقة ⚔️

داشبورد إخباري مباشر يغطي أخبار إيران، الخليج، أمريكا، وإسرائيل — مدعوم بالذكاء الاصطناعي.

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
