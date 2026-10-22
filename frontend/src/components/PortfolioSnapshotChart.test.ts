import type { PortfolioPosition } from "../types";
import {
  buildPortfolioSnapshotChartData,
  getPortfolioSnapshotChartDomain,
} from "./PortfolioSnapshotChart";

describe("buildPortfolioSnapshotChartData", () => {
  it("orders saved closes and calculates each position value", () => {
    const position: PortfolioPosition = {
      security: {
        symbol: "RELIANCE.NS",
        name: "Reliance Industries Limited",
        exchange: "NSE",
        region: "India",
        currency: "INR",
        instrument_type: "common_stock",
      },
      quantity: 2,
      averagePrice: 100,
      latestClose: 110,
      lastMarketDate: "2026-10-22",
      priceHistory: [
        {
          date: "2026-10-22",
          adjustedClose: 110,
          capturedAt: "2026-10-22T10:30:00Z",
        },
        {
          date: "2026-10-21",
          adjustedClose: 100,
          capturedAt: "2026-10-21T10:30:00Z",
        },
      ],
      updatedAt: "2026-10-22T10:30:00Z",
    };

    expect(buildPortfolioSnapshotChartData(position)).toEqual([
      {
        date: "2026-10-21",
        adjustedClose: 100,
        positionValue: 200,
      },
      {
        date: "2026-10-22",
        adjustedClose: 110,
        positionValue: 220,
      },
    ]);
  });

  it("gives a visually useful domain to a flat series with float noise", () => {
    const position: PortfolioPosition = {
      security: {
        symbol: "FEDFINA.NS",
        name: "Fedbank Financial Services Limited",
        exchange: "NSE",
        region: "India",
        currency: "INR",
        instrument_type: "common_stock",
      },
      quantity: 1,
      averagePrice: 156.3,
      latestClose: 156.3000030517578,
      lastMarketDate: "2026-10-22",
      priceHistory: [
        {
          date: "2026-10-22",
          adjustedClose: 156.3000030517578,
          capturedAt: "2026-10-22T10:30:00Z",
        },
      ],
      updatedAt: "2026-10-22T10:30:00Z",
    };

    const [minimum, maximum] = getPortfolioSnapshotChartDomain(position);

    expect(minimum).toBeLessThan(150);
    expect(maximum).toBeGreaterThan(160);
  });
});
