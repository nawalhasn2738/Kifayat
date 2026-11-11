CREATE TABLE `financial_history_start_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`previous_started_at` text,
	`new_started_at` text NOT NULL,
	`change_kind` text NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `financial_history_start_audit_user_changed_idx` ON `financial_history_start_audit` (`user_id`,`changed_at`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `financial_history_started_at` text;