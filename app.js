require('dotenv').config(); // Load environment variables
const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_USER_ID} = process.env;
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Initialize the Telegram bot using Telegraf
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Initialize Solana connection (mainnet-beta)
const connection = new Connection('https://api.devnet.solana.com');

// Define the transaction fee in lamports (5000 lamports = 0.000005 SOL)
const TRANSACTION_FEE_LAMPORTS = 5000;

// Store active transactions (keyed by user ID)
let activeTransactions = {};

// Function to generate a random Solana wallet (Keypair)
function generateWallet() {
    return Keypair.generate();
}

// Fetch the current USDT to SOL price from CoinGecko
async function fetchUSDTToSOLPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        const usdtToSolPrice = response.data['solana']?.usd;

        if (!usdtToSolPrice) {
            throw new Error('Unable to fetch the USDT to SOL price');
        }

        return usdtToSolPrice;
    } catch (error) {
        console.error("Error fetching USDT to SOL price:", error);
        await bot.telegram.sendMessage(process.env.ADMIN_USER_ID, `Error fetching USDT to SOL price: ${error.message}`);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Transfer SOL from the user's wallet to the admin wallet, deducting the transaction fee
async function transferToAdminWallet(senderWallet, amountLamports, adminWalletPublicKey) {
    try {
        const amountAfterFee = amountLamports - TRANSACTION_FEE_LAMPORTS;

        if (amountAfterFee <= 0) {
            throw new Error("Insufficient funds to cover transaction fee.");
        }

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWallet.publicKey,
                toPubkey: adminWalletPublicKey,
                lamports: amountAfterFee,
            })
        );

        const signature = await connection.sendTransaction(transaction, [senderWallet]);
        await connection.confirmTransaction(signature);

        return signature;
    } catch (error) {
        console.error("Error transferring to admin wallet:", error);
        throw error;
    }
}

// Monitor the deposit and transfer after confirmation
async function monitorDeposit(wallet, userId, username, requiredLamports, adminWalletPublicKey, timeoutDuration = 900000) { // 15 minutes
    const checkInterval = 15000; // 15 seconds
    const maxAttempts = timeoutDuration / checkInterval; // Calculate based on timeoutDuration
    let attempts = 0;

    const intervalId = setInterval(async () => {
        if (activeTransactions[userId]?.cancelled) {
            clearInterval(intervalId); // Stop monitoring if transaction is canceled
            await bot.telegram.sendMessage(userId, "Deposit process has been cancelled.");
            return;
        }

        attempts++;
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            if (balance >= requiredLamports) {
                await bot.telegram.sendMessage(userId, `Deposit confirmed! ${balance / 1e9} SOL received.`);
                await bot.telegram.sendMessage(process.env.ADMIN_USER_ID, `User @${username} deposited ${balance / 1e9} SOL.`);

                const signature = await transferToAdminWallet(wallet, balance, adminWalletPublicKey);
                await bot.telegram.sendMessage(userId, `Your deposit has been transferred. Transaction ID: ${signature}`);
                await bot.telegram.sendMessage(process.env.ADMIN_USER_ID, `Deposit from @${username} transferred to admin wallet. Transaction ID: ${signature}`);

                clearInterval(intervalId); // Stop monitoring after successful deposit
                await generateNewWalletAndNotify(userId); // Generate new wallet after transaction completion
            } else if (attempts >= maxAttempts) {
                await bot.telegram.sendMessage(userId, "Deposit timed out. No funds detected within the allowed time.");
                await bot.telegram.sendMessage(process.env.ADMIN_USER_ID, `Deposit attempt by @${username} has timed out.`);
                clearInterval(intervalId); // Stop monitoring after timeout
                await generateNewWalletAndNotify(userId); // Generate new wallet after transaction timeout
            }
        } catch (error) {
            console.error("Error monitoring deposit:", error);
        }
    }, checkInterval);

    // Store the active transaction with a cancel state
    activeTransactions[userId] = { intervalId, cancelled: false };
}

// Function to generate a new wallet when deposit process is initiated or after cancellation/completion
async function generateNewWalletAndNotify(userId) {
    const wallet = generateWallet(); // New wallet is created here for each deposit attempt
    activeTransactions[userId] = { cancelled: false }; // Reset cancellation flag for new transaction
    // Send the new wallet address to the user with the cancel button
    await bot.telegram.sendMessage(userId, `Your new deposit wallet address is:\n\n${wallet.publicKey.toBase58()}`, 
    Markup.inlineKeyboard([
        [Markup.button.callback('Cancel Deposit', 'cancel_deposit')]
    ]));
    return wallet;
}

// Handle the /start command to launch the bot
bot.command('start', (ctx) => {
    ctx.reply('Welcome! Use the buttons below to begin the deposit process or access commands:',
    Markup.inlineKeyboard([
        [Markup.button.callback('Start Deposit', 'start_deposit')]
    ]));
});

// Handle the /deposit command for user deposit (as an inline button action)
bot.action('start_deposit', async (ctx) => {
    const userId = ctx.message.from.id;
    const wallet = await generateNewWalletAndNotify(userId);
    ctx.reply('Please enter the amount in USDT you would like to deposit.');
    ctx.answerCbQuery(); // Answer callback to prevent "loading" state on button click

    // Listen for deposit amount and then prompt for admin wallet address
    bot.on('text', async (ctx) => {
        const userAmountUSDT = parseFloat(ctx.message.text);
        if (isNaN(userAmountUSDT) || userAmountUSDT <= 0) {
            return ctx.reply("Invalid amount. Please enter a valid number.");
        }

        const username = ctx.message.from.username;
        const userId = ctx.message.from.id;

        // Store amount for later use
        activeTransactions[userId].amountUSDT = userAmountUSDT;
        activeTransactions[userId].wallet = wallet;

        // Prompt the user for the admin wallet address
        ctx.reply(`You have entered ${userAmountUSDT} USDT. Now, please provide the admin wallet address.`);
    });
});

// Handle the input of admin wallet address
bot.on('text', async (ctx) => {
    const userId = ctx.message.from.id;
    if (activeTransactions[userId] && activeTransactions[userId].amountUSDT && !activeTransactions[userId].adminWallet) {
        const adminWalletAddress = ctx.message.text.trim();
        
        try {
            const adminWalletPublicKey = new PublicKey(adminWalletAddress); // Validate if the input is a valid wallet address
            activeTransactions[userId].adminWallet = adminWalletPublicKey;

            const userAmountUSDT = activeTransactions[userId].amountUSDT;
            const wallet = activeTransactions[userId].wallet;
            const usdtToSolPrice = await fetchUSDTToSOLPrice();
            const requiredSOL = userAmountUSDT / usdtToSolPrice;
            const requiredLamports = Math.floor(requiredSOL * 1e9);

            ctx.reply(`To deposit ${userAmountUSDT} USDT, please send ${requiredSOL.toFixed(5)} SOL to the following wallet:\n\n${wallet.publicKey.toBase58()}`);
            monitorDeposit(wallet, userId, ctx.message.from.username, requiredLamports, adminWalletPublicKey);

        } catch (error) {
            ctx.reply("Invalid wallet address. Please provide a valid admin wallet address.");
        }
    }
});

// Add a cancel button to terminate the deposit process
bot.action('cancel_deposit', (ctx) => {
    const userId = ctx.message.from.id;
    if (activeTransactions[userId]) {
        // Mark the transaction as cancelled
        activeTransactions[userId].cancelled = true;
        clearInterval(activeTransactions[userId].intervalId); // Stop monitoring deposit
        ctx.reply("Your deposit process has been successfully cancelled.");
        delete activeTransactions[userId]; // Remove the cancelled transaction from active transactions
        generateNewWalletAndNotify(userId); // Generate new wallet after cancellation
    } else {
        ctx.reply("No active deposit process to cancel.");
    }
});

// Start the bot
bot.launch().then(() => {
    console.log("Bot is running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
});
