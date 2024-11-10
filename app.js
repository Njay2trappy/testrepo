const { Keypair, Transaction, SystemProgram, Connection } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_WALLET_ADDRESS, ADMIN_USER_ID } = process.env;
const { Telegraf } = require('telegraf');
const axios = require('axios'); // For fetching live USDT/SOL conversion rate

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
        const usdtToSolPrice = response.data['usd-coin'].solana;
        return usdtToSolPrice;
    } catch (error) {
        console.error("Error fetching USDT to SOL price:", error);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Function to create and send a transaction
async function sendTransaction(senderWallet, depositAmount, adminWalletAddress) {
    try {
        // Create a transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWallet.publicKey,
                toPubkey: adminWalletAddress,
                lamports: depositAmount - TRANSACTION_FEE_LAMPORTS, // Deduct fee only here
            })
        );

        // Sign the transaction using the sender's wallet
        const signature = await connection.sendTransaction(transaction, [senderWallet]);

        // Wait for transaction confirmation
        await connection.confirmTransaction(signature);

        return signature; // Return the signature for tracking
    } catch (error) {
        console.error("Transaction error:", error);
        // Notify the admin of the error
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Error processing the deposit: ${error.message}`);
        throw new Error('Failed to send transaction');
    }
}

// Handle the /start command
bot.command('start', (ctx) => {
    ctx.reply('Welcome! I am your Solana payment bot. You can deposit USDT and I will convert it to SOL. Use the /deposit command to start the deposit process.');
});

// Step 1: Handle the /deposit command (Prompt for deposit amount)
bot.command('deposit', (ctx) => {
    ctx.reply('Please enter the deposit amount in USDT. Example: 50');
    // Save the user's ID and mark that they're in the deposit process
    ctx.session = { waitingForDeposit: true };
});

// Step 2: Handle the deposit amount input
bot.on('text', async (ctx) => {
    if (ctx.session && ctx.session.waitingForDeposit) {
        const depositAmountUSDT = parseFloat(ctx.message.text); // Deposit amount in USDT
        
        // Check if the deposit amount is a valid number
        if (isNaN(depositAmountUSDT) || depositAmountUSDT <= 0) {
            return ctx.reply("Please provide a valid deposit amount in USDT. Example: /deposit 50");
        }

        try {
            // Fetch the current USDT to SOL exchange rate
            const usdtToSolRate = await fetchUSDTToSOLPrice();
            
            // Convert the USDT amount to SOL (in lamports)
            const depositAmountSOL = depositAmountUSDT * usdtToSolRate * 1e9; // 1 SOL = 1e9 lamports

            // Generate a new wallet for the deposit
            const senderWallet = generateWallet();

            // Send the funds to the admin wallet
            const signature = await sendTransaction(senderWallet, depositAmountSOL, ADMIN_WALLET_ADDRESS);

            // Notify the user
            ctx.reply(`You are depositing ${depositAmountUSDT} USDT, which is approximately ${depositAmountSOL / 1e9} SOL. Transaction signature: ${signature}`);
            
            // Notify the admin
            await bot.telegram.sendMessage(ADMIN_USER_ID, `New deposit received: ${depositAmountUSDT} USDT (~${depositAmountSOL / 1e9} SOL). Transaction signature: ${signature}`);

            // Clear session after processing the deposit
            delete ctx.session.waitingForDeposit;

        } catch (error) {
            ctx.reply(`Error processing the deposit: ${error.message}`);
        }
    }
});

// Start the bot
bot.launch();
