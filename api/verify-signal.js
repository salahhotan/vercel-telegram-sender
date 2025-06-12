import fetch from 'node-fetch';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

// Helper function to parse trade signals from message text
function parseTradeSignal(messageText) {
    const signalPattern = /📈 (.+?) Trade Signal \((.+?)\)\n⏰ Interval: (\d+)min\n💵 Price: ([\d.]+)\n📊 (?:Change: [\d.%]+\n)?(?:📉 EMA21: ([\d.]+)\n)?(?:📉 Stoch K\/D: ([\d.]+)\/([\d.]+)\n)?🚦 Signal: (BUY|SELL|HOLD)/;
    const match = messageText.match(signalPattern);
    
    if (!match) return null;

    return {
        symbol: match[1],
        strategy: match[2],
        interval: parseInt(match[3]),
        price: parseFloat(match[4]),
        ema21: match[5] ? parseFloat(match[5]) : null,
        stochK: match[6] ? parseFloat(match[6]) : null,
        stochD: match[7] ? parseFloat(match[7]) : null,
        signal: match[8],
        timestamp: new Date(messageText.match(/🕒 (.+)$/)[1])
    };
}

// Function to determine signal result
async function determineSignalResult(signal) {
    try {
        // Get the next candle's data
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${signal.symbol}&interval=${signal.interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=2&start_date=${Math.floor(signal.timestamp.getTime() / 1000)}`;
        const response = await fetch(timeSeriesUrl);
        const data = await response.json();

        if (data.status === 'error' || !data.values || data.values.length < 2) {
            console.error('Error fetching next candle data:', data);
            return null;
        }

        // The first value is the candle at the signal time, the second is the next candle
        const nextCandle = data.values[1];
        const nextClose = parseFloat(nextCandle.close);
        const priceChange = ((nextClose - signal.price) / signal.price) * 100;

        let result;
        if (signal.signal === 'BUY') {
            result = priceChange > 0 ? 'WIN' : 'LOSS';
        } else if (signal.signal === 'SELL') {
            result = priceChange < 0 ? 'WIN' : 'LOSS';
        } else {
            result = 'NEUTRAL';
        }

        return {
            result,
            nextClose,
            priceChange: priceChange.toFixed(2),
            timestamp: new Date(nextCandle.datetime)
        };

    } catch (error) {
        console.error('Error determining signal result:', error);
        return null;
    }
}

// Function to post result to Telegram
async function postResultToChannel(originalSignal, analysisResult) {
    const resultEmoji = analysisResult.result === 'WIN' ? '✅' : analysisResult.result === 'LOSS' ? '❌' : '➖';
    const directionEmoji = originalSignal.signal === 'BUY' ? '📈' : '📉';
    
    const message = `🔍 Trade Signal Analysis ${resultEmoji}
${directionEmoji} ${originalSignal.symbol} ${originalSignal.signal} 
⏰ Interval: ${originalSignal.interval}min
🕒 Signal Time: ${originalSignal.timestamp.toLocaleString()}
💵 Entry Price: ${originalSignal.price.toFixed(5)}
💰 Exit Price: ${analysisResult.nextClose.toFixed(5)}
📊 P/L: ${analysisResult.priceChange}%
🎯 Result: ${analysisResult.result}

#${originalSignal.symbol.replace('/', '')} #${originalSignal.strategy.replace(/\s+/g, '')}`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: message,
                parse_mode: 'Markdown',
                reply_to_message_id: originalSignal.messageId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return true;
    } catch (error) {
        console.error('Error posting result to channel:', error);
        return false;
    }
}

// Main function to analyze the last message
export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Fetch the last message from the channel
        const messagesResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`);
        const messagesData = await messagesResponse.json();

        if (!messagesData.ok || !messagesData.result || messagesData.result.length === 0) {
            return res.status(404).json({ error: 'No messages found in channel' });
        }

        const lastMessage = messagesData.result[0];
        if (!lastMessage.text) {
            return res.status(400).json({ error: 'Last message has no text content' });
        }

        // 2. Parse the trade signal
        const signal = parseTradeSignal(lastMessage.text);
        if (!signal) {
            return res.status(400).json({ error: 'No trade signal found in last message' });
        }
        signal.messageId = lastMessage.message_id;

        // 3. Determine the signal's result
        const result = await determineSignalResult(signal);
        if (!result) {
            return res.status(500).json({ error: 'Could not determine signal result' });
        }

        // 4. Post the result back to the channel
        const postSuccess = await postResultToChannel(signal, result);
        if (!postSuccess) {
            return res.status(500).json({ error: 'Failed to post result to channel' });
        }

        return res.status(200).json({
            success: true,
            symbol: signal.symbol,
            signal: signal.signal,
            result: result.result,
            priceChange: result.priceChange,
            analysisTime: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
