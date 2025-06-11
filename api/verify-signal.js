// signal-checker.js
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
        const { checkAfterMinutes = 15, lookbackMinutes = 60 } = req.body;

        // 1. Get recent messages from Telegram channel
        const telegramMessagesUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=20`;
        const messagesResponse = await fetch(telegramMessagesUrl);
        const messagesData = await messagesResponse.json();

        if (!messagesData.ok || !messagesData.result) {
            throw new Error('Failed to fetch Telegram messages');
        }

        // 2. Parse messages to find trade signals
        const signals = [];
        const signalRegex = /📈 (.+?) Trade Signal(.+?)💰 Price: (.+?).+?🚦 Signal: (.+?)\n/s;

        messagesData.result.messages.forEach(msg => {
            if (msg.text) {
                const match = msg.text.match(signalRegex);
                if (match) {
                    const symbol = match[1].trim();
                    const price = parseFloat(match[3].trim());
                    const signal = match[4].trim();
                    const timestamp = msg.date * 1000; // Convert to milliseconds

                    signals.push({
                        messageId: msg.message_id,
                        symbol,
                        price,
                        signal,
                        timestamp,
                        originalMessage: msg.text
                    });
                }
            }
        });

        if (signals.length === 0) {
            return res.status(200).json({ 
                success: true,
                message: 'No trade signals found in recent messages',
                signalsChecked: 0
            });
        }

        // 3. Process each signal that's older than lookback period
        const now = Date.now();
        const results = [];

        for (const signal of signals) {
            const signalAgeMinutes = (now - signal.timestamp) / (1000 * 60);
            
            // Only check signals that are older than our checkAfterMinutes but within lookback window
            if (signalAgeMinutes >= checkAfterMinutes && signalAgeMinutes <= lookbackMinutes) {
                // Get current price
                const twelveDataSymbol = signal.symbol.includes('/') 
                    ? `${signal.symbol.replace('/', '/')}`
                    : signal.symbol;

                const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=1min&apikey=${TWELVEDATA_API_KEY}&outputsize=1`;
                const timeSeriesResponse = await fetch(timeSeriesUrl);
                const timeSeriesData = await timeSeriesResponse.json();
                
                if (timeSeriesData.status === 'error' || !timeSeriesData.values) {
                    console.error(`Failed to fetch price for ${signal.symbol}`);
                    continue;
                }

                const currentPrice = parseFloat(timeSeriesData.values[0].close);
                const priceChange = ((currentPrice - signal.price) / signal.price) * 100;
                
                let result = "NEUTRAL";
                let profitLoss = 0;
                let reason = "";

                // Determine result
                if (signal.signal === "BUY") {
                    profitLoss = currentPrice - signal.price;
                    if (currentPrice > signal.price) {
                        result = "WIN";
                        reason = `Price increased by ${priceChange.toFixed(2)}%`;
                    } else if (currentPrice < signal.price) {
                        result = "LOSS";
                        reason = `Price decreased by ${Math.abs(priceChange).toFixed(2)}%`;
                    }
                } else if (signal.signal === "SELL") {
                    profitLoss = signal.price - currentPrice;
                    if (currentPrice < signal.price) {
                        result = "WIN";
                        reason = `Price decreased by ${Math.abs(priceChange).toFixed(2)}%`;
                    } else if (currentPrice > signal.price) {
                        result = "LOSS";
                        reason = `Price increased by ${priceChange.toFixed(2)}%`;
                    }
                }

                // Format result message
                const resultMessage = `📊 ${signal.symbol} Signal Result (after ${checkAfterMinutes}min)
⏰ Signal Time: ${new Date(signal.timestamp).toLocaleString()}
💰 Entry Price: ${signal.price.toFixed(5)}
📈 Current Price: ${currentPrice.toFixed(5)}
📉 P/L: ${profitLoss.toFixed(5)} (${priceChange.toFixed(2)}%)
🏆 Result: ${result}
💡 Details: ${reason}

🔍 Original Signal: ${signal.signal}`;

                // Post result to Telegram (as a reply to original message)
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CHANNEL_ID,
                        text: resultMessage,
                        parse_mode: 'Markdown',
                        reply_to_message_id: signal.messageId
                    })
                });

                results.push({
                    symbol: signal.symbol,
                    originalSignal: signal.signal,
                    entryPrice: signal.price,
                    currentPrice,
                    profitLoss,
                    priceChange,
                    result,
                    durationMinutes: checkAfterMinutes
                });
            }
        }

        return res.status(200).json({ 
            success: true,
            signalsChecked: results.length,
            results
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
