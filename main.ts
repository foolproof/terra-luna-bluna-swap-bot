require('dotenv').config();
import dedent from 'dedent-js';
import { Telegraf } from 'telegraf';
import config from './config';
import { Bot } from './src/Bot';

const MICRO_MULTIPLIER = 1_000_000;
const bot = new Bot(config);

if (config.telegram.apiKey) {
	const tgBot = new Telegraf(config.telegram.apiKey);

	tgBot.command('ping', (ctx) => ctx.reply('Pong!'));

	tgBot.command('balance', async (ctx) => {
		const message = await ctx.replyWithHTML('Loading...');

		bot.clearCache();

		const [{ luna, krw }, bLuna] = await Promise.all([bot.getWalletBalance(), bot.getbLunaBalance()]);

		const msg = dedent`Your balance is
		- <code>${luna?.amount.dividedBy(MICRO_MULTIPLIER).toFixed(3) || 0} Luna</code>
		- <code>${bLuna?.amount.dividedBy(MICRO_MULTIPLIER).toFixed(3) || 0} bLuna</code>
		- <code>${krw?.amount.dividedBy(MICRO_MULTIPLIER).toFixed(3) || 0} KRW</code>`;

		ctx.telegram.editMessageText(message.chat.id, message.message_id, undefined, msg, { parse_mode: 'HTML' });
	});

	tgBot.command('info', async (ctx) => {
		const { config, wallet, status } = bot.getContext();

		ctx.replyWithHTML(dedent`<b>v${Bot.version} - Luna &lt;&gt; bLuna Swap Bot</b>
			Made by Romain Lanz
			
			<b>Network:</b> <code>${config.chainId === 'columbus-4' ? 'Mainnet' : 'Testnet'}</code>
			<b>Address:</b>
			<a href="https://finder.terra.money/${config.chainId}/address/${wallet}">
				${wallet}
			</a>

			<b>Status:</b> <code>${status}</code>
			
			<u>Configuration:</u>
				- <b>SWAP:</b> <code>${config.rate.swap}%</code>
				- <b>REVERSE SWAP:</b> <code>${config.rate.reverseSwap}%</code>`);
	});

	tgBot.command('run', (ctx) => {
		bot.start();
	});

	tgBot.command('pause', (ctx) => {
		bot.pause();
		bot.clearQueue();
		bot.clearCache();
	});

	tgBot.launch();
}

async function main() {
	try {
		await bot.execute();
	} catch (e) {
		console.error(e);
		bot.clearCache();
	} finally {
		bot.clearQueue();
		bot.stopExecution();
	}

	setTimeout(main, config.options.waitFor * 1000);
}

if (process.env.MNEMONIC && process.env.MNEMONIC.split(' ').length !== 24) {
	throw new Error('Invalid mnemonic key provided.');
}

if (process.env.LCD_URL && !process.env.LCD_URL.startsWith('https://')) {
	throw new Error('Invalid LCD URL provided.');
}

if (process.env.CHAIN_ID && process.env.CHAIN_ID.split('-').length !== 2) {
	throw new Error('Invalid CHAIN ID provided.');
}

main();
