-- Cancellation Recovery extension schema
-- Run after schema.sql

-- Extend time_slots status values
ALTER TABLE time_slots DROP CONSTRAINT IF EXISTS time_slots_status_check;
ALTER TABLE time_slots
  ADD CONSTRAINT time_slots_status_check
  CHECK (status IN ('available', 'booked', 'blocked', 'hold', 'open_for_walkin', 'unfilled'));

-- No-show booking status (appointment marked absent, slot enters recovery)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed', 'modified', 'cancelled', 'pending_payment', 'completed', 'no_show'));

-- Branch notification configuration
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS waitlist_notification_default text DEFAULT 'whatsapp'
    CHECK (waitlist_notification_default IN ('whatsapp', 'web', 'both')),
  ADD COLUMN IF NOT EXISTS offer_window_minutes integer DEFAULT 15;

-- Waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text NOT NULL,
  service_id text REFERENCES services(id) NOT NULL,
  branch_id text REFERENCES branches(id) NOT NULL,
  preferred_date date,
  preferred_date_range_start date,
  preferred_date_range_end date,
  preferred_time_start time,
  preferred_time_end time,
  preferred_artist_id text REFERENCES artists(id) NULL,
  notification_channel text DEFAULT 'whatsapp'
    CHECK (notification_channel IN ('whatsapp', 'web', 'both')),
  priority integer DEFAULT 0,
  status text DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'offered', 'confirmed', 'declined', 'expired', 'cancelled')),
  offer_sent_at timestamptz,
  offer_expires_at timestamptz,
  offered_slot_id uuid REFERENCES time_slots(id) NULL,
  offered_booking_ref text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_branch_service ON waitlist(branch_id, service_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_offer_expires ON waitlist(offer_expires_at) WHERE status = 'offered';

-- Slot recovery audit log
CREATE TABLE IF NOT EXISTS slot_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  slot_id uuid REFERENCES time_slots(id),
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  cancellation_source text CHECK (cancellation_source IN ('agent', 'staff', 'portal', 'no_show')),
  cancelled_at timestamptz NOT NULL,
  recovery_started_at timestamptz NOT NULL,
  waitlist_candidates_found integer DEFAULT 0,
  offers_sent integer DEFAULT 0,
  offers_declined integer DEFAULT 0,
  offers_expired integer DEFAULT 0,
  outcome text CHECK (outcome IN ('waitlist_filled', 'walkin_filled', 'unfilled', 'staff_assigned')),
  recovered_booking_id text REFERENCES bookings(id) NULL,
  recovery_completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slot_recovery_log_slot ON slot_recovery_log(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_recovery_log_outcome ON slot_recovery_log(outcome);
