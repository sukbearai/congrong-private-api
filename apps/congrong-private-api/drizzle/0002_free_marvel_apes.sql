ALTER TABLE `users_table` ADD `password` text;--> statement-breakpoint
ALTER TABLE `users_table` ADD `role` text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users_table` ADD `deviceIds` text DEFAULT '[]';