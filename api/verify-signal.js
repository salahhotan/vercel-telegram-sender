export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Get the last message from the Telegram channel
        // Note: Using getUpdates instead of getChatHistory which requires special permissions
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.result) {
            console.error('Telegram API Error:', updatesData);
            return res.status(500).json({ 
                error: 'Failed to fetch messages',
                details: updatesData.description || 'Check bot permissions'
            });
        }

        // Find the last message sent by the bot to the channel
        const channelMessages = updatesData.result
            .filter(update => update.channel_post && update.channel_post.chat.id.toString() === CHANNEL_ID.toString())
            .map(update => update.channel_post);

        if (channelMessages.length === 0) {
            return res.status(404).json({ 
                error: 'No messages found in channel',
                details: 'Make sure the bot is admin and has posted messages'
            });
        }

        const lastMessage = channelMessages[channelMessages.length - 1];
        const messageText = lastMessage.text;

        // 2. Parse the last signal from the message (rest of the code remains the same)
        const signalRegex = /🚦 Signal: (BUY|SELL|HOLD)/;
        const symbolRegex = /📈 (\S+) Trade Signal/;
        const intervalRegex = /⏰ Interval: (\d+)min/;
        const priceRegex = /💵 Price: (\d+\.\d+)/;

        const signalMatch = messageText.match(signalRegex);
        const symbolMatch = messageText.match(symbolRegex);
        const intervalMatch = messageText.match(intervalRegex);
        const priceMatch = messageText.match(priceRegex);

        if (!signalMatch || !symbolMatch || !intervalMatch || !priceMatch) {
            return res.status(400).json({ 
                error: 'Could not parse signal information from last message',
                details: 'Message format mismatch'
            });
        }

        const signal = signalMatch[1];
        const symbol = symbolMatch[1];
        const interval = parseInt(intervalMatch[1]);
        const entryPrice = parseFloat(priceMatch[1]);

        if (signal === 'HOLD') {
            return res.status(200).json({ 
                success: true,
                message: 'Last signal was HOLD - no result to verify'
            });
        }

        // 3. Get the next candle's data to verify the signal
        const twelveDataSymbol = symbol.includes('/') ? `${symbol.replace('/', '/')}` : symbol;

        // Get enough candles to cover the interval period
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=2`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();

        if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
            console.error('TwelveData Error:', timeSeriesData);
            return res.status(500).json({ 
                error: 'Failed to fetch time series data',
                details: timeSeriesData.message || 'Invalid symbol or API issue'
            });
        }

        // The first value is the most recent, we want the next one after our signal
        const nextCandle = timeSeriesData.values[1];
        if (!nextCandle) {
            return res.status(404).json({ 
                error: 'Next candle data not available yet',
                details: 'Wait for the next candle to close'
            });
        }

        const exitPrice = parseFloat(nextCandle.close);
        const priceChange = ((exitPrice - entryPrice) / entryPrice) * 100;

        // 4. Determine if the signal was successful
        let result;
        if (signal === 'BUY' && priceChange > 0) {
            result = 'WIN';
        } else if (signal === 'SELL' && priceChange < 0) {
            result = 'WIN';
        } else {
            result = 'LOSS';
        }

        // 5. Send the result back to the channel
        const resultMessage = `📊 ${symbol} Signal Result
⏰ Interval: ${interval}min
📈 Signal: ${signal} @ ${entryPrice.toFixed(5)}
📉 Exit: ${exitPrice.toFixed(5)} (${priceChange.toFixed(2)}%)
🏆 Result: ${result}

🔍 ${new Date().toLocaleString()}`;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: resultMessage,
                parse_mode: 'Markdown',
                reply_to_message_id: lastMessage.message_id
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            symbol,
            interval,
            signal,
            entryPrice,
            exitPrice,
            priceChange,
            result
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
