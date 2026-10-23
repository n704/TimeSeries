import type { PortfolioPosition } from "../types";
import {
  buildPortfolioSnapshotChartData,
  getPortfolioSnapshotChartDomain,
} from "./PortfolioSnapshotChart";

function position(
  symbol: string,
  quantity: number,
  averagePrice: number,
  history: Array<{ date: string; adjustedClose: number }>,
): PortfolioPosition {
  const latest = history.at(-1);
  return {
    security: {
      symbol,
      name: symbol,
      exchange: "NSE",
      region: "India",
      currency: "INR",
      instrument_type: "common_stock",
    },
    quantity,
    averagePrice,
    latestClose: latest?.adjustedClose ?? averagePrice,
    lastMarketDate: latest?.date ?? "2026-10-20",
    priceHistory: history.map((snapshot) => ({
      ...snapshot,
      capturedAt: `${snapshot.date}T10:30:00Z`,
    })),
    updatedAt: "2026-10-23T10:30:00Z",
  };
}

describe("buildPortfolioSnapshotChartData", () => {
  it("builds one complete portfolio series and carries saved closes forward", () => {
    const positions = [
      position("ALPHA.NS", 2, 90, [
        { date: "2026-10-21", adjustedClose: 100 },
        { date: "2026-10-22", adjustedClose: 110 },
      ]),
      position("BETA.NS", 3, 45, [
        { date: "2026-10-22", adjustedClose: 50 },
        { date: "2026-10-23", adjustedClose: 55 },
      ]),
    ];

    expect(buildPortfolioSnapshotChartData(positions)).toEqual([
      {
        date: "2026-10-22",
        marketValue: 370,
        updatedPositions: 2,
      },
      {
        date: "2026-10-23",
        marketValue: 385,
        updatedPositions: 1,
      },
    ]);
  });

  it("waits until every current position has a saved close", () => {
    const positions = [
      position("ALPHA.NS", 2, 90, [
        { date: "2026-10-22", adjustedClose: 110 },
      ]),
      position("BETA.NS", 3, 45, []),
    ];

    expect(buildPortfolioSnapshotChartData(positions)).toEqual([]);
  });

  it("gives a visually useful domain to a flat total with float noise", () => {
    const positions = [
      position("FEDFINA.NS", 1, 156.3, [
        {
          date: "2026-10-22",
          adjustedClose: 156.3000030517578,
        },
      ]),
    ];

    const [minimum, maximum] =
      getPortfolioSnapshotChartDomain(positions);

    expect(minimum).toBeLessThan(150);
    expect(maximum).toBeGreaterThan(160);
  });
});
