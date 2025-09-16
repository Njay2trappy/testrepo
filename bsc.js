const { Telegraf, Markup, session } = require('telegraf');
const Web3 = require('web3');
const fs = require('fs');

// Environment Variables
const BOT_TOKEN = '7346932226:AAG4IvXxJ2oXAb6Wi3yQAMU260u1hwnBIhQ';
const ADMIN_CHAT_ID = '-1002298539994';
const PAYER_PRIVATE_KEY = 'bb4e6cio9a7b4cc11f7c234f4bc0716f8617bf6ca2866ef048011c325155b6e53a';
const PAYER_ADDRESS = '0x15Dc6AB3B9b45821d6c918Ec1b256F6f7470E4DC';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const web3 = new Web3('https://bsc-dataseed.binance.org/');

const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const USDT_ABI = [
    // ABI for balanceOf and transfer
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

// Generate a new wallet
const generateWallet = () => {
    const account = web3.eth.accounts.create();
    return {
        address: account.address,
        privateKey: account.privateKey
    };
};

// Monitor wallet for deposit
const monitorWallet = async (wallet, amount, adminWallet, chatId) => {
    const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_ADDRESS);
    const checkInterval = 15000;
    const maxDuration = 15 * 60 * 1000;
    let elapsedTime = 0;

    const interval = setInterval(async () => {
        try {
            elapsedTime += checkInterval;
            const balance = await usdtContract.methods.balanceOf(wallet.address).call();
            const balanceInUSDT = web3.utils.fromWei(balance, 'ether');

            if (parseFloat(balanceInUSDT) >= amount) {
                clearInterval(interval);
                await notifyUser(chatId, "The Customer has successfully made the Deposit!");
                bot.telegram.sendMessage(ADMIN_CHAT_ID, `Deposit confirmed from ${wallet.address}. Initiating transfer to admin.`);
                const amountInWei = web3.utils.toWei(amount.toString(), 'ether');
                await transferToAdmin(wallet, amountInWei, adminWallet, chatId);
            } else if (elapsedTime >= maxDuration) {
                clearInterval(interval);
                await notifyUser(chatId, "Transaction failed: Deposit not received within 15 minutes.");
                bot.telegram.sendMessage(ADMIN_CHAT_ID, `Transaction failed: Deposit not received for ${wallet.address} within 15 minutes.`);
            }
        } catch (error) {
            console.error("Error checking balance:", error);
            clearInterval(interval);
            bot.telegram.sendMessage(chatId, "An error occurred while monitoring the deposit. Please try again.");
            bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error checking balance for ${wallet.address}: ${error.message}`);
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

// Send gas to the generated wallet
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
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Gas sent to wallet ${wallet.address}. txthash: ${receipt.transactionHash}`);
        return receipt.transactionHash;
    } catch (error) {
        console.error("Error sending gas to wallet:", error);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error sending gas to wallet ${wallet.address}: ${error.message}`);
    }
};

// Transfer USDT to the admin wallet
const transferToAdmin = async (wallet, amountInWei, adminWallet, chatId) => {
    try {
        const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_ADDRESS);
        const tx = usdtContract.methods.transfer(adminWallet, amountInWei);
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
        console.log(`USDT transferred to Admin wallet. Txthash: ${receipt.transactionHash}`);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `USDT transferred to Admin wallet: ${receipt.transactionHash}`);
        await logTransaction(wallet, receipt);
        return receipt.transactionHash;
    } catch (error) {
        console.error("Error transferring funds to admin wallet:", error);
        bot.telegram.sendMessage(chatId, `Error transferring funds to admin: ${error.message}`);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error transferring funds from ${wallet.address} to admin: ${error.message}`);
    }
};

// Log transaction
const logTransaction = (wallet, receipt) => {
    const log = {
        walletAddress: wallet.address,
        privateKey: wallet.privateKey,
        txHash: receipt.transactionHash,
        timestamp: new Date().toISOString()
    };

    try {
        fs.appendFileSync('documents.json', JSON.stringify(log, null, 2) + ',\n', 'utf8');
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Transaction logged for wallet: ${wallet.address}`);
    } catch (error) {
        console.error("Error logging transaction:", error);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error logging transaction for ${wallet.address}: ${error.message}`);
    }
};

// Bot start command
bot.start((ctx) => {
    ctx.session = {};
    ctx.reply("Welcome to Argon USDT BEP20 payment Gateway. Generate a wallet address for payments.", Markup.inlineKeyboard([
        [Markup.button.callback('Deposit', 'deposit')]
    ]));
});

// Handle deposit
bot.action('deposit', (ctx) => {
    ctx.session.depositFlow = true;
    ctx.reply("Enter the amount in USDT:");
    bot.telegram.sendMessage(ADMIN_CHAT_ID, `User ${ctx.chat.id} started a deposit process.`);
});

// Handle amount input and admin wallet address
bot.on('text', async (ctx) => {
    if (!ctx.session.depositFlow) {
        return ctx.reply("Please press 'Deposit' to start a deposit.");
    }

    if (!ctx.session.depositAmount) {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount <= 0) {
            ctx.reply("Please enter a valid amount in USDT.");
            return;
        }
        ctx.session.depositAmount = amount;
        ctx.reply("Please provide your Admin wallet address (BEP20):");
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `User ${ctx.chat.id} set deposit amount: ${amount} USDT.`);
    } else if (!ctx.session.adminWallet) {
        const adminWallet = ctx.message.text;
        if (!web3.utils.isAddress(adminWallet)) {
            ctx.reply("Please enter a valid wallet address.");
            return;
        }
        ctx.session.adminWallet = adminWallet;

        const wallet = generateWallet();
        logWalletCreation(wallet);
        ctx.reply(`Please deposit the USDT to the following address: ${wallet.address}. Transaction expires in 15 mins.`);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Wallet generated for user ${ctx.chat.id}: ${wallet.address}`);

        monitorWallet(wallet, ctx.session.depositAmount, adminWallet, ctx.chat.id);
        ctx.session.depositFlow = false;
        ctx.session.depositAmount = null;
        ctx.session.adminWallet = null;
    }
});

// Log wallet creation
const logWalletCreation = (wallet) => {
    const log = {
        walletAddress: wallet.address,
        privateKey: wallet.privateKey,
        timestamp: new Date().toISOString()
    };

    try {
        fs.appendFileSync('wallets.json', JSON.stringify(log, null, 2) + ',\n', 'utf8');
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `New wallet created: ${wallet.address}`);
    } catch (error) {
        console.error("Error logging wallet creation:", error);
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `Error logging new wallet ${wallet.address}: ${error.message}`);
    }
};

// Error handling for the bot
bot.catch((error, ctx) => {
    console.error("Bot error:", error);
    bot.telegram.sendMessage(ADMIN_CHAT_ID, `Bot error: ${error.message}`);
    ctx.reply("An error occurred. Please try again.");
});

bot.launch();
console.log('Bot is running...');
