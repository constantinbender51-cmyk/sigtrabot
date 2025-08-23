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
    this._signalMemory = [];
    this._insideGenerateSignal = false;
    log.info('StrategyEngine ready.');
  }

  async _callWithRetry(prompt, max = 4) {
    for (let i = 1; i <= max; i++) {
      try {
        const res = await this.model.generateContent(prompt);
        const text = res.response.text?.();
        if (!text?.length) throw new Error('Empty response');
        if (this._insideGenerateSignal) {
          this._signalMemory.push(text);
          if (this._signalMemory.length > 50) 
            this._signalMemory.shift(); // keep last 50
        }
            
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

You are an expert strategist for PF_XBTUSD. Use step-by-step math, not narrative fluff to derive a trade setup. You will be called every 60 minutes until a short or long order has been placed and their corresponding stoploss and takeprofit orders. After those have been triggered you will be called again until a new order has been placed.
Last 10 closed trades:
${JSON.stringify(recent, null, 2)}

Market data (720 1-h candles, indicators where apply):
${JSON.stringify(market, null, 2)}

${this._signalMemory.length ? `
Previous reasoning chain (oldest → newest):
${this._signalMemory.map((r, i) => `[${i + 1}] 
${r}`).join('\n\n')}
` : ''}
    
Return somewhere in your response this JSON:
{
  "signal": "LONG|SHORT|HOLD", 
  "confidence": <0-100>, //Derive this by calculation 
  "stop_loss_distance_in_usd": <number>, //0 if HOLD, calculate based on target
  "take_profit_distance_in_usd": <number>, //0 if HOLD, calculate this based on target
  "reason": "<string>" 
}`;
  }

  async generateSignal(marketData) {
    if (!marketData?.ohlc?.length) return this._fail('No OHLC data');
    const ind = calculateIndicatorSeries(marketData.ohlc);
    if (!ind) return this._fail('Indicator error');

    const context = { ohlc: marketData.ohlc, indicators: ind };
    const prompt  = this._prompt(context, loadLatestBlockReport());
    this._insideGenerateSignal = true;

    const { ok, text, error } = await this._callWithRetry(prompt);
    this._insideGenerateSignal = false;
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
