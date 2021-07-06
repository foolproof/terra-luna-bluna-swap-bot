export default {
	// This should be your wallet mnemonic (24 words).
	mnemonic: process.env.MNEMONIC,

	// This is Terra Blockchain information
	lcdUrl: process.env.LCD_URL,
	chainId: process.env.CHAIN_ID,

	// Telegram Bot information
	telegram: {
		apiKey: process.env.BOT_API_KEY,
		userId: process.env.BOT_CHAT_ID,
	},

	options: {
		// This define the number of SECONDS to wait between each verification.
		waitFor: 2,
	},

	rate: {
		// This define the minimum rate for the Luna > bLuna swap.
		swap: process.env.MINIMUM_SWAP_RATE,

		// This define the minimum rate for the bLuna > Luna swap.
		reverseSwap: process.env.MINIMUM_REVERSE_SWAP_RATE,

		// This define the maximum spread.
		maxSpread: process.env.MAX_SPREAD,

		// This define the maximum number of token per swap.
		maxTokenPerSwap: process.env.MAX_TOKEN_PER_SWAP,
	},

	notification: {
		tty: true,
		telegram: true,
	},
};
