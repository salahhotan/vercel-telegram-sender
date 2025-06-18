import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- Firebase Admin Initialization ---
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length) {
  try {
    initializeApp({ credential: cert(serviceAccount) });
    console.log("Firebase Admin SDK initialized successfully for robust checker.");
  } catch (error) {
    console.error("Firebase Admin SDK initialization error:", error.message);
  }
}

const db = getFirestore();
// --- End of Firebase Initialization ---

export default async function handler(req, res) {
    // --- Security Check ---
    const { secret } = req.query;
    if (req.method !== 'GET' || secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || 'YOUR_DEFAULT_API_KEY';

    if (!BOT_TOKEN || !CHANNEL_ID || !TWELVEDATA_API_KEY) {
        return res.status(500).json({ error: 'Missing server configuration' });
    }

    try {
        // 1. Get all signals that have not been checked yet
        const signalsRef = db.collection('signals');
        const snapshot = await signalsRef.where('result', '==', null).get();

        if (snapshot.empty) {
            console.log('No new signals to check.');
            return res.status(200).json({ message: 'No new signals to check.' });
        }

        console.log(`Found ${snapshot.docs.length} unchecked signal(s).`);

        // Use a loop to process each unchecked signal independently
        for (const doc of snapshot.docs) {
            const signalData = doc.data();
            const signalId = doc.id;

            // Get the timestamp when the signal was created in Firestore
            const signalTimestamp = signalData.timestamp.toDate();
            
            // 2. Fetch the last few candles for the signal's symbol
            // Fetching 10 candles should be more than enough to find the next one
            const interval = signalData.interval;
            const symbol = signalData.symbol;
            const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&apikey=${TWELVEDATA_API_KEY}&outputsize=10`;
            
            const timeSeriesResponse = await fetch(timeSeriesUrl);
            const timeSeriesData = await timeSeriesResponse.json();

            if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
                console.error(`TwelveData Error for ${symbol}:`, timeSeriesData.message || 'Unknown error');
                continue; // Skip to the next signal
            }

            // 3. Find the correct "next candle"
            // The API returns data in reverse chronological order (newest first)
            const candles = timeSeriesData.values; 
            let nextCandle = null;

            for (const candle of candles) {
                const candleTimestamp = new Date(candle.datetime);
                // We are looking for the first candle whose close time is AFTER the signal was generated.
                if (candleTimestamp > signalTimestamp) {
                    nextCandle = candle;
                    // We keep iterating to find the EARLIEST candle that is after the signal.
                    // Since the data is newest-first, the last match we find will be the correct one.
                }
            }

            if (!nextCandle) {
                console.log(`Signal ID ${signalId}: Next candle has not closed yet. Will check again later.`);
                continue; // Skip this signal, will be picked up in the next cron run
            }

            // --- If we found the next candle, process the result ---
            console.log(`Signal ID ${signalId}: Found next candle closing at ${nextCandle.datetime}`);
            
            const nextCandleClose = parseFloat(nextCandle.close);
            const entryPrice = signalData.price;
            let result = '';
            const priceDifference = nextCandleClose - entryPrice;

            if (signalData.signal === 'BUY') {
                result = nextCandleClose > entryPrice ? 'WIN ✅' : 'LOSS ❌';
            } else if (signalData.signal === 'SELL') {
                result = nextCandleClose < entryPrice ? 'WIN ✅' : 'LOSS ❌';
            } else {
                await signalsRef.doc(signalId).update({ result: 'INVALID' });
                continue; // Skip to the next signal
            }

            // 5. Send the result to Telegram
            const resultMessage = `*--- Signal Result ---*
            
*Symbol:* \`${symbol}\`
*Signal:* ${signalData.signal} at ${entryPrice.toFixed(5)}
*Next Close:* ${nextCandleClose.toFixed(5)}
*Result:* *${result}*
`;
          
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CHANNEL_ID,
                    text: resultMessage,
                    parse_mode: 'Markdown'
                })
            });

            // 6. Update Firestore
            await signalsRef.doc(signalId).update({
                result: result.split(' ')[0], // Store just 'WIN' or 'LOSS'
                resultPrice: nextCandleClose,
                pnl: priceDifference,
                checkedAt: FieldValue.serverTimestamp()
            });
            
            console.log(`Result for signal ${signalId} processed and updated successfully.`);
        } // End of loop

        return res.status(200).json({ success: true, message: `Processed ${snapshot.docs.length} signals.` });

    } catch (error) {
        console.error('Error in robust checker function:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
