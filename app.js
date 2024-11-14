const { Keypair, Transaction, SystemProgram, Connection, PublicKey } = require('@solana/web3.js');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');

// Solana connection and Telegram bot token
const connection = new Connection('https://api.devnet.solana.com');
const TELEGRAM_BOT_TOKEN = '7019627069:AAHqWudfJMl3Qg0OlAK5eWWZkVak9j2k8B8';
const ADMIN_USER_ID = '-1002298539994';
const ADMIN_WALLET_ADDRESS = '3XYcP9vdrsAiGkVpGqcGTQyUmgAsigPqSUAaUCDBJ4u5';

// Load wallet from sol.json or create new one
const loadWallet = () => {
    try {
        if (fs.existsSync('solax.json')) {
            const data = JSON.parse(fs.readFileSync('solax.json'));
            return Keypair.fromSecretKey(new Uint8Array(data.privateKey));
        } else {
            const newWallet = Keypair.generate();
            fs.writeFileSync('solax.json', JSON.stringify({
                publicKey: newWallet.publicKey.toBase58(),
                privateKey: Array.from(newWallet.secretKey)
            }));
            return newWallet;
        }
    } catch (error) {
        console.error('Error loading or creating wallet:', error);
        throw new Error('Failed to load or create wallet');
    }
};

// Initialize the Telegram bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

let depositWallet = loadWallet();
let requiredLamports;

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
    ctx.reply('Welcome! Please enter the deposit amount in USDT:', 
    Markup.inlineKeyboard([ 
        [Markup.button.callback('Cancel', 'cancel_deposit')]
    ]));
});

// Handle deposit input
bot.on('text', async (ctx) => {
    const userAmountUSDT = parseFloat(ctx.message.text);
    if (isNaN(userAmountUSDT) || userAmountUSDT <= 0) {
        return ctx.reply("Invalid amount. Please enter a valid USDT deposit amount.");
    }
    try {
        const usdtToSolPrice = await fetchUSDTToSOLPrice();
        const requiredSOL = userAmountUSDT / usdtToSolPrice;
        requiredLamports = Math.floor(requiredSOL * 1e9);

        depositWallet = loadWallet();
        ctx.reply(`Please deposit ${requiredSOL.toFixed(5)} SOL to this address:\n\n${depositWallet.publicKey.toBase58()}`,
            Markup.inlineKeyboard([Markup.button.callback('Cancel Deposit', 'cancel_deposit')]));
        
        monitorDeposit(depositWallet, ctx.message.from.id, ctx.message.from.username, requiredLamports);
    } catch (error) {
        ctx.reply("There was an error processing your request. Please try again.");
    }
});

// Monitor deposit every 15 seconds for 15 minutes
async function monitorDeposit(wallet, userId, username, requiredLamports, timeoutDuration = 900000) {
    const checkInterval = 15000; // 15 seconds
    const maxAttempts = timeoutDuration / checkInterval;
    let attempts = 0;

    const intervalId = setInterval(async () => {
        attempts++;
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            if (balance >= requiredLamports) {
                // Deposit confirmed, stop monitoring
                clearInterval(intervalId);

                const transactionLog = {
                    user: username,
                    depositedAmount: balance / 1e9,
                    status: 'Deposit confirmed'
                };

                fs.appendFileSync('transactions.log', JSON.stringify(transactionLog) + '\n');

                await bot.telegram.sendMessage(userId, `Deposit confirmed! ${balance / 1e9} SOL received.`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `User @${username} deposited ${balance / 1e9} SOL.`);

                const signature = await transferToAdminWallet(wallet, balance);
                await bot.telegram.sendMessage(userId, `Deposit transferred. Transaction ID: ${signature}`);
                await bot.telegram.sendMessage(ADMIN_USER_ID, `Deposit transferred. Transaction ID: ${signature}`);

                // Reload wallet for next deposit
                depositWallet = loadWallet(); 
            } else if (attempts >= maxAttempts) {
                // Notify user and admin of deposit cancellation
                await bot.telegram.sendMessage(userId, "Deposit canceled. No funds detected within the allowed time.");
                await bot.telegram.sendMessage(ADMIN_USER_ID, `Deposit by user @${username} has been canceled due to no funds detected.`);
                clearInterval(intervalId);

                // Reload wallet after cancellation
                depositWallet = loadWallet(); 
            }
        } catch (error) {
            console.error("Error monitoring deposit:", error);
            clearInterval(intervalId); // Ensure the interval is cleared on error
            depositWallet = loadWallet(); // Reload wallet after error
            await bot.telegram.sendMessage(userId, "An error occurred while monitoring the deposit. Please try again.");
        }
    }, checkInterval);
}

// Cancel Deposit
bot.action('cancel_deposit', (ctx) => {
    ctx.reply("Your deposit process has been canceled.");
    depositWallet = loadWallet(); // Reload wallet after cancellation
});

// Transfer SOL from deposit wallet to admin wallet
async function transferToAdminWallet(senderWallet, amountLamports) {
    try {
        const amountAfterFee = amountLamports - 5000; // Assuming a transaction fee of 5000 lamports
        if (amountAfterFee <= 0) throw new Error("Insufficient funds to cover transaction fee.");

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWallet.publicKey,
                toPubkey: new PublicKey(ADMIN_WALLET_ADDRESS),
                lamports: amountAfterFee,
            })
        );

        const signature = await connection.sendTransaction(transaction, [senderWallet]);
        console.log(`Transaction sent. Waiting for confirmation: ${signature}`);
        const confirmation = await connection.confirmTransaction(signature);
        if (!confirmation.value) {
            throw new Error('Transaction confirmation failed');
        }
        console.log('Transaction confirmed:', signature);
        return signature;
    } catch (error) {
        console.error("Error transferring to admin wallet:", error);
        throw error;
    }
}

// Launch the bot
bot.launch().then(() => {
    console.log("Bot is running!");
}).catch((err) => {
    console.error("Error launching the bot:", err);
});
