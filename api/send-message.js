// api/send-message.js

// We'll use the built-in fetch for Node.js 18+
// If you are on an older Node version, you might need to install 'node-fetch'
// and import it: const fetch = require('node-fetch');

export default async function handler(req, res) {
    // 1. Check if it's a POST request
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get Telegram Bot Token and Channel ID from Environment Variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // e.g., "@yourchannelname" or "-1001234567890"

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID environment variables.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Get the message from the request body
        const { message, parse_mode } = req.body; // Expecting { "message": "Your text here", "parse_mode": "MarkdownV2" (optional) }

        if (!message) {
            return res.status(400).json({ error: 'Missing "message" in request body' });
        }

        // 4. Construct the Telegram API URL
        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        // 5. Prepare the payload for Telegram
        const payload = {
            chat_id: CHANNEL_ID,
            text: message,
            parse_mode: parse_mode || 'MarkdownV2', // Default to MarkdownV2, can also be 'HTML' or none
            // You can add other parameters like disable_web_page_preview: true
        };

        // 6. Send the request to Telegram API
        const telegramResponse = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const telegramResult = await telegramResponse.json();

        // 7. Handle Telegram's response
        if (!telegramResponse.ok || !telegramResult.ok) {
            console.error('Telegram API Error:', telegramResult);
            return res.status(500).json({
                error: 'Failed to send message to Telegram',
                telegram_error: telegramResult.description || 'Unknown error',
            });
        }

        // 8. Send success response back to the client
        return res.status(200).json({ success: true, message: 'Message sent to Telegram successfully!', telegram_response: telegramResult });

    } catch (error) {
        console.error('Error in send-message handler:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}