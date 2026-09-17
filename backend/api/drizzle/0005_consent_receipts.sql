CREATE TABLE "consent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thought_id" uuid NOT NULL,
	"receipt_id" text NOT NULL,
	"purpose" text NOT NULL,
	"consent_version" integer NOT NULL,
	"attestation" text,
	"result_hash" text NOT NULL,
	"network" text NOT NULL,
	"program_id" text NOT NULL,
	"account_address" text,
	"tx_signature" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_receipts" ADD CONSTRAINT "consent_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_receipts" ADD CONSTRAINT "consent_receipts_thought_id_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_receipts_receipt_idx" ON "consent_receipts" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "consent_receipts_user_idx" ON "consent_receipts" USING btree ("user_id","created_at");