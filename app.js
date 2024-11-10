require('dotenv').config(); // Load environment variables
const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_WALLET_ADDRESS, ADMIN_USER_ID } = process.env;
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Initialize the Telegram bot using Telegraf
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Initialize Solana connection (mainnet-beta)
const connection = new Connection('https://api.devnet.solana.com');

// Define the transaction fee in lamports (5000 lamports = 0.000005 SOL)
const TRANSACTION_FEE_LAMPORTS = 5000;

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
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Error fetching USDT to SOL price: ${error.message}`);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Transfer SOL from the user's wallet to the admin wallet, deducting the transaction fee
async function transferToAdminWallet(senderWallet, amountLamports) {
    try {
        const adminWalletPublicKey = new PublicKey(ADMIN_WALLET_ADDRESS);
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
        await bot.telegram.sendMessage(ADMIN_USER_ID, `Error transferring to admin wallet: ${error.message}`);
        throw error;
    }
}

// Handle deposit monitoring and transfer after confirmation
async function monitorDeposit(wallet, userId, username, requiredLamports, timeoutDuration = 900000) { // 15 minutes
    const checkInterval = 15000; // 15 seconds
    const maxAttempts = timeoutDuration / checkInterval; // Calculate based on timeoutDuration
    let attempts = 0;

    const intervalId = setInterval(async () => {
        attempts++;
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            if (balance >= requiredLamports) {
                await bot.telegram.sendMessage(userId, `Deposit confirmed! ${balance / 1e9} SOL received.`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `User @${username} deposited ${balance / 1e9} SOL.`);

                const signature = await transferToAdminWallet(wallet, balance);
                await bot.telegram.sendMessage(userId, `Your deposit has been transferred. Transaction ID: ${signature}`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `Deposit from @${username} transferred to admin wallet. Transaction ID: ${signature}`);

                clearInterval(intervalId);
                wallet = generateWallet(); // Generate a new wallet after the transaction
                await bot.telegram.sendMessage(userId, `New wallet address for next deposit: ${wallet.publicKey.toBase58()}`);
            } else if (attempts >= maxAttempts) {
                await bot.telegram.sendMessage(userId, "Deposit timed out. No funds detected within the allowed time.");
                await bot.telegram.sendMessage(ADMIN_USER_ID, `Deposit attempt by @${username} has timed out.`);
                clearInterval(intervalId);
                wallet = generateWallet(); // Generate a new wallet after timeout
                await bot.telegram.sendMessage(userId, `New wallet address for next deposit: ${wallet.publicKey.toBase58()}`);
            }
        } catch (error) {
            console.error("Error monitoring deposit:", error);
            await bot.telegram.sendMessage(ADMIN_USER_ID, `Error monitoring deposit: ${error.message}`);
        }
    }, checkInterval);
}

// Handle the /start command to launch the bot
bot.command('start', (ctx) => {
    ctx.reply('Welcome! Use the buttons below to begin the deposit process or access commands:', 
    Markup.inlineKeyboard([
        [Markup.button.callback('Start Deposit', 'start_deposit')]
    ]));
});

// Handle the /deposit command for user deposit (as an inline button action)
bot.action('start_deposit', (ctx) => {
    const wallet = generateWallet();
    ctx.reply('Please enter the amount in USDT you would like to deposit.');
    ctx.answerCbQuery(); // Answer callback to prevent "loading" state on button click

    bot.on('text', async (ctx) => {
        const userAmountUSDT = parseFloat(ctx.message.text);
        const userId = ctx.message.from.id;
        const username = ctx.message.from.username;

        if (isNaN(userAmountUSDT) || userAmountUSDT <= 0) {
            return ctx.reply("Invalid amount. Please enter a valid number.");
        }

        try {
            const usdtToSolPrice = await fetchUSDTToSOLPrice();
            const requiredSOL = userAmountUSDT / usdtToSolPrice;
            const requiredLamports = Math.floor(requiredSOL * 1e9);

            ctx.reply(`To deposit ${userAmountUSDT} USDT, please send ${requiredSOL.toFixed(5)} SOL to the following wallet:\n\n${wallet.publicKey.toBase58()}`);
            monitorDeposit(wallet, userId, username, requiredLamports);
        } catch (error) {
            ctx.reply("There was an error processing your request. Please try again.");
        }
    });
});

// Launch the bot
bot.launch().then(() => {
    console.log("Bot is running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
    bot.telegram.sendMessage(ADMIN_USER_ID, `Error launching the bot: ${err.message}`);
});
