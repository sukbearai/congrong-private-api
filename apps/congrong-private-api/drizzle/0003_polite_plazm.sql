PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nickname` text NOT NULL,
	`phone` text NOT NULL,
	`password` text,
	`role` text DEFAULT 'user',
	`deviceIds` text
);
--> statement-breakpoint
INSERT INTO `__new_users_table`("id", "nickname", "phone", "password", "role", "deviceIds") SELECT "id", "nickname", "phone", "password", "role", "deviceIds" FROM `users_table`;--> statement-breakpoint
DROP TABLE `users_table`;--> statement-breakpoint
ALTER TABLE `__new_users_table` RENAME TO `users_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;