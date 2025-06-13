import { getEdgeConfig } from '@vercel/edge-config';
import { createClient } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';
    const EDGE_CONFIG = process.env.EDGE_CONFIG;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    if (!EDGE_CONFIG) {
        return res.status(500).json({ error: 'Missing Edge Config configuration' });
    }

    const edgeConfig = await getEdgeConfig(EDGE_CONFIG);

    try {
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!interval) return res.status(400).json({ error: 'Missing interval parameter' });
        if (!strategy) return res.status(400).json({ error: 'Missing strategy parameter' });

        // Normalize symbol for TwelveData API
        const twelveDataSymbol = symbol.includes('/') 
            ? `${symbol.replace('/', '/')}`
            : symbol;

        // Get time series data
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=50`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();
        
        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            console.error('TwelveData Error:', timeSeriesData);
            return res.status(500).json({ 
                error: 'Failed to fetch time series data',
                details: timeSeriesData.message || 'Invalid symbol or API issue'
            });
        }

        // Get current quote data
        const quoteUrl = `https://api.twelvedata.com/quote?symbol=${twelveDataSymbol}&apikey=${TWELVEDATA_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();
        
        if (quoteData.status === 'error') {
            console.error('TwelveData Error:', quoteData);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                details: quoteData.message || 'Invalid symbol or API issue'
            });
        }

        // Extract price data
        const values = timeSeriesData.values.reverse();
        const closes = values.map(v => parseFloat(v.close));
        const highs = values.map(v => parseFloat(v.high));
        const lows = values.map(v => parseFloat(v.low));
        const opens = values.map(v => parseFloat(v.open));
        
        // Current price data
        const currentClose = closes[closes.length - 1];
        const currentOpen = opens[opens.length - 1];
        const currentHigh = highs[highs.length - 1];
        const currentLow = lows[lows.length - 1];

        // Helper functions for indicators
        function sma(values, period) {
            const result = [];
            for (let i = period - 1; i < values.length; i++) {
                const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
                result.push(sum / period);
            }
            return result;
        }

        function stoch(close, high, low, period) {
            const result = [];
            for (let i = period - 1; i < close.length; i++) {
                const highestHigh = Math.max(...high.slice(i - period + 1, i + 1));
                const lowestLow = Math.min(...low.slice(i - period + 1, i + 1));
                const currentClose = close[i];
                const stochValue = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
                result.push(stochValue);
            }
            return result;
        }

        function ema(values, period) {
            const k = 2 / (period + 1);
            const result = [values[0]];
            for (let i = 1; i < values.length; i++) {
                result.push(values[i] * k + result[i - 1] * (1 - k));
            }
            return result;
        }

        // Calculate indicators
        const stochValues = stoch(closes, highs, lows, 14);
        const k = sma(stochValues, 1);
        const d = sma(k, 3);
        const currentK = k[k.length - 1];
        const currentD = d[d.length - 1];

        const highEma = ema(highs, 4);
        const lowEma = ema(lows, 4);
        const hl2 = (highEma[highEma.length - 1] + lowEma[lowEma.length - 1]) / 2;
        const ema21 = ema(closes, 21);
        const currentEma21 = ema21[ema21.length - 1];

        // Strategy conditions
        const buyCondition = currentClose < lowEma[lowEma.length - 1] && 
                            currentOpen < hl2 && 
                            currentClose < currentEma21 && 
                            currentD < 50 && 
                            currentK < 50;

        const sellCondition = currentClose > highEma[highEma.length - 1] && 
                             currentOpen > hl2 && 
                             currentClose > currentEma21 && 
                             currentD > 50 && 
                             currentK > 50;

        let signal = "HOLD";
        let reason = "";
        
        if (buyCondition) {
            signal = "BUY";
            reason = `EMA/Stoch strategy BUY signal: Close below Low EMA, Open below HL2, Close below 21 EMA, Stoch K/D below 50 (K: ${currentK.toFixed(2)}, D: ${currentD.toFixed(2)})`;
        } else if (sellCondition) {
            signal = "SELL";
            reason = `EMA/Stoch strategy SELL signal: Close above High EMA, Open above HL2, Close above 21 EMA, Stoch K/D above 50 (K: ${currentK.toFixed(2)}, D: ${currentD.toFixed(2)})`;
        } else {
            signal = "HOLD";
            reason = `No clear EMA/Stoch strategy signal (K: ${currentK.toFixed(2)}, D: ${currentD.toFixed(2)})`;
        }

        // Create signal data object
        const signalData = {
            symbol,
            interval,
            strategy,
            timestamp: new Date().toISOString(),
            price: currentClose,
            ema21: currentEma21,
            stochK: currentK,
            stochD: currentD,
            signal,
            reason
        };

        // Store signal in Edge Config
        try {
            // Get current signals
            const currentSignals = await edgeConfig.get('signals') || [];
            
            // Add new signal (limit to 100 most recent)
            const updatedSignals = [signalData, ...currentSignals].slice(0, 100);
            
            // Update Edge Config
            await edgeConfig.update({
                signals: updatedSignals
            });
            
            console.log('Signal stored in Edge Config');
        } catch (edgeError) {
            console.error('Error storing signal in Edge Config:', edgeError);
            // Don't fail the whole request if Edge Config storage fails
        }

        // Format message for Telegram
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Price: ${currentClose.toFixed(5)}
📊 EMA21: ${currentEma21.toFixed(5)}
📉 Stoch K/D: ${currentK.toFixed(2)}/${currentD.toFixed(2)}
🚦 Signal: ${signal}
💡 Reason: ${reason}

🕒 ${new Date().toLocaleString()}`;

        // Send to Telegram
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
            ...signalData
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
