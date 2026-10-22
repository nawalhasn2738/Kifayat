ALTER TABLE `accounts` ADD `archived_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_name_nocase_unique` ON `accounts` (`user_id`,lower("name"));