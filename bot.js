// bot.js

import { startWebServer } from './webServer.js';
import { DataHandler } from './dataHandler.js';
import { StrategyEngine } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { ExecutionHandler } from './executionHandler.js';
import { log } from './logger.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();
startWebServer();

// --- Configuration ---
const FUTURES_TRADING_PAIR = 'PF_XBTUSD';
const OHLC_DATA_PAIR = 'XBTUSD';
const CANDLE_INTERVAL = 60;
const MINIMUM_CONFIDENCE_THRESHOLD = 40;
const TRADING_INTERVAL_MS = 3600 * 1000; // 1 hour

/**
 * The main trading logic for a single cycle.
 */
async function runTradingCycle() {
    log.info(`==================================================`);
    log.info(`Bot trading cycle starting for ${FUTURES_TRADING_PAIR}...`);
    log.info(`Minimum confidence threshold set to: ${MINIMUM_CONFIDENCE_THRESHOLD}`);

    try {
        const KRAKEN_API_KEY = process.env.KRAKEN_API_KEY;
        const KRAKEN_SECRET_KEY = process.env.KRAKEN_SECRET_KEY;
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        if (!KRAKEN_API_KEY || !KRAKEN_SECRET_KEY || !GEMINI_API_KEY) {
            log.error("[FATAL] API keys are missing.");
            return; // Return instead of exiting to allow the loop to continue later
        }

        // Initialize modules
        const dataHandler = new DataHandler(KRAKEN_API_KEY, KRAKEN_SECRET_KEY);
        const strategyEngine = new StrategyEngine();
        const riskManager = new RiskManager({ leverage: 10,
    stopLossMultiplier: 2,
    takeProfitMultiplier: 3,
    marginBuffer: 0.4 });
        const executionHandler = new ExecutionHandler(dataHandler.api);

        //TEST_RUN: START 
        /*await executionHandler.placeOrder({
                    signal: "LONG",
                    pair: "pf_xbtusd",
                    params:  { size: 0.0007, // Use toFixed for reasonable precision, matching Min Lot.
            stopLoss: 2,
            takeProfit: 3 }
                });*/
        //TEST_RUN: FINISH 
        // Fetch data
        const marketData = await dataHandler.fetchAllData(OHLC_DATA_PAIR, CANDLE_INTERVAL);
        
        const openPositions = marketData.positions?.openPositions?.filter(p => p.symbol === FUTURES_TRADING_PAIR) || [];
        if (openPositions.length > 0) {
            log.info(`Position already open for ${FUTURES_TRADING_PAIR}. Skipping new trade.`);
            return;
        }

        // Generate and act on signal
        const tradingSignal = await strategyEngine.generateSignal(marketData);
        // In bot.js, inside runTradingCycle()

// ... (after generating the tradingSignal)

if (tradingSignal.signal !== 'HOLD' && tradingSignal.confidence >= MINIMUM_CONFIDENCE_THRESHOLD) {
    log.info(`High-confidence signal received (${tradingSignal.confidence}). Proceeding.`);
    
    const tradeParams = riskManager.calculateTradeParameters(marketData, tradingSignal);
    // ...
if (tradeParams) {
    // Get the last price from the market data
    const lastPrice = marketData.ohlc[marketData.ohlc.length - 1].close;

    // Pass lastPrice back to the execution handler
    await executionHandler.placeOrder({
        signal: tradingSignal.signal,
        pair: FUTURES_TRADING_PAIR,
        params: tradeParams,
        lastPrice: lastPrice 
    });
} else {
        log.warn("Trade execution skipped by Risk Manager.");
    }
}

        log.info('--- CYCLE COMPLETE ---');
        const allTrades = this.executionHandler.getTrades();
        const totalTrades = allTrades.length;
        const winningTrades = allTrades.filter(t => t.pnl > 0).length;
        const losingTrades = totalTrades - winningTrades;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const finalBalance = this.executionHandler.balance;
        const totalPnl = finalBalance - this.config.INITIAL_BALANCE;

        // ---- existing summary output ----
console.log("\n\n--- Backtest Performance Summary ---");
console.log(`(Based on ${apiCallCount} analyzed crossover events)`);
console.log(`Initial Balance: $${this.config.INITIAL_BALANCE.toFixed(2)}`);
console.log(`Final Balance:   $${finalBalance.toFixed(2)}`);
console.log(`Total P&L:       $${totalPnl.toFixed(2)}`);
console.log(`------------------------------------`);
console.log(`Total Trades:    ${totalTrades}`);
console.log(`Winning Trades:  ${winningTrades}`);
console.log(`Losing Trades:   ${losingTrades}`);
console.log(`Win Rate:        ${winRate.toFixed(2)}%`);
console.log("------------------------------------\n");

if (totalTrades > 0) {
  console.log("--- Trade Log ---");
  allTrades.forEach((trade, idx) =>
    console.log(`Trade #${idx + 1}: ${trade.signal} | P&L: $${trade.pnl.toFixed(2)} | Reason: ${trade.reason}`)
  );
  console.log("-----------------\n");
}

// ---- NEW: always write stats.json ----
const stats = {
  apiCallCount,
  initialBalance: this.config.INITIAL_BALANCE,
  finalBalance,
  totalPnl,
  totalTrades,
  winningTrades,
  losingTrades,
  winRate,
  trades: allTrades
};
fs.writeFileSync(path.join(process.cwd(), 'logs', 'stats.json'), JSON.stringify(stats, null, 2));
        
    } catch (error) {
        log.error("A critical error occurred during the trading cycle:", error);
    } finally {
        log.info("Bot trading cycle finished.");
    }
}

/**
 * The main application loop using a robust recursive setTimeout.
 */
function mainLoop() {
    runTradingCycle().finally(() => {
        log.info(`Scheduling next run in ${TRADING_INTERVAL_MS / 1000 / 60} minutes.`);
        setTimeout(mainLoop, TRADING_INTERVAL_MS);
    });
}

// --- Start the Bot ---
log.info("Trading bot application started.");
mainLoop(); // Start the first cycle immediately.

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    log.warn("Shutdown signal received (SIGINT). Exiting gracefully.");
    // Here you could add logic to cancel open orders if desired.
    process.exit(0);
});
