export default async function handler(req, res) {
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
        const { symbol, interval, strategy } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!interval) return res.status(400).json({ error: 'Missing interval parameter' });
        if (!strategy) return res.status(400).json({ error: 'Missing strategy parameter' });

        // Normalize symbol for Finnhub API
        const finnhubSymbol = symbol.includes('/') 
            ? `OANDA:${symbol.replace('/', '')}` // Format forex pairs as OANDA:EURUSD
            : symbol;

        // 1. Get basic quote data
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${FINNHUB_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();
        
        if (!quoteData.c && !quoteData.currentPrice) {
            console.error('Finnhub Error:', quoteData);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                details: quoteData.error || 'Invalid symbol or API issue'
            });
        }

        // Use currentPrice for forex or c for stocks
        const currentPrice = quoteData.currentPrice || quoteData.c;
        const previousClose = quoteData.previousClose || quoteData.pc;
        
        if (currentPrice === undefined || previousClose === undefined) {
            return res.status(400).json({ 
                error: 'Invalid symbol format',
                details: `Use 'EURUSD' or 'OANDA:EURUSD' for forex, 'AAPL' for stocks`
            });
        }

        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        
        // Strategy logic
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

        // Format message
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
