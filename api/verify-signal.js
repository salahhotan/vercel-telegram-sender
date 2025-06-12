export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Get the last 10 updates (in case recent ones don't contain channel posts)
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=10`;
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesData.ok || !updatesData.result) {
            return res.status(404).json({ 
                error: 'No updates found',
                details: updatesData.description || 'Telegram API returned no data'
            });
        }

        // 2. Find the most recent channel post
        let lastMessage = null;
        for (const update of updatesData.result.reverse()) {
            if (update.channel_post && update.channel_post.text) {
                lastMessage = update.channel_post;
                break;
            }
        }

        if (!lastMessage) {
            return res.status(404).json({ 
                error: 'No readable messages found',
                details: 'Make sure bot has access and channel has recent messages'
            });
        }

        // 3. Add emoji and repost
        const repostText = `🔁 Reposted:\n${lastMessage.text}`;
        
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: repostText,
                parse_mode: 'Markdown',
                disable_notification: true
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Failed to repost message');
        }

        return res.status(200).json({ 
            success: true,
            original_message_id: lastMessage.message_id,
            reposted_text: repostText,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message,
            suggestion: 'Check bot permissions and channel accessibility'
        });
    }
}
