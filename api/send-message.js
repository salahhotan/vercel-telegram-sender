// api/send-signal.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const FINNHUB_API_KEY = 'd0iq20pr01qnehifllf0d0iq20pr01qnehifllfg';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing Telegram configuration' });
    }

    try {
        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

        // 1. Get basic quote data (works with free tier)
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

        // 2. Get alternative technical indicators (works with free tier)
        const indicatorsUrl = `https://finnhub.io/api/v1/scan/technical-indicator?symbol=${symbol}&resolution=D&token=${FINNHUB_API_KEY}`;
        const indicatorsResponse = await fetch(indicatorsUrl);
        const indicatorsData = await indicatorsResponse.json();

        // 3. Simplified strategy using available data
        const currentPrice = quoteData.c;
        const previousClose = quoteData.pc;
        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        
        // Basic momentum strategy
        if (priceChange > 1.5) {
            signal = "BUY";
            reason = "Significant upward momentum (+" + priceChange.toFixed(2) + "%)";
        } else if (priceChange < -1.5) {
            signal = "SELL";
            reason = "Significant downward momentum (" + priceChange.toFixed(2) + "%)";
        } else {
            signal = "HOLD";
            reason = "Neutral price movement (" + priceChange.toFixed(2) + "%)";
        }

        // 4. Format and send message
        const message = `📈 ${symbol} Trade Signal
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
                text: message
            })
        });

        if (!telegramResponse.ok) {
            const error = await telegramResponse.json();
            throw new Error(error.description || 'Telegram API error');
        }

        return res.status(200).json({ 
            success: true,
            symbol,
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
