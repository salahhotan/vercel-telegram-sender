// Import Firebase Admin SDK
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- Firebase Admin Initialization ---
// Define service account credentials from environment variables
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // Replace escaped newlines from .env file with actual newlines
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Initialize Firebase only if it hasn't been initialized yet
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

        // Normalize symbol for TwelveData API (forex pairs use format: EUR/USD)
        const twelveDataSymbol = symbol.includes('/') 
            ? `${symbol.replace('/', '/')}` // Keep as EUR/USD for forex
            : symbol;

        // 1. Get time series data for price change calculation
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

        // 2. Get current quote data
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
        const values = timeSeriesData.values.reverse(); // Reverse to get chronological order
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
        // Stochastics
        const stochValues = stoch(closes, highs, lows, 14);
        const k = sma(stochValues, 1);
        const d = sma(k, 3);
        const currentK = k[k.length - 1];
        const currentD = d[d.length - 1];

        // EMAs
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

        // Format message
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Price: ${currentClose.toFixed(5)}
📊 EMA21: ${currentEma21.toFixed(5)}
📉 Stoch K/D: ${currentK.toFixed(2)}/${currentD.toFixed(2)}
🚦 Signal: ${signal}
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

        // <<< START OF ADDED CODE >>>
        // After sending to Telegram, save the signal to Firestore, but only if it's a BUY or SELL
        if (signal !== 'HOLD') {
            try {
                // Construct the data object to be saved
                const signalData = {
                    symbol,
                    interval: `${interval}min`,
                    strategy,
                    signal,
                    reason,
                    price: currentClose,
                    indicators: {
                        ema21: currentEma21,
                        stochK: currentK,
                        stochD: currentD,
                    },
                    // Use Firestore's server-side timestamp for accuracy
                    timestamp: FieldValue.serverTimestamp(), 
                };

                // Add a new document with an auto-generated ID to the 'signals' collection
                const docRef = await db.collection('signals').add(signalData);
                console.log(`Signal for ${symbol} saved to Firestore with ID: ${docRef.id}`);

            } catch (firestoreError) {
                // Log the error but don't block the API response
                console.error("Error saving signal to Firestore:", firestoreError);
            }
        }
        // <<< END OF ADDED CODE >>>

        return res.status(200).json({ 
            success: true,
            symbol,
            interval,
            strategy,
            currentPrice: currentClose,
            ema21: currentEma21,
            stochK: currentK,
            stochD: currentD,
            signal,
            reason
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
