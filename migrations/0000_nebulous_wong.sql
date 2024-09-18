CREATE TABLE `discord_bot` (
	`webhook` text PRIMARY KEY NOT NULL,
	`latest_id` integer NOT NULL,
	`query_params` text NOT NULL
);
