const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_USER_ID } = process.env;
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Initialize the Telegram bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const connection = new Connection('https://api.devnet.solana.com');

const TRANSACTION_FEE_LAMPORTS = 5000;
let adminWalletAddress; // Now will be set dynamically
let depositWallet; // Stores generated deposit wallet
let requiredLamports;

// Generate a new Solana wallet for deposit
function generateWallet() {
    return Keypair.generate();
}

// Fetch USDT to SOL conversion rate from CoinGecko
async function fetchUSDTToSOLPrice() {
    // ... (keep the existing function)
}

// Start the bot with /start command
bot.command('start', (ctx) => {
    ctx.reply('Welcome! Please set the admin wallet address to proceed.', 
    Markup.inlineKeyboard([ [Markup.button.callback('Set Admin Wallet', 'set_admin_wallet')] ]));
});

// Set Admin Wallet Address
bot.action('set_admin_wallet', (ctx) => {
    ctx.reply('Please enter the admin wallet address:');
    bot.on('text', async (ctx) => {
        const inputAddress = ctx.message.text.trim();
        try {
            adminWalletAddress = new PublicKey(inputAddress); // Validate wallet
            ctx.reply(`Admin wallet address set: ${adminWalletAddress.toBase58()}`);
            ctx.reply('Please enter the deposit amount in USDT:');
        } catch (error) {
            ctx.reply('Invalid wallet address. Please re-enter a valid Solana address.');
        }
    });
});

// Get deposit amount in USDT, then calculate required SOL
bot.on('text', async (ctx) => {
    if (!adminWalletAddress) {
        return ctx.reply("Please set the admin wallet address first.");
    }
    
    const userAmountUSDT = parseFloat(ctx.message.text);
    const userId = ctx.message.from.id;
    const username = ctx.message.from.username;

    if (isNaN(userAmountUSDT) || userAmountUSDT <= 0) {
        return ctx.reply("Invalid amount. Please enter a valid USDT deposit amount.");
    }

    try {
        const usdtToSolPrice = await fetchUSDTToSOLPrice();
        const requiredSOL = userAmountUSDT / usdtToSolPrice;
        requiredLamports = Math.floor(requiredSOL * 1e9);

        // Generate deposit wallet
        depositWallet = generateWallet();
        ctx.reply(`Please deposit ${requiredSOL.toFixed(5)} SOL to this address:\n\n${depositWallet.publicKey.toBase58()}`,
            Markup.inlineKeyboard([Markup.button.callback('Cancel Deposit', 'cancel_deposit')]));

        // Start monitoring for deposit
        monitorDeposit(depositWallet, userId, username, requiredLamports);
    } catch (error) {
        ctx.reply("There was an error processing your request. Please try again.");
    }
});

// Monitor deposit and transfer funds to admin wallet after confirmation
async function monitorDeposit(wallet, userId, username, requiredLamports, timeoutDuration = 900000) {
    // ... (keep the existing function but ensure adminWalletAddress is used)
}

// Handle /cancel_deposit command to cancel deposit
bot.action('cancel_deposit', (ctx) => {
    ctx.reply("Your deposit process has been canceled.");
    depositWallet = generateWallet(); // Generate new wallet after cancelation
});

// Transfer SOL from deposit wallet to admin wallet
async function transferToAdminWallet(senderWallet, amountLamports) {
    // ... (use adminWalletAddress here)
}

// Launch the bot
bot.launch().then(() => {
    console.log("Bot is running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
});
