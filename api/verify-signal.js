import fetch from 'node-fetch';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

// Enhanced with more robust error handling
async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

function parseTradeSignal(messageText) {
    if (!messageText) return null;
    
    try {
        const signalPattern = /📈 (.+?) Trade Signal \((.+?)\)[\s\S]+?⏰ Interval: (\d+)min[\s\S]+?💵 Price: ([\d.]+)[\s\S]+?🚦 Signal: (BUY|SELL|HOLD)/;
        const match = messageText.match(signalPattern);
        
        if (!match) return null;

        const timestampMatch = messageText.match(/🕒 (.+)$/);
        const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();

        return {
            symbol: match[1],
            strategy: match[2],
            interval: parseInt(match[3]),
            price: parseFloat(match[4]),
            signal: match[5],
            timestamp
        };
    } catch (error) {
        console.error('Error parsing trade signal:', error);
        return null;
    }
}

async function determineSignalResult(signal) {
    if (!signal) return null;
    
    try {
        const startTime = Math.floor(signal.timestamp.getTime() / 1000);
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${signal.symbol}&interval=${signal.interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=2&start_date=${startTime}`;
        
        const data = await fetchWithRetry(timeSeriesUrl);
        
        if (data.status === 'error' || !data.values || data.values.length < 2) {
            console.error('Insufficient data for analysis:', data);
            return null;
        }

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

async function postResultToChannel(originalSignal, analysisResult) {
    if (!originalSignal || !analysisResult) return false;
    
    try {
        const resultEmoji = analysisResult.result === 'WIN' ? '✅' : analysisResult.result === 'LOSS' ? '❌' : '➖';
        const directionEmoji = originalSignal.signal === 'BUY' ? '📈' : '📉';
        
        const message = `🔍 Trade Signal Analysis ${resultEmoji}
${directionEmoji} ${originalSignal.symbol} ${originalSignal.signal} 
⏰ Interval: ${originalSignal.interval}min
🕒 Signal Time: ${originalSignal.timestamp.toLocaleString()}
💵 Entry Price: ${originalSignal.price.toFixed(5)}
💰 Exit Price: ${analysisResult.nextClose.toFixed(5)}
📊 P/L: ${analysisResult.priceChange}%
🎯 Result: ${analysisResult.result}`;

        const response = await fetchWithRetry(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CHANNEL_ID,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_to_message_id: originalSignal.messageId
                })
            }
        );

        return true;
    } catch (error) {
        console.error('Error posting to Telegram:', error);
        return false;
    }
}

export default async function handler(req, res) {
    // Immediate response to prevent timeout
    res.setHeader('Content-Type', 'application/json');
    
    try {
        if (!BOT_TOKEN || !CHANNEL_ID) {
            throw new Error('Missing Telegram configuration');
        }

        // 1. Fetch the last message
        const messagesData = await fetchWithRetry(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=1`
        );

        if (!messagesData.ok || !messagesData.result?.length) {
            return res.status(200).json({ status: 'No messages found' });
        }

        const lastMessage = messagesData.result[0];
        if (!lastMessage.text) {
            return res.status(200).json({ status: 'Last message has no text' });
        }

        // 2. Parse the trade signal
        const signal = parseTradeSignal(lastMessage.text);
        if (!signal) {
            return res.status(200).json({ status: 'No trade signal detected' });
        }
        signal.messageId = lastMessage.message_id;

        // 3. Determine the signal's result
        const result = await determineSignalResult(signal);
        if (!result) {
            return res.status(200).json({ status: 'Could not analyze signal' });
        }

        // 4. Post the result back
        await postResultToChannel(signal, result);

        return res.status(200).json({
            status: 'success',
            symbol: signal.symbol,
            signal: signal.signal,
            result: result.result,
            priceChange: result.priceChange
        });

    } catch (error) {
        console.error('Fatal error:', error);
        return res.status(500).json({ 
            status: 'error',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
