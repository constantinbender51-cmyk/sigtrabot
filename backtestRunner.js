// backtestRunner.js

// --- FIX: Added import statements ---
import { log } from './logger.js';
import { BacktestDataHandler } from './backtestDataHandler.js';
import { StrategyEngine } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import fs from 'fs';
import { BacktestExecutionHandler } from './backtestExecutionHandler.js';
import path from 'path';                 // *** NEW ***

// --- ATR utility -------------------------------------------------
function calculateATR(ohlc, period = 14) {
    const tr = [];
    for (let i = 1; i < ohlc.length; i++) {
        const h = ohlc[i].high, l = ohlc[i].low, pc = ohlc[i - 1].close;
        tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const atrWindow = tr.slice(-period);
    return atrWindow.reduce((a, b) => a + b, 0) / atrWindow.length;
}
// ---------- date helpers ----------
function tsFromDate(dateStr) {
  // "YYYY-MM-DD" -> Unix seconds
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function filterByDate(candles, startDateStr, endDateStr) {
  const startTs = tsFromDate(startDateStr);
  const endTs   = tsFromDate(endDateStr);
  return candles.filter(c => c.timestamp >= startTs && c.timestamp < endTs);
}
// ------------------------------------------------------------
// 1.  Build the prompt (place this in backtestRunner.js)
// ------------------------------------------------------------
function buildPostTestPrompt(trades, cfg) {
  const fmt = ts => new Date(ts * 1000).toISOString();

  const enriched = trades.map((t, idx) => ({
    index: idx + 1,
    signal: t.signal,
    entryTime: fmt(t.entryTime),
    exitTime:  t.exitTime ? fmt(t.exitTime) : null,
    entryPrice: t.entryPrice,
    exitPrice:  t.exitPrice,
    size: t.size,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    pnl: t.pnl,
    reason: t.reason || 'N/A'
  }));

  const initial = cfg.INITIAL_BALANCE;
  const final   = trades.reduce((b, t) => b + t.pnl, initial);
  const totalR  = final - initial;
  const totalT  = trades.length;
  const wins    = trades.filter(t => t.pnl > 0).length;
  const winRt   = totalT ? (wins / totalT) * 100 : 0;

  let peak = initial, mdd = 0, run = initial;
  for (const t of trades) { run += t.pnl; if (run > peak) peak = run; mdd = Math.max(mdd, (peak - run) / peak); }

  return `
You are a senior quantitative strategist.  
Given the back-test trades below, return **only** a JSON object with these keys:
{
  "summary": "One-sentence overview",
  "totalReturn": <number>,
  "winRate": <number>,
  "maxDrawdownPct": <number>,
  "bestTrade": { "index": <int>, "profit": <number>, "reason": "<string>" },
  "worstTrade": { "index": <int>, "loss": <number>, "reason": "<string>" },
  "commonLossPatterns": [ "<string>", ... ],
  "improvements": [ "<string>", ... ]
}

Trade log:
${JSON.stringify(enriched, null, 2)}

Aggregate stats:
- Initial balance: $${initial.toFixed(2)}
- Final balance:   $${final.toFixed(2)}
- Total return:    $${totalR.toFixed(2)}
- Total trades:    ${totalT}
- Win rate:        ${winRt.toFixed(2)}%
- Max drawdown:    ${(mdd * 100).toFixed(2)}%

Config snapshot:
${JSON.stringify(cfg, null, 2)}
`.trim();
}


// --- FIX: Added export statement ---
export class BacktestRunner {
    constructor(config) {
        this.config = config;
        this.dataHandler = new BacktestDataHandler(config.DATA_FILE_PATH);
        this.executionHandler = new BacktestExecutionHandler(config.INITIAL_BALANCE);
        this.strategyEngine = new StrategyEngine();
        this.riskManager = new RiskManager({ leverage: 10, marginBuffer: 0.01 });
        this.blockReportCounter = 0;            // *** NEW ***
if (!fs.existsSync('./block-reports'))  // *** NEW ***
  fs.mkdirSync('./block-reports', { recursive: true });
        
        log.info('BacktestRunner initialized.');
    }

    async run() {
        log.info('--- STARTING NEW BACKTEST (WITH MA FILTER) ---');
        
        let allCandles = this.dataHandler.getAllCandles();
        allCandles = filterByDate(allCandles, '2022-01-01', '2022-05-01');  // <- NEW
        if (!allCandles || allCandles.length < this.config.WARMUP_PERIOD) {
            throw new Error("Not enough data for the warm-up period.");
        }

        let apiCallCount = 0;

        for (let i = this.config.WARMUP_PERIOD; i < allCandles.length; i++) {
            const currentCandle = allCandles[i];
            const marketData = { ohlc: allCandles.slice(i - this.config.DATA_WINDOW_SIZE, i) };

            const openTrade = this.executionHandler.getOpenTrade();
            if (openTrade) {
                this._checkTradeExit(currentCandle, openTrade);
            }

            if (!this.executionHandler.getOpenTrade()) {
                
                
                const signalFound = this._checkForSignal(marketData);
                if (signalFound && i % 1 === 0) {
                    if (apiCallCount >= this.config.MAX_API_CALLS) {
                        log.info(`[BACKTEST] Reached the API call limit. Ending simulation.`);
                        break;
                    }
                    apiCallCount++;
                    // --- NEW: print the candle’s human-readable date ---
                    const dateStr = new Date(currentCandle.timestamp * 1000).toISOString();
                    log.info(`[CANDLE] ${dateStr}`);
                    await this._handleSignal(marketData, currentCandle, apiCallCount);
                }
            }
        }
        await this._printSummary(apiCallCount);
    }

    _checkTradeExit(currentCandle, openTrade) {
    let exitPrice = null;
    let exitReason = '';

    if (openTrade.signal === 'LONG') {
        if (currentCandle.low <= openTrade.stopLoss)      { exitPrice = openTrade.stopLoss; exitReason = 'Stop-Loss'; }
        else if (currentCandle.high >= openTrade.takeProfit){ exitPrice = openTrade.takeProfit; exitReason = 'Take-Profit'; }
    } else if (openTrade.signal === 'SHORT') {
        if (currentCandle.high >= openTrade.stopLoss)     { exitPrice = openTrade.stopLoss; exitReason = 'Stop-Loss'; }
        else if (currentCandle.low <= openTrade.takeProfit) { exitPrice = openTrade.takeProfit; exitReason = 'Take-Profit'; }
    }

    if (exitPrice) {
        const date = new Date(currentCandle.timestamp * 1000).toISOString(); // seconds→ms
        log.info(`[EXIT] [${date}] ${exitReason} triggered for ${openTrade.signal} @ ${exitPrice}`);
        this.executionHandler.closeTrade(openTrade, exitPrice, currentCandle.timestamp);
    }
}
    

    _checkForSignal(marketData) {
    const LOOKBACK = 200;
    const MIN_ATR_MULT = 1.2;
    const MIN_ADR_PCT  = 0.005;

    if (marketData.ohlc.length < LOOKBACK + 1) return false;

    const current = marketData.ohlc[marketData.ohlc.length - 1];
    const window  = marketData.ohlc.slice(-LOOKBACK - 1, -1);

    const highestHigh = Math.max(...window.map(c => c.high));
    const lowestLow   = Math.min(...window.map(c => c.low));

    const atrNow  = calculateATR(marketData.ohlc.slice(-21));
    const atrPrev = calculateATR(marketData.ohlc.slice(-41, -21));
    const adrNow  = Math.max(...marketData.ohlc.slice(-24).map(c => c.high - c.low)) / current.close;

    const volExpansion = atrNow > atrPrev * MIN_ATR_MULT;
    const notDeadRange = adrNow >= MIN_ADR_PCT;

    // --- distance filter applied here ---
    const minDistance = highestHigh * 0.003;
    const maxDistance = lowestLow   * 0.003;

    const bullish = current.high > highestHigh + minDistance && volExpansion && notDeadRange;
    const bearish = current.low  < lowestLow   - maxDistance && volExpansion && notDeadRange;

    if (bullish || bearish) {
        const dir = bullish ? 'Bullish' : 'Bearish';
        const date = new Date(current.timestamp * 1000).toISOString();
        log.info(`[FILTER] [${date}] ${dir} breakout + vol-expansion → candidate`);
    }
    return true;//bullish || bearish;
}



    async _handleSignal(marketData, currentCandle, apiCallCount) {
        log.info(`[BACKTEST] [Call #${apiCallCount}/${this.config.MAX_API_CALLS}] Analyzing crossover event...`);
        const loopStartTime = Date.now();
        
        const tradingSignal = await this.strategyEngine.generateSignal(marketData);

        if (tradingSignal.signal !== 'HOLD' && tradingSignal.confidence >= this.config.MINIMUM_CONFIDENCE_THRESHOLD) {
            const tradeParams = this.riskManager.calculateTradeParameters({ ...marketData, balance: this.executionHandler.balance }, tradingSignal);
            if (tradeParams && tradeParams.size > 0) {
                this.executionHandler.placeOrder({
                    signal: tradingSignal.signal,
                    params: tradeParams,
                    entryPrice: currentCandle.close,
                    entryTime: currentCandle.timestamp,
                    reason: tradingSignal.reason
                });
            }
        }

        const processingTimeMs = Date.now() - loopStartTime;
        const delayNeededMs = (this.config.MIN_SECONDS_BETWEEN_CALLS * 1000) - processingTimeMs;
        if (delayNeededMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayNeededMs));
        }
    }

   async _printSummary(apiCallCount) {
        log.info('--- BACKTEST COMPLETE ---');
        const allTrades = this.executionHandler.getTrades();
        const totalTrades = allTrades.length;
        const winningTrades = allTrades.filter(t => t.pnl > 0).length;
        const losingTrades = totalTrades - winningTrades;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const finalBalance = this.executionHandler.balance;
        const totalPnl = finalBalance - this.config.INITIAL_BALANCE;

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

        fs.writeFileSync('./trades.json', JSON.stringify(allTrades, null, 2));
        // --- 1.  FULL back-test report (already existed) ------------
        const prompt = buildPostTestPrompt(allTrades, this.config);
        const { ok, text } = await new StrategyEngine()._callWithRetry(prompt);
        if (ok) {
          try {
            const report = JSON.parse(text.match(/\{.*\}/s)[0]);
            console.log("\n--- AI Post-Test Analysis ---");
            console.log(JSON.stringify(report, null, 2));
          } catch (e) {
            console.warn("Could not parse AI analysis:", e.message);
          }
        } else {
          console.warn("AI analysis call failed.");
        }

        // --- 2.  10-TRADE BLOCK REPORTS  ---------------------------
        const closed   = allTrades.filter(t => t.exitTime); // only closed trades
        const blockSize = 10;
        if (closed.length % blockSize === 0 && closed.length > 0) {
          const lastBlock = closed.slice(-blockSize);
          const blockPrompt = buildPostTestPrompt(lastBlock, this.config);
          const { ok: ok2, text: text2 } =
                 await new StrategyEngine()._callWithRetry(blockPrompt);

          let report = {};
          if (ok2) {
            try { report = JSON.parse(text2.match(/\{.*\}/s)[0]); } catch {}
          }
          const fileName = path.join('./block-reports', `${closed.length}.json`);
          fs.writeFileSync(fileName, JSON.stringify(report, null, 2));
          log.info(`[BLOCK REPORT] saved → ${fileName}`);
        }
        // -----------------------------------------------------------
    }
}
