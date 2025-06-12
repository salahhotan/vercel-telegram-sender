/**
 * Vercel Serverless Function to fetch the last message from a Telegram channel
 * and post it back to the same channel.
 *
 * This function is useful for "bumping" or reposting important announcements.
 * It's designed to be triggered by a cron job or a manual request.
 *
 * VERSION 2: Now correctly handles both standard text messages and media (photos/videos)
 * with captions.
 */
export default async function handler(req, res) {
    // Allow both GET (for easy browser testing) and POST (semantically correct)
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
        // 1. Fetch the last message from the channel
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
        const lastMessage = lastUpdate.channel_post || lastUpdate.message;

        if (!lastMessage) {
            return res.status(404).json({ error: 'Could not identify a valid message in the last update.' });
        }

        // 2. *** THE FIX IS HERE ***
        // Extract the text content, whether it's in the 'text' field (for normal messages)
        // or the 'caption' field (for media messages).
        const messageContent = lastMessage.text || lastMessage.caption;
        
        // Determine if the original message had formatting (like bold, italic, etc.)
        // For text messages, entities are in `entities`. For captions, they are in `caption_entities`.
        const hasFormatting = lastMessage.entities || lastMessage.caption_entities;

        // If after checking both text and caption, we still have nothing, then it's a non-text message (e.g., a sticker).
        if (!messageContent) {
            return res.status(404).json({
                error: 'The last item in the channel was not a text message or a message with a caption and cannot be reposted.',
                details: 'This can happen with stickers, polls, or other non-text content.'
            });
        }

        // 3. Post the extracted message text back to the channel
        const sendMessageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const repostResponse = await fetch(sendMessageUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: messageContent,
                // If the original message had formatting, try to preserve it by setting parse_mode.
                // Note: Telegram's MarkdownV2 is strict. If you have issues, you might switch to 'HTML'.
                parse_mode: hasFormatting ? 'Markdown' : undefined
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
