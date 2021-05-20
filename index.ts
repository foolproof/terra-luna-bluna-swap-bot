require('dotenv').config();
import Decimal from 'decimal.js';
import { Coin, LCDClient, MnemonicKey, Msg, MsgExecuteContract } from '@terra-money/terra.js';
import { formatDistanceToNowStrict } from 'date-fns';

const MICRO_MULTIPLIER = 1_000_000;
const MAX_TRANSACTIONS_LOG = 5;

const MINIMUM_REVERSE_SWAP_RATE = Number(process.env.MINIMUM_REVERSE_SWAP_RATE);
const MINIMUM_SWAP_RATE = Number(process.env.MINIMUM_SWAP_RATE);
const PAIR_TOKEN_ADDRESS = process.env.PAIR_TOKEN_ADDRESS;
const BLUNA_TOKEN_ADDRESS = process.env.BLUNA_TOKEN_ADDRESS;

type SimulationReturnType = {
	return_amount: string;
	spread_amount: string;
	commission_amount: string;
};

type SimulationReturnTypeNormalized = {
	returnAmount: Decimal;
	spreadAmount: Decimal;
	commissionAmount: Decimal;
};

class UIContext {
	lunaAmount: Decimal = new Decimal(0);
	blunaAmount: Decimal = new Decimal(0);
	rate: SimulationReturnTypeNormalized;
	ratePercentage: number = 0;
	startDate: number = Date.now();
	transactions: Array<string>;
}

const key = new MnemonicKey({
	mnemonic: process.env.KEY,
});

const terra = new LCDClient({
	URL: process.env.LCD_URL,
	chainID: process.env.CHAIN_ID,
	gasPrices: { uluna: 0.15 },
	gasAdjustment: 1.05,
});

const context = new UIContext();

const wallet = terra.wallet(key);

async function getSimulationRate(amount: Decimal = new Decimal(MICRO_MULTIPLIER)) {
	const rate = await terra.wasm.contractQuery<SimulationReturnType>(PAIR_TOKEN_ADDRESS, {
		simulation: {
			offer_asset: {
				amount: amount,
				info: { native_token: { denom: 'uluna' } },
			},
		},
	});

	return {
		returnAmount: new Decimal(rate.return_amount),
		spreadAmount: new Decimal(rate.spread_amount),
		commissionAmount: new Decimal(rate.commission_amount),
	};
}

async function getReverseSimulationRate(amount: Decimal = new Decimal(100)) {
	const rate = await terra.wasm.contractQuery<SimulationReturnType>(PAIR_TOKEN_ADDRESS, {
		simulation: {
			offer_asset: {
				amount: amount.times(MICRO_MULTIPLIER).toFixed(),
				info: { token: { contract_addr: BLUNA_TOKEN_ADDRESS } },
			},
		},
	});

	return {
		returnAmount: new Decimal(rate.return_amount),
		spreadAmount: new Decimal(rate.spread_amount),
		commissionAmount: new Decimal(rate.commission_amount),
	};
}

function computePercentage(rate: SimulationReturnTypeNormalized, amount: number) {
	const bLunaPrice = rate.returnAmount.dividedBy(MICRO_MULTIPLIER).times(100);
	return bLunaPrice.minus(amount).dividedBy(amount).times(100).toNumber();
}

async function getWalletBalance() {
	const balance = await terra.bank.balance(wallet.key.accAddress);

	return balance.get('uluna');
}

function increaseAllowanceMessageFactory(amount: Decimal) {
	return new MsgExecuteContract(
		wallet.key.accAddress,
		BLUNA_TOKEN_ADDRESS,
		{
			increase_allowance: {
				amount: amount,
				spender: PAIR_TOKEN_ADDRESS,
			},
		},
		[]
	);
}

function swapBlunaToLunaMessageFactory(amount: Decimal) {
	return new MsgExecuteContract(wallet.key.accAddress, BLUNA_TOKEN_ADDRESS, {
		send: {
			amount: amount,
			contract: PAIR_TOKEN_ADDRESS,
			msg: 'eyJzd2FwIjp7fX0=',
		},
	});
}

function swapLunaToBlunaMessageFactory(amount: Decimal) {
	return new MsgExecuteContract(
		wallet.key.accAddress,
		PAIR_TOKEN_ADDRESS,
		{
			swap: {
				offer_asset: {
					info: { native_token: { denom: 'uluna' } },
					amount: amount,
				},
			},
		},
		[new Coin('uluna', amount)]
	);
}

async function getBLunaBalance() {
	const { balance } = await terra.wasm.contractQuery<any>(BLUNA_TOKEN_ADDRESS, {
		balance: { address: wallet.key.accAddress },
	});

	return new Coin('ubluna', balance);
}

function createAndSignTx(msgs: Msg[]) {
	return wallet.createAndSignTx({ msgs });
}

function logTransaction(message: string) {
	context.transactions.unshift(message);

	if (context.transactions.length > MAX_TRANSACTIONS_LOG) {
		context.transactions.splice(-1, 1);
	}
}

async function init() {
	context.transactions = [];

	const blunaAmount = await getBLunaBalance();
	context.blunaAmount = blunaAmount.amount;

	const lunaAmount = await getWalletBalance();
	context.lunaAmount = lunaAmount.amount;

	main();
}

async function main() {
	try {
		context.rate = await getSimulationRate();
		context.ratePercentage = computePercentage(context.rate, 100);

		if (context.ratePercentage < MINIMUM_REVERSE_SWAP_RATE) {
			const blunaAmount = await getBLunaBalance();
			context.blunaAmount = blunaAmount.amount;

			if (context.blunaAmount.toNumber() > 2 * MICRO_MULTIPLIER) {
				logTransaction(`> Swapping bLuna -> Luna [${blunaAmount.amount.dividedBy(MICRO_MULTIPLIER).toFixed(3)} bLuna]`);

				const swapMessage = swapBlunaToLunaMessageFactory(blunaAmount.amount);
				const txs = await createAndSignTx([swapMessage]);
				await terra.tx.broadcast(txs);

				context.blunaAmount = (await getBLunaBalance()).amount;
				context.lunaAmount = (await getWalletBalance()).amount;
			}
		}

		if (context.ratePercentage > MINIMUM_SWAP_RATE) {
			const balance = await getWalletBalance();
			context.lunaAmount = balance.amount;

			const simulationRate = await getSimulationRate(context.lunaAmount);
			const allowance = simulationRate.returnAmount.plus(10);
			const toConvert = context.lunaAmount.minus(simulationRate.commissionAmount);

			if (context.lunaAmount.toNumber() > 2 * MICRO_MULTIPLIER) {
				logTransaction(`> Swapping Luna -> bLuna [${toConvert.dividedBy(MICRO_MULTIPLIER).toFixed(3)} Luna]`);

				const increaseAllowance = increaseAllowanceMessageFactory(allowance);
				const swapMessage = swapLunaToBlunaMessageFactory(toConvert);
				const txs = await createAndSignTx([increaseAllowance, swapMessage]);
				await terra.tx.broadcast(txs);

				context.blunaAmount = (await getBLunaBalance()).amount;
				context.lunaAmount = (await getWalletBalance()).amount;
			}
		}
	} catch (e) {
		console.error(e.response.data);
	}

	setTimeout(main, 15000);
}

function updateUI() {
	console.clear();
	console.log(`Uptime: ${formatDistanceToNowStrict(context.startDate)}`);
	console.log(
		`Luna: ${context.lunaAmount.dividedBy(MICRO_MULTIPLIER).toFixed(3)} - bLuna: ${context.blunaAmount
			.dividedBy(MICRO_MULTIPLIER)
			.toFixed(3)}`
	);
	console.log('=======================================');
	console.log(`Current Swap Percentage: ${context.ratePercentage.toFixed(3)}%`);
	console.log('=======================================');
	console.log('Last transactions');
	console.log('=======================================');
	for (let i = 0; i < context.transactions.length; i++) {
		console.log(context.transactions[i]);
	}
}

setInterval(updateUI, 1000);
init();
