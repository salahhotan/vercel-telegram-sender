// evaluate.js

// Use dotenv to load environment variables from .env file
require('dotenv').config(); 
// Use node-fetch for making API calls
const fetch = require('node-fetch');

// --- Configuration ---
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TWELVEDATA_API_KEY } = process.env;

// --- Helper Functions ---

/**
 * Fetches the very last message from the specified Telegram channel.
 * @returns {Promise<object|null>} The Telegram message object or null if none found.
 */
async function fetchLastSignalMessage() {
    // The getUpdates method returns an array of updates.
    // offset: -1 and limit: 1 is an efficient way to get only the last update.
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1&limit=1&allowed_updates=["channel_post"]`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok || data.result.length === 0) {
            console.log('No new messages found.');
            return null;
        }

        // We only care about posts in our specific channel
        const lastUpdate = data.result[0];
        if (lastUpdate.channel_post && lastUpdate.channel_post.chat.id.toString() === TELEGRAM_CHANNEL_ID.toString()) {
            return lastUpdate.channel_post;
        }

        return null;
    } catch (error) {
        console.error('Error fetching from Telegram:', error);
        return null;
    }
}

/**
 * Parses a signal message text to extract trade details using regex.
 * @param {string} text The message content.
 * @returns {object|null} An object with signal details or null if parsing fails.
 */
function parseSignalMessage(text) {
    // This regex uses named capture groups to easily extract data.
    const signalRegex = /Strategy: (?<strategy>[\w_]+)\s*Interval: (?<interval>\w+)\s*.*Signal: (?<signal>BUY|SELL)\s*Price: (?<price>[\d\.]+)\s*Symbol: (?<symbol>[\w\/]+)\s*.*_*(?<timestampStr>.*)_/s;

    const match = text.match(signalRegex);

    if (!match) {
        return null;
    }
    
    // Check if this message is a result message, which we should ignore.
    if (text.includes('Outcome:')) {
        console.log('Last message was a result post. Skipping.');
        return null;
    }

    const { symbol, signal, price, interval, timestampStr } = match.groups;

    return {
        symbol,
        signal, // 'BUY' or 'SELL'
        entryPrice: parseFloat(price),
        interval, // e.g., '5min', '1h'
        signalTimestamp: new Date(timestampStr.trim()),
    };
}


/**
 * Fetches the closing price of the candle immediately following the signal.
 * @param {object} signalData The parsed signal data.
 * @returns {Promise<number|null>} The closing price or null on failure.
 */
async function getNextCandleClosePrice({ symbol, interval, signalTimestamp }) {
    // Calculate the start time of the *next* candle
    const intervalValue = parseInt(interval);
    const intervalUnit = interval.replace(/[0-9]/g, '');

    let intervalMs;
    if (intervalUnit === 'min') {
        intervalMs = intervalValue * 60 * 1000;
    } else if (intervalUnit === 'h') {
        intervalMs = intervalValue * 60 * 60 * 1000;
    } else {
        console.error('Unsupported interval unit:', intervalUnit);
        return null;
    }

    // Round down the signal time to the start of its own candle, then add one interval.
    const signalCandleStartMs = Math.floor(signalTimestamp.getTime() / intervalMs) * intervalMs;
    const nextCandleStartTime = new Date(signalCandleStartMs + intervalMs);

    // Format for TwelveData API (YYYY-MM-DD HH:mm:ss)
    const startDate = nextCandleStartTime.toISOString().slice(0, 19).replace('T', ' ');

    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&apikey=${TWELVEDATA_API_KEY}&start_date=${startDate}&outputsize=1`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'error' || !data.values || data.values.length === 0) {
            // It might be too soon for the next candle to have formed.
            if(data.code === 400 && data.message.includes('future')) {
                console.log('Next candle has not formed yet. Try again later.');
            } else {
                console.error('TwelveData Error fetching next candle:', data.message || 'No data returned');
            }
            return null;
        }

        return parseFloat(data.values[0].close);
    } catch (error) {
        console.error('Error fetching from TwelveData:', error);
        return null;
    }
}


/**
 * Posts the result of the trade evaluation back to the channel.
 * @param {object} resultData The data to include in the result message.
 */
async function postResultToChannel({ symbol, signal, entryPrice, closePrice, result, pnl }) {
    const resultIcon = result === 'WIN' ? '✅' : '❌';
    const pnlString = pnl.toFixed(5);
    const message = `
*--- Trade Result ---*
${resultIcon} *Outcome: ${result}*

*Symbol:* ${symbol}
*Signal:* ${signal}
*Entry Price:* ${entryPrice.toFixed(5)}
*Close Price:* ${closePrice.toFixed(5)}
*P/L:* ${pnlString}

_Evaluation of signal from previous message._
    `;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text: message,
        parse_mode: 'Markdown',
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        const data = await response.json();
        if (data.ok) {
            console.log('Result successfully posted to Telegram.');
        } else {
            console.error('Failed to post to Telegram:', data.description);
        }
    } catch (error) {
        console.error('Error posting result to Telegram:', error);
    }
}

// --- Main Execution Logic ---
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

// Run the script
run();
