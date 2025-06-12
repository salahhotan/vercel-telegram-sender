// api/verify-signal.js

// --- 1. Use 'import' instead of 'require' ---
import fetch from 'node-fetch';
import 'dotenv/config'; // Loads .env file for local development

// --- Configuration (remains the same) ---
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TWELVEDATA_API_KEY } = process.env;

// --- Helper Functions (remain the same) ---
// All your functions (fetchLastSignalMessage, parseSignalMessage, getNextCandleClosePrice, postResultToChannel)
// can stay exactly as they were, since they already use modern async/await.

async function fetchLastSignalMessage() { /* ... your existing code ... */ }
function parseSignalMessage(text) { /* ... your existing code ... */ }
async function getNextCandleClosePrice({ symbol, interval, signalTimestamp }) { /* ... your existing code ... */ }
async function postResultToChannel({ symbol, signal, entryPrice, closePrice, result, pnl }) { /* ... your existing code ... */ }
// PASTE YOUR HELPER FUNCTIONS HERE

// --- Main Execution Logic (remains the same) ---
async function run() {
    console.log('Starting trade evaluation...');

    // 1. Fetch the last message
    const lastMessage = await fetchLastSignalMessage();
    if (!lastMessage || !lastMessage.text) {
        console.log('No valid message found to evaluate. Exiting.');
        return;
    }

    // 2. Parse the message to get signal details
    const signalData = parseSignalMessage(lastMessage.text);
    if (!signalData) {
        console.log('Last message was not a new trade signal. Exiting.');
        return;
    }
    console.log('Found a trade signal to evaluate:', signalData);

    // 3. Get the closing price of the next candle
    const closePrice = await getNextCandleClosePrice(signalData);
    if (closePrice === null) {
        console.log('Could not determine closing price. Exiting.');
        return;
    }

    // 4. Determine the result
    let result = '';
    const pnl = (signalData.signal === 'BUY') ? (closePrice - signalData.entryPrice) : (signalData.entryPrice - closePrice);

    if (pnl > 0) {
        result = 'WIN';
    } else {
        result = 'LOSS';
    }

    console.log(`Result: ${result}. Entry: ${signalData.entryPrice}, Close: ${closePrice}, P/L: ${pnl}`);

    // 5. Post the result back to the channel
    await postResultToChannel({
        ...signalData,
        closePrice,
        result,
        pnl,
    });

    console.log('Evaluation complete.');
}


// --- 2. Use 'export default' for the handler ---
// This is the function Vercel will call (e.g., via a Cron Job)
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        await run(); // Call your main logic function
        return res.status(200).json({ success: true, message: 'Evaluation job finished successfully.' });
    } catch (error) {
        console.error('Error during cron job execution:', error);
        return res.status(500).json({ success: false, message: 'An error occurred during the evaluation job.' });
    }
}
