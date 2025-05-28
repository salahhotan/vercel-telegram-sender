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
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!interval) return res.status(400).json({ error: 'Missing interval parameter' });
        if (!strategy) return res.status(400).json({ error: 'Missing strategy parameter' });

        // Normalize symbol for TwelveData API (forex pairs use format: EUR/USD)
        const twelveDataSymbol = symbol.includes('/') 
            ? `${symbol.replace('/', '/')}` // Keep as EUR/USD for forex
            : symbol;

        // 1. Get time series data for price change calculation
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

        // 2. Get current quote data
        const quoteUrl = `https://api.twelvedata.com/quote?symbol=${twelveDataSymbol}&apikey=${TWELVEDATA_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();
        
        if (quoteData.status === 'error') {
            console.error('TwelveData Error:', quoteData);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                details: quoteData.message || 'Invalid symbol or API issue'
            });
        }

        // Extract prices - using the latest from time series and previous close from quote
        const currentPrice = parseFloat(timeSeriesData.values[0].close);
        const previousClose = parseFloat(quoteData.close);
        
        if (isNaN(currentPrice) || isNaN(previousClose)) {
            return res.status(400).json({ 
                error: 'Invalid price data received',
                details: `Verify the symbol format (e.g., 'EUR/USD' for forex, 'AAPL' for stocks)`
            });
        }

        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        
        // Strategy logic (same as before)
        if (priceChange > 1.5) {
            signal = "BUY";
            reason = `Strong uptrend (+${priceChange.toFixed(2)}%) on ${interval}min chart`;
        } else if (priceChange < -1.5) {
            signal = "SELL";
            reason = `Strong downtrend (${priceChange.toFixed(2)}%) on ${interval}min chart`;
        } else {
            signal = "HOLD";
            reason = `Neutral movement (${priceChange.toFixed(2)}%) on ${interval}min chart`;
        }

        // Format message (same as before)
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Price: ${currentPrice.toFixed(5)}
📊 Change: ${priceChange.toFixed(2)}%
🚦 Signal: ${signal}
💡 Reason: ${reason}

🕒 ${new Date().toLocaleString()}`;

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
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            symbol,
            interval,
            strategy,
            currentPrice,
            priceChange,
            signal,
            reason
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
