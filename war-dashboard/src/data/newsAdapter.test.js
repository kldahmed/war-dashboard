import { resolveFeedMode, fetchNewsItems, __testing } from './newsAdapter';

describe('resolveFeedMode', () => {
  test('uses stored mode when explicitly set', () => {
    const out = resolveFeedMode({ mode: 'stored', fallbackEnabled: true });
    expect(out).toEqual({ mode: 'stored', fallbackEnabled: true });
  });

  test('falls back to legacy for invalid mode', () => {
    const out = resolveFeedMode({ mode: 'invalid', fallbackEnabled: false });
    expect(out).toEqual({ mode: 'legacy', fallbackEnabled: false });
  });
});

describe('mapStoredItem', () => {
  test('returns ui-safe shape', () => {
    const item = __testing.mapStoredItem({
      title: 'Title',
      summary: 'Summary',
      category: 'gulf',
      urgency: 'high',
      time: '2026-01-01T00:00:00.000Z',
      source: { id: 1 },
      provenance: { raw_item_id: 5 },
    });

    expect(item.title).toBe('Title');
    expect(item.summary).toBe('Summary');
    expect(item.category).toBe('gulf');
    expect(item.urgency).toBe('high');
    expect(item.source).toEqual({ id: 1 });
    expect(item.provenance).toEqual({ raw_item_id: 5 });
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
      json: async () => ({ items: [{ title: 'A', summary: 'B', category: 'gulf', urgency: 'medium', time: 'x' }] }),
    });

    const out = await fetchNewsItems('all');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/news/feed');
    expect(out).toHaveLength(1);
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
