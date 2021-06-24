import got from 'got';
import config from '../config';

export class Logger {
	static log(message: string) {
		if (config.notification.tty) {
			console.log(message);
		}

		if (config.notification.telegram) {
			Logger.sendTelegramNotification(message);
		}
	}

	static sendTelegramNotification(message: string) {
		got
			.post(`https://api.telegram.org/bot${config.telegram.apiKey}/sendMessage`, {
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chat_id: config.telegram.userId,
					text: message,
					parse_mode: 'HTML',
				}),
				retry: 5,
			})
			.catch(() => {});
	}
}
