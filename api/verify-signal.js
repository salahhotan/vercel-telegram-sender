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
        // --- STEP 1: Fetch the last message from the Telegram channel ---

        // Improved URL:
        // - `allowed_updates=["channel_post"]`: This is the key change. We explicitly tell Telegram
        //   to only send us updates about new messages in the channel, ignoring everything else.
        // - `limit=1`: Get only the most recent one.
        const allowedUpdates = encodeURIComponent(JSON.stringify(["channel_post"]));
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1&allowed_updates=${allowedUpdates}`;
        
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.ok) {
            console.error('Telegram API Error (getUpdates):', updatesData);
            throw new Error(updatesData.description || 'Failed to fetch updates from Telegram.');
        }

        if (!updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No recent channel messages found to repost.' 
            });
        }

        const lastUpdate = updatesData.result[updatesData.result.length - 1];
        const post = lastUpdate.channel_post;

        // A post might not exist if the update is malformed (highly unlikely with allowed_updates)
        if (!post) {
            return res.status(404).json({ 
                success: false, 
                message: 'Could not find a valid channel post in the last update.' 
            });
        }

        // Improved text extraction:
        // A message's content can be in '.text' (for a standard text message)
        // or in '.caption' (for a photo, video, or document with a caption).
        // This line checks for text first, and if it's not there, checks for a caption.
        const messageToRepost = post.text || post.caption;

        if (!messageToRepost) {
             return res.status(400).json({ 
                success: false, 
                message: 'The latest channel post was not a text message or did not have a caption, and cannot be reposted.' 
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
                // Add parse_mode to preserve formatting like bold, italics, etc.
                // from the original message.
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
