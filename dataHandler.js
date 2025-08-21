// dataHandler.js

import { KrakenFuturesApi } from './krakenApi.js';

/**
 * @class DataHandler
 * @description A module responsible for fetching and consolidating all necessary data 
 *              for the trading bot using the Kraken API client.
 */
export class DataHandler {
    constructor(apiKey, apiSecret) {
        if (!apiKey || !apiSecret) {
            throw new Error("API key and secret are required to initialize the DataHandler.");
        }
        this.api = new KrakenFuturesApi(apiKey, apiSecret);
    }

    /**
     * Fetches all critical data points required for a trading decision cycle.
     * @param {string} pair - The trading pair for OHLC data (e.g., 'XBTUSD').
     * @param {number} interval - The OHLC candle interval in minutes.
     * @returns {Promise<object>} A consolidated object containing all fetched data.
     */
    async fetchAllData(pair = 'XBTUSD', interval = 60) {
        console.log("--- Starting data fetch cycle ---");
        try {
            const [
                ohlcData,
                accountBalance,
                openPositions,
                openOrders,
                recentFills
            ] = await Promise.all([
                this.fetchOhlcData({ pair, interval }),
                this.fetchAccountBalance(), // This will now return a number
                this.fetchOpenPositions(),
                this.fetchOpenOrders(),
                this.fetchRecentFills()
            ]);

            console.log("--- Data fetch cycle completed successfully ---");

            return {
                ohlc: ohlcData,
                balance: accountBalance, // This is now the tradable USD amount
                positions: openPositions,
                orders: openOrders,
                fills: recentFills
            };

        } catch (error) {
            console.error("Error during the data fetch cycle:", error.message);
            throw new Error("Failed to fetch all required data.");
        }
    }

    /**
     * Fetches account balance information from Kraken Futures and returns the available tradable USD margin.
     * @returns {Promise<number>} The available USD margin as a number. Returns 0 if not found.
     */
    async fetchAccountBalance() {
        console.log("Fetching account balance...");
        try {
            const data = await this.api.getAccounts();
            
            // Safely navigate the object structure to find the available margin.
            // This is called optional chaining (`?.`) and prevents errors if a key doesn't exist.
            const availableMargin = data?.accounts?.flex?.availableMargin;
            console.log(availableMargin);
            if (typeof availableMargin === 'number') {
                console.log(`Successfully fetched account balance. Tradable USD: $${availableMargin.toFixed(2)}`);
                return availableMargin;
            } else {
                // This case handles if the structure is unexpected or the value is missing.
                console.warn("Could not find 'availableMargin' in the expected path in the account data. Defaulting to 0.");
                console.log("Received account data structure:", JSON.stringify(data, null, 2));
                return 0;
            }
        } catch (error) {
            console.error("Failed to fetch or parse account balance:", error);
            return 0; // Return a safe value in case of an API error
        }
    }

    // ... (other methods: fetchOhlcData, fetchOpenPositions, etc. remain the same) ...
    
    async fetchOhlcData({ pair, interval }) {
        console.log(`Fetching OHLC data for ${pair} with ${interval}m interval...`);
        const data = await this.api.fetchKrakenData({ pair, interval });
        console.log(`Successfully fetched ${data?.length || 0} OHLC candles.`);
        return data;
    }

    async fetchOpenPositions() {
        console.log("Fetching open positions...");
        const data = await this.api.getOpenPositions();
        console.log(`Found ${data.openPositions?.length || 0} open positions.`);
        return data;
    }

    async fetchOpenOrders() {
        console.log("Fetching open orders...");
        const data = await this.api.getOpenOrders();
        console.log(`Found ${data.openOrders?.length || 0} open orders.`);
        return data;
    }

    async fetchRecentFills() {
        console.log("Fetching recent fills (trade history)...");
        const data = await this.api.getFills();
        console.log(`Successfully fetched ${data.fills?.length || 0} recent fills.`);
        return data;
    }
    /* ---------- FIFO realised-PnL calculator ---------- */
async function realisedPnlFromFills(fills) {
  const queue = [];          // { side, size, price }  (longs only)
  let realised = 0;

  for (const f of fills) {
    let { side, size, price } = f;     // size is always positive
    size = side === 'sell' ? -size : +size; // signed qty

    while (size !== 0 && queue.length) {
      const head = queue[0];
      const headQty = head.side === 'buy' ? head.size : -head.size; // signed
      const matchQty = Math.min(Math.abs(size), Math.abs(headQty));

      const closeSide = size > 0 ? 'buy' : 'sell'; // direction of *this* trade
      const openSide  = headQty > 0 ? 'buy' : 'sell';

      // Only count when signs differ (closing a position)
      if (closeSide !== openSide) {
        realised += (price - head.price) * (size > 0 ? 1 : -1) * matchQty;
      }

      // Adjust remaining sizes
      if (Math.abs(headQty) === matchQty) {
        queue.shift();
      } else {
        head.size -= matchQty * Math.sign(headQty);
      }
      size -= matchQty * Math.sign(size);
    }

    if (size !== 0) {
      // leftover opens a new leg
      queue.push({ side: size > 0 ? 'buy' : 'sell', size: Math.abs(size), price });
    }
  }
  return realised;
}
    
}
