// Helper functions for Technical Analysis
// These replicate the logic from the Pine Script

/**
 * Calculates the Exponential Moving Average (EMA) for a given dataset.
 * @param {number[]} data - Array of prices (e.g., close, high, low).
 * @param {number} period - The EMA period (e.g., 21).
 * @returns {number[]} - Array of EMA values.
 */
function calculateEMA(data, period) {
    if (data.length < period) return [];
    const k = 2 / (period + 1);
    const emaArray = [data[0]]; // Start with the first price
    for (let i = 1; i < data.length; i++) {
        const ema = (data[i] * k) + (emaArray[i - 1] * (1 - k));
        emaArray.push(ema);
    }
    return emaArray;
}

/**
 * Calculates the Simple Moving Average (SMA) for a given dataset.
 * @param {number[]} data - Array of values.
 * @param {number} period - The SMA period.
 * @returns {number[]} - Array of SMA values.
 */
function calculateSMA(data, period) {
    if (data.length < period) return [];
    const smaArray = [];
    for (let i = period - 1; i < data.length; i++) {
        const chunk = data.slice(i - period + 1, i + 1);
        const sum = chunk.reduce((acc, val) => acc + val, 0);
        smaArray.push(sum / period);
    }
    // Pad the beginning with nulls to match original data length for easier indexing
    const padding = new Array(period - 1).fill(null);
    return [...padding, ...smaArray];
}

/**
 * Calculates the Stochastic Oscillator (%K and %D).
 * @param {object} params - The required data and periods.
 * @param {number[]} params.highs - Array of high prices.
 * @param {number[]} params.lows - Array of low prices.
 * @param {number[]} params.closes - Array of close prices.
 * @param {number} params.period - The main Stochastic period (length1).
 * @param {number} params.smoothK - The smoothing period for %K.
 * @param {number} params.smoothD - The smoothing period for %D.
 * @returns {{stochK: number[], stochD: number[]}} - The calculated %K and %D lines.
 */
function calculateStochastic({ highs, lows, closes, period, smoothK, smoothD }) {
    if (closes.length < period) return { stochK: [], stochD: [] };

    const stochValues = [];
    for (let i = period - 1; i < closes.length; i++) {
        const priceChunk = closes.slice(i - period + 1, i + 1);
        const highChunk = highs.slice(i - period + 1, i + 1);
        const lowChunk = lows.slice(i - period + 1, i + 1);

        const lowestLow = Math.min(...lowChunk);
        const highestHigh = Math.max(...highChunk);
        const currentClose = priceChunk[priceChunk.length - 1];
        
        const stoch = 100 * ((currentClose - lowestLow) / (highestHigh - lowestLow));
        stochValues.push(stoch);
    }

    // Pad the beginning to align with the original data length
    const padding = new Array(period - 1).fill(null);
    const fullStoch = [...padding, ...stochValues];

    const k_line = calculateSMA(fullStoch.filter(v => v !== null), smoothK);
    const d_line = calculateSMA(k_line.filter(v => v !== null), smoothD);

    return { stochK: k_line, stochD: d_line };
}


// --- API Handler ---

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!interval) return res.status(400).json({ error: 'Missing interval parameter' });
        if (!strategy) return res.status(400).json({ error: 'Missing strategy parameter' });

        const twelveDataSymbol = symbol.replace('/', '');

        // 1. Get time series data. We need more data for indicator calculations.
        const dataPoints = 100; // A safe number for up to 21-period EMAs/Stoch
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=${dataPoints}`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();
        
        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            console.error('TwelveData Error:', timeSeriesData);
            return res.status(500).json({ 
                error: 'Failed to fetch time series data',
                details: timeSeriesData.message || 'Invalid symbol or API issue'
            });
        }
        
        // 2. Prepare data for TA functions (API returns newest-first, we need oldest-first)
        const historicalData = timeSeriesData.values.reverse();
        const opens = historicalData.map(d => parseFloat(d.open));
        const highs = historicalData.map(d => parseFloat(d.high));
        const lows = historicalData.map(d => parseFloat(d.low));
        const closes = historicalData.map(d => parseFloat(d.close));

        if (closes.length < 21) { // 21 is the longest period in the strategy
             return res.status(500).json({ error: 'Not enough historical data to apply strategy.' });
        }

        // 3. Define strategy parameters from the Pine Script
        const stochParams = { length1: 14, smoothK: 1, smoothD: 3 };
        const highEmaLen = 4;
        const lowEmaLen = 4;
        const closeEmaLen = 21;

        // 4. Calculate all indicators
        const emaHigh = calculateEMA(highs, highEmaLen);
        const emaLow = calculateEMA(lows, lowEmaLen);
        const emaClose = calculateEMA(closes, closeEmaLen);
        const { stochK, stochD } = calculateStochastic({ 
            highs, lows, closes, 
            period: stochParams.length1, 
            smoothK: stochParams.smoothK, 
            smoothD: stochParams.smoothD 
        });

        // 5. Get the latest values for the current candle
        const currentOpen = opens[opens.length - 1];
        const currentClose = closes[closes.length - 1];
        const latestEmaHigh = emaHigh[emaHigh.length - 1];
        const latestEmaLow = emaLow[emaLow.length - 1];
        const midChannel = (latestEmaHigh + latestEmaLow) / 2;
        const latestEmaClose = emaClose[emaClose.length - 1];
        const latestK = stochK[stochK.length - 1];
        const latestD = stochD[stochD.length - 1];

        // 6. Apply the strategy logic
        let signal = "HOLD";
        let reason = "Conditions for a signal were not met.";
        
        const isBuySignal = currentClose < latestEmaLow && 
                            currentOpen < midChannel && 
                            currentClose < latestEmaClose && 
                            latestD < 50 && 
                            latestK < 50;

        const isSellSignal = currentClose > latestEmaHigh && 
                             currentOpen > midChannel && 
                             currentClose > latestEmaClose && 
                             latestD > 50 && 
                             latestK > 50;

        if (isBuySignal) {
            signal = "BUY"; // "UP" in Pine Script
            reason = "Close is below low EMA channel and 21-EMA, Open is below mid-channel, and Stochastics are below 50.";
        } else if (isSellSignal) {
            signal = "SELL"; // "DOWN" in Pine Script
            reason = "Close is above high EMA channel and 21-EMA, Open is above mid-channel, and Stochastics are above 50.";
        } else {
            signal = "HOLD";
            reason = `Neutral. Stoch(K,D): ${latestK.toFixed(2)},${latestD.toFixed(2)}. Price vs EMAs did not align.`;
        }

        // 7. Format and send the message
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Price: ${currentClose.toFixed(5)}
🚦 Signal: *${signal}*
💡 Reason: ${reason}

🕒 ${new Date().toLocaleString()}`;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            symbol,
            interval,
            strategy,
            signal,
            reason,
            data: {
                currentPrice: currentClose,
                emaHigh: latestEmaHigh,
                emaLow: latestEmaLow,
                emaClose: latestEmaClose,
                stochK: latestK,
                stochD: latestD
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
