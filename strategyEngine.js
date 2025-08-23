// strategyEngine.js – print every generateContent request & response
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { log } from './logger.js';
import { calculateIndicatorSeries } from './indicators.js';

function latest10ClosedTrades() {
  if (!fs.existsSync('./trades.json')) return [];
  try {
    const all = JSON.parse(fs.readFileSync('./trades.json', 'utf8'));
    return all.filter(t => t.exitTime).slice(-10);
  } catch { return []; }
}

export class StrategyEngine {
  constructor() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const safety = [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }];
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite', safetySettings: safety });
    log.info('StrategyEngine ready.');
  }

  async _callWithRetry(prompt, max = 4) {
    for (let i = 1; i <= max; i++) {
      try {
        const res = await this.model.generateContent(prompt);
        const text = res.response.text?.();
        if (!text?.length) throw new Error('Empty response');
        log.info(`[GEMINI_RESPONSE_ATTEMPT_${i}]:\n${text}\n---`);
        return { ok: true, text };
      } catch (err) {
        log.warn(`[GEMINI] Attempt ${i} failed: ${err.message}`);
        if (i === max) return { ok: false, error: err };
        await new Promise(r => setTimeout(r, 61_000));
      }
    }
  }

  _prompt(market) {
    const recent = latest10ClosedTrades();
    return `
You are an expert strategist for PF_XBTUSD. Use step-by-step math, not narrative fluff to derive a trade setup. You will be called every 60 minutes until a short or long order has been placed and their corresponding stoploss and takeprofit orders. After those have been triggered you will be called again until a new order has been placed.
Last 10 closed trades:
${JSON.stringify(recent, null, 2)}

Market data (720 1-h candles, indicators where apply):
${JSON.stringify(market, null, 2)}

Return somewhere in your response this JSON:
{
  "signal": "LONG|SHORT|HOLD", 
  "confidence": <0-100>,
  "stop_loss_distance_in_usd": <number>,
  "take_profit_distance_in_usd": <number>,
  "reason": "<string>" 
}`;
  }

  async generateSignal(marketData) {
    if (!marketData?.ohlc?.length) return this._fail('No OHLC data');
    const ind = calculateIndicatorSeries(marketData.ohlc);
    if (!ind) return this._fail('Indicator error');

    const context = { ohlc: marketData.ohlc, indicators: [] };
    const prompt  = this._prompt(context);
    const { ok, text, error } = await this._callWithRetry(prompt);
    if (!ok) return this._fail(error.message);

    try {
      const json = text.match(/\{.*\}/s)?.[0];
      const data = JSON.parse(json);
      if (!['LONG', 'SHORT', 'HOLD'].includes(data.signal)) throw new Error('Bad signal');
      return data;
    } catch (e) {
      log.error('Parse/validation error:', e.message);
      return this._fail('Bad AI response');
    }
  }

  _fail(reason) {
    return { signal: 'HOLD', confidence: 0, stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0, reason };
  }
}
