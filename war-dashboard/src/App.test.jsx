import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import Dashboard from "./App";

jest.mock("react-leaflet", () => {
  const ReactLib = require("react");
  return {
    MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
    TileLayer: () => <div data-testid="tile-layer" />,
    CircleMarker: ({ children }) => <div data-testid="circle-marker">{children}</div>,
    Popup: ({ children }) => <div data-testid="popup">{children}</div>,
    useMap: () => ({ setView: jest.fn() }),
  };
});

jest.mock("react-pageflip", () => {
  const ReactLib = require("react");
  return ReactLib.forwardRef(function MockFlipBook({ children }, ref) {
    if (ref) {
      if (typeof ref === "function") {
        ref({ pageFlip: () => ({ flipNext: jest.fn(), flipPrev: jest.fn() }) });
      } else {
        ref.current = { pageFlip: () => ({ flipNext: jest.fn(), flipPrev: jest.fn() }) };
      }
    }
    return <div data-testid="flipbook">{children}</div>;
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createJsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

describe("Dashboard", () => {
  const originalEnv = process.env;
  let container;
  let root;
  let consoleErrorSpy;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      REACT_APP_FEED_MODE: "stored",
      REACT_APP_FEED_FALLBACK: "false",
      REACT_APP_PRODUCTION_VERIFY_MODE: "true",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushPromises();
    });
    document.body.removeChild(container);
    consoleErrorSpy.mockRestore();
    jest.resetAllMocks();
    process.env = originalEnv;
  });

  test("renders stored news without crashing on malformed item fields", async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).startsWith("/api/news/feed")) {
        return Promise.resolve(createJsonResponse({
          mode: "stored",
          fallback_used: false,
          item_count: 2,
          freshness: {
            latest_item_at: "2026-04-03T07:00:00.000Z",
            oldest_item_at: "2026-04-03T06:00:00.000Z",
            data_age_sec: 120,
            last_ingestion_at: "2026-04-03T07:05:00.000Z",
          },
          correlation_id: "cid-news",
          error_reason: null,
          items: [
            {
              id: "1",
              title: "خبر تشغيل فعلي",
              summary: "هذا الخبر يجب أن يظهر في الصفحة الرئيسية.",
              category: "general",
              urgency: "medium",
              time: "2026-04-03T07:00:00.000Z",
              source: { id: "2", name: "Al Jazeera Arabic", domain: "aljazeera.net", trust_score: "78.00" },
              provenance: {
                raw_item_id: "1",
                source_feed_id: "2",
                source_url: "https://example.com/story-1",
                fetched_at: "2026-04-03T07:01:00.000Z",
                published_at_source: "2026-04-03T07:00:00.000Z",
                normalized_hash: "hash-1",
                cluster: { id: "c1", corroboration_count: 2, source_diversity: 2, contradiction_flag: false },
                verification: { state: "partially_corroborated", confidence_score: 0.4 },
                editorial: { decision: "merge", priority: "elevated", rank_score: 0.4 },
              },
            },
            {
              id: "2",
              title: "عنصر غير مثالي",
              summary: "",
              category: "general",
              urgency: "unexpected",
              time: "not-a-date",
              source: { id: "3", name: "US Department of State", domain: "state.gov", trust_score: "88.00" },
              provenance: {
                raw_item_id: "2",
                source_feed_id: "3",
                source_url: "https://example.com/story-2",
                fetched_at: "2026-04-03T07:02:00.000Z",
                published_at_source: "not-a-date",
                normalized_hash: "hash-2",
              },
            },
          ],
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      root.render(<Dashboard />);
      await flushPromises();
      await flushPromises();
    });

    expect(container.textContent).toContain("خبر تشغيل فعلي");
    expect(container.textContent).toContain("عنصر غير مثالي");
    expect(container.textContent).not.toContain("تعذّر تحميل الأخبار");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("The string did not match the expected pattern"));
  });

  test("renders degraded live mode when stream snapshot has no embeddable video", async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).startsWith("/api/news/feed")) {
        return Promise.resolve(createJsonResponse({
          mode: "stored",
          fallback_used: false,
          item_count: 1,
          freshness: {
            latest_item_at: "2026-04-03T07:00:00.000Z",
            oldest_item_at: "2026-04-03T07:00:00.000Z",
            data_age_sec: 120,
            last_ingestion_at: "2026-04-03T07:05:00.000Z",
          },
          correlation_id: "cid-news",
          error_reason: null,
          items: [{
            id: "1",
            title: "خبر تشغيل فعلي",
            summary: "هذا الخبر يجب أن يظهر في الصفحة الرئيسية.",
            category: "general",
            urgency: "medium",
            time: "2026-04-03T07:00:00.000Z",
            source: { id: "2", name: "Al Jazeera Arabic", domain: "aljazeera.net", trust_score: "78.00" },
            provenance: { raw_item_id: "1", source_feed_id: "2", source_url: "https://example.com/story-1", fetched_at: "2026-04-03T07:01:00.000Z", published_at_source: "2026-04-03T07:00:00.000Z", normalized_hash: "hash-1" },
          }],
        }));
      }

      if (String(url) === "/api/health/streams") {
        return Promise.resolve(createJsonResponse({
          summary: {
            active_streams: 1,
            playable_streams: 0,
            external_only_streams: 1,
            down_streams: 1,
            featured_stream_id: "10",
          },
          streams: [{
            stream_id: "10",
            source: {
              id: "10",
              name: "BBC World",
              domain: "bbc.co.uk",
              category: "general",
              region: "global",
              language: "en",
              trust_score: 84,
              status: "active",
            },
            stream: {
              feed_type: "registry",
              endpoint: "https://www.bbc.com/arabic",
              polling_interval_sec: 300,
              status: "active",
              uptime_status: "degraded",
              detail_status: "external_only",
              health_reason: "external_watch_only",
              last_success_at: "2026-04-03T06:30:00.000Z",
              last_error_at: null,
              last_error_message: null,
              embed_url: null,
              official_page_url: "https://www.bbc.com/arabic",
              external_watch_url: "https://www.bbc.com/arabic",
              playback_mode: "external_only",
              external_only: true,
              score: 0.44,
              featured: true,
            },
            story_link: {
              normalized_id: "85",
              cluster_id: "22",
              title: "Story linked to stream health",
              published_at: "2026-04-03T06:10:00.000Z",
              relevance_score: 0.86,
              corroboration_count: 5,
            },
            stats: {
              story_count: 20,
              linked_cluster_count: 11,
              latest_story_seen_at: "2026-04-03T06:10:00.000Z",
              story_relevance_score: 0.86,
            },
          }],
        }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      root.render(<Dashboard />);
      await flushPromises();
      await flushPromises();
    });

    const liveTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("البث المباشر"));

    await act(async () => {
      liveTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    const streamCard = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("BBC World"));

    await act(async () => {
      streamCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(streamCard).toBeTruthy();
    expect(container.textContent).toContain("BBC World");
  });
});