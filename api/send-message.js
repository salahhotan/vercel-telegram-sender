// NOTE: There  . is NO import from '@vercel/edge-config'

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // These environment variables are critical.
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';
    
    // Credentials for updating Edge Config via API
    const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
    const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;

    if (!BOT_TOKEN || !CHANNEL_ID || !EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
        console.error('Server configuration error: Missing one or more required environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol || !interval || !strategy) {
            return res.status(400).json({ error: 'Missing required parameters: symbol, interval, strategy' });
        }

        const twelveDataSymbol = symbol.includes('/') ? symbol : symbol;

        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=50`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();
        
        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            return res.status(500).json({ error: 'Failed to fetch time series data', details: timeSeriesData.message });
        }
        
        if (timeSeriesData.values.length < 21) {
            return res.status(400).json({ error: 'Not enough time series data to calculate indicators.' });
        }
        
        const values = timeSeriesData.values.reverse();
        const closes = values.map(v => parseFloat(v.close));
        const highs = values.map(v => parseFloat(v.high));
        const lows = values.map(v => parseFloat(v.low));
        const opens = values.map(v => parseFloat(v.open));
        const currentClose = closes[closes.length - 1];
        const currentOpen = opens[opens.length - 1];

        // --- Indicator logic (unchanged) ---
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
                const stochValue = ((close[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
                result.push(stochValue);
            }
            return result;
        }
        function ema(values, period) {
            const k = 2 / (period + 1);
            let result = [values[0]];
            for (let i = 1; i < values.length; i++) {
                result.push(values[i] * k + result[i - 1] * (1 - k));
            }
            return result;
        }
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
        const buyCondition = currentClose < lowEma[lowEma.length - 1] && currentOpen < hl2 && currentClose < currentEma21 && currentD < 50 && currentK < 50;
        const sellCondition = currentClose > highEma[highEma.length - 1] && currentOpen > hl2 && currentClose > currentEma21 && currentD > 50 && currentK > 50;
        
        let signal = "HOLD";
        let reason = `No clear signal (K:${currentK.toFixed(2)}, D:${currentD.toFixed(2)})`;
        if (buyCondition) {
            signal = "BUY";
            reason = `BUY signal: Stoch K/D < 50 and other EMA conditions met.`;
        }
        if (sellCondition) {
            signal = "SELL";
            reason = `SELL signal: Stoch K/D > 50 and other EMA conditions met.`;
        }
        
        // --- Send to Telegram (unchanged) ---
        const message = `📈 ${symbol} (${interval}min) -> ${signal}`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL_ID, text: message })
        });
        
        // --- CORRECT WAY TO SAVE TO EDGE CONFIG ---
        try {
            const edgeConfigKey = `signal_${symbol.replace('/', '')}_${interval}min`;
            const vercelApiUrl = `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`;

            const apiResponse = await fetch(vercelApiUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    items: [
                        {
                            operation: 'update', // or 'upsert' to create if it doesn't exist
                            key: edgeConfigKey,
                            value: signal,
                        },
                    ],
                }),
            });

            if (!apiResponse.ok) {
                const errorBody = await apiResponse.json();
                // Log the error but don't crash the function
                console.error('Failed to save to Edge Config:', errorBody);
            }

        } catch (edgeConfigError) {
            console.error('Error while trying to save to Edge Config:', edgeConfigError.message);
        }

        return res.status(200).json({ success: true, signal, reason });

    } catch (error) {
        console.error('Function execution error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
