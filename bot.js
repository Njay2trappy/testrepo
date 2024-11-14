import { Telegraf, Markup } from 'telegraf';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import fs from 'fs';
import axios from 'axios';
import bs58 from 'bs58';

const TELEGRAM_TOKEN = '7528484784:AAGn1PtbKA2D4FdpI605g3Iyqgli2mM0-kc';
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

const bot = new Telegraf(TELEGRAM_TOKEN);
const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');

async function loadWallets() {
    if (fs.existsSync('wallets.json')) {
        const data = await fs.promises.readFile('wallets.json');
        return JSON.parse(data);
    }å
    return {};
}

async function saveWallets(wallets) {
    await fs.promises.writeFile('wallets.json', JSON.stringify(wallets, null, 2));
}

function generateWallet() {
    const keypair = Keypair.generate();
    const privateKeyBase58 = bs58.encode(keypair.secretKey);

    return {
        publicKey: keypair.publicKey.toString(),
        privateKey: privateKeyBase58,
        balance: 0,
        mintAddress: null,
        coinData: null,
        bumpPrice: null,
        premium: false,
    };
}

async function getWalletBalance(walletAddress) {
    const publicKey = new PublicKey(walletAddress);
    try {
        const balance = await connection.getBalance(publicKey);
        return balance / 1e9;
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return 0;
    }
}

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    let wallets = await loadWallets();

    let wallet = wallets[userId];
    if (!wallet) {
        wallet = generateWallet();
        wallets[userId] = wallet;
        await saveWallets(wallets);
    }

    if (wallet.balance === 0) {
        wallet.balance = await getWalletBalance(wallet.publicKey);
        wallets[userId] = wallet;
        await saveWallets(wallets);
    }

    const welcomeMessage = `
Welcome to Argon Bump

Deposit SOL to your personalized wallet address and Boost your Tokens!

${wallet.publicKey}

🔄 Click /update to update your balance.
💰 Balance: ${wallet.balance} SOL

Works best on Pump.fun

@Unixmachine
    `;

    ctx.reply(welcomeMessage, Markup.inlineKeyboard([
        [
            Markup.button.url('🔰Support', 'https://t.me/Unixmachine'),
            Markup.button.url('🌐Website', 'https://x.com/LastLuftwaffe'),
            Markup.button.url('🔗Channel', 'https://t.me/Argontxtlog')
        ],
        [
            Markup.button.callback('🔁Update', 'update_balance'),
            Markup.button.callback('🔐Show Private Key', 'show_private_key'),
            Markup.button.callback('↘️Withdraw', 'withdraw')
        ],
        [
            Markup.button.callback('🚀Bump Now', 'bump_now')
        ]
    ], { columns: 3 }));
});


bot.action('update_balance', async (ctx) => {
    const userId = ctx.from.id.toString();
    const wallets = await loadWallets();
    const wallet = wallets[userId];

    if (!wallet) {
        return ctx.reply("No wallet found. Please start with /start.");
    }

    const newBalance = await getWalletBalance(wallet.publicKey);
    wallet.balance = newBalance;
    await saveWallets(wallets);

    ctx.answerCbQuery();
    ctx.reply(`Your updated balance is: ${wallet.balance} SOL`)
});

bot.action('show_private_key', async (ctx) => {
    const userId = ctx.from.id.toString();
    const wallets = await loadWallets();
    const wallet = wallets[userId];

    if (!wallet) {
        return ctx.reply("No wallet found. Please start with /start.");
    }

    ctx.answerCbQuery();
    ctx.reply(`Your private key (keep it safe!):\n${wallet.privateKey}`);
    
});

bot.action('withdraw', async (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("To withdraw, copy your private key and use it to sign in to a DEX like Phantom or Solflare.");
});

async function sendPortalTransaction(publicKey, privateKey, mintAddress, action = "buy") {
    try {
        // Send API request to initiate the transaction
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                publicKey,
                action,
                mint: mintAddress,
                denominatedInSol: "false",    // Change this as needed
                amount: 2000000,                 // Adjust amount accordingly
                slippage: 10,
                priorityFee: 0.001,
                pool: "pump"                  // Use "raydium" if needed
            })
        });

        // Check if the transaction generation was successful
        if (response.status === 200) {
            const data = await response.arrayBuffer();
            const tx = VersionedTransaction.deserialize(new Uint8Array(data));

            // Decode private key and sign the transaction
            const signerKeyPair = Keypair.fromSecretKey(bs58.decode(privateKey));
            tx.sign([signerKeyPair]);

            // Send the transaction to the Solana network
            const signature = await connection.sendTransaction(tx);
            console.log("Transaction successful: https://solscan.io/tx/" + signature);
            return `Transaction successful: https://solscan.io/tx/${signature}`;
        } else {
            console.error("Transaction failed:", response.statusText);
            return `Transaction failed: ${response.statusText}`;
        }
    } catch (error) {
        console.error("Error in sendPortalTransaction:", error);
        return `Transaction failed: ${error.message}`;
    }
}


async function performTrade(ctx, action) {
    const userId = ctx.from.id.toString();
    const wallets = await loadWallets();
    const wallet = wallets[userId];

    try {
        const transactionResult = await sendPortalTransaction(wallet.publicKey, wallet.privateKey, wallet.mintAddress, action);
        ctx.reply(transactionResult);

        if (action === "buy" && transactionResult.includes("Transaction successful")) {
            ctx.reply("Buy trade completed. Initiating sell trade...");
            const sellTransactionResult = await sendPortalTransaction(wallet.publicKey, wallet.privateKey, wallet.mintAddress, "sell");
            ctx.reply(sellTransactionResult);
        }
    } catch (error) {
        console.error("Error in trade transaction:", error);
        ctx.reply("An error occurred during the transaction. Please try again later.");
    }
}

bot.action('bump_now', async (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id.toString();
    const wallets = await loadWallets();

    if (!wallets[userId]) {
        return ctx.reply("Please start the bot with /start to generate a wallet.");
    }

    ctx.reply('Please enter the mint address for the token you want to bump:');

    bot.on('text', async (ctx) => {
        if (ctx.from.id.toString() === userId) {
            const mintAddress = ctx.message.text;
            wallets[userId].mintAddress = mintAddress;
            await saveWallets(wallets);

            const url = `https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false&searchTerm=${mintAddress}`;
            const response = await axios.get(url);

            if (response.status === 200 && response.data.length > 0) {
                const coinData = {
                    mint: response.data[0].mint || 'Not Available',
                    name: response.data[0].name || 'Not Available',
                    symbol: response.data[0].symbol || 'Not Available',
                    total_supply: response.data[0].total_supply || 'Not Available',
                    usd_market_cap: response.data[0].market_cap || 'Not Available'
                };

                wallets[userId].coinData = coinData;
                await saveWallets(wallets);

                const bumpMessage = `
Name: ${coinData.name}
Symbol: ${coinData.symbol}
Total Supply: ${coinData.total_supply}
USD Market Cap: ${coinData.usd_market_cap}

💰 Your Wallet Balance: ${wallets[userId].balance} SOL
                `;

                ctx.reply(bumpMessage, Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Buy', 'buy_action'),
                        Markup.button.callback('Sell', 'sell_action')
                    ]
                ], { columns: 2 }));
            } else {
                ctx.reply('No data found for this mint address. Please check the address and try again.');
            }
        }
    });
});

bot.action('buy_action', async (ctx) => {
    await performTrade(ctx, "buy");
});

bot.action('sell_action', async (ctx) => {
    await performTrade(ctx, "sell");
});

bot.launch();
console.log('Bot is running...');
