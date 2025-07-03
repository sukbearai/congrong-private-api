CREATE TABLE `products_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`checked_img` text NOT NULL,
	`unchecked_img` text NOT NULL,
	`device_ids` text NOT NULL,
	`constitutions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
