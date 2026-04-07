# Product Roadmap 30/60/90 (Execution Mode)

## Goal
Build a strong, modern, and scalable news platform with clear conversion from guest readers to registered users, plus measurable quality and retention.

## North-Star KPIs
- Guest to signup conversion rate
- Daily active readers
- News freshness within 24h
- Duplicate ratio in last 24h
- Returning readers (7d)
- Registered users growth

## Days 1-30: Foundation and Conversion
- Keep guest mode with limited news and strong registration CTA
- Stabilize auth flows: signin/signup/forgot/reset
- Enforce admin and superadmin permissions for operational endpoints
- Add KPI reporting command for weekly product review
- Define baseline targets for freshness, duplicate ratio, and translation coverage

### Exit Criteria (Day 30)
- Auth flows fully operational in local and deployed environments
- Guest experience converts to registration with clear benefits
- KPI report available from one command

## Days 31-60: Product Depth and Retention
- Personalized feed sections (topics and regions)
- Saved stories and follow-topic features
- Notification strategy (digest + breaking alerts)
- Editorial story timeline and provenance UI improvements
- Improve translation coverage and reduce unavailable status

### Exit Criteria (Day 60)
- Returning reader behavior improves week-over-week
- Personalized experiences active for registered users
- Story quality/trust indicators visible and stable

## Days 61-90: Scale and Growth
- SEO-first article pages and entity/topic pages
- Acquisition loop: newsletter, social snippets, and editorial campaigns
- Revenue readiness: configurable paywall and premium lanes
- A/B testing for conversion points (CTA, paywall timing, hero blocks)
- Performance hardening (Core Web Vitals and backend latency)

### Exit Criteria (Day 90)
- Measurable traffic growth and conversion lift
- Durable retention loop with recurring returning readers
- Platform-level readiness for monetization and scale

## Weekly Operating Rhythm
- Monday: KPI review and sprint priorities
- Wednesday: product experiment check
- Friday: quality report (freshness, duplicates, translation, reliability)

## Command Checklist
- `npm run check:product:kpi`
- `npm run smoke:backend`
- `npm run build`
