import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- Firebase Admin Initialization (same as your first script) ---
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length) {
  try {
    initializeApp({ credential: cert(serviceAccount) });
    console.log("Firebase Admin SDK initialized successfully for checker.");
  } catch (error) {
    console.error("Firebase Admin SDK initialization error:", error.message);
  }
}

const db = getFirestore();
// --- End of Firebase Initialization ---

export default async function handler(req, res) {
    // --- Security Check ---
    // We only allow GET requests with a valid secret key
    const { secret } = req.query;
    if (req.method !== 'GET' || secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

    if (!BOT_TOKEN || !CHANNEL_ID || !TWELVEDATA_API_KEY) {
        return res.status(500).json({ error: 'Missing server configuration' });
    }

    try {
        // 1. Find the latest signal that has NOT been checked yet
        const signalsRef = db.collection('signals');
        const snapshot = await signalsRef
            .where('result', '==', null) // Find signals without a 'result' field
            .orderBy('timestamp', 'desc') // Get the most recent one first
            .limit(1)
            .get();

        if (snapshot.empty) {
            console.log('No unchecked signals found.');
            return res.status(200).json({ message: 'No unchecked signals found.' });
        }
        
        const signalDoc = snapshot.docs[0];
        const signalData = signalDoc.data();
        const signalId = signalDoc.id;

        // 2. Fetch the latest candle data for the signal's symbol
        // The interval should be in the format '15min', which we already stored
        const interval = signalData.interval; 
        const symbol = signalData.symbol;

        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&apikey=${TWELVEDATA_API_KEY}&outputsize=1`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();

        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            console.error('TwelveData Error on checker:', timeSeriesData);
            return res.status(500).json({ error: 'Failed to fetch time series for result check' });
        }

        const nextCandleClose = parseFloat(timeSeriesData.values[0].close);
        const entryPrice = signalData.price;

        // 3. Determine the result (WIN or LOSS)
        let result = '';
        const priceDifference = nextCandleClose - entryPrice;

        if (signalData.signal === 'BUY') {
            result = nextCandleClose > entryPrice ? 'WIN ✅' : 'LOSS ❌';
        } else if (signalData.signal === 'SELL') {
            result = nextCandleClose < entryPrice ? 'WIN ✅' : 'LOSS ❌';
        } else {
             // If signal was something else, mark as checked to avoid re-processing
            await signalsRef.doc(signalId).update({ result: 'INVALID' });
            return res.status(200).json({ message: 'Invalid signal type, marked as checked.' });
        }

        // 4. Send the result to the Telegram channel
        const resultMessage = `--- Signal Result ---
📈 Symbol: ${symbol}
🚦 Original Signal: ${signalData.signal} at ${entryPrice.toFixed(5)}
🕯️ Next Candle Close: ${nextCandleClose.toFixed(5)}
📊 P/L: ${priceDifference.toFixed(5)} points
🏆 Result: ${result}
        `;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: resultMessage,
            })
        });

        if (!telegramResponse.ok) {
            throw new Error('Failed to send result to Telegram');
        }

        // 5. Update the signal document in Firestore with the result
        await signalsRef.doc(signalId).update({
            result: result.split(' ')[0], // Store just 'WIN' or 'LOSS'
            resultPrice: nextCandleClose,
            pnl: priceDifference,
            checkedAt: FieldValue.serverTimestamp()
        });
        
        console.log(`Result for signal ${signalId} processed and updated successfully.`);
        return res.status(200).json({
            success: true,
            signalId,
            result,
            message: 'Result processed and sent.'
        });

    } catch (error) {
        console.error('Error in checker function:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
