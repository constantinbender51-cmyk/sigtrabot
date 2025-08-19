// backtestExecutionHandler.js

import { log } from './logger.js';

// --- FIX: Added export statement ---
export class BacktestExecutionHandler {
    constructor(initialBalance) {
        this.balance = initialBalance;
        this.trades = [];
        log.info(`[BACKTEST] Initialized BacktestExecutionHandler with balance: $${this.balance}`);
    }

    placeOrder({ signal, params, entryPrice, entryTime, reason }) {
        const trade = {
            entryTime, entryPrice, signal, reason,
            size: params.size,
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
            status: 'open',
            exitTime: null, exitPrice: null, pnl: 0,
        };
        this.trades.push(trade);
        log.info(`[BACKTEST] ---- TRADE OPENED ----`);
        log.info(`[BACKTEST] Signal: ${signal} | Entry: ${entryPrice}`);
    }

    getOpenTrade() {
        return this.trades.find(t => t.status === 'open');
    }

    closeTrade(trade, exitPrice, exitTime) {
        const pnl = (exitPrice - trade.entryPrice) * trade.size * (trade.signal === 'LONG' ? 1 : -1);
        this.balance += pnl;
        trade.status = 'closed';
        trade.exitPrice = exitPrice;
        trade.exitTime = exitTime;
        trade.pnl = pnl;
        log.info(`[BACKTEST] ---- TRADE CLOSED ----`);
        log.info(`[BACKTEST] P&L: $${pnl.toFixed(2)} | New Balance: $${this.balance.toFixed(2)}`);
    }

    getTrades() {
        return this.trades;
    }
}
