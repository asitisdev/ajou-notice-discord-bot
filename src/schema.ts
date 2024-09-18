import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const discordBotTable = sqliteTable('discord_bot', {
	webhook: text('webhook').notNull().primaryKey(),
	latestId: integer('latest_id').notNull(),
	queryParams: text('query_params').notNull(),
});

export type InsertDiscordBot = typeof discordBotTable.$inferInsert;
export type SelectDiscordBot = typeof discordBotTable.$inferSelect;
