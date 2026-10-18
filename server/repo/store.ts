import { createHash } from 'node:crypto';
import type {
  AgentRun,
  Approval,
  AuditEvent,
  DeliveryTask,
  FulfillmentQuote,
  Mission,
  PaymentOperation,
  PolicyDecision,
  ProductCandidate,
  Proposal,
  ProposalLine,
  Requirement,
  SecurityTestRun,
} from '../../shared/types.js';
import {
  assertTransition,
  MISSION_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  type MissionStatus,
  type PaymentStatus,
  type ProposalStatus,
} from '../../shared/states.js';
import type { Queryable } from '../db/database.js';
import { canonicalJson } from '../planning/hash.js';
import { conflict, DomainError, notFound } from '../domain/errors.js';

// Repository over the relational schema. All status changes are compare-and-set on the expected
// current status (optimistic concurrency) and validated against the lifecycle tables, so two racing
// requests cannot both move an entity forward.

type Row = Record<string, any>;
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString();
const json = (v: unknown) => JSON.stringify(v ?? null);

export const toMission = (r: Row): Mission => ({
  id: r.id,
  title: r.title,
  organization: r.organization,
  narrative: r.narrative,
  budgetCents: r.budget_cents,
  currency: r.currency,
  population: r.population,
  infants: r.infants,
  householdSize: r.household_size,
  coverageDays: r.coverage_days,
  destination: r.destination,
  windowStart: iso(r.window_start)!,
  deadline: iso(r.deadline)!,
  timezone: r.timezone,
  status: r.status,
  version: r.version,
  plannerMode: r.planner_mode,
  catalogSource: r.catalog_source,
  scenarioKey: r.scenario_key,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const toRequirement = (r: Row): Requirement => ({
  id: r.id,
  missionId: r.mission_id,
  category: r.category,
  label: r.label,
  quantity: r.quantity,
  unit: r.unit,
  priority: r.priority,
  spec: r.spec,
  searchQuery: r.search_query,
  rationale: r.rationale,
  basis: r.basis,
});

const toCandidate = (r: Row): ProductCandidate => ({
  id: r.id,
  missionId: r.mission_id,
  requirementId: r.requirement_id,
  provenance: r.provenance,
  sourceProductId: r.source_product_id,
  title: r.title,
  brand: r.brand,
  description: r.description,
  imageUrl: r.image_url,
  buyUrl: r.buy_url,
  merchantDomain: r.merchant_domain,
  priceCents: r.price_cents,
  currency: r.currency,
  listedAvailability: r.listed_availability,
  pack: r.pack,
  attributes: r.attributes,
  specCheck: r.spec_check,
  contentFlags: r.content_flags,
  quarantined: r.quarantined,
  suitability: r.suitability,
  retrievedAt: iso(r.retrieved_at)!,
});

const toQuote = (r: Row): FulfillmentQuote => ({
  id: r.id,
  candidateId: r.candidate_id,
  missionId: r.mission_id,
  simulated: true,
  stockPacks: r.stock_packs,
  unitPriceCents: r.unit_price_cents,
  shippingBaseCents: r.shipping_base_cents,
  shippingPerPackCents: r.shipping_per_pack_cents,
  dispatchAt: iso(r.dispatch_at)!,
  eta: iso(r.eta)!,
  carrier: r.carrier,
  reason: r.reason,
  quotedAt: iso(r.quoted_at)!,
  current: r.current,
});

const toLine = (r: Row): ProposalLine => ({
  id: r.id,
  requirementId: r.requirement_id,
  candidateId: r.candidate_id,
  quoteId: r.quote_id,
  title: r.title,
  merchantDomain: r.merchant_domain,
  provenance: r.provenance,
  quantityPacks: r.quantity_packs,
  unitsCovered: r.units_covered,
  unitPriceCents: r.unit_price_cents,
  lineTotalCents: r.line_total_cents,
  eta: iso(r.eta)!,
});

const toDecision = (r: Row): PolicyDecision => ({
  id: r.id,
  missionId: r.mission_id,
  proposalId: r.proposal_id,
  proposalVersion: r.proposal_version,
  contentHash: r.content_hash,
  stage: r.stage,
  outcome: r.outcome,
  checks: r.checks,
  violations: r.violations,
  warnings: r.warnings,
  engineVersion: r.engine_version,
  evaluatedAt: iso(r.evaluated_at)!,
});

const toApproval = (r: Row): Approval => ({
  id: r.id,
  missionId: r.mission_id,
  proposalId: r.proposal_id,
  proposalVersion: r.proposal_version,
  contentHash: r.content_hash,
  missionVersion: r.mission_version,
  amountCents: r.amount_cents,
  currency: r.currency,
  approverName: r.approver_name,
  statement: r.statement,
  status: r.status,
  invalidatedReason: r.invalidated_reason,
  createdAt: iso(r.created_at)!,
});

export interface PaymentRow extends PaymentOperation {
  createRequestId: string;
  captureRequestId: string;
  attempts: number;
}

const toPayment = (r: Row): PaymentRow => ({
  id: r.id,
  missionId: r.mission_id,
  proposalId: r.proposal_id,
  proposalVersion: r.proposal_version,
  approvalId: r.approval_id,
  status: r.status,
  amountCents: r.amount_cents,
  currency: r.currency,
  provider: r.provider,
  providerEnvironment: r.provider_environment,
  providerOrderId: r.provider_order_id,
  providerCaptureId: r.provider_capture_id,
  providerOrderStatus: r.provider_order_status,
  providerCaptureStatus: r.provider_capture_status,
  providerDebugId: r.provider_debug_id,
  lastError: r.last_error,
  approveUrl: r.approve_url,
  verifiedAt: iso(r.verified_at),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  createRequestId: r.create_request_id,
  captureRequestId: r.capture_request_id,
  attempts: r.attempts,
});

const toTask = (r: Row): DeliveryTask => ({
  id: r.id,
  missionId: r.mission_id,
  proposalId: r.proposal_id,
  proposalVersion: r.proposal_version,
  kind: r.kind,
  label: r.label,
  resource: r.resource,
  startAt: iso(r.start_at)!,
  endAt: iso(r.end_at)!,
  status: r.status,
  dependsOn: r.depends_on,
  lineIds: r.line_ids,
  note: r.note,
  simulated: r.simulated,
});

const toAudit = (r: Row): AuditEvent => ({
  id: Number(r.id),
  missionId: r.mission_id,
  type: r.type,
  actor: r.actor,
  summary: r.summary,
  data: r.data,
  hash: r.hash,
  prevHash: r.prev_hash,
  createdAt: iso(r.created_at)!,
});

export const GENESIS_HASH = '0'.repeat(64);

export function auditHash(
  prevHash: string,
  e: {
    workspaceId: string;
    missionId: string | null;
    type: string;
    actor: string;
    summary: string;
    data: unknown;
    createdAt: string;
  },
): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(e)).digest('hex');
}

export class Store {
  constructor(readonly q: Queryable) {}

  // ---- workspaces -------------------------------------------------------------------
  async createWorkspace(id: string, label: string) {
    await this.q.query<Row>('INSERT INTO workspaces (id, label) VALUES ($1, $2)', [id, label]);
  }
  async workspaceExists(id: string) {
    return (await this.q.query<Row>('SELECT 1 FROM workspaces WHERE id = $1', [id])).length > 0;
  }

  // ---- missions ---------------------------------------------------------------------
  async insertMission(workspaceId: string, m: Mission, interpretation: unknown) {
    await this.q.query<Row>(
      `INSERT INTO missions (id, workspace_id, title, organization, narrative, budget_cents, currency, population, infants,
        household_size, coverage_days, destination, window_start, deadline, timezone, status, version, planner_mode,
        catalog_source, scenario_key, interpretation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        m.id,
        workspaceId,
        m.title,
        m.organization,
        m.narrative,
        m.budgetCents,
        m.currency,
        m.population,
        m.infants,
        m.householdSize,
        m.coverageDays,
        m.destination,
        m.windowStart,
        m.deadline,
        m.timezone,
        m.status,
        m.version,
        m.plannerMode,
        m.catalogSource,
        m.scenarioKey,
        json(interpretation),
      ],
    );
  }

  /** Workspace-scoped read: a mission outside the caller's workspace is indistinguishable from a missing one. */
  async getMission(workspaceId: string, id: string, forUpdate = false): Promise<Mission> {
    const rows = await this.q.query<Row>(
      `SELECT * FROM missions WHERE id = $1 AND workspace_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, workspaceId],
    );
    if (!rows[0]) throw notFound('Mission');
    return toMission(rows[0]);
  }

  async getMissionInterpretation(id: string): Promise<unknown> {
    const rows = await this.q.query<{ interpretation: unknown }>(
      'SELECT interpretation FROM missions WHERE id = $1',
      [id],
    );
    return rows[0]?.interpretation ?? null;
  }

  async workspaceOfMission(id: string): Promise<string | null> {
    const rows = await this.q.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM missions WHERE id = $1',
      [id],
    );
    return rows[0]?.workspace_id ?? null;
  }

  async listMissions(workspaceId: string): Promise<Mission[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM missions WHERE workspace_id = $1 ORDER BY created_at DESC',
        [workspaceId],
      )
    ).map(toMission);
  }

  async setMissionStatus(id: string, from: MissionStatus, to: MissionStatus) {
    if (from === to) return;
    assertTransition('mission', MISSION_TRANSITIONS, from, to);
    const rows = await this.q.query<Row>(
      'UPDATE missions SET status = $3, updated_at = now() WHERE id = $1 AND status = $2 RETURNING id',
      [id, from, to],
    );
    if (!rows[0]) throw conflict(`Mission status changed concurrently (expected ${from})`);
  }

  async updateMissionTerms(
    id: string,
    expectedVersion: number,
    t: Pick<
      Mission,
      | 'title'
      | 'organization'
      | 'narrative'
      | 'budgetCents'
      | 'population'
      | 'infants'
      | 'householdSize'
      | 'coverageDays'
      | 'destination'
      | 'windowStart'
      | 'deadline'
      | 'plannerMode'
    >,
  ): Promise<number> {
    const rows = await this.q.query<{ version: number }>(
      `UPDATE missions SET title=$3, organization=$4, narrative=$5, budget_cents=$6, population=$7, infants=$8, household_size=$9,
         coverage_days=$10, destination=$11, window_start=$12, deadline=$13, planner_mode=$14, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING version`,
      [
        id,
        expectedVersion,
        t.title,
        t.organization,
        t.narrative,
        t.budgetCents,
        t.population,
        t.infants,
        t.householdSize,
        t.coverageDays,
        t.destination,
        t.windowStart,
        t.deadline,
        t.plannerMode,
      ],
    );
    if (!rows[0])
      throw new DomainError(
        'STALE_VERSION',
        'Mission was modified by someone else; reload and retry',
        { expectedVersion },
      );
    return rows[0].version;
  }

  async setCatalogSource(id: string, source: Mission['catalogSource']) {
    await this.q.query<Row>('UPDATE missions SET catalog_source = $2 WHERE id = $1', [id, source]);
  }

  // ---- requirements ------------------------------------------------------------------
  async replaceRequirements(
    missionId: string,
    missionVersion: number,
    reqs: (Requirement & { position: number })[],
  ) {
    await this.q.query<Row>(
      'UPDATE requirements SET active = false WHERE mission_id = $1 AND active',
      [missionId],
    );
    for (const r of reqs) {
      await this.q.query<Row>(
        `INSERT INTO requirements (id, mission_id, mission_version, category, label, quantity, unit, priority, spec, search_query, rationale, basis, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          r.id,
          missionId,
          missionVersion,
          r.category,
          r.label,
          r.quantity,
          r.unit,
          r.priority,
          json(r.spec),
          r.searchQuery,
          r.rationale,
          json(r.basis),
          r.position,
        ],
      );
    }
  }
  async listRequirements(missionId: string): Promise<Requirement[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM requirements WHERE mission_id = $1 AND active ORDER BY position',
        [missionId],
      )
    ).map(toRequirement);
  }
  async requirementsVersion(missionId: string): Promise<number | null> {
    const rows = await this.q.query<{ v: number }>(
      'SELECT max(mission_version) AS v FROM requirements WHERE mission_id = $1 AND active',
      [missionId],
    );
    return rows[0]?.v ?? null;
  }

  // ---- candidates --------------------------------------------------------------------
  async upsertCandidate(c: ProductCandidate, raw: unknown): Promise<ProductCandidate> {
    const rows = await this.q.query<Row>(
      `INSERT INTO product_candidates (id, mission_id, requirement_id, provenance, source_product_id, title, brand, description, image_url,
         buy_url, merchant_domain, price_cents, currency, listed_availability, pack, attributes, spec_check, content_flags, quarantined, suitability, raw, retrieved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (requirement_id, provenance, source_product_id) DO UPDATE SET
         title = EXCLUDED.title, brand = EXCLUDED.brand, description = EXCLUDED.description, image_url = EXCLUDED.image_url,
         buy_url = EXCLUDED.buy_url, merchant_domain = EXCLUDED.merchant_domain, price_cents = EXCLUDED.price_cents,
         currency = EXCLUDED.currency, listed_availability = EXCLUDED.listed_availability, pack = EXCLUDED.pack,
         attributes = EXCLUDED.attributes, spec_check = EXCLUDED.spec_check, content_flags = EXCLUDED.content_flags,
         quarantined = EXCLUDED.quarantined, raw = EXCLUDED.raw, retrieved_at = EXCLUDED.retrieved_at
       RETURNING *`,
      [
        c.id,
        c.missionId,
        c.requirementId,
        c.provenance,
        c.sourceProductId,
        c.title,
        c.brand,
        c.description,
        c.imageUrl,
        c.buyUrl,
        c.merchantDomain,
        c.priceCents,
        c.currency,
        c.listedAvailability,
        json(c.pack),
        json(c.attributes),
        json(c.specCheck),
        json(c.contentFlags),
        c.quarantined,
        json(c.suitability),
        json(raw),
        c.retrievedAt,
      ],
    );
    return toCandidate(rows[0]!);
  }
  async setSuitability(id: string, suitability: ProductCandidate['suitability']) {
    await this.q.query<Row>('UPDATE product_candidates SET suitability = $2 WHERE id = $1', [
      id,
      json(suitability),
    ]);
  }
  async quarantineCandidate(id: string, flags: ProductCandidate['contentFlags']) {
    await this.q.query<Row>(
      'UPDATE product_candidates SET quarantined = true, content_flags = $2 WHERE id = $1',
      [id, json(flags)],
    );
  }
  async listCandidates(missionId: string): Promise<ProductCandidate[]> {
    return (
      await this.q.query<Row>(
        `SELECT c.* FROM product_candidates c JOIN requirements r ON r.id = c.requirement_id
         WHERE c.mission_id = $1 AND r.active ORDER BY r.position, c.price_cents NULLS LAST`,
        [missionId],
      )
    ).map(toCandidate);
  }
  async candidatesByIds(ids: string[]): Promise<ProductCandidate[]> {
    if (ids.length === 0) return [];
    return (
      await this.q.query<Row>('SELECT * FROM product_candidates WHERE id = ANY($1::uuid[])', [ids])
    ).map(toCandidate);
  }

  // ---- quotes ------------------------------------------------------------------------
  async insertQuote(q: FulfillmentQuote) {
    await this.q.query<Row>(
      'UPDATE fulfillment_quotes SET current = false WHERE candidate_id = $1 AND current',
      [q.candidateId],
    );
    await this.q.query<Row>(
      `INSERT INTO fulfillment_quotes (id, mission_id, candidate_id, stock_packs, unit_price_cents, shipping_base_cents, shipping_per_pack_cents,
         dispatch_at, eta, carrier, reason, quoted_at, current) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)`,
      [
        q.id,
        q.missionId,
        q.candidateId,
        q.stockPacks,
        q.unitPriceCents,
        q.shippingBaseCents,
        q.shippingPerPackCents,
        q.dispatchAt,
        q.eta,
        q.carrier,
        q.reason,
        q.quotedAt,
      ],
    );
  }
  async currentQuotes(missionId: string): Promise<Map<string, FulfillmentQuote>> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM fulfillment_quotes WHERE mission_id = $1 AND current',
      [missionId],
    );
    return new Map(rows.map((r) => [r.candidate_id as string, toQuote(r)]));
  }
  async quotesByIds(ids: string[]): Promise<Map<string, FulfillmentQuote>> {
    if (ids.length === 0) return new Map();
    const rows = await this.q.query<Row>(
      'SELECT * FROM fulfillment_quotes WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return new Map(rows.map((r) => [r.id as string, toQuote(r)]));
  }
  async listQuotes(missionId: string): Promise<FulfillmentQuote[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM fulfillment_quotes WHERE mission_id = $1 ORDER BY quoted_at',
        [missionId],
      )
    ).map(toQuote);
  }

  // ---- proposals ---------------------------------------------------------------------
  async nextProposalVersion(missionId: string): Promise<number> {
    const rows = await this.q.query<{ v: number | null }>(
      'SELECT max(version) AS v FROM proposals WHERE mission_id = $1',
      [missionId],
    );
    return (rows[0]?.v ?? 0) + 1;
  }
  async insertProposal(p: Proposal) {
    await this.q.query<Row>(
      `INSERT INTO proposals (id, mission_id, version, status, parent_proposal_id, created_by, planner_mode, rationale, tradeoffs, currency,
         subtotal_cents, shipping_cents, shipping, total_cents, content_hash, gaps, mission_version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [
        p.id,
        p.missionId,
        p.version,
        p.status,
        p.parentProposalId,
        p.createdBy,
        p.plannerMode,
        p.rationale,
        json(p.tradeoffs),
        p.currency,
        p.subtotalCents,
        p.shippingCents,
        json(p.shipping),
        p.totalCents,
        p.contentHash,
        json(p.gaps),
        p.missionVersion,
        p.createdAt,
      ],
    );
    let pos = 0;
    for (const l of p.lines) {
      await this.q.query<Row>(
        `INSERT INTO proposal_lines (id, proposal_id, requirement_id, candidate_id, quote_id, title, merchant_domain, provenance, quantity_packs,
           units_covered, unit_price_cents, line_total_cents, eta, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          l.id,
          p.id,
          l.requirementId,
          l.candidateId,
          l.quoteId,
          l.title,
          l.merchantDomain,
          l.provenance,
          l.quantityPacks,
          l.unitsCovered,
          l.unitPriceCents,
          l.lineTotalCents,
          l.eta,
          pos++,
        ],
      );
    }
  }
  private async hydrate(rows: Row[]): Promise<Proposal[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    const lines = await this.q.query<Row>(
      'SELECT * FROM proposal_lines WHERE proposal_id = ANY($1::uuid[]) ORDER BY position',
      [ids],
    );
    const decisions = await this.q.query<Row>(
      `SELECT DISTINCT ON (proposal_id) * FROM policy_decisions WHERE proposal_id = ANY($1::uuid[]) ORDER BY proposal_id, evaluated_at DESC`,
      [ids],
    );
    return rows.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      version: r.version,
      status: r.status,
      parentProposalId: r.parent_proposal_id,
      createdBy: r.created_by,
      plannerMode: r.planner_mode,
      rationale: r.rationale,
      tradeoffs: r.tradeoffs,
      currency: r.currency,
      subtotalCents: r.subtotal_cents,
      shippingCents: r.shipping_cents,
      shipping: r.shipping,
      totalCents: r.total_cents,
      contentHash: r.content_hash,
      missionVersion: r.mission_version,
      lines: lines.filter((l) => l.proposal_id === r.id).map(toLine),
      gaps: r.gaps,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      latestDecision: decisions.find((d) => d.proposal_id === r.id)
        ? toDecision(decisions.find((d) => d.proposal_id === r.id)!)
        : null,
    }));
  }
  async getProposal(missionId: string, id: string, forUpdate = false): Promise<Proposal> {
    const rows = await this.q.query<Row>(
      `SELECT * FROM proposals WHERE id = $1 AND mission_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, missionId],
    );
    if (!rows[0]) throw notFound('Proposal');
    return (await this.hydrate(rows))[0]!;
  }
  async missionOfProposal(id: string): Promise<string | null> {
    const rows = await this.q.query<{ mission_id: string }>(
      'SELECT mission_id FROM proposals WHERE id = $1',
      [id],
    );
    return rows[0]?.mission_id ?? null;
  }
  async listProposals(missionId: string): Promise<Proposal[]> {
    return this.hydrate(
      await this.q.query<Row>(
        'SELECT * FROM proposals WHERE mission_id = $1 ORDER BY version DESC',
        [missionId],
      ),
    );
  }
  async setProposalStatus(id: string, from: ProposalStatus, to: ProposalStatus) {
    if (from === to) return;
    assertTransition('proposal', PROPOSAL_TRANSITIONS, from, to);
    const rows = await this.q.query<Row>(
      'UPDATE proposals SET status = $3, row_version = row_version + 1, updated_at = now() WHERE id = $1 AND status = $2 RETURNING id',
      [id, from, to],
    );
    if (!rows[0]) throw conflict(`Proposal status changed concurrently (expected ${from})`);
  }

  // ---- policy decisions --------------------------------------------------------------
  async insertDecision(d: PolicyDecision, context: Record<string, unknown>) {
    await this.q.query<Row>(
      `INSERT INTO policy_decisions (id, mission_id, proposal_id, proposal_version, content_hash, stage, outcome, checks, violations, warnings, engine_version, context, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        d.id,
        d.missionId,
        d.proposalId,
        d.proposalVersion,
        d.contentHash,
        d.stage,
        d.outcome,
        json(d.checks),
        json(d.violations),
        json(d.warnings),
        d.engineVersion,
        json(context),
        d.evaluatedAt,
      ],
    );
  }
  async listDecisions(missionId: string): Promise<PolicyDecision[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM policy_decisions WHERE mission_id = $1 ORDER BY evaluated_at DESC',
        [missionId],
      )
    ).map(toDecision);
  }

  // ---- approvals ---------------------------------------------------------------------
  async insertApproval(a: Approval) {
    await this.q.query<Row>(
      `INSERT INTO approvals (id, mission_id, proposal_id, proposal_version, content_hash, mission_version, amount_cents, currency, approver_name, statement, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        a.id,
        a.missionId,
        a.proposalId,
        a.proposalVersion,
        a.contentHash,
        a.missionVersion,
        a.amountCents,
        a.currency,
        a.approverName,
        a.statement,
        a.status,
        a.createdAt,
      ],
    );
  }
  async getApproval(missionId: string, id: string): Promise<Approval | null> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM approvals WHERE id = $1 AND mission_id = $2',
      [id, missionId],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }
  async activeApproval(proposalId: string): Promise<Approval | null> {
    const rows = await this.q.query<Row>(
      `SELECT * FROM approvals WHERE proposal_id = $1 AND status = 'ACTIVE'`,
      [proposalId],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }
  async listApprovals(missionId: string): Promise<Approval[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM approvals WHERE mission_id = $1 ORDER BY created_at DESC',
        [missionId],
      )
    ).map(toApproval);
  }
  /** Invalidate active approvals; returns the ids that were invalidated. */
  async invalidateApprovals(
    where: { missionId: string; proposalId?: string },
    reason: string,
  ): Promise<string[]> {
    const rows = await this.q.query<{ id: string }>(
      `UPDATE approvals SET status = 'INVALIDATED', invalidated_reason = $3, updated_at = now()
       WHERE mission_id = $1 AND status = 'ACTIVE' AND ($2::uuid IS NULL OR proposal_id = $2::uuid) RETURNING id`,
      [where.missionId, where.proposalId ?? null, reason],
    );
    return rows.map((r) => r.id);
  }
  async consumeApproval(id: string) {
    const rows = await this.q.query<Row>(
      `UPDATE approvals SET status = 'CONSUMED', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
      [id],
    );
    if (!rows[0]) throw conflict('Approval is no longer active');
  }

  // ---- payment operations ------------------------------------------------------------
  async insertPayment(p: PaymentRow) {
    await this.q.query<Row>(
      `INSERT INTO payment_operations (id, mission_id, proposal_id, proposal_version, approval_id, status, amount_cents, currency, provider,
         provider_environment, create_request_id, capture_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        p.id,
        p.missionId,
        p.proposalId,
        p.proposalVersion,
        p.approvalId,
        p.status,
        p.amountCents,
        p.currency,
        p.provider,
        p.providerEnvironment,
        p.createRequestId,
        p.captureRequestId,
      ],
    );
  }
  async getPayment(missionId: string, id: string, forUpdate = false): Promise<PaymentRow> {
    const rows = await this.q.query<Row>(
      `SELECT * FROM payment_operations WHERE id = $1 AND mission_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, missionId],
    );
    if (!rows[0]) throw notFound('Payment operation');
    return toPayment(rows[0]);
  }
  async missionOfPayment(id: string): Promise<string | null> {
    const rows = await this.q.query<{ mission_id: string }>(
      'SELECT mission_id FROM payment_operations WHERE id = $1',
      [id],
    );
    return rows[0]?.mission_id ?? null;
  }
  /** Operations whose outcome is not yet confirmed by PayPal, oldest first, across all missions. */
  async listUnresolvedPayments(notUpdatedSince: Date, limit: number): Promise<PaymentRow[]> {
    return (
      await this.q.query<Row>(
        `SELECT * FROM payment_operations
         WHERE status IN ('UNKNOWN','PROVIDER_PENDING','CAPTURE_PENDING') AND updated_at < $1
         ORDER BY updated_at LIMIT $2`,
        [notUpdatedSince.toISOString(), limit],
      )
    ).map(toPayment);
  }
  async paymentByOrderId(orderId: string): Promise<PaymentRow | null> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM payment_operations WHERE provider_order_id = $1',
      [orderId],
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }
  async listPayments(missionId: string): Promise<PaymentRow[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM payment_operations WHERE mission_id = $1 ORDER BY created_at DESC',
        [missionId],
      )
    ).map(toPayment);
  }
  async updatePayment(
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    patch: Partial<
      Pick<
        PaymentRow,
        | 'providerOrderId'
        | 'providerCaptureId'
        | 'providerOrderStatus'
        | 'providerCaptureStatus'
        | 'providerDebugId'
        | 'approveUrl'
        | 'lastError'
        | 'verifiedAt'
      >
    > & { incrementAttempts?: boolean } = {},
  ) {
    assertTransition('payment', PAYMENT_TRANSITIONS, from, to);
    const rows = await this.q.query<Row>(
      `UPDATE payment_operations SET status = $3,
         provider_order_id = COALESCE($4, provider_order_id),
         provider_capture_id = COALESCE($5, provider_capture_id),
         provider_order_status = COALESCE($6, provider_order_status),
         provider_capture_status = COALESCE($7, provider_capture_status),
         provider_debug_id = COALESCE($8, provider_debug_id),
         approve_url = COALESCE($9, approve_url),
         last_error = CASE WHEN $10::boolean THEN $11::jsonb ELSE last_error END,
         verified_at = COALESCE($12, verified_at),
         attempts = attempts + CASE WHEN $13::boolean THEN 1 ELSE 0 END,
         row_version = row_version + 1, updated_at = now()
       WHERE id = $1 AND status = $2 RETURNING id`,
      [
        id,
        from,
        to,
        patch.providerOrderId ?? null,
        patch.providerCaptureId ?? null,
        patch.providerOrderStatus ?? null,
        patch.providerCaptureStatus ?? null,
        patch.providerDebugId ?? null,
        patch.approveUrl ?? null,
        'lastError' in patch,
        json(patch.lastError ?? null),
        patch.verifiedAt ?? null,
        !!patch.incrementAttempts,
      ],
    );
    if (!rows[0]) throw conflict(`Payment operation changed concurrently (expected ${from})`);
  }

  // ---- delivery tasks ----------------------------------------------------------------
  async replaceTasks(missionId: string, proposalId: string, tasks: DeliveryTask[]) {
    await this.q.query<Row>(
      `UPDATE delivery_tasks SET status = 'SUPERSEDED' WHERE mission_id = $1 AND proposal_id <> $2 AND status <> 'CONFIRMED'`,
      [missionId, proposalId],
    );
    await this.q.query<Row>('DELETE FROM delivery_tasks WHERE proposal_id = $1', [proposalId]);
    for (const t of tasks) {
      await this.q.query<Row>(
        `INSERT INTO delivery_tasks (id, mission_id, proposal_id, proposal_version, kind, label, resource, start_at, end_at, status, depends_on, line_ids, note, simulated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          t.id,
          missionId,
          proposalId,
          t.proposalVersion,
          t.kind,
          t.label,
          t.resource,
          t.startAt,
          t.endAt,
          t.status,
          json(t.dependsOn),
          json(t.lineIds),
          t.note,
          t.simulated,
        ],
      );
    }
  }
  async listTasks(missionId: string): Promise<DeliveryTask[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM delivery_tasks WHERE mission_id = $1 ORDER BY proposal_version DESC, start_at',
        [missionId],
      )
    ).map(toTask);
  }

  // ---- agent runs & security runs ----------------------------------------------------
  async insertAgentRun(r: AgentRun) {
    await this.q.query<Row>(
      `INSERT INTO agent_runs (id, mission_id, role, mode, model, input_summary, output, valid, error, latency_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.id,
        r.missionId,
        r.role,
        r.mode,
        r.model,
        r.inputSummary,
        json(r.output),
        r.valid,
        r.error,
        r.latencyMs,
      ],
    );
  }
  async listAgentRuns(missionId: string): Promise<AgentRun[]> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM agent_runs WHERE mission_id = $1 ORDER BY created_at DESC LIMIT 100',
      [missionId],
    );
    return rows.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      role: r.role,
      mode: r.mode,
      model: r.model,
      inputSummary: r.input_summary,
      output: r.output,
      valid: r.valid,
      error: r.error,
      latencyMs: r.latency_ms,
      createdAt: iso(r.created_at)!,
    }));
  }
  async insertSecurityRun(r: SecurityTestRun) {
    await this.q.query<Row>(
      'INSERT INTO security_test_runs (id, mission_id, suite_version, started_at, finished_at, passed, failed, results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        r.id,
        r.missionId,
        r.suiteVersion,
        r.startedAt,
        r.finishedAt,
        r.passed,
        r.failed,
        json(r.results),
      ],
    );
  }
  async listSecurityRuns(missionId: string): Promise<SecurityTestRun[]> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM security_test_runs WHERE mission_id = $1 ORDER BY started_at DESC LIMIT 20',
      [missionId],
    );
    return rows.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      suiteVersion: r.suite_version,
      startedAt: iso(r.started_at)!,
      finishedAt: iso(r.finished_at)!,
      passed: r.passed,
      failed: r.failed,
      results: r.results,
    }));
  }

  // ---- audit -------------------------------------------------------------------------
  /** Append a hash-chained audit event. Serialised per workspace with a transaction-scoped advisory lock. */
  async audit(e: {
    workspaceId: string;
    missionId: string | null;
    type: string;
    actor: string;
    summary: string;
    data?: Record<string, unknown>;
  }) {
    await this.q.query<Row>('SELECT pg_advisory_xact_lock(hashtext($1))', [e.workspaceId]);
    const prev = await this.q.query<{ hash: string }>(
      'SELECT hash FROM audit_events WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1',
      [e.workspaceId],
    );
    const prevHash = prev[0]?.hash ?? GENESIS_HASH;
    const createdAt = new Date().toISOString();
    const data = e.data ?? {};
    const hash = auditHash(prevHash, {
      workspaceId: e.workspaceId,
      missionId: e.missionId,
      type: e.type,
      actor: e.actor,
      summary: e.summary,
      data,
      createdAt,
    });
    await this.q.query<Row>(
      'INSERT INTO audit_events (workspace_id, mission_id, type, actor, summary, data, prev_hash, hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        e.workspaceId,
        e.missionId,
        e.type,
        e.actor,
        e.summary,
        json(data),
        prevHash,
        hash,
        createdAt,
      ],
    );
  }
  async listAudit(missionId: string): Promise<AuditEvent[]> {
    return (
      await this.q.query<Row>(
        'SELECT * FROM audit_events WHERE mission_id = $1 ORDER BY id DESC LIMIT 500',
        [missionId],
      )
    ).map(toAudit);
  }
  /** Re-derive the workspace's hash chain; returns the first broken event id, or null if intact. */
  async verifyAuditChain(
    workspaceId: string,
  ): Promise<{ intact: boolean; events: number; brokenAt: number | null }> {
    const rows = await this.q.query<Row>(
      'SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY id',
      [workspaceId],
    );
    let prev = GENESIS_HASH;
    for (const r of rows) {
      const expected = auditHash(prev, {
        workspaceId,
        missionId: r.mission_id,
        type: r.type,
        actor: r.actor,
        summary: r.summary,
        data: r.data,
        createdAt: iso(r.created_at)!,
      });
      if (r.prev_hash !== prev || r.hash !== expected)
        return { intact: false, events: rows.length, brokenAt: Number(r.id) };
      prev = r.hash;
    }
    return { intact: true, events: rows.length, brokenAt: null };
  }
}
