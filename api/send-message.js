// api/send-market-data.js

export default async function handler(req, res) {
    // 1. Check if it's a POST request (optional - could be GET if you want to trigger via URL)
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get all required environment variables
    const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!ALPHA_VANTAGE_API_KEY || !BOT_TOKEN || !CHANNEL_ID) {
        console.error("Missing required environment variables.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Fetch market data from Alpha Vantage
        const symbol = req.body.symbol || 'IBM'; // Default to IBM if no symbol provided
        const functionType = req.body.function || 'TIME_SERIES_DAILY'; // Could be TIME_SERIES_INTRADAY, etc.
        
        const alphaVantageUrl = `https://www.alphavantage.co/query?function=${functionType}&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;

        const alphaResponse = await fetch(alphaVantageUrl);
        const marketData = await alphaResponse.json();

        if (!alphaResponse.ok || marketData['Error Message']) {
            console.error('Alpha Vantage API Error:', marketData);
            return res.status(500).json({
                error: 'Failed to fetch market data',
                alpha_error: marketData['Error Message'] || 'Unknown error',
            });
        }

        // 4. Process the market data into a readable message
        let message = `📈 *Market Data for ${symbol}* 📉\n\n`;
        
        // Handle different response formats from Alpha Vantage
        if (functionType.includes('TIME_SERIES')) {
            const timeSeries = marketData[Object.keys(marketData).find(key => key.includes('Time Series'))];
            const latestDate = Object.keys(timeSeries)[0];
            const latestData = timeSeries[latestDate];
            
            message += `*Latest Update (${latestDate})*:\n`;
            message += `Open: $${latestData['1. open']}\n`;
            message += `High: $${latestData['2. high']}\n`;
            message += `Low: $${latestData['3. low']}\n`;
            message += `Close: $${latestData['4. close']}\n`;
            if (latestData['5. volume']) {
                message += `Volume: ${latestData['5. volume']}\n`;
            }
        } else if (functionType === 'GLOBAL_QUOTE') {
            const quote = marketData['Global Quote'];
            message += `*Current Quote*:\n`;
            message += `Price: $${quote['05. price']}\n`;
            message += `Change: $${quote['09. change']}\n`;
            message += `Change %: ${quote['10. change percent']}\n`;
        } else {
            // Fallback for other function types
            message += `Data format not specifically handled. Showing raw data:\n`;
            message += '```\n' + JSON.stringify(marketData, null, 2) + '\n```';
        }

        // 5. Send the message to Telegram
        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const payload = {
            chat_id: CHANNEL_ID,
            text: message,
            parse_mode: 'MarkdownV2',
        };

        const telegramResponse = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

        // 6. Send success response
        return res.status(200).json({ 
            success: true, 
            message: 'Market data sent to Telegram successfully!', 
            telegram_response: telegramResult,
            market_data: marketData 
        });

    } catch (error) {
        console.error('Error in send-market-data handler:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
