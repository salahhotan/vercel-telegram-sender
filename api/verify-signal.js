// File: check-signal-result.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '67f3f0d12887445d915142fcf85ccb59';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // 1. Fetch last message from Telegram channel
        const getUpdatesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${CHANNEL_ID}&limit=1`;
        const updatesResponse = await fetch(getUpdatesUrl);
        const updatesData = await updatesResponse.json();

        if (!updatesResponse.ok || !updatesData.result || updatesData.result.length === 0) {
            return res.status(404).json({ error: 'No messages found in channel' });
        }

        const lastMessage = updatesData.result[0].channel_post;
        const messageText = lastMessage.text;
        const messageDate = new Date(lastMessage.date * 1000);

        // 2. Identify trade signals in the message
        const signalRegex = /📈 (.+?) Trade Signal \((.+?)\)\n⏰ Interval: (.+?)min\n💵 Price: (.+?)\n📊 EMA21: (.+?)\n📉 Stoch K\/D: (.+?)\n🚦 Signal: (.+?)\n💡 Reason: (.+?)\n\n🕒 (.+)/;
        const match = messageText.match(signalRegex);

        if (!match) {
            return res.status(200).json({ 
                success: true, 
                message: 'Last message is not a trade signal', 
                lastMessage: messageText 
            });
        }

        const [, symbol, strategy, interval, price, ema21, stochKD, signal, reason, timestamp] = match;
        const stochK = parseFloat(stochKD.split('/')[0]);
        const stochD = parseFloat(stochKD.split('/')[1]);
        const entryPrice = parseFloat(price);

        // 3. Determine signal's result based on next candle close price
        // Calculate the time of the next candle close
        const intervalMinutes = parseInt(interval);
        const nextCandleCloseTime = new Date(messageDate);
        nextCandleCloseTime.setMinutes(nextCandleCloseTime.getMinutes() + intervalMinutes);

        // Check if enough time has passed to evaluate the signal
        const currentTime = new Date();
        if (currentTime < nextCandleCloseTime) {
            return res.status(200).json({ 
                success: true, 
                message: 'Signal evaluation time not reached yet', 
                nextEvaluationTime: nextCandleCloseTime.toISOString() 
            });
        }

        // Fetch price data for the evaluation period
        const twelveDataSymbol = symbol.includes('/') ? symbol : symbol;
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&start_date=${messageDate.toISOString()}&end_date=${currentTime.toISOString()}`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        const timeSeriesData = await timeSeriesResponse.json();

        if (timeSeriesData.status === 'error' || !timeSeriesData.values || timeSeriesData.values.length < 2) {
            console.error('TwelveData Error:', timeSeriesData);
            return res.status(500).json({ 
                error: 'Failed to fetch evaluation data',
                details: timeSeriesData.message || 'Not enough data points'
            });
        }

        // The first value is the candle when the signal was generated
        // The second value is the next candle we want to evaluate
        const evaluationCandle = timeSeriesData.values[1];
        const exitPrice = parseFloat(evaluationCandle.close);
        const priceChange = ((exitPrice - entryPrice) / entryPrice) * 100;

        // Determine if the signal was successful
        let result, resultMessage;
        if (signal === 'BUY') {
            const isWin = exitPrice > entryPrice;
            result = isWin ? 'WIN' : 'LOSS';
            resultMessage = `BUY signal ${isWin ? 'won' : 'lost'} (${priceChange.toFixed(2)}%)`;
        } else if (signal === 'SELL') {
            const isWin = exitPrice < entryPrice;
            result = isWin ? 'WIN' : 'LOSS';
            resultMessage = `SELL signal ${isWin ? 'won' : 'lost'} (${priceChange.toFixed(2)}%)`;
        } else {
            result = 'HOLD';
            resultMessage = 'No trade signal to evaluate';
        }

        // 4. Post the result back to the channel
        const resultMessageText = `📊 ${symbol} Trade Result (${strategy})
⏰ Interval: ${interval}min
⏱️ Signal Time: ${messageDate.toLocaleString()}
📊 Evaluation Time: ${new Date(evaluationCandle.datetime).toLocaleString()}
💰 Entry Price: ${entryPrice.toFixed(5)}
📈 Exit Price: ${exitPrice.toFixed(5)}
📉 Price Change: ${priceChange.toFixed(2)}%
🏆 Result: ${result}
📝 Details: ${resultMessage}

🔍 Original Signal:
${signal} - ${reason}`;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: resultMessageText,
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
            strategy,
            interval,
            entryPrice,
            exitPrice,
            priceChange,
            result,
            resultMessage
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
