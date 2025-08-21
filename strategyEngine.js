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
        this.model = genAI.getGenerativeModel({ model: "gemini-2.5-pro", safetySettings });
        log.info("StrategyEngine V3 initialized (Full Autonomy).");
    }

    _createPrompt(contextualData) {
        const dataPayload = JSON.stringify(contextualData, null, 2);

        return `
            You are an expert quantitative strategist and risk manager for the PF_XBTUSD market.
            Your ONLY job is to produce a single JSON object that defines a complete trade plan.

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

        let responseText = ""; // Define outside to be accessible in catch
        try {
            // --- STEP 1 & 2: Calculate Indicators and Prepare Payload (Unaltered) ---
            const indicatorSeries = calculateIndicatorSeries(marketData.ohlc);
            if (!indicatorSeries) {
                return { signal: 'HOLD', confidence: 0, reason: 'Could not calculate indicators.', stop_loss_distance_in_usd: 0 };
            }

            // --- STEP 2: PREPARE FULL CONTEXTUAL PAYLOAD FOR AI ---
            const contextualData = {
                ohlc: marketData.ohlc, // The full 720 candles
                indicators: indicatorSeries // The full indicator series
            };
            // --- STEP 3: MAKE STRATEGIC DECISION WITH AI ---
    
    /* continue parsing ... */
} catch (error) {
    /* NEW: print the *original* SDK error structure */
    log.error("Caught in generateSignal", {
        name: error.name,
        message: error.message,
        stack: error.stack,
        response: error.response             // ← GoogleGenerativeAIResponseError puts it here
    });
    throw error;  // let the back-test die so you see everything in one place
            }
            const strategistPrompt = this._createPrompt(contextualData);
            /* -------- NEW: dump the whole SDK envelope -------- */
    log.info(
        "[GEMINI_SDK_RESULT]:\n" +
        JSON.stringify(strategistResult, null, 2)
    );
    /* -------------------------------------------------- */

    responseText = strategistResult.response?.text?.() ?? "";
    log.info(`[GEMINI_RAW_RESPONSE]:\n---\n${responseText}\n---`);

    if (!responseText.trim()) {
        // Now we can also inspect the HTTP metadata
        const metadata = strategistResult.response?.response; // underlying fetch Response
        const status   = metadata?.status;
        const headers  = Object.fromEntries(metadata?.headers ?? []);
        log.error(`Empty body received. HTTP status=${status}`, { headers });
        throw new Error(`Gemini returned HTTP ${status} with empty body`);
    }

            // Use a more resilient method to find the JSON block
            const jsonMatch = responseText.match(/\{.*\}/s);
            if (!jsonMatch) {
                throw new Error("No valid JSON object found in the AI's response.");
            }
            
            const signalJsonText = jsonMatch[0];
            const signalData = JSON.parse(signalJsonText);

            // Add validation for the new fields
            if (
                !['LONG', 'SHORT', 'HOLD'].includes(signalData.signal) ||
                typeof signalData.confidence !== 'number' ||
                typeof signalData.stop_loss_distance_in_usd !== 'number' ||
                typeof signalData.take_profit_distance_in_usd !== 'number'
            ) {
                throw new Error(`AI response is missing required fields or has incorrect types.`);
            }
            
            return signalData;

        } catch (error) {
    /* NEW: print the *original* SDK error structure */
    log.error("Caught in generateSignal", {
        name: error.name,
        message: error.message,
        stack: error.stack,
        response: error.response             // ← GoogleGenerativeAIResponseError puts it here
    });
    throw error;  // let the back-test die so you see everything in one place
}

