/**
 * Vercel Serverless Function to fetch the last message from a Telegram channel
 * and post it back to the same channel.
 *
 * This function is useful for "bumping" or reposting important announcements.
 *
 * VERSION 3: Now correctly handles EDITED messages in addition to new messages
 * and media with captions. It's more robust against different types of channel updates.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error('Missing Telegram environment variables');
        return res.status(500).json({ error: 'Server configuration error: Missing Telegram credentials.' });
    }

    try {
        // 1. Fetch the last update from the channel
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

        const lastUpdate = updatesData.result[0];

        // For debugging: This will show you exactly what the last update object looks like.
        console.log('Received last update from Telegram:', JSON.stringify(lastUpdate, null, 2));

        // 2. *** THE FIX IS HERE ***
        // Identify the message object, whether it's new or edited.
        const lastMessage = lastUpdate.channel_post ||         // A new post in the channel
                            lastUpdate.edited_channel_post ||   // An edited post in the channel
                            lastUpdate.message ||               // A new message (fallback)
                            lastUpdate.edited_message;          // An edited message (fallback)

        // If none of the above fields exist, the update was something else (e.g., bot permissions changed).
        if (!lastMessage) {
            return res.status(404).json({
                error: 'Could not identify a valid message in the last update.',
                details: 'The last update was not a new or edited message.'
            });
        }

        // 3. Extract the text content, whether it's from 'text' or 'caption'.
        const messageContent = lastMessage.text || lastMessage.caption;
        
        const hasFormatting = lastMessage.entities || lastMessage.caption_entities;

        if (!messageContent) {
            return res.status(404).json({
                error: 'The last item in the channel was not a text message or a message with a caption and cannot be reposted.',
                details: 'This can happen with stickers, polls, or other non-text content.'
            });
        }

        // 4. Post the extracted message text back to the channel
        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageContent,
                parse_mode: hasFormatting ? 'Markdown' : undefined
            })
        });

        if (!repostResponse.ok) {
            const errorDetails = await repostResponse.json();
            console.error("Telegram API Error (sendMessage):", errorDetails.description);
            throw new Error(`Failed to repost message: ${errorDetails.description}`);
        }

        // 5. Return a success response
        return res.status(200).json({
            success: true,
            message: 'Successfully fetched and reposted the last message.',
            reposted_text: messageContent
        });

    } catch (error) {
        console.error('Unhandled Error:', error);
        return res.status(500).json({
            error: 'An internal server error occurred.',
            details: error.message
        });
    }
}
