// api/send-signal.js

export default async function handler(req, res) {
    // 1. Check if it's a POST request (optional - could be GET for scheduled triggers)
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get environment variables
    const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!ALPHA_VANTAGE_API_KEY || !BOT_TOKEN || !CHANNEL_ID) {
        console.error("Missing required environment variables.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Fetch market data from Alpha Vantage
        const symbol = req.body.symbol || 'IBM'; // Default to IBM if not specified
        const interval = req.body.interval || '5min'; // Default to 5min intervals
        
        const alphaVantageUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${interval}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        
        const dataResponse = await fetch(alphaVantageUrl);
        const marketData = await dataResponse.json();

        // 4. Check if we got valid data
        if (!marketData || !marketData['Time Series (' + interval + ')']) {
            console.error('Invalid market data received:', marketData);
            return res.status(500).json({ error: 'Failed to fetch market data' });
        }

        // 5. Process the data and apply trading strategy
        const timeSeries = marketData['Time Series (' + interval + ')'];
        const latestDataPoints = Object.entries(timeSeries)
            .slice(0, 20) // Get last 20 data points
            .map(([timestamp, data]) => ({
                timestamp,
                close: parseFloat(data['4. close']),
                volume: parseFloat(data['5. volume'])
            }));

        // 6. Simple moving average strategy
        const shortPeriod = 5;
        const longPeriod = 10;
        
        // Calculate short and long SMAs
        const shortSMA = calculateSMA(latestDataPoints.slice(0, shortPeriod).map(d => d.close));
        const longSMA = calculateSMA(latestDataPoints.slice(0, longPeriod).map(d => d.close));
        
        const latestClose = latestDataPoints[0].close;
        const previousClose = latestDataPoints[1].close;
        
        // 7. Generate signal based on strategy
        let signal = '';
        let strength = '';
        
        // Simple crossover strategy
        if (shortSMA > longSMA && previousClose <= longSMA) {
            signal = 'BUY';
            strength = 'Strong';
        } else if (shortSMA < longSMA && previousClose >= longSMA) {
            signal = 'SELL';
            strength = 'Strong';
        } else if (latestClose > shortSMA && latestClose > longSMA) {
            signal = 'BUY';
            strength = 'Weak';
        } else if (latestClose < shortSMA && latestClose < longSMA) {
            signal = 'SELL';
            strength = 'Weak';
        } else {
            signal = 'HOLD';
            strength = 'Neutral';
        }

        // 8. Prepare Telegram message
        const message = `📈 *Market Signal for ${symbol}* (${interval})\n\n` +
                         `*Current Price*: $${latestClose.toFixed(2)}\n` +
                         `*5-period SMA*: $${shortSMA.toFixed(2)}\n` +
                         `*10-period SMA*: $${longSMA.toFixed(2)}\n\n` +
                         `🚦 *Signal*: _${signal}_ (${strength})\n` +
                         `📅 *Time*: ${new Date().toUTCString()}\n\n` +
                         `#${symbol} #${signal} #TradingSignal`;

        // 9. Send message to Telegram
        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const payload = {
            chat_id: CHANNEL_ID,
            text: message,
            parse_mode: 'MarkdownV2',
        };

        const telegramResponse = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const telegramResult = await telegramResponse.json();

        if (!telegramResponse.ok || !telegramResult.ok) {
            console.error('Telegram API Error:', telegramResult);
            return res.status(500).json({
                error: 'Failed to send message to Telegram',
                telegram_error: telegramResult.description || 'Unknown error',
            });
        }

        // 10. Return success response
        return res.status(200).json({
            success: true,
            message: 'Signal processed and sent successfully!',
            symbol,
            signal,
            strength,
            latestClose,
            shortSMA,
            longSMA,
            telegram_response: telegramResult
        });

    } catch (error) {
        console.error('Error in signal handler:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

// Helper function to calculate Simple Moving Average
function calculateSMA(values) {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}
