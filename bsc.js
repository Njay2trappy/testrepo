require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const Web3 = require('web3');
const fs = require('fs');

// Environment Variables
const BOT_TOKEN = '7346932226:AAG4IvXxJ2oXAb6Wi3yQAMU260u1hwnBIhQ';
const ADMIN_CHAT_ID = '-1002298539994';
const ADMIN_WALLET_ADDRESS = '0xa5F4d7C5c1A6C0892684B0fcba6579B17B86a471';
const PAYER_PRIVATE_KEY = 'bb4e6c9a7b4cc11f7c234f4bc0716f8617bf6ca2866ef048011c325155b6e53a';
const PAYER_ADDRESS = '0x15Dc6AB3B9b45821d6c918Ec1b256F6f7470E4DC'; // Replace with the payer's wallet address

// Initialize Web3 and Telegraf bot
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());  // Enable session for each user to track deposit flow

const web3 = new Web3('https://bsc-dataseed.binance.org/');

// USDT BEP-20 contract address and ABI
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const USDT_ABI = [
    {
        "constant": true,
        "inputs": [{ "name": "_owner", "type": "address" }],
        "name": "balanceOf",
        "outputs": [{ "name": "balance", "type": "uint256" }],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            { "name": "to", "type": "address" },
            { "name": "value", "type": "uint256" }
        ],
        "name": "transfer",
        "outputs": [
            { "name": "", "type": "bool" }
        ],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

// Function to generate a new wallet
const generateWallet = () => {
    const account = web3.eth.accounts.create();
    return {
        address: account.address,
        privateKey: account.privateKey
    };
};

// Monitor for the deposit amount
const monitorWallet = async (wallet, amount, chatId) => {
    const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_ADDRESS);
    const checkInterval = 15000; // 15 seconds
    const maxDuration = 15 * 60 * 1000; // 15 minutes in milliseconds
    let elapsedTime = 0;

    const interval = setInterval(async () => {
        try {
            elapsedTime += checkInterval;
            const balance = await usdtContract.methods.balanceOf(wallet.address).call();
            const balanceInUSDT = web3.utils.fromWei(balance, 'ether');

            if (parseFloat(balanceInUSDT) >= amount) {
                clearInterval(interval);
                await notifyUser(chatId, "Deposit received!");
                const amountInWei = web3.utils.toWei(amount.toString(), 'ether');
                await transferToAdmin(wallet, amountInWei);
            } else if (elapsedTime >= maxDuration) {
                clearInterval(interval);
                await notifyUser(chatId, "Transaction failed: Deposit not received within 15 minutes.");
            }
        } catch (error) {
            console.error("Error checking balance:", error);
            clearInterval(interval);
            bot.telegram.sendMessage(chatId, "An error occurred while monitoring the deposit. Please try again.");
        }
    }, checkInterval);
};

// Notify user of deposit status
const notifyUser = async (chatId, message) => {
    try {
        await bot.telegram.sendMessage(chatId, message);
    } catch (error) {
        console.error("Error notifying user:", error);
    }
};

// Send gas required for transfer to the generated wallet
const sendGasToWallet = async (wallet, gasEstimate) => {
    try {
        const gasAmount = web3.utils.toWei(gasEstimate.toString(), 'gwei');

        const payerBalance = await web3.eth.getBalance(PAYER_ADDRESS);
        if (BigInt(payerBalance) < BigInt(gasAmount)) {
            throw new Error("Payer wallet has insufficient funds for gas transfer.");
        }

        const signedTx = await web3.eth.accounts.signTransaction(
            {
                to: wallet.address,
                from: PAYER_ADDRESS,
                value: gasAmount,
                gas: 21000,
            },
            PAYER_PRIVATE_KEY
        );

        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`Gas sent to generated wallet: ${receipt.transactionHash}`);
        return receipt.transactionHash;
    } catch (error) {
        console.error("Error sending gas to wallet:", error);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error sending gas to generated wallet: ${error.message}`);
    }
};

// Transfer USDT to admin wallet
const transferToAdmin = async (wallet, amountInWei) => {
    try {
        const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_ADDRESS);
        const tx = usdtContract.methods.transfer(ADMIN_WALLET_ADDRESS, amountInWei);
        const gasEstimate = await tx.estimateGas({ from: wallet.address });

        await sendGasToWallet(wallet, gasEstimate);
        const txData = tx.encodeABI();

        const signedTx = await web3.eth.accounts.signTransaction({
            to: USDT_ADDRESS,
            data: txData,
            from: wallet.address,
            gas: gasEstimate,
        }, wallet.privateKey);

        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`USDT transferred to Admin wallet: ${receipt.transactionHash}`);
        await logTransaction(wallet, receipt);
        return receipt.transactionHash;
    } catch (error) {
        console.error("Error transferring funds to admin wallet:", error);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error transferring funds to admin: ${error.message}`);
    }
};

// Log transaction to JSON file
const logTransaction = (wallet, receipt) => {
    const log = {
        walletAddress: wallet.address,
        privateKey: wallet.privateKey,
        txHash: receipt.transactionHash,
        timestamp: new Date().toISOString()
    };

    try {
        fs.appendFileSync('documents.json', JSON.stringify(log, null, 2) + ',\n', 'utf8');
    } catch (error) {
        console.error("Error logging transaction:", error);
    }
};

// Start command
bot.start((ctx) => {
    ctx.session = {}; // Initialize session if undefined
    ctx.reply("Welcome! Please select an action:", Markup.inlineKeyboard([
        [Markup.button.callback('Deposit', 'deposit')]
    ]));
});

// Handle deposit
bot.action('deposit', (ctx) => {
    ctx.session.depositFlow = true;
    ctx.reply("Enter the amount in USDT you'd like to deposit:");
});

// Handle amount input
bot.on('text', async (ctx) => {
    if (!ctx.session.depositFlow) {
        return ctx.reply("Please press 'Deposit' to start a deposit.");
    }

    const amount = parseFloat(ctx.message.text);

    if (isNaN(amount) || amount <= 0) {
        ctx.reply("Please enter a valid amount in USDT.");
        return;
    }

    const wallet = generateWallet();
    logWalletCreation(wallet);

    ctx.reply(`Please deposit USDT to the following address: ${wallet.address}`);
    
    monitorWallet(wallet, amount, ctx.chat.id);
    ctx.session.depositFlow = false;
});

// Log wallet creation
const logWalletCreation = (wallet) => {
    const log = {
        walletAddress: wallet.address,
        privateKey: wallet.privateKey,
        timestamp: new Date().toISOString()
    };

    try {
        fs.appendFileSync('documents.json', JSON.stringify(log, null, 2) + ',\n', 'utf8');
    } catch (error) {
        console.error("Error logging wallet creation:", error);
    }
};

// Error handling
bot.catch((error) => {
    console.error("Bot error:", error);
    bot.telegram.sendMessage(ADMIN_CHAT_ID, `Bot error: ${error.message}`);
});

// Start bot
bot.launch()
    .then(() => console.log("Bot is running"))
    .catch((error) => console.error("Bot launch error:", error));
