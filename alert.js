const { Telegraf } = require('telegraf');
const axios = require('axios');

// Replace with your bot token
const bot = new Telegraf('8128900021:AAGVIczELerO_O3iKCATXwF5MfRzB9xvzu4');

// Admin user ID
const adminId = -1002296368449;

// Function to fetch the SOL price from the API
async function fetchSolPrice() {
    try {
        // Send a GET request to the API
        const response = await axios.get('https://frontend-api.pump.fun/sol-price');
        
        // Check if the response contains the sol_price
        if (response.data && response.data.solPrice) {
            return response.data.solPrice;
        } else {
            return 'No price data available';
        }
    } catch (error) {
        return `Error fetching price: ${error.message}`;
    }
}

// Function to send the price update to the admin
async function sendPriceToAdmin() {
    try {
        // Fetch the SOL price
        const price = await fetchSolPrice();
        
        // Styled message to send to the admin
        const message = `
*SOL Price Update*  
The current price of SOL is:  
💰 *${price}*  
🕒 _Fetched at: ${new Date().toLocaleString()}_

_This is a system generated update._  
        `;
        
        // Send the styled message to the admin
        bot.telegram.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(`Error sending price update: ${error.message}`);
    }
}

// Command handler for /start
bot.command('start', (ctx) => {
    // Send confirmation to the user
    ctx.reply('The bot has started! You will receive regular updates.');

    // Send the first price update to the admin immediately
    sendPriceToAdmin();

    // Set an interval to send the price to the admin every 5 minutes (300,000 ms)
    setInterval(sendPriceToAdmin, 300000); // 300,000 ms = 5 minutes
});

// Start the bot
bot.launch();

// Handle bot shutdown gracefully
process.on('SIGINT', () => {
    console.log('Bot is shutting down...');
    process.exit();
});
