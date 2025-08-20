CREATE TABLE `announcement_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`wechatUrl` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
