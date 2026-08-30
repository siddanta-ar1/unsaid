CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_keys" (
	"thought_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrap_algorithm" text NOT NULL,
	"key_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"bucket" text NOT NULL,
	"provider" text DEFAULT 's3' NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objects_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thought_id" uuid NOT NULL,
	"object_id" uuid,
	"provider_ref" text NOT NULL,
	"model_version" text NOT NULL,
	"safety_notice" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"subject_id" uuid,
	"actor_type" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solana_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thought_id" uuid NOT NULL,
	"network" text NOT NULL,
	"program_id" text NOT NULL,
	"account_address" text,
	"commitment" text NOT NULL,
	"tx_signature" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thoughts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"content_hash" text NOT NULL,
	"encryption_version" smallint NOT NULL,
	"iv" text NOT NULL,
	"algorithm" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"type" text NOT NULL,
	"declared_size" bigint NOT NULL,
	"declared_hash" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_lookup" text NOT NULL,
	"kdf_salt" text NOT NULL,
	"kdf_iterations" integer NOT NULL,
	"kdf_algorithm" text NOT NULL,
	"wrapped_vault_key" text NOT NULL,
	"recovery_salt" text NOT NULL,
	"recovery_iterations" integer NOT NULL,
	"recovery_algorithm" text NOT NULL,
	"recovery_wrapped_vault_key" text NOT NULL,
	"recovery_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_keys" ADD CONSTRAINT "content_keys_thought_id_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_thought_id_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_records" ADD CONSTRAINT "solana_records_thought_id_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_user_scope_idx" ON "consents" USING btree ("user_id","scope");--> statement-breakpoint
CREATE INDEX "security_events_subject_idx" ON "security_events" USING btree ("subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "solana_records_idempotency_idx" ON "solana_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "solana_records_thought_idx" ON "solana_records" USING btree ("thought_id");--> statement-breakpoint
CREATE INDEX "thoughts_user_created_idx" ON "thoughts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upload_intents_user_idx" ON "upload_intents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_lookup_idx" ON "users" USING btree ("account_lookup");