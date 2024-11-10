const { Keypair, Transaction, SystemProgram, Connection } = require('@solana/web3.js');
const { TELEGRAM_BOT_TOKEN, ADMIN_WALLET_ADDRESS, ADMIN_USER_ID } = process.env;
const TelegramBot = require('node-telegram-bot-api');

// Initialize the Telegram bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Initialize Solana connection (mainnet-beta)
const connection = new Connection('https://api.devnet.solana.com');

// Function to generate a random Solana wallet (Keypair)
function generateWallet() {
    const wallet = Keypair.generate();
    return wallet;
}

// Define the transaction fee (in lamports)
const TRANSACTION_FEE_LAMPORTS = 5000; // 0.000005 SOL in lamports

// Function to create and send a transaction
async function sendTransaction(senderWallet, depositAmount, adminWalletAddress) {
    try {
        // Ensure the wallet has sufficient balance for the transfer and the fee
        const balance = await connection.getBalance(senderWallet.publicKey);
        if (balance < depositAmount + TRANSACTION_FEE_LAMPORTS) {
            throw new Error('Insufficient balance in generated wallet to cover the deposit and fee');
        }

        // Calculate the amount to send to the admin wallet after deducting the transaction fee
        const amountToSend = depositAmount - TRANSACTION_FEE_LAMPORTS;

        // Create a transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderWallet.publicKey,
                toPubkey: adminWalletAddress,
                lamports: amountToSend,
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
        await bot.sendMessage(ADMIN_USER_ID, `Error processing the deposit: ${error.message}`);
        throw new Error('Failed to send transaction');
    }
}

// Function to handle user input for deposits
bot.onText(/\/deposit (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const depositAmount = parseInt(match[1], 10); // Deposit amount in lamports (1 SOL = 1e9 lamports)
    
    // Generate a new wallet for the deposit
    const senderWallet = generateWallet();

    // Send the funds to the admin wallet
    try {
        const signature = await sendTransaction(senderWallet, depositAmount, ADMIN_WALLET_ADDRESS);
        bot.sendMessage(chatId, `Deposit of ${depositAmount / 1e9} SOL has been sent successfully! Transaction signature: ${signature}`);
    } catch (error) {
        bot.sendMessage(chatId, `Error processing the deposit: ${error.message}`);
    }
});

