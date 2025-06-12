// filename: get-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Fetch the last message from the channel
        // First try getting the last channel post directly
        const getHistoryUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`;
        const historyResponse = await fetch(getHistoryUrl);
        const historyData = await historyResponse.json();

        let lastMessage = null;

        // Check if we got a message from getChatHistory
        if (historyData.ok && historyData.result && historyData.result.messages && historyData.result.messages.length > 0) {
            const messageObj = historyData.result.messages[0];
            lastMessage = messageObj.text || messageObj.caption || null;
        }

        // If not found, try getUpdates as fallback
        if (!lastMessage) {
            const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=1`;
            const updatesResponse = await fetch(getUpdatesUrl);
            const updatesData = await updatesResponse.json();

            if (updatesData.ok && updatesData.result && updatesData.result.length > 0) {
                const update = updatesData.result[0];
                // Check different message locations in the update object
                if (update.message) {
                    lastMessage = update.message.text || update.message.caption || null;
                } else if (update.channel_post) {
                    lastMessage = update.channel_post.text || update.channel_post.caption || null;
                } else if (update.edited_message) {
                    lastMessage = update.edited_message.text || update.edited_message.caption || null;
                }
            }
        }

        if (!lastMessage) {
            return res.status(404).json({ error: 'No text message found in the channel' });
        }

        // 2. Post the same message back to the channel
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: `🔁 Reposting last message:\n\n${lastMessage}`,
                parse_mode: 'HTML' // Using HTML to preserve emojis and formatting
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            originalMessage: lastMessage,
            reposted: true,
            note: 'Emojis and formatting should be preserved'
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
