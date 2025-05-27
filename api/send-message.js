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

        // 1. Get quote data
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

        // 2. Get technical indicators based on interval
        const indicatorsUrl = `https://finnhub.io/api/v1/scan/technical-indicator?symbol=${symbol}&resolution=${interval}&token=${FINNHUB_API_KEY}`;
        const indicatorsResponse = await fetch(indicatorsUrl);
        const indicatorsData = await indicatorsResponse.json();

        // 3. Apply selected strategy
        const currentPrice = quoteData.c;
        const previousClose = quoteData.pc;
        const priceChange = ((currentPrice - previousClose) / previousClose) * 100;
        
        let signal = "HOLD";
        let reason = "";
        let analysis = {};

        switch(strategy) {
            case 'momentum':
                // Momentum strategy (default)
                if (priceChange > 1.5) {
                    signal = "BUY";
                    reason = `Strong upward momentum (+${priceChange.toFixed(2)}%) on ${interval} timeframe`;
                } else if (priceChange < -1.5) {
                    signal = "SELL";
                    reason = `Strong downward momentum (${priceChange.toFixed(2)}%) on ${interval} timeframe`;
                } else {
                    reason = `Neutral price movement (${priceChange.toFixed(2)}%) on ${interval} timeframe`;
                }
                analysis = { priceChange };
                break;

            case 'mean_reversion':
                // Mean reversion strategy (using RSI if available)
                const rsi = indicatorsData?.technicalAnalysis?.rsi;
                if (rsi) {
                    analysis.rsi = rsi;
                    if (rsi < 30) {
                        signal = "BUY";
                        reason = `Oversold (RSI ${rsi.toFixed(1)}) on ${interval} timeframe`;
                    } else if (rsi > 70) {
                        signal = "SELL";
                        reason = `Overbought (RSI ${rsi.toFixed(1)}) on ${interval} timeframe`;
                    } else {
                        reason = `Neutral RSI (${rsi.toFixed(1)}) on ${interval} timeframe`;
                    }
                } else {
                    // Fallback to momentum if no RSI
                    signal = "HOLD";
                    reason = `RSI data not available, using price change (${priceChange.toFixed(2)}%)`;
                    analysis.priceChange = priceChange;
                }
                break;

            case 'breakout':
                // Breakout strategy (using volatility and recent highs/lows)
                const volatility = indicatorsData?.technicalAnalysis?.volatility;
                const recentHigh = indicatorsData?.technicalAnalysis?.high;
                const recentLow = indicatorsData?.technicalAnalysis?.low;
                
                analysis = { volatility, recentHigh, recentLow, currentPrice };
                
                if (volatility && recentHigh && recentLow) {
                    const range = recentHigh - recentLow;
                    const breakoutThreshold = 0.7 * range;
                    
                    if (currentPrice > recentHigh + breakoutThreshold) {
                        signal = "BUY";
                        reason = `Breakout above resistance ($${recentHigh.toFixed(2)}) on ${interval} timeframe`;
                    } else if (currentPrice < recentLow - breakoutThreshold) {
                        signal = "SELL";
                        reason = `Breakdown below support ($${recentLow.toFixed(2)}) on ${interval} timeframe`;
                    } else {
                        reason = `Trading within range ($${recentLow.toFixed(2)}-$${recentHigh.toFixed(2)}) on ${interval} timeframe`;
                    }
                } else {
                    signal = "HOLD";
                    reason = `Insufficient data for breakout analysis on ${interval} timeframe`;
                }
                break;
        }

        // 4. Format and send message
        const message = `📈 ${symbol} Trade Signal (${strategy.toUpperCase()})
⏱️ Timeframe: ${interval}
💵 Current: $${currentPrice.toFixed(2)}
📊 Change: ${priceChange.toFixed(2)}%
🚦 Signal: ${signal}
💡 Reason: ${reason}

📊 Analysis: ${JSON.stringify(analysis, null, 2)}

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
            reason,
            analysis
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
}
