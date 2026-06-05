CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE branches (
  id text PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  address text,
  phone text,
  hours jsonb,
  categories text[],
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE artists (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text,
  title text,
  branch_id text REFERENCES branches(id),
  bio text,
  specialities text[],
  qualifications text[],
  years_exp integer,
  avg_rating numeric(3,2),
  review_count integer DEFAULT 0,
  service_ids text[],
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE services (
  id text PRIMARY KEY,
  title text NOT NULL,
  cat text NOT NULL,
  service_tier text NOT NULL DEFAULT 'T1'
    CHECK (service_tier IN ('T1', 'T2', 'T3')),
  city text,
  duration_min integer,
  price_aed numeric(8,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'AED',
  is_featured boolean DEFAULT false,
  tag text,
  rating numeric(3,2),
  review_count integer DEFAULT 0,
  description text,
  sessions_info text,
  maintenance text,
  prep text,
  aftercare text,
  contraindications text[],
  trust_signals text[],
  requires_consultation boolean DEFAULT false,
  requires_patch_test boolean DEFAULT false,
  requires_screening boolean DEFAULT false,
  is_medical_gated boolean DEFAULT false,
  min_frequency_weeks integer,
  frequency_hard_block boolean DEFAULT false,
  complementary_ids text[],
  package_ids text[],
  steps jsonb,
  service_reviews jsonb,
  faq jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE packages (
  id text PRIMARY KEY,
  title text NOT NULL,
  service_ids text[],
  cat text,
  tag text,
  description text,
  session_count integer,
  rebook_weeks integer,
  price_per_session numeric(8,2),
  total_price numeric(8,2),
  single_price numeric(8,2),
  savings_pct integer,
  savings_amount numeric(8,2),
  currency text DEFAULT 'AED',
  validity text,
  includes text[],
  requires_consultation boolean DEFAULT false,
  sessions jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE,
  phone text UNIQUE,
  tier text DEFAULT 'STANDARD',
  auth_user_id uuid UNIQUE,
  preferences text,
  skin_notes text,
  allergies text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id text REFERENCES branches(id) ON DELETE CASCADE,
  service_id text REFERENCES services(id) ON DELETE CASCADE,
  artist_id text REFERENCES artists(id),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'available'
    CHECK (status IN ('available', 'booked', 'blocked')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_time_slots_branch_service_date
  ON time_slots (branch_id, service_id, DATE(start_time));
CREATE INDEX idx_time_slots_status ON time_slots (status);

CREATE TABLE bookings (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  slot_id uuid REFERENCES time_slots(id),
  artist_id text REFERENCES artists(id) NULL,
  status text DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','modified','cancelled','pending_payment','completed')),
  notes text,
  booking_type text DEFAULT 'single'
    CHECK (booking_type IN ('single','consultation','package_first_session')),
  payment_type text DEFAULT 'full_upfront'
    CHECK (payment_type IN ('full_upfront','deposit','package','free')),
  deposit_amount_aed numeric(8,2) DEFAULT 0,
  balance_due_aed numeric(8,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','link_sent','deposit_paid','paid')),
  payment_link text,
  screening_ref text,
  clearance_ref text,
  consent_status text DEFAULT 'not_required'
    CHECK (consent_status IN ('not_required','pending','signed')),
  channel text CHECK (channel IN ('web','whatsapp')),
  booking_source text DEFAULT 'ai_concierge',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_status ON bookings(status);

CREATE TABLE spmu_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NULL,
  visitor_contact text,
  service_category text NOT NULL,
  consultation_booking_id text REFERENCES bookings(id) NULL,
  patch_test_done boolean DEFAULT false,
  patch_test_cleared boolean DEFAULT false,
  cleared_at timestamptz,
  valid_until timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE medical_screenings (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_category text NOT NULL,
  answers jsonb NOT NULL,
  flagged_questions text[] DEFAULT '{}',
  status text DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','FLAGGED','EXPIRED','DECLINED','NEEDS_INFO')),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_until timestamptz,
  reviewer_note text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE consultation_requests (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_id text REFERENCES services(id),
  service_category text,
  branch_id text REFERENCES branches(id),
  slot_id uuid REFERENCES time_slots(id) NULL,
  status text DEFAULT 'booked'
    CHECK (status IN ('booked','completed','no_show','cancelled')),
  patch_test_done boolean DEFAULT false,
  patch_test_cleared boolean DEFAULT false,
  clearance_valid_until timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text CHECK (channel IN ('web','whatsapp')),
  user_tier text CHECK (user_tier IN ('visitor','client')),
  client_id uuid REFERENCES clients(id) NULL,
  whatsapp_number text,
  conversation_history jsonb DEFAULT '[]',
  screening_state jsonb,
  last_intent text,
  last_booking_ref text,
  agent_context jsonb,
  status text DEFAULT 'active'
    CHECK (status IN ('active','escalated','closed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_sessions_whatsapp ON sessions(whatsapp_number);
CREATE INDEX idx_sessions_client ON sessions(client_id);

CREATE TABLE agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id),
  turn integer,
  channel text,
  user_message text,
  intent text,
  confidence numeric(4,3),
  entities_extracted jsonb,
  tool_called text,
  tool_result jsonb,
  agent_response text,
  latency_ms integer,
  escalated boolean DEFAULT false,
  timestamp timestamptz DEFAULT now()
);

CREATE INDEX idx_agent_logs_session ON agent_logs(session_id);

CREATE TABLE screening_questions (
  id text PRIMARY KEY,
  question text NOT NULL,
  type text DEFAULT 'yesno',
  has_follow_up boolean DEFAULT false,
  follow_up_placeholder text,
  blocks_if_yes boolean DEFAULT false,
  review_if_yes boolean DEFAULT false,
  caution_if_yes boolean DEFAULT false,
  sort_order integer
);

CREATE TABLE faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_faqs_embedding
  ON faqs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

CREATE TABLE products (
  id text PRIMARY KEY,
  title text NOT NULL,
  brand text,
  price_aed numeric(8,2),
  currency text DEFAULT 'AED',
  cat text,
  tag text,
  description text,
  stock integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION match_faqs (
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.72,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  question text,
  answer text,
  category text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    faqs.id,
    faqs.question,
    faqs.answer,
    faqs.category,
    1 - (faqs.embedding <=> query_embedding) AS similarity
  FROM faqs
  WHERE 1 - (faqs.embedding <=> query_embedding) > match_threshold
  ORDER BY faqs.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
