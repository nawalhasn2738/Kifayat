CREATE TABLE `category_applicability` (
	`category_id` integer NOT NULL,
	`transaction_type` text NOT NULL,
	PRIMARY KEY(`category_id`, `transaction_type`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "category_applicability_transaction_type_check" CHECK("category_applicability"."transaction_type" in ('income', 'expense', 'transfer'))
);
--> statement-breakpoint
CREATE TEMP TABLE `category_applicability_seed_guard` (
	`valid` integer NOT NULL CHECK (`valid` = 1)
);
--> statement-breakpoint
INSERT INTO `category_applicability_seed_guard` (`valid`)
SELECT CASE
	WHEN (SELECT COUNT(*) FROM `users`) = 0
		AND (SELECT COUNT(*) FROM `categories`) = 0 THEN 1
	WHEN (
		SELECT COUNT(*) FROM `categories`
		WHERE `name` IN (
			'salary', 'freelance', 'groceries', 'fuel', 'utilities',
			'internet_mobile', 'transport', 'healthcare', 'university',
			'family_support', 'charity', 'food_delivery', 'dine_out',
			'subscriptions', 'online_shopping', 'entertainment', 'personal_care'
		)
	) = 17 THEN 1
	ELSE 0
END;
--> statement-breakpoint
INSERT INTO `category_applicability` (`category_id`, `transaction_type`)
SELECT
	`id`,
	CASE WHEN `name` IN ('salary', 'freelance') THEN 'income' ELSE 'expense' END
FROM `categories`
WHERE `name` IN (
	'salary', 'freelance', 'groceries', 'fuel', 'utilities',
	'internet_mobile', 'transport', 'healthcare', 'university',
	'family_support', 'charity', 'food_delivery', 'dine_out',
	'subscriptions', 'online_shopping', 'entertainment', 'personal_care'
);
--> statement-breakpoint
DROP TABLE `category_applicability_seed_guard`;
