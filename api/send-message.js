//  Import Firebase Admin SDK (for server-side use)
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

        // 1. Get time series data (increased outputsize for BB period)
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=250`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();
        
        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            console.error('TwelveData Error:', timeSeriesData);
            return res.status(500).json({ 
                error: 'Failed to fetch time series data',
                details: timeSeriesData.message || 'Invalid symbol or API issue'
            });
        }
        
        const values = timeSeriesData.values.reverse();
        const closes = values.map(v => parseFloat(v.close));
        const currentClose = closes[closes.length - 1];

        // --- Helper functions for indicators ---
        function sma(values, period) {
            if (values.length < period) return [];
            const result = [];
            for (let i = period - 1; i < values.length; i++) {
                const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
                result.push(sum / period);
            }
            return result;
        }

        // NEW: Standard Deviation function needed for Bollinger Bands
        function stdev(values, period) {
            if (values.length < period) return [];
            const result = [];
            for (let i = period - 1; i < values.length; i++) {
                const slice = values.slice(i - period + 1, i + 1);
                const mean = slice.reduce((a, b) => a + b, 0) / period;
                const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
                result.push(Math.sqrt(variance));
            }
            return result;
        }
        
        // NEW: RSI function
        function rsi(values, period) {
            if (values.length <= period) return [];
            const result = [];
            let gains = 0;
            let losses = 0;

            // Calculate initial average gain and loss
            for (let i = 1; i <= period; i++) {
                const change = values[i] - values[i - 1];
                if (change > 0) gains += change;
                else losses -= change;
            }
            let avgGain = gains / period;
            let avgLoss = losses / period;

            for (let i = period + 1; i < values.length; i++) {
                const change = values[i] - values[i - 1];
                let currentGain = change > 0 ? change : 0;
                let currentLoss = change < 0 ? -change : 0;
                
                avgGain = (avgGain * (period - 1) + currentGain) / period;
                avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
                
                if (avgLoss === 0) {
                     result.push(100);
                } else {
                    const rs = avgGain / avgLoss;
                    result.push(100 - (100 / (1 + rs)));
                }
            }
            // Add a placeholder for the initial period to align arrays
            const initialRSI = [ ...Array(period + 1).fill(50) ];
            return initialRSI.concat(result);
        }

        // NEW: Bollinger Bands function
        function bb(values, period, multiplier) {
            const basis = sma(values, period);
            const dev = stdev(values, period);
            if (basis.length !== dev.length) return { basis: [], upper: [], lower: []};

            const upper = basis.map((val, index) => val + (dev[index] * multiplier));
            const lower = basis.map((val, index) => val - (dev[index] * multiplier));
            
            // Align arrays by adding placeholders
            const placeholder = [ ...Array(values.length - basis.length).fill(NaN) ];
            return {
                basis: placeholder.concat(basis),
                upper: placeholder.concat(upper),
                lower: placeholder.concat(lower)
            };
        }

        // --- START OF STRATEGY REPLACEMENT ---

        // 1. Define Strategy Parameters from Pine Script
        const rsiLength = 6;
        const rsiOverSold = 50;
        const rsiOverBought = 50;
        const bbLength = 200;
        const bbMult = 2.0;

        // 2. Calculate Indicators
        const rsiValues = rsi(closes, rsiLength);
        const { upper: bbUpper, lower: bbLower } = bb(closes, bbLength, bbMult);

        // Ensure we have enough data (at least 2 points) to check for a cross
        if (rsiValues.length < 2 || bbUpper.length < 2 || closes.length < 2) {
             return res.status(200).json({ success: true, signal: "HOLD", reason: "Not enough data to compute indicators." });
        }
        
        // 3. Get Current and Previous values for crossover/crossunder logic
        const currentIndex = closes.length - 1;
        const prevIndex = closes.length - 2;

        const currentRsi = rsiValues[currentIndex];
        const prevRsi = rsiValues[prevIndex];

        const currentPrice = closes[currentIndex];
        const prevPrice = closes[prevIndex];

        const currentBbUpper = bbUpper[currentIndex];
        const prevBbUpper = bbUpper[prevIndex];
        
        const currentBbLower = bbLower[currentIndex];
        const prevBbLower = bbLower[prevIndex];

        // 4. Define Final Buy/Sell Conditions (Translating crossover/crossunder)
        
        // Crossover: The value was below the threshold on the previous bar and is now at or above it.
        const rsiCrossover = prevRsi < rsiOverSold && currentRsi >= rsiOverSold;
        const priceCrossoverBbLower = prevPrice < prevBbLower && currentPrice >= currentBbLower;
        const buyCondition = rsiCrossover && priceCrossoverBbLower;

        // Crossunder: The value was above the threshold on the previous bar and is now at or below it.
        const rsiCrossunder = prevRsi > rsiOverBought && currentRsi <= rsiOverBought;
        const priceCrossunderBbUpper = prevPrice > prevBbUpper && currentPrice <= currentBbUpper;
        const sellCondition = rsiCrossunder && priceCrossunderBbUpper;
        
        // --- END OF STRATEGY REPLACEMENT ---

        let signal = "HOLD";
        
        if (buyCondition) {
            signal = "BUY";
        } else if (sellCondition) {
            signal = "SELL";
        }

        // Save to Firestore and send to Telegram if it's a BUY or SELL signal
        if (signal !== 'HOLD') {
            try {
                // 1. Data to be saved and sent
                const signalData = {
                    symbol,
                    interval: `${interval}min`,
                    strategy,
                    signal,
                    price: currentClose,
                    timestamp: FieldValue.serverTimestamp(), 
                    result: null, // This field will be updated later
                };
                
                // 2. Save to Firestore
                const docRef = await db.collection('signals').add(signalData);
                console.log(`Signal for ${symbol} saved to Firestore with ID: ${docRef.id}`);

                // 3. Prepare and send the detailed message to Telegram
                const signalEmoji = signal === 'BUY' ? '🟢' : '🔴';
                const messageForTelegram = `
*${signalEmoji} ${signal} Signal*

*Symbol:* \`${symbol}\`
*Interval:* \`${interval}min\`
*Price:* \`${currentClose.toFixed(5)}\`
*Strategy:* \`${strategy}\`
                `.trim();

                // Send the message, handling potential errors gracefully
                const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CHANNEL_ID,
                        text: messageForTelegram,
                        parse_mode: 'Markdown'
                    })
                });

                if (!telegramResponse.ok) {
                    const errorData = await telegramResponse.json();
                    console.error("Failed to send Telegram message:", errorData.description);
                } else {
                    console.log("Signal successfully sent to Telegram.");
                }

            } catch (firestoreError) {
                console.error("Error saving signal to Firestore:", firestoreError.message);
            }
        }

        return res.status(200).json({ success: true, signal });

    } catch (error) {
        console.error('Error in handler:', error);
        // Notify via Telegram if the whole handler fails
        try {
            const errorMessage = `🚨 **API Error:**\nAn error occurred in the signal handler.\n\`\`\`\n${error.message}\n\`\`\``;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CHANNEL_ID, text: errorMessage, parse_mode: 'Markdown' })
            });
        } catch (telegramError) {
            console.error("Also failed to send error message to Telegram:", telegramError.message);
        }
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
