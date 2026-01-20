CREATE TABLE `words_count` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_words_count` integer NOT NULL,
	`server_words_count` integer,
	`download_url` text,
	`create_time` text,
	`order_id` text
);
