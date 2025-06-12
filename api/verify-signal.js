import { URLSearchParams } from 'url';

// --- Helper Functions ---

/**
 * Parses a signal message text to extract trade details.
 * @param {string} text - The text content of the Telegram message.
 * @returns {object|null} An object with signal details or null if not a valid signal message.
 */
function parseSignalMessage(text) {
    // Regex to capture the necessary details from the message format of the first script.
    const signalRegex = /^\*📈\s(.+?)\sTrade Signal.*?\*⏰ Interval:\* (\d+)min.*?💵 Price:\* ([\d.]+).*?🚦 Signal: (BUY|SELL)\*.*?_🕒 (.*?)_$/ms;
    
    const match = text.match(signalRegex);

    if (!match) {
        return null;
    }

    return {
        symbol: match[1].trim(),
        interval: parseInt(match[2], 10),
        price: parseFloat(match[3]),
        signalType: match[4],
        timestamp: new Date(match[5]),
    };
}

/**
 * Escapes characters for Telegram's MarkdownV2 format.
 * @param {string} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeMarkdownV2(text) {
    // Characters to escape for MarkdownV2
    const charsToEscape = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    let escapedText = text;
    for (const char of charsToEscape) {
        escapedText = escapedText.replace(new RegExp('\\' + char, 'g'), '\\' + char);
    }
    return escapedText;
}


// --- API Handler ---

export default async function handler(req, res) {
    // 1. Request Method Validation
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Configuration & Secrets
    const { 
        TELEGRAM_BOT_TOKEN: BOT_TOKEN, 
        TELEGRAM_CHANNEL_ID: CHANNEL_ID, 
        TWELVEDATA_API_KEY 
    } = process.env;

    if (!BOT_TOKEN || !CHANNEL_ID || !TWELVEDATA_API_KEY) {
        console.error('Missing one or more required environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Fetch Recent Channel Messages
        // We get the last 20 messages to find the latest signal and check for existing replies.
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=20`;
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesData.ok || !updatesData.result) {
            throw new Error('Failed to fetch messages from Telegram.');
        }

        const posts = updatesData.result
            .filter(u => u.channel_post) // Ensure we only look at channel posts
            .map(u => u.channel_post)
            .reverse(); // Newest first

        // 4. Find Latest Signal Message and Check for Existing Reply
        let latestSignalPost = null;
        for (const post of posts) {
            if (post.text && parseSignalMessage(post.text)) {
                latestSignalPost = post;
                break; // Found the most recent signal
            }
        }

        if (!latestSignalPost) {
            return res.status(200).json({ success: true, message: 'No new signal message found to analyze.' });
        }

        // Check if this signal has already been replied to by our bot
        const hasBeenRepliedTo = posts.some(
            post => post.reply_to_message && post.reply_to_message.message_id === latestSignalPost.message_id
        );

        if (hasBeenRepliedTo) {
            return res.status(200).json({ success: true, message: `Signal from message ${latestSignalPost.message_id} has already been analyzed.` });
        }
        
        // 5. Parse Signal and Check if Result is Ready
        const signalDetails = parseSignalMessage(latestSignalPost.text);
        
        // Calculate when the result candle should have closed
        const resultTime = new Date(signalDetails.timestamp.getTime() + signalDetails.interval * 60 * 1000);

        if (new Date() < resultTime) {
            return res.status(200).json({ 
                success: false, 
                message: 'Result not yet available. Waiting for the next candle to close.',
                willBeReadyAt: resultTime.toISOString()
            });
        }
        
        // 6. Fetch Price Data for the Result Candle
        const params = new URLSearchParams({
            symbol: signalDetails.symbol,
            interval: `${signalDetails.interval}min`,
            start_date: resultTime.toISOString().split('T')[0], // Get data for the day
            apikey: TWELVEDATA_API_KEY,
            outputsize: 5 // Get a few candles to be safe
        });
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?${params.toString()}`;
        const priceResponse = await fetch(timeSeriesUrl);
        const priceData = await priceResponse.json();

        if (priceData.status === 'error' || !priceData.values) {
            throw new Error(`Failed to fetch price data from TwelveData: ${priceData.message || 'Unknown error'}`);
        }

        // Find the specific candle that corresponds to our result time
        const resultCandle = priceData.values.find(v => new Date(v.datetime).getTime() === resultTime.getTime());

        if (!resultCandle) {
             throw new Error(`Could not find the result candle for timestamp ${resultTime.toISOString()}`);
        }

        const resultClosePrice = parseFloat(resultCandle.close);

        // 7. Determine Signal Result (WIN/LOSS)
        const pnl = resultClosePrice - signalDetails.price;
        let outcome;
        
        if (signalDetails.signalType === 'BUY') {
            outcome = pnl > 0 ? "WIN ✅" : "LOSS ❌";
        } else { // SELL
            outcome = pnl < 0 ? "WIN ✅" : "LOSS ❌";
        }

        // 8. Post Result Back to Telegram as a Reply
        const pnlPoints = (pnl).toFixed(5); // Format for clarity
        const resultMessageText = `*🎯 Signal Result*

*Outcome:* ${outcome}
*Result Price:* ${escapeMarkdownV2(resultClosePrice.toFixed(5))}
*P/L:* ${escapeMarkdownV2(pnlPoints)} points`;

        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const telegramResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: resultMessageText,
                parse_mode: 'MarkdownV2',
                reply_to_message_id: latestSignalPost.message_id
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(`Telegram API Error: ${error.description}`);
        }

        return res.status(200).json({
            success: true,
            message: 'Successfully analyzed signal and posted result.',
            analysis: {
                ...signalDetails,
                result: outcome,
                resultPrice: resultClosePrice,
                pnl: pnlPoints
            }
        });

    } catch (error) {
        console.error('Error in analyze-signal-result handler:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
