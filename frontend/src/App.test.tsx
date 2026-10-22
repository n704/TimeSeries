import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import App from "./App";
import { ApiError } from "./api/client";
import type { TrackingState } from "./types";

const apiMocks = vi.hoisted(() => ({
  createBacktest: vi.fn(),
  createForecast: vi.fn(),
  getHistory: vi.fn(),
  getTrackingState: vi.fn(),
  saveTrackingState: vi.fn(),
  screenIndex: vi.fn(),
  searchSecurities: vi.fn(),
}));

vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly requestId: string;
    readonly details?: Record<string, unknown>;

    constructor(payload: {
      code: string;
      message: string;
      retryable: boolean;
      request_id: string;
      details?: Record<string, unknown>;
    }) {
      super(payload.message);
      this.code = payload.code;
      this.retryable = payload.retryable;
      this.requestId = payload.request_id;
      this.details = payload.details;
    }
  },
  ...apiMocks,
}));

vi.mock("./components/PriceChart", () => ({
  PriceChart: () => <div>Price chart</div>,
}));

const security = {
  symbol: "RELIANCE.NS",
  name: "Reliance Industries Limited",
  exchange: "NSE",
  region: "India",
  currency: "INR",
  instrument_type: "common_stock" as const,
  timezone: "Asia/Kolkata",
};

const historyResponse = {
  security,
  prices: [{ date: "2026-10-16", adjusted_close: 1211.2 }],
  metadata: {
    provider: "Fixture",
    retrieved_at: "2026-10-17T00:00:00Z",
    last_market_date: "2026-10-16",
    is_stale: false,
  },
};

const forecastResponse = {
  forecast_id: "fc_test",
  security,
  history: historyResponse.prices,
  forecast: Array.from({ length: 20 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    p10: 1190 + index,
    p50: 1220 + index * 2,
    p90: 1260 + index * 3,
  })),
  analysis: {
    latest_close: 1211.2,
    forecast_end: 1258,
    forecast_change_percent: 3.86,
    historical_change_5d_percent: 1.2,
    historical_change_20d_percent: 2.4,
    recent_trend: "upward" as const,
    trend_alignment: "aligned" as const,
    evidence_level: "supportive" as const,
    historical_evaluation: {
      holdout_sessions: 7,
      context_end_date: "2026-10-07",
      metrics: {
        mean_absolute_error: 5,
        mean_absolute_percentage_error: 1.25,
        interval_coverage_percent: 85.71,
        directional_accuracy_percent: 71.43,
        end_direction_match: true,
      },
      correction: {
        method: "latest_holdout_ratio" as const,
        reference_date: "2026-10-16",
        signed_median_error_percent: 2,
        scale_factor: 1 / 1.02,
      },
    },
    sma_20: 1200,
    sma_50: 1180,
    trend: "upward" as const,
    final_interval_width_percent: 8.5,
    summary: "The median forecast ends above the latest adjusted close.",
  },
  metadata: {
    horizon_trading_days: 20,
    context_observations: 1240,
    context_start_date: "2021-10-18",
    context_end_date: "2026-10-16",
    provider: "Fixture",
    backend: "fixture",
    model: "fixture-timesfm",
    model_version: "test",
    preprocessing_version: "1",
    generated_at: "2026-10-17T00:00:00Z",
    is_data_stale: false,
  },
  disclaimer: "Not financial advice.",
};

const indexScreenResponse = {
  results: Array.from({ length: 5 }, (_, index) => ({
    rank: index + 1,
    security: {
      ...security,
      symbol: `STOCK${index + 1}.NS`,
      name: `Stock ${index + 1}`,
    },
    latest_close: 100,
    forecast_end: 110 - index,
    forecast_change_percent: 10 - index,
    forecast_end_date: "2026-11-16",
    final_p10: 95,
    final_p50: 110 - index,
    final_p90: 120,
    final_interval_width_percent: 22.73,
    is_data_stale: false,
    correction: {
      method: "latest_holdout_ratio" as const,
      reference_date: "2026-10-16",
      signed_median_error_percent: 2,
      scale_factor: 1 / 1.02,
    },
  })),
  metadata: {
    index_id: "nifty_midcap_select",
    index_name: "NIFTY MIDCAP SELECT",
    horizon_trading_days: 20,
    universe_size: 25,
    analyzed_count: 23,
    positive_count: 17,
    unavailable_symbols: ["BSE.NS", "TMPV.NS"],
    provider: "Fixture",
    backend: "fixture",
    model: "fixture-timesfm",
    model_version: "test",
    generated_at: "2026-10-18T00:00:00Z",
  },
  disclaimer: "Research screen only; not a buy, sell, or hold recommendation.",
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMocks.getHistory.mockResolvedValue(historyResponse);
    apiMocks.createForecast.mockResolvedValue(forecastResponse);
    apiMocks.getTrackingState.mockResolvedValue({
      watchlist: [],
      positions: [],
      updatedAt: null,
    });
    apiMocks.saveTrackingState.mockImplementation(
      async (state: TrackingState) => ({
        ...state,
        updatedAt: "2026-10-18T00:00:00Z",
      }),
    );
    apiMocks.screenIndex.mockResolvedValue(indexScreenResponse);
  });

  it("defaults to NIFTY 50 research and automatically forecasts Reliance", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /research all nifty 50 stocks/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /nifty 50 research/i }),
    ).toHaveAttribute("aria-selected", "true");
    const constituentPanel = screen.getByRole("region", {
      name: /predict a nifty 50 stock/i,
    });
    const stockSelect = within(constituentPanel).getByRole("combobox", {
      name: /nifty 50 stock/i,
    });
    expect(stockSelect).toHaveValue("RELIANCE.NS");
    expect(within(stockSelect).getAllByRole("option")).toHaveLength(50);
    await waitFor(() =>
      expect(apiMocks.getHistory).toHaveBeenCalledWith(
        "RELIANCE.NS",
        "1y",
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(apiMocks.createForecast).toHaveBeenCalledWith(
        "RELIANCE.NS",
        20,
        expect.any(AbortSignal),
      ),
    );
    expect(
      await screen.findByRole("heading", {
        name: /positive median, overlapping downside/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(constituentPanel).getByRole("button", {
        name: /predict selected stock/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a buy recommendation/i)).toBeInTheDocument();
  });

  it("predicts the NIFTY 50 stock chosen from the dropdown", async () => {
    const hdfcSecurity = {
      ...security,
      symbol: "HDFCBANK.NS",
      name: "HDFC Bank Ltd.",
    };
    render(<App />);
    await waitFor(() => expect(apiMocks.createForecast).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: /predict selected stock/i });
    apiMocks.getHistory.mockResolvedValue({
      ...historyResponse,
      security: hdfcSecurity,
    });
    apiMocks.createForecast.mockResolvedValue({
      ...forecastResponse,
      security: hdfcSecurity,
    });
    const constituentPanel = screen.getByRole("region", {
      name: /predict a nifty 50 stock/i,
    });

    fireEvent.change(
      within(constituentPanel).getByRole("combobox", {
        name: /nifty 50 stock/i,
      }),
      { target: { value: "HDFCBANK.NS" } },
    );
    fireEvent.click(
      within(constituentPanel).getByRole("button", {
        name: /predict selected stock/i,
      }),
    );

    await waitFor(() =>
      expect(apiMocks.getHistory).toHaveBeenLastCalledWith(
        "HDFCBANK.NS",
        "1y",
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(apiMocks.createForecast).toHaveBeenLastCalledWith(
        "HDFCBANK.NS",
        20,
        expect.any(AbortSignal),
      ),
    );
  });

  it("keeps stock search available in the explorer tab", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));

    expect(
      screen.getByRole("heading", {
        name: /see the trend.*understand the uncertainty/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/daily indian stock forecasts/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/reliance, infosys, or tcs/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not financial advice/i)).toBeInTheDocument();
  });

  it("flags an upward model forecast that opposes the recent decline", async () => {
    apiMocks.createForecast.mockResolvedValue({
      ...forecastResponse,
      analysis: {
        ...forecastResponse.analysis,
        historical_change_5d_percent: -3.5,
        recent_trend: "downward",
        trend_alignment: "opposed",
        evidence_level: "limited",
        historical_evaluation: {
          ...forecastResponse.analysis.historical_evaluation,
          metrics: {
            ...forecastResponse.analysis.historical_evaluation.metrics,
            directional_accuracy_percent: 42.86,
            end_direction_match: false,
          },
        },
        summary:
          "TimesFM's upward median opposes the latest five-session decline.",
      },
    });

    render(<App />);

    const evidence = await screen.findByRole("region", {
      name: /accuracy and recent-pattern check/i,
    });
    expect(within(evidence).getByText("limited evidence")).toBeInTheDocument();
    expect(within(evidence).getByText("-3.50%")).toBeInTheDocument();
    expect(within(evidence).getByText("42.86%")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: /model range conflicts with recent trend/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows the holdout correction applied to forecast values", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: /back-check-corrected timesfm forecast/i,
      }),
    ).toBeInTheDocument();
    const evidence = screen.getByRole("region", {
      name: /accuracy and recent-pattern check/i,
    });
    expect(
      within(evidence).getByText(/applied back-check adjustment/i),
    ).toBeInTheDocument();
    expect(within(evidence).getByText("-1.96%")).toBeInTheDocument();
    expect(
      within(evidence).getByText(
        /latest holdout median error was \+2\.00%.*multiplied by 0\.9804/i,
      ),
    ).toBeInTheDocument();
  });

  it("re-runs the selected NIFTY 50 prediction from the button", async () => {
    render(<App />);
    await waitFor(() => expect(apiMocks.createForecast).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: /predict selected stock/i });

    fireEvent.click(
      screen.getByRole("button", { name: /predict selected stock/i }),
    );

    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.createForecast).toHaveBeenCalledTimes(2));
  });

  it("ranks the selected index over 20 sessions", async () => {
    render(<App />);
    fireEvent.change(
      screen.getByRole("combobox", { name: /index universe/i }),
      { target: { value: "nifty_midcap_select" } },
    );
    const screenButton = screen.getByRole("button", {
      name: /find top 5 for 20 sessions/i,
    });
    await waitFor(() => expect(screenButton).toBeEnabled());

    fireEvent.click(screenButton);

    expect(apiMocks.screenIndex).toHaveBeenCalledWith(
      "nifty_midcap_select",
      expect.any(AbortSignal),
    );
    const heading = await screen.findByRole("heading", {
      name: /top positive nifty midcap select forecasts/i,
    });
    expect(
      screen.getByRole("table", {
        name: /highest positive timesfm median changes with adjustment status/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("+10.00%")).toBeInTheDocument();
    expect(screen.getByText(/analyzed 23 of 25 constituents/i)).toBeInTheDocument();
    expect(screen.getByText(/not analyzed: BSE.NS, TMPV.NS/i)).toBeInTheDocument();
    expect(screen.getByText(/not a buy, sell, or hold recommendation/i)).toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("shows available and required trading days when forecast history is insufficient", async () => {
    const security = {
      symbol: "TRIVENIPT.NS",
      name: "Triveni Turbine Limited",
      exchange: "NSE",
      region: "India",
      currency: "INR",
      instrument_type: "common_stock" as const,
      timezone: "Asia/Kolkata",
    };
    apiMocks.searchSecurities.mockResolvedValue([security]);
    apiMocks.getHistory.mockResolvedValue({
      security,
      prices: [{ date: "2026-10-16", adjusted_close: 810 }],
      metadata: {
        provider: "Fixture",
        retrieved_at: "2026-10-17T00:00:00Z",
        last_market_date: "2026-10-16",
        is_stale: false,
      },
    });
    apiMocks.createForecast.mockRejectedValue(
      new ApiError({
        code: "INSUFFICIENT_HISTORY",
        message: "TRIVENIPT.NS does not have enough valid daily history.",
        retryable: false,
        request_id: "req_insufficient",
        details: {
          available_observations: 74,
          required_observations: 120,
        },
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));
    fireEvent.change(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
      { target: { value: "Triveni" } },
    );
    await waitFor(() => expect(apiMocks.searchSecurities).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: /Triveni Turbine Limited/i }),
    );
    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", { name: /generate forecast/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Available history: 74 trading days. Minimum required for prediction: 120 trading days.",
    );
  });

  it("back-checks the latest seven sessions against known prices", async () => {
    apiMocks.searchSecurities.mockResolvedValue([security]);
    apiMocks.createBacktest.mockResolvedValue({
      backtest_id: "bt_test",
      security,
      points: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 8).padStart(2, "0")}`,
        actual: 1200 + index,
        p10: 1180 + index,
        p50: 1195 + index,
        p90: 1220 + index,
      })),
      metrics: {
        mean_absolute_error: 5,
        mean_absolute_percentage_error: 1.25,
        interval_coverage_percent: 85.71,
        directional_accuracy_percent: 71.43,
        end_direction_match: true,
      },
      metadata: {
        holdout_sessions: 7,
        context_observations: 1240,
        context_start_date: "2021-10-18",
        context_end_date: "2026-10-07",
        provider: "Fixture",
        backend: "fixture",
        model: "fixture-timesfm",
        model_version: "test",
        preprocessing_version: "1",
        generated_at: "2026-10-17T00:00:00Z",
        is_data_stale: false,
      },
      disclaimer: "Historical holdout only.",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));
    fireEvent.change(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
      { target: { value: "Reliance" } },
    );
    await waitFor(() => expect(apiMocks.searchSecurities).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: /Reliance Industries Limited/i }),
    );
    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", {
        name: /back-check last 7 sessions/i,
      }),
    );

    const heading = await screen.findByRole("heading", {
      name: /historical back-check/i,
    });
    expect(apiMocks.createBacktest).toHaveBeenCalledWith(
      "RELIANCE.NS",
      expect.any(AbortSignal),
    );
    expect(screen.getByText("1.25%")).toBeInTheDocument();
    expect(screen.getByText("85.71%")).toBeInTheDocument();
    expect(screen.getByText("71.43%")).toBeInTheDocument();
    expect(
      screen.getByRole("table", {
        name: /predicted and actual prices for the holdout sessions/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("keeps back-check results visible for an older backend response", async () => {
    apiMocks.createBacktest.mockResolvedValue({
      backtest_id: "bt_legacy",
      security,
      points: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 8).padStart(2, "0")}`,
        actual: 1200 + index,
        p10: 1180 + index,
        p50: 1195 + index,
        p90: 1220 + index,
      })),
      metrics: {
        mean_absolute_error: 5,
        mean_absolute_percentage_error: 1.25,
        interval_coverage_percent: 85.71,
      },
      metadata: {
        holdout_sessions: 7,
        context_observations: 1240,
        context_start_date: "2021-10-18",
        context_end_date: "2026-10-07",
        provider: "Fixture",
        backend: "fixture",
        model: "fixture-timesfm",
        model_version: "test",
        preprocessing_version: "1",
        generated_at: "2026-10-17T00:00:00Z",
        is_data_stale: false,
      },
      disclaimer: "Historical holdout only.",
    });

    render(<App />);
    await screen.findByRole("heading", { name: /timesfm forecast/i });

    fireEvent.click(
      await screen.findByRole("button", {
        name: /back-check last 7 sessions/i,
      }),
    );

    expect(
      await screen.findByRole("heading", { name: /historical back-check/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/directional metrics are unavailable.*older api version/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", {
        name: /predicted and actual prices for the holdout sessions/i,
      }),
    ).toBeInTheDocument();
  });

  it("saves the selected stock to a local watchlist", async () => {
    render(<App />);

    const watchlistButton = await screen.findByRole("button", {
      name: /add to watchlist/i,
    });
    fireEvent.click(watchlistButton);
    fireEvent.click(
      screen.getByRole("tab", { name: /watchlist & portfolio/i }),
    );

    expect(
      screen.getByRole("heading", { name: /stocks to revisit/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("RELIANCE.NS · NSE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open research/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.saveTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({
          watchlist: [
            expect.objectContaining({
              security: expect.objectContaining({ symbol: "RELIANCE.NS" }),
            }),
          ],
        }),
      ),
    );
  });

  it("adds a paper portfolio position and calculates its value", async () => {
    render(<App />);

    await screen.findByRole("heading", { name: /timesfm forecast/i });
    fireEvent.click(
      await screen.findByRole("button", { name: /add holding/i }),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /quantity/i }), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /average price/i }),
      { target: { value: "1000" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));
    fireEvent.click(
      screen.getByRole("tab", { name: /watchlist & portfolio/i }),
    );

    expect(
      screen.getByRole("heading", { name: /position overview/i }),
    ).toBeInTheDocument();
    const portfolioTable = screen.getByRole("table", {
      name: /locally saved paper portfolio positions/i,
    });
    expect(portfolioTable).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/2,422\.40/)).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/1,232\.00/)).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/2,464\.00/)).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/2026-11-07/)).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: /portfolio forecast horizon/i }),
      { target: { value: "20" } },
    );
    expect(within(portfolioTable).getByText(/1,258\.00/)).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/2,516\.00/)).toBeInTheDocument();
    apiMocks.createForecast.mockResolvedValue({
      ...forecastResponse,
      forecast: Array.from({ length: 60 }, (_, index) => ({
        date: `2027-01-${String(index + 1).padStart(2, "0")}`,
        p10: 1190 + index,
        p50: 1220 + index * 2,
        p90: 1260 + index * 3,
      })),
      metadata: {
        ...forecastResponse.metadata,
        horizon_trading_days: 60,
      },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: /portfolio forecast horizon/i }),
      { target: { value: "60" } },
    );
    await waitFor(() =>
      expect(apiMocks.createForecast).toHaveBeenLastCalledWith(
        "RELIANCE.NS",
        60,
        expect.any(AbortSignal),
      ),
    );
    expect(
      await within(portfolioTable).findByText(/1,338\.00/),
    ).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/2,676\.00/)).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.saveTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: [
            expect.objectContaining({
              quantity: 2,
              outlooks: expect.objectContaining({
                7: expect.objectContaining({ p50: 1232 }),
                20: expect.objectContaining({ p50: 1258 }),
                60: expect.objectContaining({ p50: 1338 }),
              }),
            }),
          ],
        }),
      ),
    );
  });

  it("automatically forecasts portfolio positions missing the selected horizon", async () => {
    const trackedSecurity = {
      ...security,
      symbol: "FEDFINA.NS",
      name: "Fedbank Financial Services Limited",
    };
    window.localStorage.setItem(
      "timeseries.tracking.v1",
      JSON.stringify({
        watchlist: [],
        positions: [
          {
            security: trackedSecurity,
            quantity: 5,
            averagePrice: 1000,
            latestClose: 1211.2,
            lastMarketDate: "2026-10-16",
            updatedAt: "2026-10-18T00:00:00Z",
          },
        ],
      }),
    );
    apiMocks.createForecast.mockImplementation(
      async (symbol: string) => ({
        ...forecastResponse,
        security: {
          ...security,
          symbol,
          name:
            symbol === trackedSecurity.symbol
              ? trackedSecurity.name
              : security.name,
        },
      }),
    );

    render(<App />);
    fireEvent.click(
      screen.getByRole("tab", { name: /watchlist & portfolio/i }),
    );

    await waitFor(() =>
      expect(apiMocks.createForecast).toHaveBeenCalledWith(
        "FEDFINA.NS",
        20,
        expect.any(AbortSignal),
      ),
    );
    const portfolioTable = screen.getByRole("table", {
      name: /locally saved paper portfolio positions/i,
    });
    expect(
      await within(portfolioTable).findByText(/1,232\.00/),
    ).toBeInTheDocument();
    expect(within(portfolioTable).getByText(/6,160\.00/)).toBeInTheDocument();
    expect(
      within(portfolioTable).queryByText(/run a 20-session forecast/i),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.saveTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: [
            expect.objectContaining({
              security: expect.objectContaining({ symbol: "FEDFINA.NS" }),
            }),
          ],
        }),
      ),
    );
    expect(window.localStorage.getItem("timeseries.tracking.v1")).toBeNull();
  });

  it("loads saved watchlist data from the tracking API", async () => {
    apiMocks.getTrackingState.mockResolvedValue({
      watchlist: [
        {
          security,
          latestClose: 1211.2,
          lastMarketDate: "2026-10-16",
          addedAt: "2026-10-18T00:00:00Z",
        },
      ],
      positions: [],
      updatedAt: "2026-10-18T00:00:00Z",
    });

    render(<App />);
    fireEvent.click(
      screen.getByRole("tab", { name: /watchlist & portfolio/i }),
    );

    expect(await screen.findByText("RELIANCE.NS · NSE")).toBeInTheDocument();
    expect(apiMocks.getTrackingState).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
  });

  it("does not overwrite tracking state when the database cannot be loaded", async () => {
    apiMocks.getTrackingState.mockRejectedValue(
      new Error("Tracking API unavailable"),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /database tracking data could not be loaded/i,
    );
    expect(
      await screen.findByRole("button", { name: /add to watchlist/i }),
    ).toBeDisabled();
    expect(apiMocks.saveTrackingState).not.toHaveBeenCalled();
  });
});
