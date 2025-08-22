// strategyEngine.js – concise & still functional
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { log } from './logger.js';
import { calculateIndicatorSeries } from './indicators.js';

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
        return { ok: true, text };
      } catch (err) {
        log.warn(`Gemini attempt ${i}/${max}: ${err.message} → retry in 61 s`);
        if (i === max) return { ok: false, error: err };
        await new Promise(r => setTimeout(r, 61_000));
      }
    }
  }

  _prompt(market, block) {
    return `
You are an expert strategist for PF_XBTUSD.
Last 10-trade summary:
${block ? JSON.stringify(block, null, 2) : 'N/A'}

Market data (720 1-h candles):
${JSON.stringify(market, null, 2)}

Return **only** this JSON:
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
