// api/send-message.js
export default async function handler(req, res) {
    // Allow both GET (with query params) and POST (with body)
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || 'd0iq20pr01qnehifllf0d0iq20pr01qnehifllfg';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        // Get parameters from either query (GET) or body (POST)
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!interval) return res.status(400).json({ error: 'Missing interval parameter' });
        if (!strategy) return res.status(400).json({ error: 'Missing strategy parameter' });

        // 1. Get basic quote data
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();
        
        if (!quoteData.c) {
            console.error('Finnhub Error:', quoteData);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                details: quoteData.error || 'Invalid response'
            });
        }

        // 2. Get technical indicators with the specified interval
        const indicatorsUrl = `https://finnhub.io/api/v1/scan/technical-indicator?symbol=${symbol}&resolution=${interval}&token=${FINNHUB_API_KEY}`;
        const indicatorsResponse = await fetch(indicatorsUrl);
        const indicatorsData = await indicatorsResponse.json();

        // 3. Generate signal based on strategy
        const currentPrice = quoteData.c;
        const previousClose = quoteData.pc;
        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        
        // Basic momentum strategy (same logic as before)
        if (priceChange > 1.5) {
            signal = "BUY";
            reason = `Significant upward momentum (+${priceChange.toFixed(2)}%) using ${strategy} strategy on ${interval}min chart`;
        } else if (priceChange < -1.5) {
            signal = "SELL";
            reason = `Significant downward momentum (${priceChange.toFixed(2)}%) using ${strategy} strategy on ${interval}min chart`;
        } else {
            signal = "HOLD";
            reason = `Neutral price movement (${priceChange.toFixed(2)}%) using ${strategy} strategy on ${interval}min chart`;
        }

        // 4. Format and send message
        const message = `📈 ${symbol} Trade Signal (${strategy})
⏰ Interval: ${interval}min
💵 Current: $${currentPrice.toFixed(2)}
📊 Change: ${priceChange.toFixed(2)}%
🚦 Signal: ${signal}
💡 Reason: ${reason}

Generated at: ${new Date().toLocaleString()}`;

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
