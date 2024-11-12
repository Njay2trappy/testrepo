const { Telegraf } = require('telegraf');
const Web3 = require('web3');
const fetch = require('node-fetch');
const fs = require('fs');

// Set your Telegram Bot API Token
const TELEGRAM_API_TOKEN = '7346932226:AAGDE3cVOw7ZXJQjHhjmy4p0z5TE7HisITs';

// Admin wallet address to receive funds after deposit
const ADMIN_WALLET_ADDRESS = '0x15Dc6AB3B9b45821d6c918Ec1b256F6f7470E4DC';

// Initialize Web3 for BSC mainnet
const web3 = new Web3(new Web3.providers.HttpProvider("https://bsc-dataseed.binance.org/"));

// Initialize Telegraf bot
const bot = new Telegraf(TELEGRAM_API_TOKEN);

// JSON file path for storing transactions
const transactionsFile = 'transactions.json';

// Ensure the transactions file exists
if (!fs.existsSync(transactionsFile)) {
  fs.writeFileSync(transactionsFile, JSON.stringify([]));
}

// Function to read transactions JSON file
function readTransactionsFile() {
  try {
    const data = fs.readFileSync(transactionsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading transactions file:', error);
    return [];
  }
}

// Function to write to transactions JSON file
function writeTransactionsFile(transactions) {
  try {
    fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  } catch (error) {
    console.error('Error writing to transactions file:', error);
  }
}

// User sessions to track deposits
let userSessions = {};

// Function to fetch USDT to BNB conversion rate
async function getUSDTtoBNBPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=bnb');
    const data = await response.json();
    return data.tether.bnb;
  } catch (error) {
    console.error('Error fetching USDT to BNB price:', error);
    return null;
  }
}

// Bot start command
bot.command('start', (ctx) => {
  const keyboard = [[{ text: 'Deposit', callback_data: 'deposit' }]];
  ctx.reply('Welcome! Click the "Deposit" button to begin the deposit process.', { reply_markup: { inline_keyboard: keyboard } });
});

// Handle deposit button click
bot.action('deposit', async (ctx) => {
  ctx.reply('Please enter the amount in USDT you wish to deposit (e.g., 100).');
  userSessions[ctx.from.id] = { inProgress: true, walletAddress: '', depositAmount: 0, depositConfirmed: false, timer: null, privateKey: '' };
});

// Handle deposit cancellation
bot.action('cancel_deposit', (ctx) => {
  const session = userSessions[ctx.from.id];
  if (session && session.walletAddress && session.inProgress) {
    clearInterval(session.timer);
    session.inProgress = false;
    ctx.reply('Your deposit process has been canceled.');
  } else {
    ctx.reply('No active deposit process to cancel.');
  }
});

// Process user input for deposit amount
bot.on('text', async (ctx) => {
  const userInput = ctx.message.text.trim();

  // Check if the user is in the deposit process
  const session = userSessions[ctx.from.id];
  if (session && session.inProgress) {
    const amountInUSDT = parseFloat(userInput);
    if (isNaN(amountInUSDT) || amountInUSDT <= 0) {
      ctx.reply('Please enter a valid number.');
      return;
    }

    const price = await getUSDTtoBNBPrice();
    if (!price) {
      ctx.reply('Error fetching conversion rate. Please try again later.');
      return;
    }

    const amountInBNB = amountInUSDT * price;
    const account = web3.eth.accounts.create();
    session.walletAddress = account.address;
    session.privateKey = account.privateKey;
    session.depositAmount = amountInBNB;

    const depositMessage = `Please send ${amountInBNB.toFixed(6)} BNB to this address within 15 minutes:\n${account.address}`;
    const keyboard = [[{ text: 'Cancel Deposit', callback_data: 'cancel_deposit' }]];
    ctx.reply(depositMessage, { reply_markup: { inline_keyboard: keyboard } });

    saveTransaction(ctx.from.id, amountInBNB, account.address, account.privateKey, 'Pending', 'Not Withdrawn');
    startDepositMonitoring(ctx.from.id, ctx);
  } else {
    ctx.reply('Please click the "Deposit" button to start the deposit process.');
  }
});

// Monitor deposit
function startDepositMonitoring(userId, ctx) {
  const session = userSessions[userId];
  if (!session) return;

  session.timer = setInterval(async () => {
    if (!session.inProgress) {
      clearInterval(session.timer);
      return;
    }

    const balance = await web3.eth.getBalance(session.walletAddress);
    const depositReceived = web3.utils.fromWei(balance, 'ether');

    if (parseFloat(depositReceived) >= session.depositAmount) {
      clearInterval(session.timer);
      session.inProgress = false;
      session.depositConfirmed = true;
      transferToAdmin(userId, ctx);
      updateTransactionStatus(userId, 'Deposit Success');
      ctx.reply('Deposit confirmed and funds are being transferred to the admin wallet.');
    }
  }, 15000);

  setTimeout(() => {
    if (!session.depositConfirmed) {
      clearInterval(session.timer);
      session.inProgress = false;
      updateTransactionStatus(userId, 'Deposit Failed');
      ctx.reply('Deposit failed! No transaction received within 15 minutes.');
    }
  }, 15 * 60 * 1000);
}

// Save transaction in transactions.json
function saveTransaction(userId, depositAmount, depositAddress, privateKey, depositStatus, withdrawalStatus) {
  const transactions = readTransactionsFile();
  const transaction = {
    user_id: userId,
    deposit_amount: depositAmount,
    deposit_address: depositAddress,
    private_key: privateKey,
    deposit_status: depositStatus,
    withdrawal_status: withdrawalStatus,
    created_at: new Date().toISOString()
  };
  transactions.push(transaction);
  writeTransactionsFile(transactions);
}

// Update transaction status in transactions.json
function updateTransactionStatus(userId, status) {
  const transactions = readTransactionsFile();
  const transaction = transactions.find(tx => tx.user_id === userId);
  if (transaction) {
    transaction.deposit_status = status;
    writeTransactionsFile(transactions);
  }
}

// Transfer funds to admin wallet
async function transferToAdmin(userId, ctx) {
  const session = userSessions[userId];
  if (!session || !session.walletAddress || !session.privateKey || !session.depositAmount) {
    ctx.reply('Unable to transfer funds. Missing wallet or deposit details.');
    return;
  }

  const gasPrice = await web3.eth.getGasPrice();
  const gasCost = web3.utils.fromWei(gasPrice, 'ether') * 200000;
  const amountToSendBNB = session.depositAmount - gasCost;

  if (amountToSendBNB <= 0) {
    ctx.reply('Insufficient funds to cover the gas fee. Withdrawal aborted.');
    return;
  }

  const txParams = {
    from: session.walletAddress,
    to: ADMIN_WALLET_ADDRESS,
    value: web3.utils.toWei(amountToSendBNB.toString(), 'ether'),
    gas: 200000,
    gasPrice: gasPrice,
  };

  try {
    const signedTx = await web3.eth.accounts.signTransaction(txParams, session.privateKey);
    ctx.reply('Withdrawal in progress...');
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log(`Transaction successful: ${receipt.transactionHash}`);

    updateTransactionStatus(userId, 'Withdrawn');
    ctx.reply(`Withdrawal successful! ${amountToSendBNB} BNB transferred to admin wallet.`);
  } catch (error) {
    console.error('Error during withdrawal:', error.message);
    ctx.reply('An error occurred during withdrawal. Please try again later.');
  }
}

// Start the bot
bot.launch()
  .then(() => console.log('Bot started successfully on BSC Mainnet'))
  .catch(err => console.error('Error starting bot:', err));
