require('dotenv').config();
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } = require('@solana/web3.js');
const { Telegraf } = require('telegraf');

// Initialize the bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Connect to the Solana blockchain
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Fee wallet (this is the wallet from which the transaction fee will be paid)
const feeWallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.FEE_WALLET_SECRET)));

// Command when user starts the bot
bot.start((ctx) => ctx.reply('Welcome! Type /generate_wallet to create a wallet for payment.'));

// Generate wallet command
bot.command('generate_wallet', async (ctx) => {
    const payer = Keypair.generate();
    const publicKey = payer.publicKey.toString();

    // Send generated wallet address to the user
    ctx.reply(`New wallet created! Send your payment to this address: ${publicKey}`);
    ctx.reply('Please reply with the amount you intend to send (in SOL) for confirmation.');

    // Wait for user to send the payment amount
    bot.on('text', async (msgCtx) => {
        const amount = parseFloat(msgCtx.message.text);
        if (isNaN(amount) || amount <= 0) {
            return msgCtx.reply("Please enter a valid amount in SOL.");
        }

        msgCtx.reply(`Tracking payment of ${amount} SOL to ${publicKey}. Monitoring for confirmation...`);

        // Check for payment every 15 seconds
        const checkBalance = setInterval(async () => {
            const balance = await connection.getBalance(payer.publicKey) / LAMPORTS_PER_SOL;
            if (balance >= amount) {
                clearInterval(checkBalance);
                msgCtx.reply(`Payment of ${amount} SOL confirmed. Transferring funds to admin wallet...`);

                // Calculate transaction fee (use the minimum fee here for simplicity)
                const fee = 0.000015 // You can adjust this as needed

                // Total transaction cost: deposit amount + fee
                const totalAmount = amount + fee;

                // Transfer the deposit amount to the admin wallet
                const transaction = new Transaction().add(
                    // Transfer the full deposit to admin wallet
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: new PublicKey(process.env.ADMIN_WALLET_ADDRESS),
                        lamports: (amount - fee) * LAMPORTS_PER_SOL, // Deposit amount minus fee
                    }),

                    // Pay transaction fee from the fee wallet
                    SystemProgram.transfer({
                        fromPubkey: feeWallet.publicKey,
                        toPubkey: payer.publicKey, // The fee is sent to the payer's wallet
                        lamports: fee * LAMPORTS_PER_SOL, // The transaction fee
                    })
                );

                try {
                    // Send the transaction
                    const signature = await connection.sendTransaction(transaction, [payer, feeWallet]);
                    await connection.confirmTransaction(signature);
                    msgCtx.reply(`Funds successfully transferred to admin wallet. Transaction signature: ${signature}`);
                } catch (error) {
                    msgCtx.reply("Error transferring funds: " + error.message);
                }
            }
        }, 15000); // Check every 15 seconds
    });
});

// Launch the bot
bot.launch();
