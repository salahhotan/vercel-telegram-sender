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
    console.log("Firebase Admin SDK initialized successfully for checker.");
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
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

    if (!BOT_TOKEN || !CHANNEL_ID || !TWELVEDATA_API_KEY) {
        return res.status(500).json({ error: 'Missing server configuration' });
    }

    try {
        // 1. Get the single most recent signal, regardless of its status.
        const signalsRef = db.collection('signals');
        const latestSignalSnapshot = await signalsRef
            .orderBy('timestamp', 'desc') // Get the most recent one first
            .limit(1)
            .get();

        // Exit if the 'signals' collection is completely empty.
        if (latestSignalSnapshot.empty) {
            console.log('No signals found in the collection to check.');
            return res.status(200).json({ message: 'No signals found to check.' });
        }
        
        const signalDoc = latestSignalSnapshot.docs[0];
        const signalData = signalDoc.data();
        const signalId = signalDoc.id;

        // 2. Check if this latest signal has ALREADY been processed.
        // If 'result' is anything other than 'null', we exit.
        if (signalData.result !== null) {
            console.log(`Latest signal (ID: ${signalId}) already has a result: '${signalData.result}'. Exiting.`);
            return res.status(200).json({ message: 'Latest signal already checked.' });
        }

        // --- If we reach here, it means the latest signal has result: null ---
        // --- and we need to process it.                                  ---
        console.log(`Found unchecked latest signal (ID: ${signalId}). Processing result...`);

        // 3. Fetch the latest candle data for the signal's symbol
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

        // 4. Determine the result (WIN or LOSS)
        let result = '';
        const priceDifference = nextCandleClose - entryPrice;

        if (signalData.signal === 'BUY') {
            result = nextCandleClose > entryPrice ? 'WIN ✅' : 'LOSS ❌';
        } else if (signalData.signal === 'SELL') {
            result = nextCandleClose < entryPrice ? 'WIN ✅' : 'LOSS ❌';
        } else {
            await signalsRef.doc(signalId).update({ result: 'INVALID' });
            return res.status(200).json({ message: 'Invalid signal type, marked as checked.' });
        }

        // 5. Send the result to the Telegram channel
        const resultMessage = `🚀 *TRADE RESULT* 🚀

▫️ *Symbol:* \`${symbol}\`
▫️ *Signal:* ${signalData.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL'} at ${entryPrice.toFixed(5)}
▫️ *Next Close:* ${nextCandleClose.toFixed(2)}
▫️ *P/L:* ${priceDifference >= 0 ? '🟢' : '🔴'} ${priceDifference.toFixed(2)} points
▫️ *Result:* ${result}

📊 *Performance Summary*
Profit: ${priceDifference >= 0 ? '+' : ''}${priceDifference.toFixed(2)} (${(Math.abs(priceDifference)/entryPrice*100).toFixed(2)}%)`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: resultMessage,
            })
        });

        // 6. Update the signal document in Firestore with the result
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
