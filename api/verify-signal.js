/**
 * Vercel Serverless Function to fetch the last message from a Telegram channel
 * and post it back to the same channel.
 *
 * This function is useful for "bumping" or reposting important announcements.
 * It's designed to be triggered by a cron job or a manual request.
 */
export default async function handler(req, res) {
    // Allow both GET (for easy browser testing) and POST (semantically correct)
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 1. Get required environment variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error('Missing Telegram environment variables');
        return res.status(500).json({ error: 'Server configuration error: Missing Telegram credentials.' });
    }

    try {
        // 2. Fetch the last message from the channel
        // We use `offset: -1` and `limit: 1` to efficiently get only the most recent update.
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1&offset=-1`;

        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesData.ok || !updatesData.result || updatesData.result.length === 0) {
            console.error("Telegram API Error (getUpdates):", updatesData.description || "No messages found.");
            return res.status(404).json({
                error: 'Could not fetch the last message.',
                details: updatesData.description || 'The channel might be empty or there was an API error.'
            });
        }

        // The API returns an array of "updates". We need the first (and only) one.
        const lastUpdate = updatesData.result[0];
        
        // A message in a channel is a `channel_post`. We check for `message` as a fallback.
        const lastMessage = lastUpdate.channel_post || lastUpdate.message;

        if (!lastMessage || !lastMessage.text) {
             return res.status(404).json({ error: 'The last item in the channel was not a text message and cannot be reposted.' });
        }

        // Extract the text from the last message
        const messageTextToRepost = lastMessage.text;

        // 3. Post the extracted message text back to the channel
        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageTextToRepost,
                // Preserve markdown/html formatting if it exists
                parse_mode: lastMessage.entities ? 'MarkdownV2' : undefined 
            })
        });

        if (!repostResponse.ok) {
            const errorDetails = await repostResponse.json();
            console.error("Telegram API Error (sendMessage):", errorDetails.description);
            throw new Error(`Failed to repost message: ${errorDetails.description}`);
        }

        // 4. Return a success response
        return res.status(200).json({
            success: true,
            message: 'Successfully fetched and reposted the last message.',
            reposted_text: messageTextToRepost
        });

    } catch (error) {
        console.error('Unhandled Error:', error);
        return res.status(500).json({
            error: 'An internal server error occurred.',
            details: error.message
        });
    }
}
