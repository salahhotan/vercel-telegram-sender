// filename: get-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    // Use either the numeric ID or @username format
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '@shnbat';

    if (!BOT_TOKEN) {
        return res.status(500).json({ 
            error: 'Missing Telegram Bot Token',
            details: 'Check your Vercel environment variables'
        });
    }

    try {
        // First verify the bot can access the channel
        const getChatUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${CHANNEL_ID}`;
        const chatResponse = await fetch(getChatUrl);
        const chatData = await chatResponse.json();

        if (!chatData.ok) {
            return res.status(403).json({
                error: 'Bot cannot access channel',
                details: {
                    telegram_error: chatData.description,
                    required_permissions: [
                        'Bot must be channel admin',
                        'Needs "Post Messages" permission',
                        'Needs "Read Messages" permission'
                    ],
                    current_chat_info: chatData
                }
            });
        }

        // METHOD 1: Use getChatHistory (requires admin rights)
        const historyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`;
        const historyResponse = await fetch(historyUrl);
        const historyData = await historyResponse.json();

        if (historyData.ok && historyData.result?.messages?.length > 0) {
            const message = historyData.result.messages[0];
            const lastMessage = message.text || message.caption || '[non-text message]';

            // Repost the message
            const repostResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CHANNEL_ID,
                    text: `📢 Last Message Repost:\n\n${lastMessage}`,
                    parse_mode: 'HTML'
                })
            });

            const repostData = await repostResponse.json();
            
            return res.status(200).json({
                success: true,
                method: 'getChatHistory',
                original_message: lastMessage,
                reposted_message: repostData.result
            });
        }

        // METHOD 2: Fallback to checking updates (if bot has seen recent messages)
        const updatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`;
        const updatesResponse = await fetch(updatesUrl);
        const updatesData = await updatesResponse.json();

        if (updatesData.ok && updatesData.result?.length > 0) {
            // Find the most recent message from our channel
            for (let i = updatesData.result.length - 1; i >= 0; i--) {
                const update = updatesData.result[i];
                const message = update.channel_post || update.message;
                
                if (message && (
                    message.chat?.id === -1002496807595 || 
                    message.chat?.username === 'shnbat'
                )) {
                    const lastMessage = message.text || message.caption || '[non-text message]';

                    const repostResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: CHANNEL_ID,
                            text: `📢 Last Message Repost (from updates):\n\n${lastMessage}`,
                            parse_mode: 'HTML'
                        })
                    });

                    const repostData = await repostResponse.json();
                    
                    return res.status(200).json({
                        success: true,
                        method: 'getUpdates',
                        original_message: lastMessage,
                        reposted_message: repostData.result,
                        note: 'This might not be the very latest message'
                    });
                }
            }
        }

        // If we get here, no messages were found
        return res.status(404).json({
            error: 'No messages found in channel',
            details: {
                channel_info: chatData.result,
                required_actions: [
                    '1. Make sure the bot is admin in the channel',
                    '2. Send a new message to the channel',
                    '3. For private channels, use the numeric ID (-1002496807595)',
                    '4. Ensure bot has "Read Messages" permission'
                ],
                test_links: [
                    `Verify bot access: https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=<your_bot_user_id>`,
                    `Check updates: https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`
                ]
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                troubleshooting: 'Check your bot token and channel ID format'
            }
        });
    }
}
