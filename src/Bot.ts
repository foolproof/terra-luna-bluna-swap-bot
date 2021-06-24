import dedent from 'dedent-js';
import Decimal from 'decimal.js';
import { Coin, LCDClient, MnemonicKey, Msg, MsgExecuteContract, Wallet } from '@terra-money/terra.js';
import { Logger } from './Logger';

const MICRO_MULTIPLIER = 1_000_000;

type BotStatus = 'RUNNING' | 'PAUSE';

type SimulationReturnType = {
	return_amount: string;
	spread_amount: string;
	commission_amount: string;
};

export class Bot {
	#client: LCDClient;
	#config: Record<string, any>;
	#status: BotStatus = 'RUNNING';
	#wallet: Wallet;
	#tx = [];

	constructor(config: any) {
		this.#config = config;

		// Initialization of the Terra Client
		this.#client = new LCDClient({
			URL: this.#config.lcdUrl,
			chainID: this.#config.chainId,
			gasPrices: { ukrw: 200 },
		});

		// Initialization of the user Wallet
		const key = new MnemonicKey({ mnemonic: this.#config.mnemonic });
		this.#wallet = new Wallet(this.#client, key);

		Logger.log(dedent`<b>v0.1.0 - Luna &lt;&gt; bLuna Swap Bot</b>
				Made by Romain Lanz
				
				<b>Network:</b> <code>${this.#config.chainId === 'columbus-4' ? 'Mainnet' : 'Testnet'}</code>
				<b>Address:</b>
				<a href="https://finder.terra.money/${this.#config.chainId}/address/${this.#wallet.key.accAddress}">
					${this.#wallet.key.accAddress}
				</a>
				
				<u>Configuration:</u>
					- <b>SWAP:</b> <code>${this.#config.rate.swap}%</code>
					- <b>REVERSE SWAP:</b> <code>${this.#config.rate.reverseSwap}%</code>
		`);
	}

	getContext() {
		return { config: this.#config, wallet: this.#wallet.key.accAddress, status: this.#status };
	}

	start() {
		this.#status = 'RUNNING';
		Logger.log('Bot started');
	}

	pause() {
		this.#status = 'PAUSE';
		Logger.log('Bot paused');
	}

	clearQueue() {
		this.#tx = [];
	}

	async execute() {
		if (this.#status === 'PAUSE') {
			return;
		}

		let [percentage, reversePercentage] = await Promise.all([
			this.getSimulationRate(),
			this.getReverseSimulationRate(),
		]);

		if (percentage < 0 || reversePercentage > 0) {
			return;
		}

		if (percentage > this.#config.rate.swap) {
			const lunaBalance = await this.getLunaBalance();

			if (+lunaBalance?.amount > 0) {
				Logger.log(
					`Swapping Luna -> bLuna [${lunaBalance.amount
						.dividedBy(MICRO_MULTIPLIER)
						.toFixed(3)} Luna @ ${percentage.toFixed(3)}%]`
				);

				this.toBroadcast([
					this.computeIncreaseAllowanceMessage(lunaBalance),
					this.computeLunatobLunaMessage(lunaBalance),
				]);

				await this.broadcast();
			}
		} else if (reversePercentage < this.#config.rate.reverseSwap) {
			const bLunaBalance = await this.getbLunaBalance();

			if (+bLunaBalance?.amount > 0) {
				Logger.log(
					`Swapping bLuna -> Luna [${bLunaBalance.amount
						.dividedBy(MICRO_MULTIPLIER)
						.toFixed(3)} bLuna @ ${reversePercentage.toFixed(3)}%]`
				);

				this.toBroadcast(this.computebLunaToLunaMessage(bLunaBalance));

				await this.broadcast();
			}
		}
	}

	async getLunaBalance(): Promise<Coin> {
		const balance = await this.#client.bank.balance(this.#wallet.key.accAddress);

		return balance.get('uluna');
	}

	async getbLunaBalance(): Promise<Coin> {
		const { balance } = await this.#client.wasm.contractQuery<any>(process.env.BLUNA_TOKEN_ADDRESS, {
			balance: { address: this.#wallet.key.accAddress },
		});

		return new Coin('ubluna', balance);
	}

	async getSimulationRate(): Promise<number> {
		const amount = new Decimal(MICRO_MULTIPLIER * 100);

		const rate = await this.#client.wasm.contractQuery<SimulationReturnType>(process.env.PAIR_TOKEN_ADDRESS, {
			simulation: {
				offer_asset: {
					amount,
					info: { native_token: { denom: 'uluna' } },
				},
			},
		});

		const returnAmount = new Decimal(rate.return_amount);
		const bLunaPrice = returnAmount.dividedBy(MICRO_MULTIPLIER);
		return bLunaPrice.minus(100).toNumber();
	}

	async getReverseSimulationRate(): Promise<number> {
		const amount = new Decimal(MICRO_MULTIPLIER * 100);
		const rate = await this.#client.wasm.contractQuery<SimulationReturnType>(process.env.PAIR_TOKEN_ADDRESS, {
			simulation: {
				offer_asset: {
					amount: amount,
					info: { token: { contract_addr: process.env.BLUNA_TOKEN_ADDRESS } },
				},
			},
		});

		const returnAmount = new Decimal(rate.return_amount);
		const bLunaPrice = returnAmount.dividedBy(MICRO_MULTIPLIER);
		return bLunaPrice.minus(100).toNumber();
	}

	computeIncreaseAllowanceMessage(amount: Coin) {
		return new MsgExecuteContract(
			this.#wallet.key.accAddress,
			process.env.BLUNA_TOKEN_ADDRESS,
			{
				increase_allowance: {
					amount: amount.amount,
					spender: process.env.PAIR_TOKEN_ADDRESS,
				},
			},
			[]
		);
	}

	computebLunaToLunaMessage(amount: Coin) {
		return new MsgExecuteContract(this.#wallet.key.accAddress, process.env.BLUNA_TOKEN_ADDRESS, {
			send: {
				amount: amount.amount,
				contract: process.env.PAIR_TOKEN_ADDRESS,
				msg: 'eyJzd2FwIjp7fX0=',
			},
		});
	}

	computeLunatobLunaMessage(amount: Coin) {
		return new MsgExecuteContract(
			this.#wallet.key.accAddress,
			process.env.PAIR_TOKEN_ADDRESS,
			{
				swap: {
					offer_asset: {
						info: { native_token: { denom: 'uluna' } },
						amount: amount.amount,
					},
				},
			},
			[new Coin('uluna', amount.amount)]
		);
	}

	private toBroadcast(message: Msg | Msg[]) {
		if (Array.isArray(message)) {
			this.#tx.push(...message);
			return;
		}

		this.#tx.push(message);
	}

	private async broadcast() {
		try {
			const tx = await this.#wallet.createAndSignTx({ msgs: this.#tx });
			await this.#client.tx.broadcast(tx);
		} catch (e) {
			console.error(`An error occured\n${JSON.stringify(e.response.data)}`);
		} finally {
			this.clearQueue();
		}
	}
}
