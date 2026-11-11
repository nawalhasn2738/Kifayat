CREATE TABLE `transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`source_account_id` integer NOT NULL,
	`destination_account_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfers_distinct_accounts_check" CHECK("transfers"."source_account_id" <> "transfers"."destination_account_id"),
	CONSTRAINT "transfers_amount_check" CHECK("transfers"."amount" > 0 and "transfers"."amount" <= 2147483647)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_user_client_unique` ON `transfers` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `transfers_user_date_idx` ON `transfers` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `transfers_source_account_idx` ON `transfers` (`source_account_id`);--> statement-breakpoint
CREATE INDEX `transfers_destination_account_idx` ON `transfers` (`destination_account_id`);