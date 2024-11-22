const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');

// Initialize the bot with your token
const bot = new Telegraf('7231982062:AAFMjFTPqLor7RniSKi_Q7kgiqPArgXEbCw');

// Store active wallet tracking intervals and listeners
const activeIntervals = {};
const activeListeners = {};

// Function to check tokens in a wallet
async function checkWallet(address) {
  try {
    const url = 'https://api.phantom.app/tokens/v1';
    const payload = {
      addresses: [{ chainId: 'solana:101', address }],
    };
    const headers = { 'Content-Type': 'application/json' };

    const response = await axios.post(url, payload, { headers, timeout: 60_000 });
    if (response.status === 200) return response.data;
  } catch (error) {
    console.error('Error checking wallet:', error);
  }
  return null;
}

// Function to load saved tokens from file
function loadSavedTokens(userId) {
  try {
    const data = fs.readFileSync(`tokens_${userId}.json`, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Function to save tokens to file
function saveTokens(userId, tokens) {
  try {
    fs.writeFileSync(`tokens_${userId}.json`, JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

// Function to clear tracking, delete the wallet file, and reset the bot
function clearTracking(userId, ctx) {
  if (activeIntervals[userId]) {
    clearInterval(activeIntervals[userId]);
    delete activeIntervals[userId];
  }

  if (activeListeners[userId]) {
    bot.off('text', activeListeners[userId]);
    delete activeListeners[userId];
  }

  try {
    fs.unlinkSync(`tokens_${userId}.json`);
  } catch (err) {
    console.error('Error deleting wallet file:', err);
  }

  ctx.reply(
    `ARGON | Wallet Tracker👾\n\n🎯 Never miss any token purchased by your favorite WHALEs. Track their wallets, copy their trades, and make more profits.\n\n🔴 Due to high usage, wallets are tracked every 2 minutes.\n\n💎 Upgrade to Premium for faster tracking ⚡️\n\n🔥 Ready to track a WHALE wallet? 👇`,
    Markup.keyboard(['Track Wallet']).resize()
  );
}

// Function to send only the first 10 tokens initially
function sendLimitedTokens(tokens, savedTokens, ctx) {
  let message = '🚀 **Top Tokens in WHALE wallet:**\n\n';
  const limitedTokens = tokens.slice(0, 10);

  limitedTokens.forEach((token) => {
    const mintAddress = token.data.mintAddress || 'Unknown Mint';
    const tokenName = token.data.name || 'Unknown Token';
    const amount = (parseFloat(token.data.amount) || 0) / 1_000_000;
    const symbol = token.data.symbol || 'Unknown Symbol';

    if (!savedTokens[mintAddress]) {
      savedTokens[mintAddress] = { name: tokenName, symbol, amount };
    }

    message += `🌐 ${tokenName} (${symbol}): ${amount}\n💰 Mint Address: <code>${mintAddress}</code>\n\n`;
  });

  saveTokens(ctx.chat.id, savedTokens);
  ctx.replyWithHTML(message);
}

// /start command
bot.start((ctx) => {
  ctx.reply(
    `ARGON | Wallet Tracker👾\n\n🎯 Never miss any token purchased by your favorite WHALEs. Track their wallets, copy their trades, and make more profits.\n\n🔴 Due to high usage, wallets are tracked every 2 minutes.\n\n💎 Upgrade to Premium for faster tracking ⚡️\n\n🔥 Ready to track a WHALE wallet? 👇`,
    Markup.keyboard(['Track Wallet']).resize()
  );
});

// Track Wallet command
bot.hears('Track Wallet', async (ctx) => {
  const userId = ctx.chat.id;

  if (activeIntervals[userId]) {
    return ctx.reply(
      `🛑 You're already tracking a wallet. Please cancel the current tracking first.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Tracking', `cancel_${userId}`)],
      ])
    );
  }

  ctx.reply('🔍 Please provide the Solana wallet address you want to track:');

  const listener = async (ctx) => {
    const userAddress = ctx.message.text.trim();

    ctx.reply(
      `🛸 Tracking wallet: ${userAddress}. I will notify you when new tokens are added.`
    );

    const savedTokens = loadSavedTokens(userId);
    const tokenData = await checkWallet(userAddress);

    if (tokenData && tokenData.tokens) {
      sendLimitedTokens(tokenData.tokens, savedTokens, ctx);

      activeIntervals[userId] = setInterval(async () => {
        const updatedData = await checkWallet(userAddress);
        if (updatedData && updatedData.tokens) {
          const newTokens = updatedData.tokens.filter(
            (token) => !savedTokens[token.data.mintAddress]
          );

          if (newTokens.length) {
            sendLimitedTokens(newTokens, savedTokens, ctx);
          }
        }
      }, 150_000); // Check every 2.5 minutes
    }

    delete activeListeners[userId];
  };

  activeListeners[userId] = listener;
  bot.on('text', listener);
});

// Cancel Tracking command
bot.action(/cancel_(\d+)/, (ctx) => {
  const userId = parseInt(ctx.match[1]);
  clearTracking(userId, ctx);
});

// Launch the bot
bot.launch().then(() => console.log('Bot started successfully.'));
