// Import Firebase Admin SDK (for server-side use)
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- Firebase Admin Initialization ---
// This block reads the credentials securely from Vercel's environment variables
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // Vercel handles multi-line env vars, but this replace() makes it robust
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Initialize Firebase only if it hasn't been initialized yet
// This is important to prevent re-initialization on hot reloads
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Firebase Admin SDK initialization error:", error.message);
  }
}

// Get a reference to the Firestore database
const db = getFirestore();
// --- End of Firebase Initialization ---


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

        // Normalize symbol for TwelveData API
        const twelveDataSymbol = symbol.includes('/') ? symbol : symbol;

        // 1. Get time series data
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
        
        // ... (rest of your logic for calculating indicators remains the same)
        const values = timeSeriesData.values.reverse();
        const closes = values.map(v => parseFloat(v.close));
        const highs = values.map(v => parseFloat(v.high));
        const lows = values.map(v => parseFloat(v.low));
        const opens = values.map(v => parseFloat(v.open));
        const currentClose = closes[closes.length - 1];
        const currentOpen = opens[opens.length - 1];

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
                result.push(((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100);
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

        const message = `📈 ${symbol} Trade Signal (${strategy})...`; // (your message format)

        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL_ID, text: message, parse_mode: 'Markdown' })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        // Save to Firestore if it's a BUY or SELL signal
        if (signal !== 'HOLD') {
            try {
                const signalData = {
                    symbol,
                    interval: `${interval}min`,
                    strategy,
                    signal,
                    price: currentClose,
                    timestamp: FieldValue.serverTimestamp(), 
                    result: null,
                };
                const docRef = await db.collection('signals').add(signalData);
                console.log(`Signal for ${symbol} saved to Firestore with ID: ${docRef.id}`);
            } catch (firestoreError) {
                console.error("Error saving signal to Firestore:", firestoreError);
            }
        }

        return res.status(200).json({ success: true, signal, reason });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
