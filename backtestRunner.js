// backtestRunner.js
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';
import { BacktestDataHandler } from './backtestDataHandler.js';
import { StrategyEngine } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { BacktestExecutionHandler } from './backtestExecutionHandler.js';

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */
function tsFromDate(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function filterByDate(candles, start, end) {
  const startTs = tsFromDate(start);
  const endTs   = tsFromDate(end);
  return candles.filter(c => c.timestamp >= startTs && c.timestamp < endTs);
}

function calculateATR(ohlc, period = 14) {
  const tr = [];
  for (let i = 1; i < ohlc.length; i++) {
    const h  = ohlc[i].high;
    const l  = ohlc[i].low;
    const pc = ohlc[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atrWindow = tr.slice(-period);
  return atrWindow.reduce((a, b) => a + b, 0) / atrWindow.length;
}

/* ------------------------------------------------------------------ */
/*  Prompt builder                                                    */
/* ------------------------------------------------------------------ */
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

  let peak = cfg.INITIAL_BALANCE;
  let run  = cfg.INITIAL_BALANCE;
  let mdd  = 0;
  for (const t of trades) {
    run += t.pnl;
    if (run > peak) peak = run;
    mdd = Math.max(mdd, (peak - run) / peak);
  }

  const final  = run;
  const totalR = final - cfg.INITIAL_BALANCE;
  const totalT = trades.length;
  const wins   = trades.filter(t => t.pnl > 0).length;
  const winRt  = totalT ? (wins / totalT) * 100 : 0;

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
- Initial balance: $${cfg.INITIAL_BALANCE.toFixed(2)}
- Final balance:   $${final.toFixed(2)}
- Total return:    $${totalR.toFixed(2)}
- Total trades:    ${totalT}
- Win rate:        ${winRt.toFixed(2)}%
- Max drawdown:    ${(mdd * 100).toFixed(2)}%

Config snapshot:
${JSON.stringify(cfg, null, 2)}
`.trim();
}

/* ------------------------------------------------------------------ */
/*  BacktestRunner                                                    */
/* ------------------------------------------------------------------ */
export class BacktestRunner {
  constructor(cfg) {
    this.cfg   = cfg;
    this.data  = new BacktestDataHandler(cfg.DATA_FILE_PATH);
    this.exec  = new BacktestExecutionHandler(cfg.INITIAL_BALANCE);
    this.strat = new StrategyEngine();
    this.risk  = new RiskManager({ leverage: 10, marginBuffer: 0.01 });

    const BLOCK_DIR = './block-reports';
    if (!fs.existsSync(BLOCK_DIR)) fs.mkdirSync(BLOCK_DIR, { recursive: true });
    log.info('BacktestRunner initialized.');
  }

  async run() {
    log.info('--- STARTING NEW BACKTEST (WITH MA FILTER) ---');

    let candles = this.data.getAllCandles();
    candles = filterByDate(candles, '2022-01-01', '2022-05-01');
    if (!candles || candles.length < this.cfg.WARMUP_PERIOD) {
      throw new Error('Not enough data for the warm-up period.');
    }

    let apiCalls = 0;

    for (let i = this.cfg.WARMUP_PERIOD; i < candles.length; i++) {
      const candle = candles[i];
      const window = candles.slice(i - this.cfg.DATA_WINDOW_SIZE, i);

      if (this.exec.getOpenTrade()) this._checkExit(candle);

      if (!this.exec.getOpenTrade() && this._hasSignal({ ohlc: window })) {
        if (apiCalls >= this.cfg.MAX_API_CALLS) {
          log.info('[BACKTEST] Reached the API call limit. Ending simulation.');
          break;
        }
        apiCalls++;

        const date = new Date(candle.timestamp * 1000).toISOString();
        log.info(`[CANDLE] ${date}`);
        await this._handleSignal({ ohlc: window }, candle, apiCalls);
      }
    }
    await this._printSummary(apiCalls);
  }

  /* ------------------------ Private ------------------------ */
  _checkExit(candle) {
    const t = this.exec.getOpenTrade();
    let exitPrice  = null;
    let exitReason = '';

    if (t.signal === 'LONG') {
      if (candle.low  <= t.stopLoss)      { exitPrice = t.stopLoss; exitReason = 'Stop-Loss'; }
      if (candle.high >= t.takeProfit)    { exitPrice = t.takeProfit; exitReason = 'Take-Profit'; }
    } else if (t.signal === 'SHORT') {
      if (candle.high >= t.stopLoss)      { exitPrice = t.stopLoss; exitReason = 'Stop-Loss'; }
      if (candle.low  <= t.takeProfit)    { exitPrice = t.takeProfit; exitReason = 'Take-Profit'; }
    }

    if (exitPrice) {
      const date = new Date(candle.timestamp * 1000).toISOString();
      log.info(`[EXIT] [${date}] ${exitReason} triggered for ${t.signal} @ ${exitPrice}`);
      this.exec.closeTrade(t, exitPrice, candle.timestamp);
      emitBlockReportIfNeeded(this.exec.getTrades().filter(tr => tr.exitTime), this.cfg);
    }
  }

  _hasSignal(market) {
    const LOOKBACK   = 200;
    const MIN_ATR_M  = 1.2;
    const MIN_ADR_P  = 0.005;

    if (market.ohlc.length < LOOKBACK + 1) return false;

    const cur   = market.ohlc[market.ohlc.length - 1];
    const prev  = market.ohlc.slice(-LOOKBACK - 1, -1);

    const hh = Math.max(...prev.map(c => c.high));
    const ll = Math.min(...prev.map(c => c.low));

    const atrNow  = calculateATR(market.ohlc.slice(-21));
    const atrPrev = calculateATR(market.ohlc.slice(-41, -21));
    const adrNow  = Math.max(...market.ohlc.slice(-24).map(c => c.high - c.low)) / cur.close;

    const volExp  = atrNow > atrPrev * MIN_ATR_M;
    const notDead = adrNow >= MIN_ADR_P;

    const minDist = hh * 0.003;
    const maxDist = ll * 0.003;

    const bullish = cur.high > hh + minDist && volExp && notDead;
    const bearish = cur.low  < ll - maxDist && volExp && notDead;

    if (bullish || bearish) {
      const dir  = bullish ? 'Bullish' : 'Bearish';
      const date = new Date(cur.timestamp * 1000).toISOString();
      log.info(`[FILTER] [${date}] ${dir} breakout + vol-expansion → candidate`);
    }
    return bullish || bearish;
  }

  async _handleSignal(market, candle, apiCalls) {
    log.info(`[BACKTEST] [Call #${apiCalls}/${this.cfg.MAX_API_CALLS}] Analyzing crossover event...`);
    const t0 = Date.now();

    const sig = await this.strat.generateSignal(market);
    if (sig.signal !== 'HOLD' && sig.confidence >= this.cfg.MINIMUM_CONFIDENCE_THRESHOLD) {
      const params = this.risk.calculateTradeParameters(
        { ...market, balance: this.exec.balance },
        sig
      );
      if (params?.size > 0) {
        this.exec.placeOrder({
          signal: sig.signal,
          params,
          entryPrice: candle.close,
          entryTime: candle.timestamp,
          reason: sig.reason
        });
      }
    }

    const elapsed = Date.now() - t0;
    const delay   = this.cfg.MIN_SECONDS_BETWEEN_CALLS * 1000 - elapsed;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
  }

  async _printSummary(apiCalls) {
    log.info('--- BACKTEST COMPLETE ---');
    const trades   = this.exec.getTrades();
    const closed   = trades.filter(t => t.exitTime);
    const total    = trades.length;
    const wins     = trades.filter(t => t.pnl > 0).length;
    const winRate  = total ? (wins / total) * 100 : 0;
    const pnl      = this.exec.balance - this.cfg.INITIAL_BALANCE;

    console.log('\n--- Backtest Performance Summary ---');
    console.log(`Analyzed crossover events: ${apiCalls}`);
    console.log(`Initial Balance : $${this.cfg.INITIAL_BALANCE.toFixed(2)}`);
    console.log(`Final Balance   : $${this.exec.balance.toFixed(2)}`);
    console.log(`Total P&L       : $${pnl.toFixed(2)}`);
    console.log(`Total Trades    : ${total}`);
    console.log(`Winning Trades  : ${wins}`);
    console.log(`Losing Trades   : ${total - wins}`);
    console.log(`Win Rate        : ${winRate.toFixed(2)}%`);
    console.log('------------------------------------\n');

    fs.writeFileSync('./trades.json', JSON.stringify(trades, null, 2));

    // full report
    const prompt = buildPostTestPrompt(trades, this.cfg);
    const { ok, text } = await this.strat._callWithRetry(prompt);
    if (ok) {
      try {
        const report = JSON.parse(text.match(/\{.*\}/s)[0]);
        console.log('\n--- AI Post-Test Analysis ---');
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        console.warn('Could not parse AI analysis:', e.message);
      }
    } else {
      console.warn('AI analysis call failed.');
    }
  }
}
/* ------------------------------------------------------------------ */
/*  Block-report helper                                               */
/* ------------------------------------------------------------------ */
async function emitBlockReportIfNeeded(allClosedTrades, cfg) {
  const blockSize = 10;
  if (!allClosedTrades.length || allClosedTrades.length % blockSize !== 0) return;

  const lastBlock = allClosedTrades.slice(-blockSize);
  const prompt    = buildPostTestPrompt(lastBlock, cfg);

  const { ok, text } = await new StrategyEngine()._callWithRetry(prompt);
  let report = {};
  if (ok) {
    try {
      report = JSON.parse(text.match(/\{.*\}/s)[0]);
    } catch {}
  }
  if (!fs.existsSync(BLOCK_DIR)) fs.mkdirSync(BLOCK_DIR, { recursive: true });
  const file = path.join(BLOCK_DIR, `${allClosedTrades.length}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  log.info(`[BLOCK REPORT] saved → ${file}`);
}
