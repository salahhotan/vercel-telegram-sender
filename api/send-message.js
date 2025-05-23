// api/send-signal.js

export default async function handler(req, res) {
    // 1. Check if it's a POST request
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get API keys from Environment Variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const FINNHUB_API_KEY = 'd0iq20pr01qnehifllf0d0iq20pr01qnehifllfg';

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error("Missing Telegram environment variables.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Get the stock symbol from request body
        const { symbol } = req.body;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Missing "symbol" in request body' });
        }

        // 4. Fetch stock data from Finnhub
        // Get current quote
        const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();

        if (!quoteData.c) {
            console.error('Finnhub Quote Error:', quoteData);
            return res.status(500).json({ 
                error: 'Failed to fetch quote data',
                finnhub_error: quoteData.error || 'Invalid response'
            });
        }

        // Get historical data for MA calculation
        const now = Math.floor(Date.now() / 1000);
        const oneMonthAgo = now - (30 * 24 * 60 * 60);
        const candlesUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${oneMonthAgo}&to=${now}&token=${FINNHUB_API_KEY}`;
        const candlesResponse = await fetch(candlesUrl);
        const candlesData = await candlesResponse.json();

        if (!candlesData.c || candlesData.c.length < 20) {
            console.error('Finnhub Candles Error:', candlesData);
            return res.status(500).json({ 
                error: 'Failed to fetch historical data',
                finnhub_error: candlesData.error || 'Not enough data points'
            });
        }

        // 5. Process data and implement strategy
        const closingPrices = candlesData.c.slice(0, 20); // Last 20 closing prices
        const currentPrice = quoteData.c;
        const previousClose = quoteData.pc;
        
        // Calculate 5-day and 20-day moving averages
        const shortTermPeriod = 5;
        const longTermPeriod = 20;
        
        const shortMA = closingPrices.slice(0, shortTermPeriod).reduce((a, b) => a + b, 0) / shortTermPeriod;
        const longMA = closingPrices.slice(0, longTermPeriod).reduce((a, b) => a + b, 0) / longTermPeriod;
        
        // 6. Generate trading signal
        let signal = "HOLD";
        let reason = "";
        
        // Moving Average Crossover Strategy
        if (shortMA > longMA && previousClose <= longMA) {
            signal = "BUY";
            reason = "5-day MA crossed above 20-day MA";
        } 
        else if (shortMA < longMA && previousClose >= longMA) {
            signal = "SELL";
            reason = "5-day MA crossed below 20-day MA";
        }
        
        // 7. Format the message
        const message = `📊 ${symbol} Trading Signal
📈 Current Price: $${currentPrice.toFixed(2)}
📉 Previous Close: $${previousClose.toFixed(2)}
📊 5-Day MA: $${shortMA.toFixed(2)}
📈 20-Day MA: $${longMA.toFixed(2)}

🚦 Signal: ${signal}
💡 Reason: ${reason}

Data provided by Finnhub`;

        // 8. Send to Telegram
        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const payload = {
            chat_id: CHANNEL_ID,
            text: message
        };

        const telegramResponse = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const telegramResult = await telegramResponse.json();

        if (!telegramResponse.ok || !telegramResult.ok) {
            console.error('Telegram API Error:', telegramResult);
            return res.status(500).json({
                error: 'Failed to send message to Telegram',
                telegram_error: telegramResult.description || 'Unknown error'
            });
        }

        // 9. Send success response
        return res.status(200).json({ 
            success: true, 
            message: 'Trading signal sent to Telegram successfully!',
            symbol,
            currentPrice,
            signal,
            reason,
            telegram_response: telegramResult 
        });

    } catch (error) {
        console.error('Error in handler:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
}




