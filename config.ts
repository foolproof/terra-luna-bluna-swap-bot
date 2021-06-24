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
		waitFor: 10,
	},

	rate: {
		// This define the minimum rate for the Luna > bLuna swap.
		swap: process.env.MINIMUM_SWAP_RATE,

		// This define the minimum rate for the bLuna > Luna swap.
		reverseSwap: process.env.MINIMUM_REVERSE_SWAP_RATE,
	},

	notification: {
		tty: true,
		telegram: true,
	},
};
