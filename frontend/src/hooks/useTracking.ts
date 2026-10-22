import { useEffect, useRef, useState } from "react";

import { getTrackingState, saveTrackingState } from "../api/client";
import type {
  PortfolioOutlook,
  PortfolioOutlooks,
  PortfolioPosition,
  PortfolioPriceSnapshot,
  Security,
  TrackingState,
  WatchlistItem,
} from "../types";

const STORAGE_KEY = "timeseries.tracking.v1";
const MAX_TRACKED_SECURITIES = 20;
const SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;

interface TrackingStore extends TrackingState {
  error: string | null;
  ready: boolean;
}

function isSecurity(value: unknown): value is Security {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Security>;
  return (
    typeof candidate.symbol === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.exchange === "string" &&
    typeof candidate.region === "string" &&
    typeof candidate.currency === "string" &&
    candidate.instrument_type === "common_stock"
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isWatchlistItem(value: unknown): value is WatchlistItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WatchlistItem>;
  return (
    isSecurity(candidate.security) &&
    isPositiveNumber(candidate.latestClose) &&
    typeof candidate.lastMarketDate === "string" &&
    typeof candidate.addedAt === "string"
  );
}

function isPortfolioPosition(value: unknown): value is PortfolioPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PortfolioPosition> & {
    outlook?: PortfolioOutlook;
  };
  return (
    isSecurity(candidate.security) &&
    isPositiveNumber(candidate.quantity) &&
    isPositiveNumber(candidate.averagePrice) &&
    isPositiveNumber(candidate.latestClose) &&
    typeof candidate.lastMarketDate === "string" &&
    (candidate.outlooks === undefined ||
      isPortfolioOutlooks(candidate.outlooks)) &&
    (candidate.priceHistory === undefined ||
      (Array.isArray(candidate.priceHistory) &&
        candidate.priceHistory.every(isPortfolioPriceSnapshot))) &&
    (candidate.outlook === undefined || isPortfolioOutlook(candidate.outlook)) &&
    typeof candidate.updatedAt === "string"
  );
}

function isPortfolioPriceSnapshot(
  value: unknown,
): value is PortfolioPriceSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PortfolioPriceSnapshot>;
  return (
    typeof candidate.date === "string" &&
    isPositiveNumber(candidate.adjustedClose) &&
    typeof candidate.capturedAt === "string"
  );
}

function isPortfolioOutlook(value: unknown): value is PortfolioOutlook {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PortfolioOutlook>;
  return (
    typeof candidate.date === "string" &&
    isPositiveNumber(candidate.p10) &&
    isPositiveNumber(candidate.p50) &&
    isPositiveNumber(candidate.p90) &&
    candidate.p10 <= candidate.p50 &&
    candidate.p50 <= candidate.p90 &&
    typeof candidate.generatedAt === "string"
  );
}

function isPortfolioOutlooks(value: unknown): value is PortfolioOutlooks {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).every(
    ([key, outlook]) =>
      (key === "7" || key === "20" || key === "60") &&
      isPortfolioOutlook(outlook),
  );
}

function loadTrackingStore(): TrackingStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { watchlist: [], positions: [], error: null, ready: false };
    }
    const value = JSON.parse(raw) as Partial<TrackingState>;
    if (
      !Array.isArray(value.watchlist) ||
      !value.watchlist.every(isWatchlistItem) ||
      !Array.isArray(value.positions) ||
      !value.positions.every(isPortfolioPosition)
    ) {
      return {
        watchlist: [],
        positions: [],
        error: "Saved watchlist and portfolio data was invalid and could not be loaded.",
        ready: false,
      };
    }
    return {
      watchlist: value.watchlist.slice(0, MAX_TRACKED_SECURITIES),
      positions: value.positions
        .slice(0, MAX_TRACKED_SECURITIES)
        .map((position) => {
          const legacy = position as PortfolioPosition & {
            outlook?: PortfolioOutlook;
          };
          const { outlook, ...current } = legacy;
          return {
            ...current,
            outlooks:
              current.outlooks ?? (outlook ? { 7: outlook } : undefined),
          };
        }),
      error: null,
      ready: false,
    };
  } catch (error) {
    return {
      watchlist: [],
      positions: [],
      error:
        error instanceof Error
          ? `Saved tracking data could not be read: ${error.message}`
          : "Saved tracking data could not be read.",
      ready: false,
    };
  }
}

function trackingRequestError(prefix: string, error: unknown): string {
  return error instanceof Error ? `${prefix}: ${error.message}` : prefix;
}

function samePriceHistory(
  left: PortfolioPriceSnapshot[] | undefined,
  right: PortfolioPriceSnapshot[] | undefined,
): boolean {
  const leftHistory = left ?? [];
  const rightHistory = right ?? [];
  return (
    leftHistory.length === rightHistory.length &&
    leftHistory.every((snapshot, index) => {
      const other = rightHistory[index];
      return (
        snapshot.date === other.date &&
        snapshot.adjustedClose === other.adjustedClose &&
        snapshot.capturedAt === other.capturedAt
      );
    })
  );
}

function mergeServerSnapshots(
  current: TrackingStore,
  remote: TrackingState,
): TrackingStore {
  const remoteWatchlist = new Map(
    remote.watchlist.map((item) => [item.security.symbol, item]),
  );
  const remotePositions = new Map(
    remote.positions.map((position) => [position.security.symbol, position]),
  );
  let changed = false;
  const watchlist = current.watchlist.map((item) => {
    const remoteItem = remoteWatchlist.get(item.security.symbol);
    if (
      !remoteItem ||
      (remoteItem.latestClose === item.latestClose &&
        remoteItem.lastMarketDate === item.lastMarketDate)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      latestClose: remoteItem.latestClose,
      lastMarketDate: remoteItem.lastMarketDate,
    };
  });
  const positions = current.positions.map((position) => {
    const remotePosition = remotePositions.get(position.security.symbol);
    if (
      !remotePosition ||
      (remotePosition.latestClose === position.latestClose &&
        remotePosition.lastMarketDate === position.lastMarketDate &&
        samePriceHistory(remotePosition.priceHistory, position.priceHistory))
    ) {
      return position;
    }
    changed = true;
    return {
      ...position,
      latestClose: remotePosition.latestClose,
      lastMarketDate: remotePosition.lastMarketDate,
      priceHistory: remotePosition.priceHistory,
    };
  });
  const refreshError = current.error?.startsWith(
    "Daily portfolio prices could not be refreshed",
  );
  if (!changed && !refreshError) return current;
  return {
    ...current,
    watchlist,
    positions,
    error: refreshError ? null : current.error,
  };
}

export function useTracking() {
  const initialStoreRef = useRef<TrackingStore | null>(null);
  if (initialStoreRef.current === null) {
    initialStoreRef.current = loadTrackingStore();
  }
  const [store, setStore] = useState<TrackingStore>(
    initialStoreRef.current,
  );
  const hydratedRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const controller = new AbortController();

    async function hydrate() {
      try {
        const databaseState = await getTrackingState(controller.signal);
        if (controller.signal.aborted) return;
        const localState = initialStoreRef.current;
        const shouldMigrate =
          databaseState.watchlist.length === 0 &&
          databaseState.positions.length === 0 &&
          localState !== null &&
          (localState.watchlist.length > 0 || localState.positions.length > 0);
        const nextState: TrackingState = shouldMigrate
          ? {
              watchlist: localState.watchlist,
              positions: localState.positions,
            }
          : {
              watchlist: databaseState.watchlist,
              positions: databaseState.positions,
            };
        hydratedRef.current = true;
        setStore({
          ...nextState,
          error: localState?.error ?? null,
          ready: true,
        });
        if (shouldMigrate) {
          await saveTrackingState(nextState);
        }
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        if (controller.signal.aborted) return;
        hydratedRef.current = false;
        setStore((current) => ({
          ...current,
          error: trackingRequestError(
            "Database tracking data could not be loaded",
            error,
          ),
          ready: false,
        }));
      }
    }

    void hydrate();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || !store.ready) return;
    const snapshot: TrackingState = {
      watchlist: store.watchlist,
      positions: store.positions,
    };
    const timer = window.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          await saveTrackingState(snapshot);
          window.localStorage.removeItem(STORAGE_KEY);
          setStore((current) =>
            current.error?.startsWith("Database tracking changes could not be saved")
              ? { ...current, error: null }
              : current,
          );
        })
        .catch((error) => {
          setStore((current) => ({
            ...current,
            error: trackingRequestError(
              "Database tracking changes could not be saved",
              error,
            ),
          }));
        });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [store.positions, store.ready, store.watchlist]);

  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const timer = window.setInterval(async () => {
      if (!hydratedRef.current || refreshing) return;
      refreshing = true;
      try {
        const remote = await getTrackingState(controller.signal);
        if (!controller.signal.aborted) {
          setStore((current) => mergeServerSnapshots(current, remote));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStore((current) => ({
            ...current,
            error: trackingRequestError(
              "Daily portfolio prices could not be refreshed",
              error,
            ),
          }));
        }
      } finally {
        refreshing = false;
      }
    }, SNAPSHOT_REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  function toggleWatchlist(
    security: Security,
    latestClose: number,
    lastMarketDate: string,
  ) {
    setStore((current) => {
      const exists = current.watchlist.some(
        (item) => item.security.symbol === security.symbol,
      );
      if (exists) {
        return {
          ...current,
          watchlist: current.watchlist.filter(
            (item) => item.security.symbol !== security.symbol,
          ),
          error: null,
        };
      }
      if (current.watchlist.length >= MAX_TRACKED_SECURITIES) {
        return {
          ...current,
          error: `Watchlist limit reached. Remove a stock before adding more than ${MAX_TRACKED_SECURITIES}.`,
        };
      }
      return {
        ...current,
        watchlist: [
          ...current.watchlist,
          {
            security,
            latestClose,
            lastMarketDate,
            addedAt: new Date().toISOString(),
          },
        ],
        error: null,
      };
    });
  }

  function savePosition(
    security: Security,
    quantity: number,
    averagePrice: number,
    latestClose: number,
    lastMarketDate: string,
    outlooks?: PortfolioOutlooks,
  ) {
    setStore((current) => {
      const exists = current.positions.some(
        (position) => position.security.symbol === security.symbol,
      );
      const existingPosition = current.positions.find(
        (position) => position.security.symbol === security.symbol,
      );
      if (!exists && current.positions.length >= MAX_TRACKED_SECURITIES) {
        return {
          ...current,
          error: `Portfolio limit reached. Remove a position before adding more than ${MAX_TRACKED_SECURITIES}.`,
        };
      }
      const nextPosition: PortfolioPosition = {
        security,
        quantity,
        averagePrice,
        latestClose,
        lastMarketDate,
        outlooks,
        priceHistory: existingPosition?.priceHistory,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...current,
        positions: exists
          ? current.positions.map((position) =>
              position.security.symbol === security.symbol
                ? nextPosition
                : position,
            )
          : [...current.positions, nextPosition],
        error: null,
      };
    });
  }

  function removePosition(symbol: string) {
    setStore((current) => ({
      ...current,
      positions: current.positions.filter(
        (position) => position.security.symbol !== symbol,
      ),
      error: null,
    }));
  }

  function refreshSnapshot(
    security: Security,
    latestClose: number,
    lastMarketDate: string,
  ) {
    setStore((current) => {
      const watchlist = current.watchlist.map((item) =>
        item.security.symbol === security.symbol
          ? { ...item, latestClose, lastMarketDate, security }
          : item,
      );
      const positions = current.positions.map((position) =>
        position.security.symbol === security.symbol
          ? { ...position, latestClose, lastMarketDate, security }
          : position,
      );
      return { ...current, watchlist, positions };
    });
  }

  function refreshOutlooks(symbol: string, outlooks: PortfolioOutlooks) {
    setStore((current) => {
      const position = current.positions.find(
        (item) => item.security.symbol === symbol,
      );
      if (!position) return current;
      return {
        ...current,
        positions: current.positions.map((item) =>
          item.security.symbol === symbol
            ? { ...item, outlooks: { ...item.outlooks, ...outlooks } }
            : item,
        ),
      };
    });
  }

  return {
    watchlist: store.watchlist,
    positions: store.positions,
    trackingError: store.error,
    trackingReady: store.ready,
    toggleWatchlist,
    savePosition,
    removePosition,
    refreshSnapshot,
    refreshOutlooks,
  };
}
