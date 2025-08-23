// strategyEngine.js – print every generateContent request & response
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { log } from './logger.js';
import { calculateIndicatorSeries } from './indicators.js';
                    // already present
function latest10ClosedTrades() {
  if (!fs.existsSync('./trades.json')) return [];
  try {
    const all = JSON.parse(fs.readFileSync('./trades.json', 'utf8'));
    return all.filter(t => t.exitTime).slice(-10);
  } catch { return []; }
}

const loadLatestBlockReport = () => {
  const dir = './block-reports';
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir)
               .filter(f => f.endsWith('.json'))
               .sort((a, b) => +a - +b)
               .pop();
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    return null;
  }
};

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

  _prompt(market, block) {
      const recent = latest10ClosedTrades();     // *** NEW ***
    
    return `
You are an expert strategist for PF_XBTUSD. Use step-by-step math, not narrative fluff to derive your decisions.
Last 10 closed trades:
${JSON.stringify(recent, null, 2)}

Market data (720 1-h candles):
${JSON.stringify(market, null, 2)}

A past test run analysis has resulted in the following suggestions:
    "**Implement RSI Divergence Filters or Dynamic Thresholds:** Instead of merely tolerating extreme RSI, introduce a filter for RSI divergence (e.g., bearish divergence for LONGs, bullish divergence for SHORTs) as a stronger warning signal. Alternatively, implement dynamic RSI thresholds or stricter limits for entries when RSI is beyond 80/20, requiring additional confirmation for trades.",

    "**Enhance Stop-Loss Logic with Market Structure:** The current fixed ATR-based stop-loss appears vulnerable. Consider integrating market structure (e.g., placing stops below significant swing lows for LONGs or above swing highs for SHORTs), potentially combined with ATR, to make stop-losses more robust against noise and temporary reversals.",

    "**Refine Volume Analysis at Extremes:** While volume is used as a supportive indicator, investigate volume patterns more critically at extreme price points or when RSI is overbought/oversold. High volume on a reversal candle, or a decrease in volume on continuation candles after a strong impulse, could serve as a pre-warning for trend exhaustion.",

    "**Consider Partial Profit Taking or Trailing Stops:** For trades that move quickly into profit (e.g., 1R or 1.5R gain), consider taking partial profits or implementing a trailing stop-loss to protect capital and reduce risk exposure, especially in high-momentum trades that might eventually face a sharp correction.
    
Return **only** this JSON:
{
  "signal": "LONG|SHORT|HOLD", //Holding period until retest: 60 minutes
  "confidence": <0-100>, 
  "stop_loss_distance_in_usd": <number>, //0 if HOLD 
  "take_profit_distance_in_usd": <number>, //0 if HOLD 
  "reason": "<string>" //YOUR ENTIRE LOGIC GOES HERE
}`;
  }

  async generateSignal(marketData) {
    if (!marketData?.ohlc?.length) return this._fail('No OHLC data');
    const ind = calculateIndicatorSeries(marketData.ohlc);
    if (!ind) return this._fail('Indicator error');

    const context = { ohlc: marketData.ohlc, indicators: ind };
    const prompt  = this._prompt(context, loadLatestBlockReport());

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
