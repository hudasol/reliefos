import { useEffect, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import type { MissionSummary, PolicyDecision } from '../../../../shared/types';

// Custom AG Studio widgets for RELIEFOS. They read their measure through Studio's data engine
// (widgetApi.getData), so page filters and cross-filters apply, and read authoritative mission
// context (budget, committed spend, latest policy decision) passed in from the server.

export interface StudioContext {
  summary: MissionSummary;
  decision: PolicyDecision | null;
  proposalVersion: number | null;
}

const usd = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

function firstNumber(rows: Record<string, unknown>[] | undefined): number | null {
  const row = rows?.[0];
  if (!row) return null;
  const v = Object.values(row).find((x) => typeof x === 'number');
  return typeof v === 'number' ? v : null;
}

function useMeasure(props: AgWidgetParams<any>) {
  const { widgetApi, dataMapping } = props;
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fieldsMapped = (dataMapping as { value?: unknown[] })?.value;
    if (!fieldsMapped?.length) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    widgetApi.setDisplayState('loading', { prominent: false });
    widgetApi
      .getData({ fields: fieldsMapped as never })
      .then((res) => {
        if (cancelled) return;
        const v = firstNumber((res.results as { rows?: Record<string, unknown>[] }).rows);
        setValue(v);
        widgetApi.setDisplayState(v === null ? 'noData' : 'displayed');
      })
      .catch(() => !cancelled && widgetApi.setDisplayState('noData'));
    return () => {
      cancelled = true;
    };
  }, [widgetApi, dataMapping]);
  return value;
}

/** Spend against the mission's hard authority: paid, in flight, planned and headroom. */
function AuthorityWidget(props: AgWidgetParams<any>) {
  const planned = useMeasure(props) ?? 0;
  const ctx = props.context as StudioContext | undefined;
  if (!ctx) return null;
  const budget = ctx.summary.budgetCents / 100;
  const paid = ctx.summary.committedCents / 100;
  const pending = ctx.summary.pendingCents / 100;
  const headroom = budget - paid - pending - planned;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / budget) * 100))}%`;
  const over = headroom < 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        justifyContent: 'center',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 600, color: over ? '#b1261b' : '#17202c' }}>
          {usd(Math.abs(headroom))}
        </span>
        <span style={{ color: '#7a818c', fontSize: 13 }}>
          {over ? 'over authority' : 'headroom of ' + usd(budget)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          height: 12,
          borderRadius: 6,
          overflow: 'hidden',
          background: '#f0ede6',
        }}
        role="img"
        aria-label="Budget authority usage"
      >
        <span style={{ width: pct(paid), background: '#1d7347' }} />
        <span style={{ width: pct(pending), background: '#9a5b0c' }} />
        <span style={{ width: pct(planned), background: over ? '#b1261b' : '#2459c4' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#4b5462', flexWrap: 'wrap' }}>
        <span>Paid {usd(paid)}</span>
        <span>In flight {usd(pending)}</span>
        <span>Planned (filtered) {usd(planned)}</span>
      </div>
    </div>
  );
}

/** The latest DEADMAN decision on the current proposal. */
function GateWidget(props: AgWidgetParams<any>) {
  const ctx = props.context as StudioContext | undefined;
  useEffect(() => {
    props.widgetApi.setDisplayState(ctx?.decision ? 'displayed' : 'noData');
  }, [ctx?.decision, props.widgetApi]);
  const d = ctx?.decision;
  if (!d) return null;
  const deny = d.outcome === 'DENY';
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 12,
            background: deny ? '#fbe9e7' : '#e5f3ea',
            color: deny ? '#b1261b' : '#1d7347',
          }}
        >
          {deny ? 'DENIED' : 'ALLOWED'}
        </span>
        <span style={{ fontSize: 13, color: '#4b5462' }}>
          v{ctx?.proposalVersion} · {d.stage} · {d.checks.filter((c) => c.passed).length}/
          {d.checks.length} checks passed
        </span>
      </div>
      {(deny ? d.violations : d.warnings.slice(0, 4)).map((v, i) => (
        <div key={i} style={{ fontSize: 12.5, lineHeight: 1.4 }}>
          <code style={{ fontSize: 11, color: deny ? '#b1261b' : '#9a5b0c' }}>{v.checkId}</code>{' '}
          {v.message}
        </div>
      ))}
    </div>
  );
}

const icon = (color: string) => ({
  url: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.3 8.3-8 9-4.7-.7-8-4.5-8-9V6z" fill="${color}"/></svg>`)}`,
});

export const authorityWidgetDefinition = {
  id: 'relief-authority',
  label: 'Budget authority',
  icon: icon('#2459c4'),
  dataMapping: {
    value: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      required: true,
    },
  },
  form: (params: { createDefaults: (o: unknown) => unknown }) =>
    params.createDefaults({ dataMappingItems: [{ key: 'value', label: 'Planned spend' }] }),
  comp: AuthorityWidget,
  defaultSize: { width: 420, height: 160 },
  minSize: { width: 260, height: 120 },
};

export const gateWidgetDefinition = {
  id: 'relief-gate',
  label: 'Policy gate verdict',
  icon: icon('#1d7347'),
  dataMapping: {},
  form: (params: { createDefaults: (o: unknown) => unknown }) =>
    params.createDefaults({ dataMappingItems: [] }),
  comp: GateWidget,
  defaultSize: { width: 420, height: 200 },
  minSize: { width: 260, height: 140 },
};
