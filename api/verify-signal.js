// filename: get-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ 
            error: 'Missing Telegram configuration',
            details: {
                BOT_TOKEN: BOT_TOKEN ? '*****' : 'MISSING',
                CHANNEL_ID: CHANNEL_ID ? '*****' : 'MISSING'
            }
        });
    }

    try {
        // First try to get basic chat information to verify access
        const getChatUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${CHANNEL_ID}`;
        const chatResponse = await fetch(getChatUrl);
        const chatData = await chatResponse.json();

        if (!chatData.ok) {
            return res.status(404).json({
                error: 'Cannot access chat/channel',
                details: {
                    telegram_error: chatData.description,
                    chat_id_format: typeof CHANNEL_ID === 'string' ? 
                        (CHANNEL_ID.startsWith('@') ? 'public channel' : 
                         CHANNEL_ID.startsWith('-100') ? 'private channel/supergroup' : 
                         'unknown format (should start with @ or -100)') : 'invalid type',
                    troubleshooting: [
                        'Ensure bot is added to the channel as admin',
                        'For private channels, use ID in format "-100123456789"',
                        'For public channels, use username in format "@channelname"'
                    ]
                }
            });
        }

        // Try to get the last message through different methods
        let lastMessage = null;
        let methodUsed = '';
        
        // Method 1: getChatHistory (works for channels where bot is admin)
        try {
            const historyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`;
            const historyResponse = await fetch(historyUrl);
            const historyData = await historyResponse.json();

            if (historyData.ok && historyData.result?.messages?.length > 0) {
                const message = historyData.result.messages[0];
                lastMessage = message.text || message.caption || null;
                methodUsed = 'getChatHistory';
            }
        } catch (e) {
            console.log('getChatHistory failed, trying fallback methods');
        }

        // Method 2: getUpdates (works if bot has seen recent messages)
        if (!lastMessage) {
            try {
                const updatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=10`;
                const updatesResponse = await fetch(updatesUrl);
                const updatesData = await updatesResponse.json();

                if (updatesData.ok && updatesData.result?.length > 0) {
                    // Find the most recent message from our channel
                    for (const update of updatesData.result.reverse()) {
                        const message = update.message || update.channel_post || update.edited_message;
                        if (message && (message.chat?.id == CHANNEL_ID || message.chat?.username === CHANNEL_ID.replace('@', ''))) {
                            lastMessage = message.text || message.caption || null;
                            methodUsed = 'getUpdates';
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('getUpdates failed');
            }
        }

        if (!lastMessage) {
            return res.status(404).json({
                error: 'No message found',
                details: {
                    troubleshooting: [
                        'Bot might not have message history access',
                        'Try sending a new message to the channel with the bot as admin',
                        'For channels, use getChatHistory method (bot needs admin rights)',
                        'Make sure channel ID is correct'
                    ],
                    verified_chat_info: chatData.result
                }
            });
        }

        // Post the message back
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: `🔁 Reposting last message (via ${methodUsed}):\n\n${lastMessage}`,
                parse_mode: 'HTML'
            })
        });

        const responseData = await telegramResponse.json();
        
        if (!telegramResponse.ok) {
            return res.status(500).json({
                error: 'Failed to repost message',
                telegram_error: responseData.description,
                details: {
                    method_used: methodUsed,
                    original_message: lastMessage,
                    chat_id_used: CHANNEL_ID
                }
            });
        }

        return res.status(200).json({ 
            success: true,
            method_used: methodUsed,
            original_message: lastMessage,
            reposted_message: responseData.result,
            chat_info: chatData.result
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
