const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_USER_ID } = process.env;
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Initialize the Telegram bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const connection = new Connection('https://api.devnet.solana.com');

const TRANSACTION_FEE_LAMPORTS = 5000;
let adminWalletAddress; 
let depositWallet; 
let requiredLamports;

// Generate a new Solana wallet for deposit
function generateWallet() {
    return Keypair.generate();
}

// Fetch USDT to SOL conversion rate from CoinGecko
async function fetchUSDTToSOLPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        const usdtToSolPrice = response.data['solana']?.usd;
        if (!usdtToSolPrice) throw new Error('Unable to fetch the USDT to SOL price');
        return usdtToSolPrice;
    } catch (error) {
        console.error("Error fetching USDT to SOL price:", error);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Start the bot with /start command
bot.command('start', (ctx) => {
    console.log("User started the bot:", ctx.from.username); // Debug log
    ctx.reply('Welcome! Please set the admin wallet address to proceed.', 
    Markup.inlineKeyboard([ [Markup.button.callback('Set Admin Wallet', 'set_admin_wallet')] ]));
});

// Set Admin Wallet Address with Debugging
bot.action('set_admin_wallet', (ctx) => {
    ctx.reply('Please enter the admin wallet address:');
    bot.on('text', async (ctx) => {
        const inputAddress = ctx.message.text.trim();
        console.log("Received admin wallet address input:", inputAddress); // Debug log
        try {
            adminWalletAddress = new PublicKey(inputAddress);
            console.log("Admin wallet address after conversion:", adminWalletAddress.toBase58()); // Debug log
            ctx.reply(`Admin wallet address set: ${adminWalletAddress.toBase58()}`);
            ctx.reply('Please enter the deposit amount in USDT:');
        } catch (error) {
            console.error("Error in setting admin wallet address:", error); // Debug log
            ctx.reply('Invalid wallet address. Please re-enter a valid Solana address.');
        }
    });
});

// Get deposit amount in USDT, then calculate required SOL with Debugging
bot.on('text', async (ctx) => {
    if (!adminWalletAddress) {
        console.log("Admin wallet address not set yet."); // Debug log
        return ctx.reply("Please set the admin wallet address first.");
    }
    
    const userAmountUSDT = parseFloat(ctx.message.text);
    console.log("User entered amount:", userAmountUSDT); // Debug log
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
    const checkInterval = 15000;
    const maxAttempts = timeoutDuration / checkInterval;
    let attempts = 0;

    const intervalId = setInterval(async () => {
        attempts++;
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            console.log("Current balance for deposit wallet:", balance); // Debug log
            if (balance >= requiredLamports) {
                await bot.telegram.sendMessage(userId, `Deposit confirmed! ${balance / 1e9} SOL received.`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `User @${username} deposited ${balance / 1e9} SOL.`);

                const signature = await transferToAdminWallet(wallet, balance);
                await bot.telegram.sendMessage(userId, `Deposit transferred. Transaction ID: ${signature}`);
                clearInterval(intervalId);
                depositWallet = generateWallet(); // Generate new wallet for next deposit
            } else if (attempts >= maxAttempts) {
                await bot.telegram.sendMessage(userId, "Deposit timed out. No funds detected within the allowed time.");
                clearInterval(intervalId);
                depositWallet = generateWallet(); // Generate new wallet for next deposit
            }
        } catch (error) {
            console.error("Error monitoring deposit:", error); // Debug log
        }
    }, checkInterval);
}

// Handle /cancel_deposit command to cancel deposit
bot.action('cancel_deposit', (ctx) => {
    ctx.reply("Your deposit process has been canceled.");
    depositWallet = generateWallet(); // Generate new wallet after cancellation
});

// Transfer SOL from deposit wallet to admin wallet
async function transferToAdminWallet(senderWallet, amountLamports) {
    try {
        const amountAfterFee = amountLamports - TRANSACTION_FEE_LAMPORTS;
        console.log("Transferring amount after fee:", amountAfterFee); // Debug log
        if (amountAfterFee <= 0) throw new Error("Insufficient funds to cover transaction fee.");

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWallet.publicKey,
                toPubkey: adminWalletAddress,
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

// Launch the bot with added error logging
bot.launch().then(() => {
    console.log("Bot is running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
});
