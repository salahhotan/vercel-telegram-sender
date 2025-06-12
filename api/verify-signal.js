// filename: get-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = '-1002496807595'; // Using your channel's numeric ID

    if (!BOT_TOKEN) {
        return res.status(500).json({ 
            error: 'Missing Telegram Bot Token',
            details: 'Check your Vercel environment variables'
        });
    }

    try {
        // 1. Verify bot is admin in channel
        const adminCheckUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${BOT_TOKEN.split(':')[0]}`;
        const adminResponse = await fetch(adminCheckUrl);
        const adminData = await adminResponse.json();

        if (!adminData.ok || !['administrator', 'creator'].includes(adminData.result?.status)) {
            return res.status(403).json({
                error: 'Bot is not an admin in the channel',
                solution: {
                    step1: 'Add @YourBotUsername as admin to @shnbat',
                    step2: 'Enable "View Messages" and "Post Messages" permissions',
                    step3: 'Try again after 1 minute',
                    verification_link: `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${BOT_TOKEN.split(':')[0]}`
                }
            });
        }

        // 2. Get the last message (using getChatHistory)
        const historyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`;
        const historyResponse = await fetch(historyUrl);
        const historyData = await historyResponse.json();

        if (!historyData.ok || !historyData.result?.messages?.length) {
            // If no messages found, try sending a test message
            const testMsgResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CHANNEL_ID,
                    text: 'رسالة اختبار من البوت',
                    parse_mode: 'HTML'
                })
            });

            const testMsgData = await testMsgResponse.json();

            if (!testMsgResponse.ok) {
                return res.status(500).json({
                    error: 'Failed to send test message',
                    details: {
                        telegram_error: testMsgData.description,
                        required_permissions: 'The bot needs "Send Messages" permission',
                        channel_info: {
                            id: CHANNEL_ID,
                            username: 'shnbat'
                        }
                    }
                });
            }

            return res.status(404).json({
                error: 'No previous messages found',
                success: 'Test message sent successfully',
                details: {
                    test_message: testMsgData.result,
                    note: 'Try the request again to fetch this test message'
                }
            });
        }

        const lastMessage = historyData.result.messages[0].text || 
                          historyData.result.messages[0].caption || 
                          '[media message]';

        // 3. Repost the message
        const repostResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: `📢 آخر رسالة في القناة:\n\n${lastMessage}`,
                parse_mode: 'HTML'
            })
        });

        const repostData = await repostResponse.json();

        return res.status(200).json({
            success: true,
            action: 'last_message_reposted',
            original_message: lastMessage,
            reposted_message: repostData.result,
            channel: {
                id: CHANNEL_ID,
                username: 'shnbat'
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: {
                message: error.message,
                troubleshooting: [
                    '1. Verify bot token is correct',
                    '2. Ensure bot is admin in @shnbat',
                    `3. Check bot permissions: https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${BOT_TOKEN.split(':')[0]}`,
                    '4. Try sending a manual message first'
                ]
            }
        });
    }
}
