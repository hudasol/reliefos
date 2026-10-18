import type { Database } from './database.js';

// Ordered, append-only migrations. Never edit an applied migration; add a new one.
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '0001_core_schema',
    sql: `
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE missions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  organization text NOT NULL,
  narrative text NOT NULL,
  budget_cents integer NOT NULL CHECK (budget_cents > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  population integer NOT NULL CHECK (population > 0),
  infants integer NOT NULL CHECK (infants >= 0),
  household_size integer NOT NULL CHECK (household_size > 0),
  coverage_days integer NOT NULL CHECK (coverage_days BETWEEN 1 AND 14),
  destination text NOT NULL,
  window_start timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  planner_mode text NOT NULL,
  catalog_source text NOT NULL,
  scenario_key text,
  interpretation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deadline > window_start)
);
CREATE INDEX missions_workspace_idx ON missions(workspace_id, created_at DESC);

CREATE TABLE requirements (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  mission_version integer NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('critical','high','standard')),
  spec jsonb NOT NULL,
  search_query text NOT NULL,
  rationale text NOT NULL,
  basis jsonb NOT NULL,
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX requirements_mission_idx ON requirements(mission_id) WHERE active;

CREATE TABLE product_candidates (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  provenance text NOT NULL CHECK (provenance IN ('channel3','fixture','simulated-adversarial')),
  source_product_id text NOT NULL,
  title text NOT NULL,
  brand text,
  description text,
  image_url text,
  buy_url text,
  merchant_domain text,
  price_cents integer,
  currency text NOT NULL,
  listed_availability text,
  pack jsonb NOT NULL,
  attributes jsonb NOT NULL,
  spec_check jsonb NOT NULL,
  content_flags jsonb NOT NULL,
  quarantined boolean NOT NULL,
  suitability jsonb,
  raw jsonb,
  retrieved_at timestamptz NOT NULL,
  UNIQUE (requirement_id, provenance, source_product_id)
);
CREATE INDEX candidates_mission_idx ON product_candidates(mission_id);

CREATE TABLE fulfillment_quotes (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES product_candidates(id) ON DELETE CASCADE,
  stock_packs integer NOT NULL CHECK (stock_packs >= 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  shipping_base_cents integer NOT NULL CHECK (shipping_base_cents >= 0),
  shipping_per_pack_cents integer NOT NULL CHECK (shipping_per_pack_cents >= 0),
  dispatch_at timestamptz NOT NULL,
  eta timestamptz NOT NULL,
  carrier text NOT NULL,
  reason text NOT NULL,
  quoted_at timestamptz NOT NULL DEFAULT now(),
  current boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX quotes_one_current_idx ON fulfillment_quotes(candidate_id) WHERE current;

CREATE TABLE proposals (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL,
  parent_proposal_id uuid REFERENCES proposals(id),
  created_by text NOT NULL,
  planner_mode text NOT NULL,
  rationale text NOT NULL,
  tradeoffs jsonb NOT NULL,
  currency text NOT NULL,
  subtotal_cents integer NOT NULL,
  shipping_cents integer NOT NULL,
  shipping jsonb NOT NULL,
  total_cents integer NOT NULL,
  content_hash text NOT NULL,
  gaps jsonb NOT NULL,
  mission_version integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, version)
);

CREATE TABLE proposal_lines (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  candidate_id uuid NOT NULL REFERENCES product_candidates(id),
  quote_id uuid NOT NULL REFERENCES fulfillment_quotes(id),
  title text NOT NULL,
  merchant_domain text NOT NULL,
  provenance text NOT NULL,
  quantity_packs integer NOT NULL CHECK (quantity_packs > 0),
  units_covered integer NOT NULL CHECK (units_covered > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
  eta timestamptz NOT NULL,
  position integer NOT NULL
);
CREATE INDEX proposal_lines_proposal_idx ON proposal_lines(proposal_id);

CREATE TABLE policy_decisions (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL,
  content_hash text NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ALLOW','DENY')),
  checks jsonb NOT NULL,
  violations jsonb NOT NULL,
  warnings jsonb NOT NULL,
  engine_version text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policy_decisions_proposal_idx ON policy_decisions(proposal_id, evaluated_at DESC);

CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL,
  content_hash text NOT NULL,
  mission_version integer NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  approver_name text NOT NULL,
  statement text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','INVALIDATED')),
  invalidated_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approvals_one_active_idx ON approvals(proposal_id) WHERE status = 'ACTIVE';

CREATE TABLE payment_operations (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  proposal_version integer NOT NULL,
  approval_id uuid NOT NULL REFERENCES approvals(id),
  status text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL,
  provider text NOT NULL,
  provider_environment text NOT NULL,
  create_request_id text NOT NULL UNIQUE,
  capture_request_id text NOT NULL UNIQUE,
  provider_order_id text UNIQUE,
  provider_capture_id text,
  provider_order_status text,
  provider_capture_status text,
  provider_debug_id text,
  approve_url text,
  last_error jsonb,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live (or completed) payment operation per proposal: the database itself refuses a
-- duplicate purchase, independent of application checks.
CREATE UNIQUE INDEX payment_ops_one_live_idx ON payment_operations(proposal_id)
  WHERE status NOT IN ('FAILED','CANCELLED');
CREATE INDEX payment_ops_mission_idx ON payment_operations(mission_id);

CREATE TABLE delivery_tasks (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  proposal_version integer NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  resource text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL,
  depends_on jsonb NOT NULL,
  line_ids jsonb NOT NULL,
  note text,
  simulated boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at >= start_at)
);
CREATE INDEX delivery_tasks_mission_idx ON delivery_tasks(mission_id);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  role text NOT NULL,
  mode text NOT NULL,
  model text,
  input_summary text NOT NULL,
  output jsonb,
  valid boolean NOT NULL,
  error text,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_mission_idx ON agent_runs(mission_id, created_at DESC);

CREATE TABLE security_test_runs (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  suite_version text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  passed integer NOT NULL,
  failed integer NOT NULL,
  results jsonb NOT NULL
);
CREATE INDEX security_runs_mission_idx ON security_test_runs(mission_id, started_at DESC);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  mission_id uuid,
  type text NOT NULL,
  actor text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_mission_idx ON audit_events(mission_id, id);

-- The audit log is append-only. Updates and deletes are rejected by the database.
CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
`,
  },
  {
    // Make a workspace (and everything it owns) deletable in one statement. Needed to clean up
    // Security Lab sandboxes; audit_events deliberately keep no foreign keys and remain append-only.
    id: '0002_cascading_ownership',
    sql: `
ALTER TABLE proposal_lines DROP CONSTRAINT proposal_lines_requirement_id_fkey,
  ADD CONSTRAINT proposal_lines_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE;
ALTER TABLE proposal_lines DROP CONSTRAINT proposal_lines_candidate_id_fkey,
  ADD CONSTRAINT proposal_lines_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES product_candidates(id) ON DELETE CASCADE;
ALTER TABLE proposal_lines DROP CONSTRAINT proposal_lines_quote_id_fkey,
  ADD CONSTRAINT proposal_lines_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES fulfillment_quotes(id) ON DELETE CASCADE;
ALTER TABLE proposals DROP CONSTRAINT proposals_parent_proposal_id_fkey,
  ADD CONSTRAINT proposals_parent_proposal_id_fkey FOREIGN KEY (parent_proposal_id) REFERENCES proposals(id) ON DELETE SET NULL;
ALTER TABLE payment_operations DROP CONSTRAINT payment_operations_proposal_id_fkey,
  ADD CONSTRAINT payment_operations_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;
ALTER TABLE payment_operations DROP CONSTRAINT payment_operations_approval_id_fkey,
  ADD CONSTRAINT payment_operations_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE;
`,
  },
];

export async function migrate(db: Database): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const appliedRows = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.id));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.tx(async (q) => {
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    ran.push(m.id);
  }
  return ran;
}
