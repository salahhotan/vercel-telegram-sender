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
    const ALPHA_VANTAGE_KEY = 'MTQ00L6WCER4WWBX';

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

        // 4. Fetch stock data from Alpha Vantage (daily time series)
        const alphaUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}&outputsize=compact`;
        
        const alphaResponse = await fetch(alphaUrl);
        const alphaData = await alphaResponse.json();

        if (!alphaData['Time Series (Daily)']) {
            console.error('Alpha Vantage Error:', alphaData);
            return res.status(500).json({ 
                error: 'Failed to fetch stock data',
                alpha_error: alphaData.Note || alphaData.Information || 'Invalid response'
            });
        }

        // 5. Process data and implement strategy
        const timeSeries = alphaData['Time Series (Daily)'];
        const dates = Object.keys(timeSeries).sort().reverse(); // Newest first
        
        // Extract closing prices for last 20 days
        const closingPrices = dates.slice(0, 20).map(date => parseFloat(timeSeries[date]['4. close']));
        
        // Calculate 5-day and 20-day moving averages
        const shortTermPeriod = 5;
        const longTermPeriod = 20;
        
        const shortMA = closingPrices.slice(0, shortTermPeriod).reduce((a, b) => a + b, 0) / shortTermPeriod;
        const longMA = closingPrices.slice(0, longTermPeriod).reduce((a, b) => a + b, 0) / longTermPeriod;
        
        const currentPrice = closingPrices[0];
        const previousPrice = closingPrices[1];
        
        // 6. Generate trading signal
        let signal = "HOLD";
        let reason = "";
        
        // Simple Moving Average Crossover Strategy
        if (shortMA > longMA && previousPrice <= longMA) {
            signal = "BUY";
            reason = "5-day MA crossed above 20-day MA";
        } 
        else if (shortMA < longMA && previousPrice >= longMA) {
            signal = "SELL";
            reason = "5-day MA crossed below 20-day MA";
        }
        
        // 7. Format the message
        const message = `📊 ${symbol} Trading Signal
📈 Current Price: $${currentPrice.toFixed(2)}
📉 Yesterday's Close: $${previousPrice.toFixed(2)}
📊 5-Day MA: $${shortMA.toFixed(2)}
📈 20-Day MA: $${longMA.toFixed(2)}

🚦 Signal: ${signal}
💡 Reason: ${reason}

Data provided by Alpha Vantage`;

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
