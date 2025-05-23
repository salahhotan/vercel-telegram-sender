// api/send-price.js

export default async function handler(req, res) {
    // 1. Check if it's a POST request
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get API keys from Environment Variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
    const ALPHA_VANTAGE_KEY = 'MTQ00L6WCER4WWBX'; // Ideally move this to env var too

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

        // 4. Fetch stock data from Alpha Vantage
        const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
        
        const alphaResponse = await fetch(alphaUrl);
        const alphaData = await alphaResponse.json();

        if (!alphaData['Global Quote'] || !alphaData['Global Quote']['05. price']) {
            console.error('Alpha Vantage Error:', alphaData);
            return res.status(500).json({ 
                error: 'Failed to fetch stock data',
                alpha_error: alphaData.Note || alphaData.Information || 'Invalid response'
            });
        }

        const price = alphaData['Global Quote']['05. price'];
        const changePercent = alphaData['Global Quote']['10. change percent'];
        
        // 5. Format the message as plain text (no Markdown)
        const message = `${symbol} Stock Update:
Price: $${price}
Change: ${changePercent}

Data provided by Alpha Vantage`;

        // 6. Send to Telegram without parse_mode
        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const payload = {
            chat_id: CHANNEL_ID,
            text: message
            // No parse_mode specified
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

        // 7. Send success response
        return res.status(200).json({ 
            success: true, 
            message: 'Stock price sent to Telegram successfully!',
            symbol,
            price,
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
