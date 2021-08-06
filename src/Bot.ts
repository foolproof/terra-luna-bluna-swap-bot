import dedent from 'dedent-js';
import Decimal from 'decimal.js';
import { Coin, Denom, LCDClient, MnemonicKey, Msg, MsgExecuteContract, Wallet } from '@terra-money/terra.js';
import { Logger } from './Logger';

const MICRO_MULTIPLIER = 1_000_000;

type BotStatus = 'RUNNING' | 'IDLE' | 'PAUSE';

type SimulationReturnType = {
	return_amount: string;
	spread_amount: string;
	commission_amount: string;
};

type Simulation = {
	beliefPrice: Decimal;
	percentage: number;
};

export class Bot {
	#client: LCDClient;
	#config: Record<string, any>;
	#status: BotStatus = 'IDLE';
	#wallet: Wallet;
	#cache = new Map();
	#tx = [];

	static get version() {
		return '0.2.0';
	}

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

		this.info();
	}

	info() {
		Logger.log(dedent`<b>v${Bot.version} - Luna &lt;&gt; bLuna Swap Bot</b>
			Made by Romain Lanz
			
			<b>Network:</b> <code>${this.#config.chainId === 'columbus-4' ? 'Mainnet' : 'Testnet'}</code>
			<b>Address:</b>
			<a href="https://finder.terra.money/${this.#config.chainId}/address/${this.#wallet.key.accAddress}">
				${this.#wallet.key.accAddress}
			</a>

			<b>Status:</b> <code>${this.#status}</code>
			
			<u>Configuration:</u>
				- <b>SWAP:</b> <code>${this.#config.rate.swap}%</code>
				- <b>REVERSE SWAP:</b> <code>${this.#config.rate.reverseSwap}%</code>
				- <b>MAX SPREAD:</b> <code>${this.#config.rate.maxSpread}%</code>
				- <b>MAX TOKEN PER SWAP:</b> <code>${this.#config.rate.maxTokenPerSwap}</code>
		`);
	}

	start() {
		this.#status = 'IDLE';
		Logger.log('Bot started');
	}

	pause() {
		this.#status = 'PAUSE';
		Logger.log('Bot paused');
	}

	stopExecution() {
		this.#status = 'IDLE';
	}

	clearQueue() {
		this.#tx = [];
	}

	clearCache() {
		this.#cache.clear();
	}

	getMaxTokenSwap() {
		return +this.#config.rate.maxTokenPerSwap * MICRO_MULTIPLIER;
	}

	async execute() {
		if (this.#status !== 'IDLE') {
			return;
		}

		this.#status = 'RUNNING';

		let [simulation, reverseSimulation] = await Promise.all([
			this.getSimulationRate(),
			this.getReverseSimulationRate(),
		]);

		if (simulation.percentage > +this.#config.rate.swap) {
			let { luna: lunaBalance } = await this.getWalletBalance();

			if (+lunaBalance?.amount > 0) {
				if (this.#config.rate.maxTokenPerSwap != 0 && +lunaBalance.amount > this.getMaxTokenSwap()) {
					lunaBalance = new Coin(Denom.LUNA, this.getMaxTokenSwap());
				}

				Logger.log(
					`Trying Luna → bLuna [${lunaBalance.amount
						.dividedBy(MICRO_MULTIPLIER)
						.toFixed(3)} Luna @ ${simulation.percentage.toFixed(3)}%]`
				);

				this.toBroadcast([
					this.computeIncreaseAllowanceMessage(lunaBalance),
					this.computeLunatobLunaMessage(lunaBalance, simulation.beliefPrice),
				]);

				try {
					await this.broadcast();

					Logger.log(
						`Swapped Luna → bLuna [${lunaBalance.amount
							.dividedBy(MICRO_MULTIPLIER)
							.toFixed(3)} Luna @ ${simulation.percentage.toFixed(3)}%]`
					);
				} catch (e) {
					console.error(e);
				} finally {
					this.#cache.clear();
				}
			}
		} else if (reverseSimulation.percentage > +this.#config.rate.reverseSwap) {
			let bLunaBalance = await this.getbLunaBalance();

			if (+bLunaBalance?.amount > 0) {
				if (this.#config.rate.maxTokenPerSwap != 0 && +bLunaBalance.amount > this.getMaxTokenSwap()) {
					bLunaBalance = new Coin('ubluna', this.getMaxTokenSwap());
				}

				Logger.log(
					`Trying bLuna → Luna [${bLunaBalance.amount
						.dividedBy(MICRO_MULTIPLIER)
						.toFixed(3)} bLuna @ ${reverseSimulation.percentage.toFixed(3)}%]`
				);

				this.toBroadcast(this.computebLunaToLunaMessage(bLunaBalance, reverseSimulation.beliefPrice));

				try {
					await this.broadcast();

					Logger.log(
						`Swapped bLuna → Luna [${bLunaBalance.amount
							.dividedBy(MICRO_MULTIPLIER)
							.toFixed(3)} bLuna @ ${reverseSimulation.percentage.toFixed(3)}%]`
					);
				} finally {
					this.#cache.clear();
				}
			}
		}

		this.#status = 'IDLE';
	}

	async getWalletBalance(): Promise<{ luna: Coin; krw: Coin }> {
		if (this.#cache.has('wallet')) {
			return this.#cache.get('wallet');
		}

		const balance = await this.#client.bank.balance(this.#wallet.key.accAddress);

		const luna = balance.get(Denom.LUNA);
		const krw = balance.get(Denom.KRW);

		this.#cache.set('wallet', { luna, krw });

		return { luna, krw };
	}

	async getbLunaBalance(): Promise<Coin> {
		if (this.#cache.has('bluna')) {
			return this.#cache.get('bluna');
		}

		const { balance } = await this.#client.wasm.contractQuery<any>(process.env.BLUNA_TOKEN_ADDRESS, {
			balance: { address: this.#wallet.key.accAddress },
		});

		const bluna = new Coin('ubluna', balance);
		this.#cache.set('bluna', bluna);

		return bluna;
	}

	async getSimulationRate(): Promise<Simulation> {
		const { luna: balance } = await this.getWalletBalance();
		let amount = (MICRO_MULTIPLIER * 100).toString();

		if (balance && +balance?.amount > +this.#config.rate.maxTokenPerSwap) {
			amount = this.getMaxTokenSwap().toString();
		} else if (balance && +balance?.amount !== 0) {
			amount = balance?.amount.toString();
		}

		const rate = await this.#client.wasm.contractQuery<SimulationReturnType>(process.env.PAIR_TOKEN_ADDRESS, {
			simulation: {
				offer_asset: {
					amount,
					info: { native_token: { denom: 'uluna' } },
				},
			},
		});

		const returnAmount = new Decimal(rate.return_amount);

		return {
			beliefPrice: returnAmount,
			percentage: returnAmount.minus(amount).dividedBy(amount).times(100).toNumber(),
		};
	}

	async getReverseSimulationRate(): Promise<Simulation> {
		const balance = await this.getbLunaBalance();
		let amount = (MICRO_MULTIPLIER * 100).toString();

		if (balance && +balance?.amount > +this.#config.rate.maxTokenPerSwap) {
			amount = this.getMaxTokenSwap().toString();
		} else if (balance && +balance.amount !== 0) {
			amount = balance?.amount.toString();
		}

		const rate = await this.#client.wasm.contractQuery<SimulationReturnType>(process.env.PAIR_TOKEN_ADDRESS, {
			simulation: {
				offer_asset: {
					amount,
					info: { token: { contract_addr: process.env.BLUNA_TOKEN_ADDRESS } },
				},
			},
		});

		const returnAmount = new Decimal(rate.return_amount);

		return {
			beliefPrice: returnAmount,
			percentage: returnAmount.minus(amount).dividedBy(amount).times(100).toNumber(),
		};
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

	computebLunaToLunaMessage(amount: Coin, beliefPrice: Decimal) {
		const maxSpread = this.#config.rate.maxSpread / 100 || '0.01';
		const message = JSON.stringify({
			swap: {
				max_spread: maxSpread,
				belief_price: beliefPrice.dividedBy(MICRO_MULTIPLIER),
			},
		});

		return new MsgExecuteContract(this.#wallet.key.accAddress, process.env.BLUNA_TOKEN_ADDRESS, {
			send: {
				amount: amount.amount,
				contract: process.env.PAIR_TOKEN_ADDRESS,
				msg: Buffer.from(message).toString('base64'),
			},
		});
	}

	computeLunatobLunaMessage(amount: Coin, beliefPrice: Decimal) {
		const maxSpread = this.#config.rate.maxSpread / 100 || '0.01';

		return new MsgExecuteContract(
			this.#wallet.key.accAddress,
			process.env.PAIR_TOKEN_ADDRESS,
			{
				swap: {
					offer_asset: {
						info: { native_token: { denom: 'uluna' } },
						amount: amount.amount,
					},
					max_spread: String(maxSpread),
					belief_price: beliefPrice.dividedBy(MICRO_MULTIPLIER),
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
			throw e;
		} finally {
			this.clearQueue();
		}
	}
}
