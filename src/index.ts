import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { discordBotTable as discordBot } from './schema';
import { WorkerEntrypoint } from 'cloudflare:workers';

const API_URL = 'https://ajou-notice.asitis.workers.dev';

export interface Env {
	DB: D1Database;
	NOTICE_WORKER: Service<WorkerEntrypoint>;
}

interface Payload {
	category?: string;
	department?: string;
	search?: string;
}

interface Notice {
	id: number;
	category: string;
	department: string;
	title: string;
	content: string;
	url: string;
	date: string;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const db = drizzle(env.DB);
		const { pathname, searchParams } = new URL(request.url);

		if (pathname === '/api/webhook') {
			if (request.method === 'OPTIONS') {
				return new Response('', {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type',
						'Access-Control-Max-Age': '86400',
					},
				});
			} else if (request.method === 'GET') {
				const webhook = searchParams.get('webhook');
				if (!webhook) {
					return new Response('Bad Request: Missing `webhook` parameter', {
						status: 400,
					});
				}

				const info = await db.select().from(discordBot).where(eq(discordBot.webhook, webhook)).get();
				if (!info) {
					return new Response('Not Found: Webhook not found', {
						status: 404,
					});
				}

				return Response.json(info, {
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			} else if (request.method === 'POST') {
				const webhook = searchParams.get('webhook');
				if (!webhook) {
					return new Response('Bad Request: Missing `webhook` parameter', {
						status: 400,
					});
				}

				const { category, department, search }: Payload = await request.json();
				const queryParams = new URLSearchParams();

				if (category) queryParams.append('category', category);
				if (department) queryParams.append('department', department);
				if (search) queryParams.append('search', search);

				const response = await env.NOTICE_WORKER.fetch(`${API_URL}/api/notices?${queryParams.toString()}`, {
					method: 'GET',
				});
				const notices: Notice[] = await response.json();

				const newRecord = {
					webhook,
					latestId: notices[0]?.id ?? 0,
					queryParams: queryParams.toString(),
				};

				try {
					const info = await db.select().from(discordBot).where(eq(discordBot.webhook, webhook)).get();
					if (info) {
						return new Response('Conflict: Duplicate entry for unique field', {
							status: 409,
						});
					}

					await db.insert(discordBot).values(newRecord);

					return new Response('Webhook registered successfully', {
						status: 201,
					});
				} catch (error) {
					return new Response('Internal Server Error', {
						status: 500,
					});
				}
			} else if (request.method === 'DELETE') {
				const webhook = searchParams.get('webhook');
				if (!webhook) {
					return new Response('Bad Request: Missing `webhook` parameter', {
						status: 400,
					});
				}

				try {
					const result = await db.delete(discordBot).where(eq(discordBot.webhook, webhook));

					if (result.meta.rows_read === 0) {
						return new Response('Not Found: Webhook not found', {
							status: 404,
						});
					}

					return new Response('Webhook deleted successfully', {
						status: 200,
					});
				} catch (error) {
					return new Response('Internal Server Error', {
						status: 500,
					});
				}
			} else {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: {
						Allow: 'GET',
					},
				});
			}
		} else if (pathname === '/api/webhook/refresh') {
			if (request.method !== 'POST') {
				return new Response('Method Not Allowed', {
					status: 405,
					headers: {
						Allow: 'GET',
					},
				});
			}

			const webhook = searchParams.get('webhook');
			if (!webhook) {
				return new Response('Bad Request: Missing `webhook` parameter', {
					status: 400,
				});
			}

			const info = await db.select().from(discordBot).where(eq(discordBot.webhook, webhook)).get();
			if (!info) {
				return new Response('Not Found: Webhook not found', {
					status: 404,
				});
			}

			const response = await env.NOTICE_WORKER.fetch(`/api/notices?${info.queryParams}`, {
				method: 'GET',
			});
			const notices: Notice[] = await response.json();
			const latestId = notices[0]?.id ?? 0;

			if (latestId > info.latestId) {
				await db.update(discordBot).set({ latestId }).where(eq(discordBot.webhook, webhook));
			}

			const newNotices = notices.filter((notice) => notice.id > info.latestId).reverse();

			for (const notice of newNotices) {
				const form = new FormData();
				form.append('content', `${notice.title}\n${notice.url}`);
				form.append('avatar_url', 'https://www.ajou.ac.kr/_res/ajou/kr/img/intro/img-symbol.png');

				await fetch(webhook, {
					method: 'POST',
					body: form,
				});
			}

			return new Response('Success', {
				status: 200,
			});
		}

		return new Response('Call /api/webhook', {
			status: 404,
		});
	},

	async scheduled(event, env, ctx) {
		const db = drizzle(env.DB);

		const bots = await db.select().from(discordBot).all();

		for (const bot of bots) {
			const response = await env.NOTICE_WORKER.fetch(`https://ajou-notice.asitis.workers.dev/api/notices?${bot.queryParams}`, {
				method: 'GET',
			});
			const notices: Notice[] = await response.json();
			const latestId = notices[0]?.id ?? 0;

			if (latestId > bot.latestId) {
				await db.update(discordBot).set({ latestId }).where(eq(discordBot.webhook, bot.webhook));
			}

			const newNotices = notices.filter((notice) => notice.id > bot.latestId).reverse();

			for (const notice of newNotices) {
				const form = new FormData();
				form.append('content', `${notice.title}\n${notice.url}`);
				form.append('avatar_url', 'https://www.ajou.ac.kr/_res/ajou/kr/img/intro/img-symbol.png');

				await fetch(bot.webhook, {
					method: 'POST',
					body: form,
				});
			}
		}
	},
} satisfies ExportedHandler<Env>;
