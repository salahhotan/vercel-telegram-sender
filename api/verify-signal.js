// filename: repost-message.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Fetch the last message from the channel
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1`;
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesData.ok || !updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({ error: 'No messages found in channel' });
        }

        const lastMessage = updatesData.result[0].channel_post;
        if (!lastMessage || !lastMessage.text) {
            return res.status(404).json({ error: 'No message text found' });
        }

        const messageText = lastMessage.text;

        // 2. Post the same message back to the channel
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: "🔁 Reposted message:\n\n" + messageText,
                parse_mode: 'Markdown'
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            originalMessage: messageText,
            reposted: true
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
