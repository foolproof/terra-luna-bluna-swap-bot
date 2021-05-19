require('dotenv').config();
import { Coin, LCDClient, MnemonicKey, Msg, MsgExecuteContract } from '@terra-money/terra.js';

const MICRO_MULTIPLIER = 1000000;
const MINIMUM_REVERSE_SWAP_RATE = Number(process.env.MINIMUM_REVERSE_SWAP_RATE);
const MINIMUM_SWAP_RATE = Number(process.env.MINIMUM_SWAP_RATE);
const PAIR_TOKEN_ADDRESS = process.env.PAIR_TOKEN_ADDRESS;
const BLUNA_TOKEN_ADDRESS = process.env.BLUNA_TOKEN_ADDRESS;

const key = new MnemonicKey({
	mnemonic: process.env.KEY,
});

const terra = new LCDClient({
	URL: process.env.LCD_URL,
	chainID: process.env.CHAIN_ID,
	gasPrices: { uluna: 0.015 },
});

const wallet = terra.wallet(key);

function getSwapRate(amount: number): any {
	return terra.wasm.contractQuery(PAIR_TOKEN_ADDRESS, {
		simulation: {
			offer_asset: {
				amount: String(amount * MICRO_MULTIPLIER),
				info: { native_token: { denom: 'uluna' } },
			},
		},
	});
}

async function computePercentage({ return_amount }, amount = 100) {
	const bLunaPrice = return_amount / MICRO_MULTIPLIER;
	return ((bLunaPrice - amount) / amount) * 100;
}

async function displayBalance() {
	const native = await terra.bank.balance(wallet.key.accAddress);
	const bLuna = await getBLunaBalance();

	console.log(
		`New Balance: ${Number(native.get('uluna').amount) / MICRO_MULTIPLIER} Luna - ${bLuna / MICRO_MULTIPLIER} bLuna`
	);
}

function getWalletBalance() {
	return terra.bank.balance(wallet.key.accAddress);
}

function increaseAllowanceMessageFactory(amount: number) {
	return new MsgExecuteContract(
		wallet.key.accAddress,
		BLUNA_TOKEN_ADDRESS,
		{
			increase_allowance: {
				amount: String(amount * MICRO_MULTIPLIER),
				spender: PAIR_TOKEN_ADDRESS,
			},
		},
		[]
	);
}

function swapBlunaToLunaMessageFactory(amount: number) {
	return new MsgExecuteContract(
		wallet.key.accAddress,
		BLUNA_TOKEN_ADDRESS,
		{
			send: {
				offer_asset: {
					amount: String(amount * MICRO_MULTIPLIER),
					contract: PAIR_TOKEN_ADDRESS,
					msg: Buffer.from('{"swap":{}}').toString('base64'),
				},
			},
		},
		[]
	);
}

function swapLunaToBlunaMessageFactory(amount: number) {
	return new MsgExecuteContract(
		wallet.key.accAddress,
		PAIR_TOKEN_ADDRESS,
		{
			swap: {
				offer_asset: {
					info: { native_token: { denom: 'uluna' } },
					amount: String(amount * MICRO_MULTIPLIER),
				},
			},
		},
		[new Coin('uluna', amount * MICRO_MULTIPLIER)]
	);
}

async function getBLunaBalance() {
	const { balance } = await terra.wasm.contractQuery<any>(BLUNA_TOKEN_ADDRESS, {
		balance: { address: wallet.key.accAddress },
	});

	return balance;
}

function createAndSignTx(msgs: Msg[]) {
	return wallet.createAndSignTx({ msgs });
}

async function main() {
	try {
		const rate = await getSwapRate(100);
		const percentage = await computePercentage(rate, 100);

		console.log('-----------------------------------');
		console.info(`Current Swap Percentage: ${percentage}%`);

		if (percentage < MINIMUM_REVERSE_SWAP_RATE) {
			const blunaAmount = (await getBLunaBalance()) / MICRO_MULTIPLIER;

			if (Number(blunaAmount) > 2) {
				console.info(`Swapping bLuna -> Luna [${blunaAmount} bLuna]`);

				const swapMessage = swapBlunaToLunaMessageFactory(blunaAmount);

				const txs = await createAndSignTx([swapMessage]);
				const r = await terra.tx.broadcast(txs);
				console.log(r);
				await displayBalance();
			} else {
				console.log('Not enough bLuna to swap');
			}
		}

		if (percentage > MINIMUM_SWAP_RATE) {
			const balance = await getWalletBalance();
			let lunaAmount = Number(balance.get('uluna').amount) / MICRO_MULTIPLIER;

			const rate = await getSwapRate(lunaAmount);
			const percentage = await computePercentage(rate, lunaAmount);
			lunaAmount = Number((lunaAmount - (rate.commission_amount + 10) / MICRO_MULTIPLIER).toFixed(3));

			if (lunaAmount > 2) {
				if (percentage < MINIMUM_SWAP_RATE) {
					console.log('Percentage changed!');
					return;
				}

				console.info(`Swapping Luna -> bLuna [${lunaAmount} Luna]`);

				const increaseAllowance = increaseAllowanceMessageFactory(rate.return_amount + 10);
				const swapMessage = swapLunaToBlunaMessageFactory(lunaAmount);

				const txs = await createAndSignTx([increaseAllowance, swapMessage]);
				const r = await terra.tx.broadcast(txs);
				console.log(r);
				await displayBalance();
			} else {
				console.log('Not enough Luna to swap');
			}
		}
	} catch (e) {
		console.error(e.response.data);
	}

	setTimeout(main, 1000);
}

main();
