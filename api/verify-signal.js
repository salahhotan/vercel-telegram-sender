// filename: get-last-message.js

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8084526976:AAF80D_NFpFtbRt7mSzWlrOaMsT04j3pvEo';
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '@shnbat';

    try {
        // Step 1: Verify bot has access to the channel
        const chatInfoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${CHANNEL_ID}`;
        const chatInfoResponse = await fetch(chatInfoUrl);
        const chatInfo = await chatInfoResponse.json();

        if (!chatInfo.ok) {
            return res.status(403).json({
                error: 'Bot cannot access channel',
                details: {
                    telegram_error: chatInfo.description,
                    required_permissions: 'Bot needs to be admin with "View Messages" and "Post Messages" permissions',
                    verification_link: `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${BOT_TOKEN.split(':')[0]}`
                }
            });
        }

        // Step 2: Get the last message (using both methods)
        let lastMessage = null;
        let source = '';

        // Method 1: Try getChatHistory (requires admin)
        try {
            const historyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`;
            const historyResponse = await fetch(historyUrl);
            const historyData = await historyResponse.json();

            if (historyData.ok && historyData.result?.messages?.length > 0) {
                lastMessage = historyData.result.messages[0].text || 
                              historyData.result.messages[0].caption || 
                              '[media message]';
                source = 'getChatHistory';
            }
        } catch (e) {
            console.log('getChatHistory failed, trying fallback');
        }

        // Method 2: Try getUpdates (if bot has seen recent messages)
        if (!lastMessage) {
            try {
                const updatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100&offset=-1`;
                const updatesResponse = await fetch(updatesUrl);
                const updatesData = await updatesResponse.json();

                if (updatesData.ok && updatesData.result?.length > 0) {
                    // Find most recent message from our channel
                    for (let i = updatesData.result.length - 1; i >= 0; i--) {
                        const update = updatesData.result[i];
                        const message = update.channel_post || update.message;
                        
                        if (message && (
                            message.chat?.id === -1002496807595 || 
                            message.chat?.username === 'shnbat'
                        )) {
                            lastMessage = message.text || message.caption || '[media message]';
                            source = 'getUpdates';
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
                error: 'No messages found',
                solution: {
                    step1: 'Make the bot an admin in @shnbat with "View Messages" permission',
                    step2: 'Send a new test message to the channel',
                    step3: `Verify access at: https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${BOT_TOKEN.split(':')[0]}`,
                    step4: `Check recent messages at: https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`
                },
                channel_info: chatInfo.result
            });
        }

        // Step 3: Repost the message
        const repostUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const repostResponse = await fetch(repostUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: `🔁 آخر رسالة تم إعادة نشرها:\n\n${lastMessage}`,
                parse_mode: 'HTML'
            })
        });

        const repostData = await repostResponse.json();

        if (!repostResponse.ok) {
            return res.status(500).json({
                error: 'Repost failed',
                telegram_error: repostData.description,
                details: `Bot might need "Send Messages" permission in ${CHANNEL_ID}`
            });
        }

        return res.status(200).json({
            success: true,
            message_source: source,
            original_message: lastMessage,
            reposted_message: repostData.result,
            channel_info: chatInfo.result
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message,
            troubleshooting: `Verify your bot token at: https://api.telegram.org/bot${BOT_TOKEN}/getMe`
        });
    }
}
