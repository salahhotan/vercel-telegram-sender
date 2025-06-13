import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

export default async function handler(req, res) {
    // Verify environment variables first
    const requiredEnvVars = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHANNEL_ID',
        'FIREBASE_API_KEY',
        'FIREBASE_AUTH_DOMAIN',
        'FIREBASE_PROJECT_ID'
    ];
    
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        return res.status(500).json({
            error: 'Missing environment variables',
            missing: missingVars
        });
    }

    try {
        // Initialize Firebase inside handler
        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
        };
        
        const firebaseApp = initializeApp(firebaseConfig);
        const db = getFirestore(firebaseApp);

        // Rest of your existing function logic...
        // (Keep all your existing code here)

    } catch (error) {
        console.error('FULL ERROR:', {
            message: error.message,
            stack: error.stack,
            time: new Date().toISOString()
        });
        
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message,
            ...(process.env.NODE_ENV === 'development' && {
                stack: error.stack
            })
        });
    }
}
