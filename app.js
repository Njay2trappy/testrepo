require('dotenv').config();  // Load environment variables
const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_WALLET_ADDRESS, ADMIN_USER_ID } = process.env;
const { Telegraf } = require('telegraf');
const axios = require('axios');

// Initialize the Telegram bot using Telegraf
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Initialize Solana connection (mainnet-beta)
const connection = new Connection('https://api.devnet.solana.com');

// Function to generate a random Solana wallet (Keypair)
function generateWallet() {
    return Keypair.generate();
}

// Define the transaction fee (in lamports)
const TRANSACTION_FEE_LAMPORTS = 5000; // 0.000005 SOL in lamports

// Fetch the current USDT to SOL price from CoinGecko
async function fetchUSDTToSOLPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=solana');
        const usdtToSolPrice = response.data['usd-coin']?.solana;
        
        if (!usdtToSolPrice) {
            throw new Error('Unable to fetch the USDT to SOL price');
        }
        
        return usdtToSolPrice;
    } catch (error) {
        console.error("Error fetching USDT to SOL price:", error);
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Error fetching USDT to SOL price: ${error.message}`);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Function to monitor the wallet for deposit
async function monitorDeposit(wallet, userId, username, requiredLamports) {
    const checkInterval = 15000; // 15 seconds
    const maxAttempts = 60; // 15 minutes (60 * 15 sec = 900 sec = 15 min)
    let attempts = 0;

    const intervalId = setInterval(async () => {
        attempts++;
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            if (balance >= requiredLamports) {
                await bot.telegram.sendMessage(userId, `Deposit confirmed! ${balance} lamports have been received.`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `User @${username} successfully deposited ${balance} lamports.`);
                clearInterval(intervalId);
            } else if (attempts >= maxAttempts) {
                await bot.telegram.sendMessage(userId, "Deposit timed out. No funds were detected within the allowed time.");
                await bot.telegram.sendMessage(ADMIN_USER_ID, `Deposit attempt by @${username} has timed out. No funds detected.`);
                clearInterval(intervalId);
            }
        } catch (error) {
            console.error("Error monitoring deposit:", error);
        }
    }, checkInterval);
}

// Handle the /start command
bot.command('start', (ctx) => {
    ctx.reply('Welcome! I am your Solana payment bot. You can deposit USDT and I will convert it to SOL. Use the /deposit command to start the deposit process.');
});

// Handle the /deposit command
bot.command('deposit', async (ctx) => {
    try {
        ctx.reply("Please enter the amount you wish to deposit in USDT:");
        
        bot.on('text', async (messageCtx) => {
            const usdtAmount = parseFloat(messageCtx.message.text);
            
            if (isNaN(usdtAmount) || usdtAmount <= 0) {
                messageCtx.reply("Invalid amount. Please enter a valid number greater than zero.");
                return;
            }

            const usdtToSolRate = await fetchUSDTToSOLPrice();
            const requiredSol = usdtAmount * usdtToSolRate;
            const requiredLamports = Math.ceil(requiredSol * 1e9); // Convert SOL to lamports
            
            const depositWallet = generateWallet();
            const depositAddress = depositWallet.publicKey.toString();
            
            messageCtx.reply(`Your unique deposit address is:\n\n${depositAddress}\n\nPlease send approximately ${requiredSol.toFixed(6)} SOL to this address (equivalent to ${usdtAmount} USDT).\n\nNote: Only send SOL to this address; other tokens will be lost.`);
            
            await bot.telegram.sendMessage(
                ADMIN_USER_ID, 
                `New deposit request by @${ctx.message.from.username} for ${usdtAmount} USDT (${requiredSol.toFixed(6)} SOL) to wallet ${depositAddress}`
            );

            monitorDeposit(depositWallet, ctx.message.from.id, ctx.message.from.username, requiredLamports);
        });
        
    } catch (error) {
        console.error("Error in /deposit command:", error);
        ctx.reply("There was an error starting the deposit process. Please try again later.");
    }
});

// Launch the bot
bot.launch().then(() => {
    console.log("Bot is up and running!");
}).catch((err) => {
    console.error("Error launching the bot:", err.message);
    bot.telegram.sendMessage(ADMIN_USER_ID, `Error launching the bot: ${err.message}`).catch(console.error);
});
