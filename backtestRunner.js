// backtestRunner.js

// --- FIX: Added import statements ---
import { log } from './logger.js';
import { BacktestDataHandler } from './backtestDataHandler.js';
import { StrategyEngine } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { BacktestExecutionHandler } from './backtestExecutionHandler.js';

// --- FIX: Added export statement ---
export class BacktestRunner {
    constructor(config) {
        this.config = config;
        this.dataHandler = new BacktestDataHandler(config.DATA_FILE_PATH);
        this.executionHandler = new BacktestExecutionHandler(config.INITIAL_BALANCE);
        this.strategyEngine = new StrategyEngine();
        this.riskManager = new RiskManager({ leverage: 10, marginBuffer: 0.01 });
        log.info('BacktestRunner initialized.');
    }

    async run() {
        log.info('--- STARTING NEW BACKTEST (WITH MA FILTER) ---');
        
        const allCandles = this.dataHandler.getAllCandles();
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
                if (signalFound) {
                    if (apiCallCount >= this.config.MAX_API_CALLS) {
                        log.info(`[BACKTEST] Reached the API call limit. Ending simulation.`);
                        break;
                    }
                    apiCallCount++;
                    await this._handleSignal(marketData, currentCandle, apiCallCount);
                }
            }
        }
        this._printSummary(apiCallCount);
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
    const LOOKBACK_PERIOD = 20; // A common period for breakout strategies

    // Ensure we have enough data for the lookback
    if (marketData.ohlc.length < LOOKBACK_PERIOD + 1) {
        return false;
    }

    // The current candle is the last one in the window
    const currentCandle = marketData.ohlc[marketData.ohlc.length - 1];
    
    // The "lookback window" is the 20 candles *before* the current one
    const lookbackWindow = marketData.ohlc.slice(
        marketData.ohlc.length - LOOKBACK_PERIOD - 1, 
        marketData.ohlc.length - 1
    );

    // Find the highest high and lowest low in that lookback window
    const highestHigh = Math.max(...lookbackWindow.map(c => c.high));
    const lowestLow = Math.min(...lookbackWindow.map(c => c.low));

    // Check for a breakout
    const isBullishBreakout = currentCandle.high > highestHigh;
    const isBearishBreakout = currentCandle.low < lowestLow;

    if (isBullishBreakout) {
        const date = new Date(currentCandle.timestamp * 1000).toISOString();
        log.info(`[FILTER] [${date}] Potential signal found: Bullish Breakout above ${highestHigh}.`);
        return true;
    }
    if (isBearishBreakout) {
        const date = new Date(currentCandle.timestamp * 1000).toISOString();
        log.info(`[FILTER] [${date}] Potential signal found: Bearish Breakout below ${lowestLow}.`);
        return true;
    }

    return false; // No breakout, no signal
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

    _printSummary(apiCallCount) {
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

        if (totalTrades > 0) {
            console.log("--- Trade Log ---");
            allTrades.forEach((trade, index) => {
                console.log(`Trade #${index + 1}: ${trade.signal} | P&L: $${trade.pnl.toFixed(2)} | Reason: ${trade.reason}`);
            });
            console.log("-----------------\n");
        }
    }
}
