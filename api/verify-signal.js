export default async function handler(req, res) {
    // 1. Ensure the request method is GET
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Load and validate environment variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration environment variables.' });
    }

    try {
        // --- STEP 1: Fetch the last message from the Telegram channel ---

        // The `getUpdates` method fetches recent updates. `limit=1` gets the very last one.
        // We need to use a large negative offset to ensure we get the last update.
        // A more reliable way is to just use limit=1 and take the last element of the result array.
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1`;
        
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.ok) {
            console.error('Telegram API Error (getUpdates):', updatesData);
            throw new Error(updatesData.description || 'Failed to fetch updates from Telegram.');
        }

        if (!updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No messages found in the channel to repost.' 
            });
        }

        // The result is an array of updates. The last one is the most recent.
        const lastUpdate = updatesData.result[updatesData.result.length - 1];

        // A channel message is identified by `channel_post`. We need to ensure it exists and has text.
        if (!lastUpdate.channel_post || !lastUpdate.channel_post.text) {
             return res.status(400).json({ 
                success: false, 
                message: 'The latest update was not a text message and cannot be reposted.' 
            });
        }

        const messageToRepost = lastUpdate.channel_post.text;
        const originalMessageId = lastUpdate.channel_post.message_id;

        // --- STEP 2: Post the message back to the channel ---

        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageToRepost,
                // Note: This simple repost does not preserve formatting (Markdown/HTML)
                // from the original message. It just sends the raw text content.
            }),
        });
        
        if (!repostResponse.ok) {
            const errorData = await repostResponse.json();
            console.error('Telegram API Error (sendMessage):', errorData);
            throw new Error(errorData.description || 'Failed to repost message to Telegram.');
        }

        const repostData = await repostResponse.json();

        // 3. Return a success response
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
