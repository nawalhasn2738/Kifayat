CREATE TABLE `opening_balance_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`previous_opening_balance` integer,
	`new_opening_balance` integer NOT NULL,
	`change_kind` text NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "opening_balance_audit_kind_check" CHECK("opening_balance_audit"."change_kind" in ('confirmation', 'correction'))
);
--> statement-breakpoint
CREATE INDEX `opening_balance_audit_account_changed_idx` ON `opening_balance_audit` (`account_id`,`changed_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `opening_balance` integer;