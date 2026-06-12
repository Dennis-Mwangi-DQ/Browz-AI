-- Browz no-show reduction migration.
-- Safe to run after supabase/schema.sql on an existing prototype database.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS no_show_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_flag text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS no_show_flag_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_flag_lifted_at timestamptz;

UPDATE clients SET no_show_count = 0 WHERE no_show_count IS NULL;
UPDATE clients SET no_show_flag = 'none' WHERE no_show_flag IS NULL;

DO $$
BEGIN
  ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_no_show_flag_check;
  ALTER TABLE clients
    ADD CONSTRAINT clients_no_show_flag_check
    CHECK (no_show_flag IN ('none', 'active', 'lifted'));
END $$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reconfirmation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconfirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconfirmation_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS reconfirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_in_recorded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_forfeited boolean DEFAULT false;

UPDATE bookings SET reconfirmation_status = 'pending' WHERE reconfirmation_status IS NULL;
UPDATE bookings SET check_in_recorded = false WHERE check_in_recorded IS NULL;
UPDATE bookings SET deposit_forfeited = false WHERE deposit_forfeited IS NULL;

DO $$
BEGIN
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('confirmed','modified','cancelled','pending_payment','completed','no_show_risk','no_show'));

  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN ('unpaid','link_sent','deposit_paid','paid','forfeited'));

  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_reconfirmation_status_check;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_reconfirmation_status_check
    CHECK (reconfirmation_status IN ('pending','confirmed','no_response','not_required'));
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_reconfirmation_deadline
  ON bookings(reconfirmation_deadline);

CREATE TABLE IF NOT EXISTS reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  client_id uuid REFERENCES clients(id) NULL,
  channel text CHECK (channel IN ('whatsapp', 'web', 'both')),
  reminder_type text CHECK (reminder_type IN ('reminder', 'reconfirmation_nudge', 'no_show_followup')),
  sent_at timestamptz NOT NULL,
  delivered boolean DEFAULT false,
  response text,
  responded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_booking ON reminder_log(booking_id);

CREATE TABLE IF NOT EXISTS no_show_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  client_id uuid REFERENCES clients(id) NULL,
  visitor_contact text,
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  appointment_time timestamptz NOT NULL,
  reconfirmation_status text,
  deposit_amount_aed numeric(8,2) DEFAULT 0,
  deposit_forfeited boolean DEFAULT false,
  flag_triggered boolean DEFAULT false,
  no_show_count_at_event integer,
  follow_up_sent boolean DEFAULT false,
  follow_up_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_show_log_client ON no_show_log(client_id);
CREATE INDEX IF NOT EXISTS idx_no_show_log_booking ON no_show_log(booking_id);
