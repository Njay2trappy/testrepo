require('dotenv').config();
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const connection = new Connection('https://api.devnet.solana.com');

// Welcome message
bot.start((ctx) => ctx.reply('Welcome! Type /generate_wallet to create a wallet for payment.'));

// Generate a new Solana wallet
bot.command('generate_wallet', async (ctx) => {
    const payer = Keypair.generate();
    const publicKey = payer.publicKey.toString();

    ctx.reply(`New wallet created! Send your payment to this address: ${publicKey}`);
    ctx.reply('Please reply with the amount you intend to send (in SOL) for confirmation.');

    // Listen for the amount input
    bot.on('text', async (msgCtx) => {
        const amount = parseFloat(msgCtx.message.text);
        if (isNaN(amount) || amount <= 0) {
            return msgCtx.reply("Please enter a valid amount in SOL.");
        }

        msgCtx.reply(`Tracking payment of ${amount} SOL to ${publicKey}. Monitoring for confirmation...`);

        // Periodically check balance for confirmation
        const checkBalance = setInterval(async () => {
            const balance = await connection.getBalance(new PublicKey(publicKey)) / LAMPORTS_PER_SOL;
            if (balance >= amount) {
                clearInterval(checkBalance);
                msgCtx.reply(`Payment of ${amount} SOL confirmed. Thank you!`);
            }
        }, 15000); // Check every 15 seconds
    });
});

bot.launch();
