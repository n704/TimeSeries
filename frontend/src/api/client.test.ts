import { afterEach, describe, expect, it, vi } from "vitest";

import { getTrackingState, saveTrackingState } from "./client";
import type { TrackingState } from "../types";

const apiState = {
  watchlist: [],
  positions: [
    {
      security: {
        symbol: "RELIANCE.NS",
        name: "Reliance Industries Limited",
        exchange: "NSE",
        region: "India",
        currency: "INR",
        instrument_type: "common_stock",
      },
      quantity: 2,
      average_price: 1000,
      latest_close: 1211.2,
      last_market_date: "2026-10-22",
      outlooks: {
        "5": {
          date: "2026-10-29",
          p10: 1190,
          p50: 1230,
          p90: 1270,
          generated_at: "2026-10-22T12:30:00Z",
        },
      },
      price_history: [
        {
          date: "2026-10-21",
          adjusted_close: 1200,
          captured_at: "2026-10-21T12:30:00Z",
        },
        {
          date: "2026-10-22",
          adjusted_close: 1211.2,
          captured_at: "2026-10-22T12:30:00Z",
        },
      ],
      updated_at: "2026-10-22T12:30:00Z",
    },
  ],
  updated_at: "2026-10-22T12:30:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tracking API mapping", () => {
  it("maps server-managed price history to frontend fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(apiState), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await getTrackingState(new AbortController().signal);

    expect(result.positions[0].priceHistory).toEqual([
      {
        date: "2026-10-21",
        adjustedClose: 1200,
        capturedAt: "2026-10-21T12:30:00Z",
      },
      {
        date: "2026-10-22",
        adjustedClose: 1211.2,
        capturedAt: "2026-10-22T12:30:00Z",
      },
    ]);
    expect(result.positions[0].outlooks?.[5]).toEqual({
      date: "2026-10-29",
      p10: 1190,
      p50: 1230,
      p90: 1270,
      generatedAt: "2026-10-22T12:30:00Z",
    });
  });

  it("does not send server-managed price history in tracking updates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(apiState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const state: TrackingState = {
      watchlist: [],
      positions: [
        {
          security: {
            symbol: "RELIANCE.NS",
            name: "Reliance Industries Limited",
            exchange: "NSE",
            region: "India",
            currency: "INR",
            instrument_type: "common_stock",
          },
          quantity: 2,
          averagePrice: 1000,
          latestClose: 1211.2,
          lastMarketDate: "2026-10-22",
          outlooks: {
            5: {
              date: "2026-10-29",
              p10: 1190,
              p50: 1230,
              p90: 1270,
              generatedAt: "2026-10-22T12:30:00Z",
            },
          },
          priceHistory: [
            {
              date: "2026-10-22",
              adjustedClose: 1211.2,
              capturedAt: "2026-10-22T12:30:00Z",
            },
          ],
          updatedAt: "2026-10-22T12:30:00Z",
        },
      ],
    };

    await saveTrackingState(state);

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(request?.body));
    expect(body.positions[0]).not.toHaveProperty("price_history");
    expect(body.positions[0]).not.toHaveProperty("priceHistory");
    expect(body.positions[0].outlooks["5"]).toEqual({
      date: "2026-10-29",
      p10: 1190,
      p50: 1230,
      p90: 1270,
      generated_at: "2026-10-22T12:30:00Z",
    });
  });
});
