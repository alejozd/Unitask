CREATE TABLE `sync_log` (
	`entity_table` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`entity_table`, `entity_id`)
);
--> statement-breakpoint
ALTER TABLE `semesters` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `subtasks` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `subtasks` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `attachments` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `attachments` ADD `synced_at` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `sync_email` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `sync_cursor` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `last_sync_at` integer;