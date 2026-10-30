CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`family_id` text,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Taipei' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_calendars_single_owner" CHECK(("calendars"."owner_user_id" IS NOT NULL AND "calendars"."family_id" IS NULL) OR ("calendars"."owner_user_id" IS NULL AND "calendars"."family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_calendars_owner_user_id` ON `calendars` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_calendars_family_id` ON `calendars` (`family_id`);--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`family_id` text,
	`timezone` text DEFAULT 'Asia/Taipei' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_chat_rooms_kind_owner" CHECK(("chat_rooms"."kind" = 'personal' AND "chat_rooms"."user_id" IS NOT NULL AND "chat_rooms"."family_id" IS NULL) OR ("chat_rooms"."kind" = 'family' AND "chat_rooms"."user_id" IS NULL AND "chat_rooms"."family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_rooms_user_id` ON `chat_rooms` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_rooms_family_id` ON `chat_rooms` (`family_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`sender_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`local_date` text NOT NULL,
	`record_date` text,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_room_date_created` ON `messages` (`room_id`,`local_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_messages_room_created` ON `messages` (`room_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `diaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_diaries_user_entry_date` ON `diaries` (`user_id`,`entry_date`);--> statement-breakpoint
CREATE TABLE `ledgers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`family_id` text,
	`name` text NOT NULL,
	`currency` text DEFAULT 'TWD' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_ledgers_single_owner" CHECK(("ledgers"."owner_user_id" IS NOT NULL AND "ledgers"."family_id" IS NULL) OR ("ledgers"."owner_user_id" IS NULL AND "ledgers"."family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledgers_owner_user_id` ON `ledgers` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledgers_family_id` ON `ledgers` (`family_id`);--> statement-breakpoint
CREATE TABLE `task_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`family_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_task_lists_single_owner" CHECK(("task_lists"."owner_user_id" IS NOT NULL AND "task_lists"."family_id" IS NULL) OR ("task_lists"."owner_user_id" IS NULL AND "task_lists"."family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_lists_owner_user_id` ON `task_lists` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_lists_family_id` ON `task_lists` (`family_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'Asia/Taipei' NOT NULL,
	`source_message_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_events_calendar_id` ON `events` (`calendar_id`);--> statement-breakpoint
CREATE INDEX `idx_events_source_message_id` ON `events` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`completed_at` text,
	`source_message_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `task_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_list_id` ON `tasks` (`list_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_source_message_id` ON `tasks` (`source_message_id`);
