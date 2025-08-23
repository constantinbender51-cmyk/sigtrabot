// strategyEngine.js
import fs from 'fs';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { log } from './logger.js';

const latest10ClosedTrades = () => {
  try {
    return JSON.parse(fs.readFileSync('./trades.json', 'utf8'))
      .filter(t => t.exitTime)
      .slice(-10);
  } catch { return []; }
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
        log.info(`[GEMINI_ATTEMPT_${i}]:\n${text}\n---`);
        return { ok: true, text };
      } catch (err) {
        log.warn(`[GEMINI] Attempt ${i} failed: ${err.message}`);
        if (i === max) return { ok: false, error: err };
        await new Promise(r => setTimeout(r, 61_000));
      }
    }
  }

  _prompt(market) {
    const closes = market.ohlc.map(c => c.close);
    const latest = closes.at(-1);
    const sma20  = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const atr14  = (() => {
      const trs = [];
      for (let i = 1; i < 15; i++) {
        const h  = market.ohlc.at(-i).high;
        const l  = market.ohlc.at(-i).low;
        const pc = market.ohlc.at(-i - 1)?.close ?? h;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      }
      return trs.reduce((a, b) => a + b, 0) / 14;
    })();

    const momPct = ((latest - sma20) / sma20 * 100).toFixed(2);
    const volPct = (atr14 / latest * 100).toFixed(2);

    return `
Expert PF_XBTUSD strategist: every 60 min output LONG/SHORT/HOLD JSON with calculated stops/targets; repeat after fills.

Candles (720×1h): ${JSON.stringify(market.ohlc)}
Summary:
- lastClose=${latest}
- 20SMA=${sma20.toFixed(2)}
- momentum=${momPct}%
- 14ATR=${volPct}%

last10=${JSON.stringify(latest10ClosedTrades())}

Return JSON:{"signal":"LONG|SHORT|HOLD","confidence":0-100,"stop_loss_distance_in_usd":<n>,"take_profit_distance_in_usd":<n>,"reason":"<str>"}`;
  }

  async generateSignal(marketData) {
    if (!marketData?.ohlc?.length) return this._fail('No OHLC');
    const prompt = this._prompt({ ohlc: marketData.ohlc });
    const { ok, text } = await this._callWithRetry(prompt);
    if (!ok) return this._fail('Bad AI response');

    try {
      return JSON.parse(text.match(/\{.*\}/s)?.[0]);
    } catch {
      return this._fail('Parse error');
    }
  }

  _fail(reason) {
    return { signal: 'HOLD', confidence: 0, stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0, reason };
  }
}
