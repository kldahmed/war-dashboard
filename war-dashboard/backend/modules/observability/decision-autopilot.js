'use strict';

const { query } = require('../../lib/db');
const { getSignalsHealth } = require('../signals/service');
const { getNewsroomStatusSnapshot } = require('./newsroom-status');
const { getProductKpiSnapshot } = require('./product-kpi');

function parsePercent(value) {
  const num = Number(String(value || '0').replace('%', '').trim());
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function toBand(score) {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'elevated';
  return 'stable';
}

function modeFromScore(score) {
  if (score >= 80) return 'human_gate';
  if (score >= 55) return 'hybrid';
  return 'autonomous';
}

async function getDecisionAutopilotSnapshot() {
  const [productKpi, signals, newsroom, ingestion] = await Promise.all([
    getProductKpiSnapshot(),
    getSignalsHealth(),
    getNewsroomStatusSnapshot(),
    query(`SELECT
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
      COUNT(*) FILTER (WHERE status = 'succeeded' AND created_at > NOW() - INTERVAL '24 hours')::int AS succeeded_24h
    FROM processing_jobs
    WHERE job_type IN ('run_ingestion', 'news_ingestion')`),
  ]);

  const freshness = parsePercent(productKpi?.content_kpi_24h?.freshness_ratio_24h);
  const duplicate = parsePercent(productKpi?.content_kpi_24h?.duplicate_ratio_24h);
  const stalenessSeconds = Number(newsroom?.feed_staleness?.seconds_since_last_feed || 0);
  const signalsStatus = String(signals?.overall_status || 'red').toLowerCase();
  const failedJobs = Number(ingestion.rows?.[0]?.failed_24h || 0);
  const succeededJobs = Number(ingestion.rows?.[0]?.succeeded_24h || 0);

  const freshnessPenalty = Math.max(0, 35 - (freshness * 0.35));
  const duplicatePenalty = Math.min(28, duplicate * 0.55);
  const stalenessPenalty = Math.min(25, stalenessSeconds / 420);
  const signalsPenalty = signalsStatus === 'green' ? 0 : signalsStatus === 'yellow' ? 14 : 28;
  const failurePenalty = Math.min(18, failedJobs * 4);

  const riskScore = Math.round(Math.max(0, Math.min(100,
    freshnessPenalty + duplicatePenalty + stalenessPenalty + signalsPenalty + failurePenalty
  )));

  const reliability = Math.max(0, Math.min(100, 100 - riskScore));
  const riskBand = toBand(riskScore);
  const mode = modeFromScore(riskScore);

  const primaryAction = riskScore >= 75
    ? {
        code: 'LOCK_HIGH_IMPACT_AUTOMATION',
        title: 'إيقاف الأتمتة عالية المخاطر مؤقتًا',
        reason: 'مزيج التدهور الحالي يرفع احتمال القرارات الخاطئة. يتطلب موافقة بشرية قبل التنفيذ.',
        expected_impact: 'تقليل مخاطر الإنذار الكاذب والقرارات غير الدقيقة خلال الساعة القادمة.',
      }
    : riskScore >= 50
      ? {
          code: 'PRIORITIZE_FRESHNESS_RECOVERY',
          title: 'استعادة الحداثة أولًا قبل التوسع',
          reason: 'مستوى المخاطر متوسط إلى مرتفع ويحتاج موازنة بين السرعة والدقة.',
          expected_impact: 'تحسين جودة القرار مع الحفاظ على سرعة التحديث الأساسية.',
        }
      : {
          code: 'EXPAND_AUTONOMOUS_EXECUTION',
          title: 'توسيع التنفيذ الذاتي المتحكم به',
          reason: 'المخاطر ضمن النطاق المستقر ويمكن رفع الأتمتة بشكل محسوب.',
          expected_impact: 'رفع سرعة الاستجابة مع الحفاظ على دقة جيدة.',
        };

  const counterfactuals = [
    {
      strategy: 'AGGRESSIVE_AUTOPILOT',
      title: 'تفعيل هجومي كامل',
      expected_gain: '+24% سرعة استجابة',
      opportunity_loss_if_skipped: 'فقدان سرعة التغطية في الأحداث المتسارعة',
      risk_tradeoff: riskScore >= 60 ? 'مرتفع' : 'متوسط',
    },
    {
      strategy: 'BALANCED_HYBRID',
      title: 'هجين متوازن',
      expected_gain: '+12% جودة قرار',
      opportunity_loss_if_skipped: 'زيادة الإنذارات الضوضائية تحت الضغط',
      risk_tradeoff: 'متوسط',
    },
    {
      strategy: 'HUMAN_ONLY',
      title: 'اعتماد بشري كامل',
      expected_gain: '-18% أخطاء حرجة',
      opportunity_loss_if_skipped: 'بطء ملحوظ في الدورة التشغيلية',
      risk_tradeoff: 'منخفض',
    },
  ];

  const policyVerdicts = [
    {
      policy: 'AUTO_INGESTION',
      status: riskScore >= 80 ? 'hold' : 'active',
      note: riskScore >= 80 ? 'يتطلب موافقة بشرية قبل التشغيل.' : 'تشغيل تلقائي مسموح ضمن الحدود.',
    },
    {
      policy: 'ALERT_ESCALATION',
      status: signalsStatus === 'red' ? 'priority' : 'normal',
      note: signalsStatus === 'red' ? 'رفع أولوية التنبيه إلى مستوى أحمر.' : 'المسار الطبيعي مفعل.',
    },
    {
      policy: 'SOURCE_QUARANTINE',
      status: duplicate >= 20 ? 'active' : 'standby',
      note: duplicate >= 20 ? 'تفعيل عزل المصادر الضوضائية تلقائيا.' : 'جاهز للتفعيل عند الحاجة.',
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    autopilot: {
      mode,
      risk_score: riskScore,
      reliability_score: reliability,
      risk_band: riskBand,
      primary_action: primaryAction,
      counterfactuals,
      policy_verdicts: policyVerdicts,
      telemetry: {
        freshness_ratio_24h: productKpi?.content_kpi_24h?.freshness_ratio_24h || '0.00%',
        duplicate_ratio_24h: productKpi?.content_kpi_24h?.duplicate_ratio_24h || '0.00%',
        feed_staleness_seconds: stalenessSeconds,
        signals_status: signalsStatus,
        failed_ingestion_jobs_24h: failedJobs,
        succeeded_ingestion_jobs_24h: succeededJobs,
      },
    },
  };
}

module.exports = {
  getDecisionAutopilotSnapshot,
};
