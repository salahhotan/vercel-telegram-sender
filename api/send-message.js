// api/send-message.js
export default async function handler(req, res) {
    // Support both GET and POST requests
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
        const { symbol, interval = '15', strategy = 'momentum' } = req.method === 'GET' ? req.query : req.body;
        
        if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });
        if (!['1', '5', '15', '30', '60', 'D', 'W', 'M'].includes(interval)) {
            return res.status(400).json({ error: 'Invalid interval. Use: 1,5,15,30,60,D,W,M' });
        }
        if (!['momentum', 'mean_reversion', 'breakout'].includes(strategy)) {
            return res.status(400).json({ error: 'Invalid strategy. Use: momentum, mean_reversion, breakout' });
        }

        // 1. Get quote data with better error handling
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
        let quoteData;
        
        try {
            const quoteResponse = await fetch(quoteUrl);
            quoteData = await quoteResponse.json();
            
            if (!quoteData || quoteData.error) {
                console.error('Finnhub Quote Error:', quoteData);
                return res.status(500).json({ 
                    error: 'Failed to fetch quote data',
                    details: quoteData?.error || 'Empty response',
                    finnhubResponse: quoteData
                });
            }
            
            if (quoteData.c === undefined || quoteData.pc === undefined) {
                return res.status(500).json({ 
                    error: 'Invalid quote data structure',
                    details: 'Missing required price fields',
                    finnhubResponse: quoteData
                });
            }
        } catch (error) {
            console.error('Fetch Quote Error:', error);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                details: error.message,
                url: quoteUrl
            });
        }

        // 2. Get technical indicators with better error handling
        let indicatorsData = {};
        try {
            const indicatorsUrl = `https://finnhub.io/api/v1/scan/technical-indicator?symbol=${symbol}&resolution=${interval}&token=${FINNHUB_API_KEY}`;
            const indicatorsResponse = await fetch(indicatorsUrl);
            indicatorsData = await indicatorsResponse.json();
            
            if (indicatorsData.error) {
                console.warn('Finnhub Indicators Warning:', indicatorsData.error);
                // Continue with empty indicators data
                indicatorsData = {};
            }
        } catch (error) {
            console.warn('Fetch Indicators Error:', error);
            // Continue with empty indicators data
            indicatorsData = {};
        }

        // 3. Apply selected strategy
        const currentPrice = quoteData.c;
        const previousClose = quoteData.pc;
        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        let analysis = {
            price: currentPrice,
            previousClose,
            priceChange,
            interval,
            strategy
        };

        // ... (rest of your strategy logic remains the same)

        // 4. Format and send message
        const message = `📈 ${symbol} Trade Signal (${strategy.toUpperCase()})
⏱️ Timeframe: ${interval}
💵 Current: $${currentPrice.toFixed(2)}
📊 Change: ${priceChange.toFixed(2)}%
🚦 Signal: ${signal}
💡 Reason: ${reason}

Generated at: ${new Date().toLocaleString()}`;

        // ... (rest of your Telegram sending logic)

    } catch (error) {
        console.error('Unhandled Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
