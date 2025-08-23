// strategyEngine.js  —  only buildLast10ClosedFromRawFills keeps debug logs
import fs from 'fs';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { log } from './logger.js';

const readLast10ClosedTradesFromFile = () => {
  try {
    return JSON.parse(fs.readFileSync('./trades.json', 'utf8'))
               .filter(t => t.exitTime)
               .slice(-10);
  } catch { return []; }
};

function buildLast10ClosedFromRawFills(rawFills, n = 10) {
  if (!Array.isArray(rawFills) || rawFills.length === 0) return [];

  const fills = [...rawFills].reverse();           // newest→oldest → oldest→newest
  const queue = [];
  const closed = [];

  for (const f of fills) {
    const side = f.side === 'buy' ? 'LONG' : 'SHORT';

    // opening leg
    if (!queue.length || queue.at(-1).side === side) {
      queue.push({ side, entryTime: f.fillTime, entryPrice: f.price, size: f.size });
      continue;
    }

    // closing leg(s)
    let remaining = f.size;
    while (remaining > 0 && queue.length && queue[0].side !== side) {
      const open = queue.shift();
      const match = Math.min(remaining, open.size);
      const pnl = (f.price - open.entryPrice) * match * (open.side === 'LONG' ? 1 : -1);

      closed.push({
        side: open.side,
        entryTime: open.entryTime,
        entryPrice: open.entryPrice,
        exitTime: f.fillTime,
        exitPrice: f.price,
        size: match,
        pnl
      });
      remaining -= match;
      open.size -= match;
      if (open.size > 0) queue.unshift(open);
    }

    if (remaining > 0) {
      queue.push({ side, entryTime: f.fillTime, entryPrice: f.price, size: remaining });
    }
  }

  const last10 = closed.slice(-n).reverse(); // newest-last
  console.log('--- last10 closed trades ----------------------------------');
  console.table(last10);
  console.log('----------------------------------------------------------');
  return last10;
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
        return { ok: true, text };
      } catch (err) {
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

    const last10 = market.fills?.fills
      ? buildLast10ClosedFromRawFills(market.fills.fills, 10)
      : readLast10ClosedTradesFromFile();

    return `
Expert PF_XBTUSD strategist: every 60 min output LONG/SHORT/HOLD JSON with calculated stops/targets; repeat after fills.

Candles (720×1h): ${JSON.stringify(market.ohlc)}
Summary:
- lastClose=${latest}
- 20SMA=${sma20.toFixed(2)}
- momentum=${momPct}%
- 14ATR=${volPct}%

last10=${JSON.stringify(last10)}

Return JSON:{"signal":"LONG|SHORT|HOLD","confidence":0-100,"stop_loss_distance_in_usd":<n>,"take_profit_distance_in_usd":<n>,"reason":"<str>"}`;
  }

  async generateSignal(marketData) {
    if (!marketData?.ohlc?.length) return this._fail('No OHLC');
    const prompt = this._prompt(marketData);
    const { ok, text } = await this._callWithRetry(prompt);
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
