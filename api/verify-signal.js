// pages/api/repost-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // e.g., -1001234567890

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration environment variables.' });
    }

    try {
        // --- STEP 1: Fetch the last update for the BOT ---

        // The most reliable way to get the single latest update is `offset: -1`.
        // We REMOVE `chat_id` because getUpdates doesn't use it.
        // We add `allowed_updates` as a best practice to only get message-related events.
        const allowedUpdates = encodeURIComponent(JSON.stringify([
            "message", 
            "edited_message", 
            "channel_post", 
            "edited_channel_post"
        ]));
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=1&offset=-1&allowed_updates=${allowedUpdates}`;

        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.ok) {
            console.error('Telegram API Error (getUpdates):', updatesData);
            throw new Error(updatesData.description || 'Failed to fetch updates from Telegram.');
        }

        if (!updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No recent updates found for this bot.'
            });
        }

        // --- STEP 2: Find the message object and VALIDATE its origin ---
        
        // With offset=-1 and limit=1, the result will be an array with one item.
        const lastUpdate = updatesData.result[0];

        // Intelligently find the message object, whether it's a new post, an edited post,
        // a group message, or an edited group message.
        const message = lastUpdate.channel_post || lastUpdate.edited_channel_post || lastUpdate.message || lastUpdate.edited_message;

        // If for some reason the last update was not a message type we handle (e.g., a poll).
        if (!message) {
            console.log('DEBUG: Full last update object received from Telegram:', JSON.stringify(lastUpdate, null, 2));
            return res.status(404).json({
                success: false,
                message: 'The last update was not a recognizable message or post.'
            });
        }
        
        // **CRITICAL VALIDATION STEP:**
        // Since getUpdates fetches from ALL chats, we must verify this message is from the channel we want.
        // We compare the chat ID from the message with our environment variable.
        if (message.chat.id.toString() !== CHANNEL_ID.toString()) {
             return res.status(404).json({
                success: false,
                message: `Last message was from a different chat (ID: ${message.chat.id}) and not the target channel (ID: ${CHANNEL_ID}).`
            });
        }

        // --- STEP 3: Extract content and repost ---

        const messageToRepost = message.text || message.caption;

        if (!messageToRepost) {
            return res.status(400).json({
                success: false,
                message: 'The latest message in the target channel was not text or did not have a caption.'
            });
        }

        const originalMessageId = message.message_id;

        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageToRepost,
                // You can add parse_mode if you expect Markdown or HTML
                // parse_mode: 'Markdown' 
            }),
        });

        if (!repostResponse.ok) {
            const errorData = await repostResponse.json();
            console.error('Telegram API Error (sendMessage):', errorData);
            throw new Error(errorData.description || 'Failed to repost message to Telegram.');
        }

        const repostData = await repostResponse.json();

        return res.status(200).json({
            success: true,
            message: 'Successfully fetched and reposted the last message.',
            reposted_content: messageToRepost,
            original_message_id: originalMessageId,
            new_message_id: repostData.result.message_id
        });

    } catch (error) {
        console.error('Repost Handler Error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            details: error.message,
        });
    }
}
