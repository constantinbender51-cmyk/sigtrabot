// strategyEngine.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { log } from './logger.js';
import { calculateIndicatorSeries } from './indicators.js';

export class StrategyEngine {
    constructor() {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const safetySettings = [{
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        }];
        this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", safetySettings });
        log.info("StrategyEngine V3 initialized (Full Autonomy).");
    }

        /* --------------  RETRY HELPER (61 s fixed delay) -------------- */
    async _callWithRetry(prompt, maxAttempts = 4) {
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                log.info(`[GEMINI] Attempt ${attempt}/${maxAttempts}`);
                const result = await this.model.generateContent(prompt);

                const text = result.response.text?.();
                if (!text || text.length < 10) {
                    throw new Error("Empty or too-short response");
                }

                return { ok: true, text, fullResult: result };
            } catch (err) {
                lastError = err;

                // FIXED 61-second pause between retries
                const delay = 61_000;
                log.warn(`[GEMINI] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay / 1000}s …`);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        log.error(`[GEMINI] All ${maxAttempts} attempts failed. Giving up.`);
        return { ok: false, error: lastError };
    }
    /* -------------------------------------------------------------- */

    _createPrompt(contextualData) {
        const dataPayload = JSON.stringify(contextualData, null, 2);

        return `
            You are an expert quantitative strategist and risk manager for the PF_XBTUSD market.
            Your ONLY job is to produce a single JSON object that defines a complete trade plan.
            You will be asked every 120 hours to to perform this task until an order is placed and it will be waited, until either the stoploss or takeprofit orders are triggered.
            
            **Provided Market Data:**
            You have been provided with the last 720 1-hour OHLC candles and their corresponding indicator series.
            ${dataPayload}

            **Your Task (Produce the final JSON based on your complete analysis):**
            1.  **"signal"**: Decide on one of three actions: "LONG", "SHORT", or "HOLD".
            2.  **"confidence"**: Directly determine your confidence in this signal, from 0 to 100. A confidence below 50 must result in a "HOLD" signal.
            3.  **"stop_loss_distance_in_usd"**: This is a critical risk management parameter. Provide the optimal stop-loss distance in USD, based on all available data (volatility, support/resistance, market structure). If the signal is HOLD, this must be 0.
            4.  **"take_profit_distance_in_usd"**: Provide the optimal take-profit distance in USD. This should be based on your analysis of potential price targets and the market's current momentum. If the signal is HOLD, this must be 0.
            5.  **"reason"**: Provide a detailed, step-by-step explanation for your entire trade plan.

            **Output Format (Strict JSON only):**
            Return ONLY a JSON object with the five keys: "signal", "confidence", "reason", "stop_loss_distance_in_usd", and "take_profit_distance_in_usd".
        `;
    }

    async generateSignal(marketData) {
        if (!marketData?.ohlc?.length) {
            log.warn("StrategyEngine: Invalid or empty OHLC data provided.");
            return { signal: 'HOLD', confidence: 0, reason: 'Insufficient market data.', stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0 };
        }

        const indicatorSeries = calculateIndicatorSeries(marketData.ohlc);
        if (!indicatorSeries) {
            return { signal: 'HOLD', confidence: 0, reason: 'Could not calculate indicators.', stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0 };
        }

        const contextualData = {
            ohlc: marketData.ohlc,
            indicators: indicatorSeries
        };

        const prompt = this._createPrompt(contextualData);

        /* --------------  RETRY-AWARE CALL  -------------- */
        const { ok, text, error } = await this._callWithRetry(prompt);
        if (!ok) {
            log.error(`[GEMINI] Final failure: ${error.message}`);
            return { signal: 'HOLD', confidence: 0, reason: 'Failed to get a valid signal from the AI model.', stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0 };
        }

        /* ----------  PARSE & VALIDATE RESPONSE  ---------- */
        try {
            log.info(`[GEMINI_RAW_RESPONSE]:\n---\n${text}\n---`);

            const jsonMatch = text.match(/\{.*\}/s);
            if (!jsonMatch) throw new Error("No JSON block found");

            const signalData = JSON.parse(jsonMatch[0]);

            if (
                !['LONG', 'SHORT', 'HOLD'].includes(signalData.signal) ||
                typeof signalData.confidence !== 'number' ||
                typeof signalData.stop_loss_distance_in_usd !== 'number' ||
                typeof signalData.take_profit_distance_in_usd !== 'number'
            ) {
                throw new Error("Validation failed");
            }

            return signalData;
        } catch (parseErr) {
            log.error(`[GEMINI] Parsing error: ${parseErr.message}`);
            return { signal: 'HOLD', confidence: 0, reason: 'Failed to parse AI response.', stop_loss_distance_in_usd: 0, take_profit_distance_in_usd: 0 };
        }
    }
}
