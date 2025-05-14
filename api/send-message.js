export default async function handler(req, res) {
    // 1. Check if it's a POST request
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Get environment variables
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error("Missing Telegram configuration");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Get command and parameters from request body
        const { command, params = {} } = req.body;

        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        // 4. Process different commands
        let result;
        switch (command.toLowerCase()) {
            case 'ping':
                result = await handlePingCommand();
                break;
            
            case 'notify':
                result = await handleNotifyCommand(params.message, BOT_TOKEN, CHANNEL_ID);
                break;
            
            case 'status':
                result = await handleStatusCommand();
                break;
            
            case 'calculate':
                result = await handleCalculateCommand(params.expression);
                break;
            
            // Add more commands as needed
            
            default:
                return res.status(400).json({ error: 'Unknown command' });
        }

        // 5. Return success response
        return res.status(200).json({
            success: true,
            command,
            result
        });

    } catch (error) {
        console.error('Error in command handler:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
}

// Command Handlers
async function handlePingCommand() {
    return { response: 'pong', timestamp: new Date().toISOString() };
}

async function handleNotifyCommand(message, botToken, chatId) {
    if (!message) {
        throw new Error('Message parameter is required for notify command');
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: `🔔 Notification: ${message}`,
        parse_mode: 'MarkdownV2'
    };

    const response = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const result = await response.json();
    
    if (!response.ok || !result.ok) {
        throw new Error(result.description || 'Failed to send notification');
    }

    return { telegram_response: result };
}

async function handleStatusCommand() {
    // Example: Check system status or external services
    return {
        status: 'operational',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };
}

async function handleCalculateCommand(expression) {
    if (!expression) {
        throw new Error('Expression parameter is required for calculate command');
    }

    // WARNING: In production, you should NEVER evaluate untrusted input like this
    // This is just an example - use a proper math parsing library instead
    try {
        const result = eval(expression); // DANGEROUS - USE A SAFE ALTERNATIVE
        return { expression, result };
    } catch (e) {
        throw new Error('Invalid mathematical expression');
    }
}
