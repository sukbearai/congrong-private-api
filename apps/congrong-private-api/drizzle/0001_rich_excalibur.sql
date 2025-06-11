CREATE TABLE `snapshoot_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`indexPrice` text NOT NULL,
	`markPrice` text NOT NULL,
	`topTraderAccountLsRatio` text NOT NULL,
	`openInterest` text NOT NULL,
	`timestamp` integer NOT NULL,
	`oiChangePctPositive` real NOT NULL,
	`basisPercentNegative` real NOT NULL,
	`signal` text NOT NULL
);
