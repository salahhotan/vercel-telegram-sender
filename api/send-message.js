import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Debug Firebase config
console.log('Firebase Config:', {
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
});

let db;
try {
  const firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  console.log('Firebase initialized successfully');
} catch (firebaseError) {
  console.error('Firebase initialization error:', firebaseError);
}

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
        // [Previous code for fetching data and calculating indicators remains the same...]
        // ... up to the point after sending to Telegram

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        const telegramResponseData = await telegramResponse.json();
        console.log('Telegram response:', telegramResponseData);

        // Only proceed to Firestore if we have a valid db instance
        if (!db) {
            throw new Error('Firestore not initialized');
        }

        // Prepare signal data
        const signalData = {
            symbol,
            interval: parseInt(interval),
            strategy,
            price: currentClose,
            ema21: currentEma21,
            stochK: currentK,
            stochD: currentD,
            signal,
            reason,
            timestamp: serverTimestamp(),
            message,
            telegramSent: true,
            telegramMessageId: telegramResponseData.result.message_id,
            createdAt: new Date().toISOString()
        };

        console.log('Attempting to save to Firestore:', signalData);

        // Save to Firestore with timeout
        let docRef;
        try {
            docRef = await Promise.race([
                addDoc(collection(db, 'tradeSignals'), signalData),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Firestore timeout')), 5000)
                )
            ]);
            console.log('Signal successfully saved to Firestore with ID:', docRef.id);
        } catch (firestoreError) {
            console.error('Firestore save error:', firestoreError);
            // Even if Firestore fails, we can still return success since Telegram worked
            return res.status(200).json({ 
                success: true,
                warning: 'Signal sent to Telegram but failed to save in Firestore',
                error: firestoreError.message,
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
        }

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
            reason,
            firestoreId: docRef.id
        });

    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

