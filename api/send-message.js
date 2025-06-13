// Simplified version without Firebase for now to isolate the issue
export default async function handler(req, res) {
    // Set response headers
    res.setHeader('Content-Type', 'application/json');

    try {
        // Validate HTTP method
        if (req.method !== 'GET' && req.method !== 'POST') {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).json({ 
                error: `Method ${req.method} Not Allowed`,
                message: 'Only GET or POST requests are supported'
            });
        }

        // Check required environment variables
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
        const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

        if (!BOT_TOKEN || !CHANNEL_ID) {
            return res.status(500).json({ 
                error: 'Configuration Error',
                message: 'Missing Telegram bot token or channel ID'
            });
        }

        if (!TWELVEDATA_API_KEY) {
            return res.status(500).json({ 
                error: 'Configuration Error',
                message: 'Missing TwelveData API key'
            });
        }

        // Extract parameters
        const params = req.method === 'GET' ? req.query : req.body;
        const { symbol, interval, strategy } = params;

        // Validate parameters
        if (!symbol || !interval || !strategy) {
            return res.status(400).json({
                error: 'Missing Parameters',
                message: 'symbol, interval, and strategy are all required',
                received: { symbol, interval, strategy }
            });
        }

        // Normalize symbol
        const twelveDataSymbol = symbol.includes('/') 
            ? symbol.replace('/', '/') 
            : symbol;

        // 1. Fetch time series data
        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${twelveDataSymbol}&interval=${interval}min&apikey=${TWELVEDATA_API_KEY}&outputsize=2`;
        const timeSeriesResponse = await fetch(timeSeriesUrl);
        
        if (!timeSeriesResponse.ok) {
            const errorData = await timeSeriesResponse.json();
            return res.status(500).json({
                error: 'API Error',
                message: 'Failed to fetch time series data',
                details: errorData
            });
        }

        const timeSeriesData = await timeSeriesResponse.json();

        if (!timeSeriesData.values || timeSeriesData.values.length < 2) {
            return res.status(500).json({
                error: 'Data Error',
                message: 'Insufficient data points received',
                data: timeSeriesData
            });
        }

        // 2. Fetch quote data
        const quoteUrl = `https://api.twelvedata.com/quote?symbol=${twelveDataSymbol}&apikey=${TWELVEDATA_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        
        if (!quoteResponse.ok) {
            const errorData = await quoteResponse.json();
            return res.status(500).json({
                error: 'API Error',
                message: 'Failed to fetch quote data',
                details: errorData
            });
        }

        const quoteData = await quoteResponse.json();

        // Extract prices
        const currentPrice = parseFloat(timeSeriesData.values[0].close);
        const previousClose = parseFloat(quoteData.close);

        if (isNaN(currentPrice) {
            return res.status(500).json({
                error: 'Data Error',
                message: 'Invalid current price data',
                value: timeSeriesData.values[0].close
            });
        }

        if (isNaN(previousClose)) {
            return res.status(500).json({
                error: 'Data Error',
                message: 'Invalid previous close price data',
                value: quoteData.close
            });
        }

        // Calculate price change
        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;

        // Simple strategy logic for testing
        let signal = "HOLD";
        let reason = "";
        
        if (priceChange > 1.5) {
            signal = "BUY";
            reason = `Uptrend (+${priceChange.toFixed(2)}%)`;
        } else if (priceChange < -1.5) {
            signal = "SELL";
            reason = `Downtrend (${priceChange.toFixed(2)}%)`;
        } else {
            signal = "HOLD";
            reason = `Neutral (${priceChange.toFixed(2)}%)`;
        }

        // Format Telegram message
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Price: ${currentPrice.toFixed(5)}
📊 Change: ${priceChange.toFixed(2)}%
🚦 Signal: ${signal}
💡 Reason: ${reason}

🕒 ${new Date().toLocaleString()}`;

        // Send to Telegram
        const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(`Telegram API error: ${error.description || 'Unknown error'}`);
        }

        // Successful response
        return res.status(200).json({
            success: true,
            symbol,
            interval,
            strategy,
            currentPrice,
            priceChange,
            signal,
            reason,
            message: 'Signal processed successfully'
        });

    } catch (error) {
        // Detailed error logging
        console.error('Full Error:', {
            message: error.message,
            stack: error.stack,
            request: {
                method: req.method,
                query: req.query,
                body: req.body
            }
        });

        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message,
            requestId: req.headers['x-vercel-id'],
            ...(process.env.NODE_ENV === 'development' && {
                stack: error.stack
            })
        });
    }
}
