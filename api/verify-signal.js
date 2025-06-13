export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration environment variables.' });
    }

    try {
        // --- STEP 1: Fetch the single last update from the channel ---

        // `offset: -1` is the official, most reliable way to get the single most recent update.
        // We ask for all possible message types to ensure we don't miss anything.
        const allowedUpdates = encodeURIComponent(JSON.stringify([
            "message", 
            "edited_message", 
            "channel_post", 
            "edited_channel_post"
        ]));
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1&offset=-1&allowed_updates=${allowedUpdates}`;

        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.ok) {
            console.error('Telegram API Error (getUpdates):', updatesData);
            throw new Error(updatesData.description || 'Failed to fetch updates from Telegram.');
        }

        if (!updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No recent messages or posts found to repost.'
            });
        }

        // The result will be an array with one item: the last update.
        const lastUpdate = updatesData.result[0];

        // --- THIS IS THE KEY LOGIC ---
        // Find the message object, regardless of whether it's a new post, an edited post,
        // a group message, or an edited group message. This handles all cases.
        const post = lastUpdate.channel_post || lastUpdate.edited_channel_post || lastUpdate.message || lastUpdate.edited_message;

        if (!post) {
            console.log('DEBUG: Full last update object received from Telegram:', JSON.stringify(lastUpdate, null, 2));
            return res.status(404).json({
                success: false,
                message: 'Could not find a recognizable message or post object in the last update.'
            });
        }

        // Extract the content from the message/post object.
        const messageToRepost = post.text || post.caption;

        if (!messageToRepost) {
            return res.status(400).json({
                success: false,
                message: 'The latest post/message was not text or did not have a caption.'
            });
        }

        const originalMessageId = post.message_id;

        // --- STEP 2: Post the message back to the channel ---
        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageToRepost,
                parse_mode: 'Markdown'
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
            message: 'Successfully fetched and reposted the last message in the channel.',
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
