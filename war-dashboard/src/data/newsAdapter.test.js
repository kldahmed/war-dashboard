import { resolveFeedMode, fetchNewsItems, fetchNewsFeedEnvelope, __testing } from './newsAdapter';

describe('resolveFeedMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('uses stored mode when explicitly set', () => {
    const out = resolveFeedMode({ mode: 'stored', fallbackEnabled: true });
    expect(out).toEqual({ mode: 'stored', fallbackEnabled: true, verifyProductionMode: false });
  });

  test('falls back to legacy for invalid mode', () => {
    const out = resolveFeedMode({ mode: 'invalid', fallbackEnabled: false });
    expect(out).toEqual({ mode: 'legacy', fallbackEnabled: false, verifyProductionMode: false });
  });

  test('verify mode disables silent fallback when mode=stored', () => {
    process.env.REACT_APP_PRODUCTION_VERIFY_MODE = 'true';
    const out = resolveFeedMode({ mode: 'stored', fallbackEnabled: true });
    expect(out).toEqual({ mode: 'stored', fallbackEnabled: false, verifyProductionMode: true });
  });
});

describe('mapStoredItem', () => {
  test('returns ui-safe shape', () => {
    const item = __testing.mapStoredItem({
      id: '123',
      title: 'Title',
      summary: 'Summary',
      category: 'gulf',
      urgency: 'high',
      time: '2026-01-01T00:00:00.000Z',
      source: { id: 1 },
      provenance: { raw_item_id: 5 },
    });

    expect(item.id).toBe('123');
    expect(item.title).toBe('Title');
    expect(item.summary).toBe('Summary');
    expect(item.category).toBe('gulf');
    expect(item.urgency).toBe('high');
    expect(item.source).toMatchObject({ id: 1, domain: null, name: null, trust_score: null });
    expect(item.provenance).toMatchObject({ raw_item_id: 5 });
  });

  test('normalizes production-shaped stored items defensively', () => {
    const item = __testing.mapStoredItem({
      title: '  Stored title  ',
      summary: '',
      category: 'general',
      urgency: 'unexpected',
      time: 'not-a-date',
      source: { domain: 'state.gov', trust_score: '88.00' },
      provenance: {
        source_url: ' https://example.com/story ',
        cluster: { corroboration_count: '3', contradiction_flag: 0 },
        verification: { state: '', confidence_score: '0.4' },
        editorial: { decision: '', priority: '', rank_score: '0.8' },
      },
    });

    expect(item.title).toBe('Stored title');
    expect(item.summary).toBe('...');
    expect(item.category).toBe('usa');
    expect(item.urgency).toBe('medium');
    expect(item.time).toBe('منذ قليل');
    expect(item.provenance).toMatchObject({
      source_url: 'https://example.com/story',
      cluster: { corroboration_count: 3, contradiction_flag: false },
      verification: { state: 'single_source', confidence_score: 0.4 },
      editorial: { decision: 'publish', priority: 'normal', rank_score: 0.8 },
    });
  });
});

describe('fetchNewsItems mode and fallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetAllMocks();
  });

  test('uses stored endpoint when mode=stored', async () => {
    process.env.REACT_APP_FEED_MODE = 'stored';
    process.env.REACT_APP_FEED_FALLBACK = 'false';

    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ items: [{ title: 'A', summary: 'B', category: 'gulf', urgency: 'medium', time: 'x' }] }),
    });

    const out = await fetchNewsItems('all');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/news/feed');
    expect(out).toHaveLength(1);
  });

  test('returns metadata envelope with fallback flag when stored fails', async () => {
    process.env.REACT_APP_FEED_MODE = 'stored';
    process.env.REACT_APP_FEED_FALLBACK = 'true';

    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { get: () => 'cid-123' },
        json: async () => ({ error: 'stored failed', mode: 'stored', item_count: 0, error_reason: 'stored failed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Legacy', summary: 'ok', category: 'all', urgency: 'medium', time: 'now' }] }),
      });

    const out = await fetchNewsFeedEnvelope('all');
    expect(out.metadata.fallback_used).toBe(true);
    expect(out.metadata.mode).toBe('legacy');
    expect(out.metadata.error_reason).toContain('stored failed');
  });

  test('throws in verify mode without silent fallback', async () => {
    process.env.REACT_APP_FEED_MODE = 'stored';
    process.env.REACT_APP_FEED_FALLBACK = 'true';
    process.env.REACT_APP_PRODUCTION_VERIFY_MODE = 'true';

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => 'cid-999' },
      json: async () => ({
        error: 'stored failed',
        mode: 'stored',
        fallback_used: false,
        item_count: 0,
        freshness: { latest_item_at: null, oldest_item_at: null, data_age_sec: null, last_ingestion_at: null },
        correlation_id: 'cid-999',
        error_reason: 'db_down',
      }),
    });

    await expect(fetchNewsFeedEnvelope('all')).rejects.toMatchObject({
      feedMeta: expect.objectContaining({
        mode: 'stored',
        fallback_used: false,
        correlation_id: 'cid-999',
        error_reason: 'db_down',
      }),
    });
  });

  test('falls back to legacy when stored fails and fallback is enabled', async () => {
    process.env.REACT_APP_FEED_MODE = 'stored';
    process.env.REACT_APP_FEED_FALLBACK = 'true';

    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'stored failed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ title: 'Legacy', summary: 'ok', category: 'all', urgency: 'medium', time: 'now' }] }),
      });

    const out = await fetchNewsItems('all');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/news/feed');
    expect(global.fetch.mock.calls[1][0]).toBe('/api/claude');
    expect(out[0].title).toBe('Legacy');
  });
});
