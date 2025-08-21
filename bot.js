// bot.js

import { startWebServer } from './webServer.js';
import { DataHandler } from './dataHandler.js';
import { StrategyEngine } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { ExecutionHandler } from './executionHandler.js';
import { log } from './logger.js';
import dotenv from 'dotenv';

dotenv.config();
startWebServer();

// --- Configuration ---
const FUTURES_TRADING_PAIR = 'PF_XBTUSD';
const OHLC_DATA_PAIR = 'XBTUSD';
const CANDLE_INTERVAL = 60;
const MINIMUM_CONFIDENCE_THRESHOLD = 40;
const TRADING_INTERVAL_MS = 3600 * 1000; // 1 hour

let _signalNr = 0; let _tradeNr = 0; let _initialMrgn, _newMrgn = 0; const _tradePnLs = []; // ---- state variables (top of bot.js) ----
let _initialBalance = null;   // first balance when flat
let _lastTradeBalance = null;
const equityCurve = [];   // needed for drawdown calculation
const dailyReturns = [];   // push today's % change vs previous balance
let lastBalance = _initialBalance;  // will mutate each cycle
let ordersSent = 0;

// each closed-trade PnL

// inside the “position just closed” block
// balance right after the last trade closed
// push each trade’s PnL

const startTime = Date.now();
setInterval(() => {
  log.metric('uptime_minutes', Math.floor((Date.now()-startTime)/60000), 'min');
}, 60_000);

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
    marginBuffer: 0.4});
        const executionHandler = new ExecutionHandler(dataHandler.api);
        // Fetch data
        const marketData = await dataHandler.fetchAllData(OHLC_DATA_PAIR, CANDLE_INTERVAL);
        /* ---- rolling Sharpe block ---- */
const ret = (marketData.balance - lastBalance) / lastBalance;
dailyReturns.push(ret);
lastBalance = marketData.balance;

if (dailyReturns.length > 30) dailyReturns.shift();   // keep last 30

if (dailyReturns.length >= 2) {
  const avg = dailyReturns.reduce((a,b)=>a+b,0) / dailyReturns.length;
  const std = Math.sqrt(
    dailyReturns.map(r=>(r-avg)**2).reduce((a,b)=>a+b,0) /
    (dailyReturns.length-1)
  );
  const sharpe = std ? (avg / std) * Math.sqrt(252) : 0;   // annualised
  log.metric('sharpe_30d', sharpe.toFixed(2));
}
        
        const openPositions = marketData.positions?.openPositions?.filter(p => p.symbol === FUTURES_TRADING_PAIR) || [];
        log.metric('open_positions', openPositions.length);
/* 1. very first flat cycle → capture baseline */
if (_initialBalance === null && openPositions.length === 0) {
  _initialBalance = marketData.balance;
  log.metric('initial_balance', _initialBalance, 'USD');
}
        // remove the early-return for a moment **or** always log balance
        

/* 2. position just closed (was open last cycle, now flat) */
/* 2. Position just closed (was open last cycle, now flat) */
if (_lastTradeBalance !== null && openPositions.length === 0) {
  /* ---- state you already had ---- */
  const pnlUSD  = marketData.balance - _initialBalance;
  const perc    = (pnlUSD / _initialBalance) * 100;
  _tradePnLs.push(pnlUSD);

  /* ---- essentials you already log ---- */
  log.metric('realised_pnl',   pnlUSD, 'USD');
  log.metric('perc_gain',      perc, '%');
  log.metric('trade_count',    _tradePnLs.length, 'trades');

  /* ---- NEW METRICS (drop in below) ---- */

  // 1. Max drawdown (requires equity-curve array; declare it once at top of bot.js)
  equityCurve.push(marketData.balance);
  const peak = Math.max(...equityCurve);
  const maxDD = ((peak - marketData.balance) / peak) * 100;
  log.metric('max_drawdown', maxDD.toFixed(2), '%');

  // 2. Win-rate
  const wins     = _tradePnLs.filter(p => p > 0).length;
  const winRate  = _tradePnLs.length ? (wins / _tradePnLs.length) : 0;
  log.metric('win_rate', (winRate*100).toFixed(1), '%');

  // 3. Average trade
  const avgTradeUSD = _tradePnLs.reduce((a,b)=>a+b,0) / _tradePnLs.length;
  log.metric('avg_trade_usd', avgTradeUSD.toFixed(2), 'USD');

  // 4. Profit factor
  const grossWin  = _tradePnLs.filter(p=>p>0).reduce((a,b)=>a+b,0);
  const grossLoss = Math.abs(_tradePnLs.filter(p=>p<0).reduce((a,b)=>a+b,0));
  const pf        = grossLoss ? (grossWin/grossLoss).toFixed(2) : '—';
  log.metric('profit_factor', pf);

  // 5. Expectancy
  const losses    = _tradePnLs.length - wins;
  const avgWin    = wins   ? grossWin/wins   : 0;
  const avgLos    = losses ? grossLoss/losses : 0;
  const expectancy = winRate*avgWin - (1-winRate)*avgLos;
  log.metric('expectancy_usd', expectancy.toFixed(2), 'USD');

  // 6. CAGR (simple version – since inception)
  const days = _tradePnLs.length || 1; // crude: 1 trade ≈ 1 day
  const cagr = ((marketData.balance/_initialBalance)**(365/days)-1)*100;
  log.metric('cagr', cagr.toFixed(2), '%');

  /* ---- reset for next round ---- */
  _lastTradeBalance = null;
}

/* 3. new trade placed (flat → open) */
if (openPositions.length > 0) {
            log.info(`Position already open for ${FUTURES_TRADING_PAIR}. Skipping new trade.`);
            if (_lastTradeBalance === null) {
  
  _lastTradeBalance = marketData.balance; // snapshot right after entry
}
            return;
        }
        
        // Generate and act on signal
        const tradingSignal = await strategyEngine.generateSignal(marketData);
        _signalNr++;
        log.metric('_signalNr', _signalNr);
if (tradingSignal.signal !== 'HOLD' && tradingSignal.confidence >= MINIMUM_CONFIDENCE_THRESHOLD) {
    log.info(`High-confidence signal received (${tradingSignal.confidence}). Proceeding.`);
    _tradeNr++;
    log.metric('trade_nr', _tradeNr);
    const tradeParams = riskManager.calculateTradeParameters(marketData, tradingSignal);
    // ...
if (tradeParams) {log.metric('order_trade_ratio', _tradeNr ? (ordersSent/_tradeNr).toFixed(2) : 0);
                  
    // Get the last price from the market data
    const lastPrice = marketData.ohlc[marketData.ohlc.length - 1].close;
    ordersSent++;
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
