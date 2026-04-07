'use strict';

const { query } = require('../../lib/db');

const SITE_CUSTOMIZATION_KEY = 'site_editor';

const DEFAULT_SITE_CUSTOMIZATION = {
  copy: {
    brand_name: 'WorldPulse',
    brand_tagline: 'أخبار عالمية مباشرة',
    footer_tagline: 'منصة أخبار عربية مباشرة',
    guest_upgrade_title: 'الوضع المجاني: أخبار محدودة',
    guest_upgrade_body: 'يمكنك الآن قراءة 12 خبر فقط. للتغطية الكاملة والتحديثات المستمرة قم بالتسجيل.',
    guest_upgrade_benefit_1: 'مزايا التسجيل:',
    guest_upgrade_benefit_2: 'وصول كامل لكل الأخبار بدون حد',
    guest_upgrade_benefit_3: 'التحديث التلقائي الفوري للمحتوى',
    guest_upgrade_benefit_4: 'فتح لوحة البث المباشر والتحرير الذكي والخريطة',
    guest_upgrade_benefit_5: 'صلاحيات تشغيل أدوات غرفة الأخبار (حسب الدور)',
    ops_title: 'غرفة الأخبار التشغيلية',
    ops_autopilot_title: 'غرفة القرار الذاتي',
    ops_autopilot_label: 'Decision Autopilot',
    stream_discovery_title: 'قمع اعتماد القنوات',
    stream_discovery_body: 'المسار الجديد يسمح بفحص JSON مرشحين عبر API أو سكربت محلي، ويعيد الموافق عليهم فقط إذا كانوا عربًا ويعملون من داخل الموقع مباشرة.',
    signals_repair_idle: 'إصلاح الإشارات الآن',
    signals_repair_busy: 'جاري الإصلاح…',
    news_empty_state: 'لا توجد أخبار مطابقة',
    load_more_news: 'تحميل المزيد',
    editorial_title: 'لوحة التحرير الذكية',
    editorial_subtitle: 'ترتيب القصص حسب الزخم · التحقق · التعارض · تنوع المصادر',
    live_title: 'مركز قنوات الأخبار',
    live_subtitle: 'تغطية استخباراتية على مدار الساعة',
    map_title: 'خريطة الأحداث',
    map_subtitle: 'رصد جيوسياسي على مدار الساعة',
    podcast_title: 'البودكاست العربي',
    podcast_subtitle: 'تحليلات وأخبار وتقارير صوتية من أبرز المصادر العربية والدولية',
    login_label: 'Sign in',
    signup_label: 'Sign up',
    logout_label: 'Logout',
  },
  tabs: {
    news: 'الأخبار',
    editorial: 'التحرير الذكي',
    live: 'البث المباشر',
    podcast: 'البودكاست',
    ops: 'غرفة الأخبار',
    map: 'خريطة الأحداث',
  },
  categories: {
    all: 'الكل',
    breaking: 'عاجل',
    war: 'حرب',
    politics: 'سياسة',
    economy: 'اقتصاد',
    gulf: 'gulf',
    iran: 'إيران',
    israel: 'إسرائيل',
    usa: 'أمريكا',
    world: 'العالم',
    energy: 'طاقة',
    analysis: 'تحليل',
    technology: 'تقنية',
  },
  layout: {
    header_tabs_order: ['news', 'editorial', 'live', 'podcast', 'ops', 'map'],
    news_sections_order: ['filters', 'freshness', 'sitrep', 'mission', 'guest', 'newspaper', 'load_more', 'empty'],
    ops_sections_order: ['signals', 'alerts', 'kpi', 'autopilot', 'candidate_inventory', 'health_grid'],
  },
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch.slice() : base.slice();
  }

  if (!isPlainObject(base)) {
    return patch === undefined ? base : patch;
  }

  const output = { ...base };
  const source = isPlainObject(patch) ? patch : {};
  for (const key of Object.keys(source)) {
    output[key] = key in base ? mergeDeep(base[key], source[key]) : source[key];
  }
  return output;
}

function sanitizeStringMap(value, fallback) {
  if (!isPlainObject(value)) return { ...fallback };
  return Object.keys(fallback).reduce((acc, key) => {
    const next = value[key];
    acc[key] = typeof next === 'string' && next.trim() ? next : fallback[key];
    return acc;
  }, {});
}

function sanitizeOrder(value, allowed, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  const clean = value.filter((item) => allowed.includes(item));
  const seen = new Set();
  const deduped = clean.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  for (const item of allowed) {
    if (!seen.has(item)) deduped.push(item);
  }
  return deduped.length ? deduped : fallback.slice();
}

function sanitizeCustomization(payload) {
  const merged = mergeDeep(DEFAULT_SITE_CUSTOMIZATION, payload);
  return {
    copy: sanitizeStringMap(merged.copy, DEFAULT_SITE_CUSTOMIZATION.copy),
    tabs: sanitizeStringMap(merged.tabs, DEFAULT_SITE_CUSTOMIZATION.tabs),
    categories: sanitizeStringMap(merged.categories, DEFAULT_SITE_CUSTOMIZATION.categories),
    layout: {
      header_tabs_order: sanitizeOrder(
        merged.layout?.header_tabs_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.header_tabs_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.header_tabs_order,
      ),
      news_sections_order: sanitizeOrder(
        merged.layout?.news_sections_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.news_sections_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.news_sections_order,
      ),
      ops_sections_order: sanitizeOrder(
        merged.layout?.ops_sections_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.ops_sections_order,
        DEFAULT_SITE_CUSTOMIZATION.layout.ops_sections_order,
      ),
    },
  };
}

async function getSiteCustomization() {
  const result = await query(
    `SELECT payload_json, updated_at, updated_by_user_id
     FROM site_customizations
     WHERE key = $1
     LIMIT 1`,
    [SITE_CUSTOMIZATION_KEY],
  );

  const row = result.rows[0];
  const customization = sanitizeCustomization(row?.payload_json || {});
  return {
    customization,
    updated_at: row?.updated_at || null,
    updated_by_user_id: row?.updated_by_user_id || null,
  };
}

async function saveSiteCustomization(payload, userId) {
  const customization = sanitizeCustomization(payload);
  const result = await query(
    `INSERT INTO site_customizations (key, payload_json, updated_by_user_id)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key)
     DO UPDATE SET payload_json = EXCLUDED.payload_json,
                   updated_by_user_id = EXCLUDED.updated_by_user_id,
                   updated_at = NOW()
     RETURNING payload_json, updated_at, updated_by_user_id`,
    [SITE_CUSTOMIZATION_KEY, JSON.stringify(customization), userId || null],
  );

  return {
    customization: sanitizeCustomization(result.rows[0]?.payload_json || {}),
    updated_at: result.rows[0]?.updated_at || null,
    updated_by_user_id: result.rows[0]?.updated_by_user_id || null,
  };
}

module.exports = {
  DEFAULT_SITE_CUSTOMIZATION,
  getSiteCustomization,
  saveSiteCustomization,
};