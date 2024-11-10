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
    const wallet = Keypair.generate();
    return wallet;
}

// Define the transaction fee (in lamports)
const TRANSACTION_FEE_LAMPORTS = 5000; // 0.000005 SOL in lamports

// Fetch the current USDT to SOL price from CoinGecko or any other API
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
        // Send error message to the admin
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Error fetching USDT to SOL price: ${error.message}`);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Function to create and send a transaction
async function sendTransaction(senderWallet, depositAmount, adminWalletAddress) {
    try {
        const adminWalletPublicKey = new PublicKey(adminWalletAddress); // Convert to PublicKey
        const senderWalletPublicKey = senderWallet.publicKey;

        // Create a transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWalletPublicKey,
                toPubkey: adminWalletPublicKey,
                lamports: BigInt(depositAmount - TRANSACTION_FEE_LAMPORTS), // Use BigInt
            })
        );

        // Sign the transaction using the sender's wallet
        const signature = await connection.sendTransaction(transaction, [senderWallet]);

        // Wait for transaction confirmation
        await connection.confirmTransaction(signature);

        return signature; // Return the signature for tracking
    } catch (error) {
        console.error("Transaction error:", error);
        // Send error message to the admin
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Transaction error: ${error.message}`);
        throw new Error('Failed to send transaction');
    }
}

// Handle the /start command to launch the bot
bot.command('start', (ctx) => {
    ctx.reply('Welcome! I am your Solana payment bot. You can deposit USDT and I will convert it to SOL. Use the /deposit command to start the deposit process.');
});

// Launch the bot to listen for incoming commands
bot.launch().then(() => {
    console.log("Bot is up and running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
    bot.telegram.sendMessage(ADMIN_USER_ID, `Error launching the bot: ${err.message}`);
});
