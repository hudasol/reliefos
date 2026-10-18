import { useState } from 'react';
import { useParams } from 'react-router';
import { useCandidates, useMission } from '../api/hooks';
import type { CandidateView } from '../api/types';
import { Badge, Callout, Panel, ProvenanceTag, QueryView, SimTag } from '../components/ui';
import { IconExternal } from '../components/icons';
import { clock, dateTime, usd } from '../lib/format';

type Filter = 'all' | 'eligible' | 'excluded' | 'flagged';

function ProductRow({ c, unit, tz }: { c: CandidateView; unit: string; tz: string }) {
  return (
    <div className={`product${c.eligible ? '' : ' excluded'}`}>
      {c.imageUrl?.startsWith('https://') ? (
        <img className="thumb" src={c.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ objectFit: 'contain', background: '#fff' }} />
      ) : (
        <div className="thumb" aria-hidden="true">
          no image
        </div>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <div className="row wrap">
          <span className="ptitle">{c.title}</span>
          <ProvenanceTag p={c.provenance} />
          {c.selectedInActive && <Badge tone="accent">In current plan</Badge>}
          {c.quarantined && <Badge tone="danger">Quarantined</Badge>}
          {c.suitability && <Badge tone="neutral" plain>Agent rank score {c.suitability.score}</Badge>}
        </div>
        <dl className="kv">
          <dt>Merchant</dt>
          <dd>
            {c.merchantDomain ?? '—'}
            {c.brand && <span className="muted"> · {c.brand}</span>}
          </dd>
          <dt>Listed price</dt>
          <dd>
            {usd(c.priceCents)} <span className="muted">· source {c.provenance} · retrieved {dateTime(c.retrievedAt, tz)}</span>
          </dd>
          <dt>Pack size</dt>
          <dd>
            {c.pack.unitsPerPack ? (
              <>
                {c.pack.unitsPerPack} {unit} per pack · evidence <span className="quote">{c.pack.evidence}</span> <span className="muted">({c.pack.basis})</span>
              </>
            ) : (
              <span style={{ color: 'var(--danger)' }}>Not established from listing text</span>
            )}
          </dd>
          {c.costPerUnitCents != null && (
            <>
              <dt>Delivered cost</dt>
              <dd>
                {usd(c.costPerUnitCents)} per {unit.replace(/s$/, '')}
              </dd>
            </>
          )}
          {c.quote && (
            <>
              <dt>Supplier commitment</dt>
              <dd>
                <SimTag /> {c.quote.stockPacks} packs in stock · ETA {clock(c.quote.eta, tz)} · courier {usd(c.quote.shippingBaseCents)} + {usd(c.quote.shippingPerPackCents)}/pack
                {c.quote.reason.startsWith('SIMULATED market event') && <div className="small" style={{ color: 'var(--warn)' }}>{c.quote.reason}</div>}
              </dd>
            </>
          )}
        </dl>
        {c.contentFlags.length > 0 && (
          <Callout tone="danger" title="Untrusted content flagged">
            <ul>
              {c.contentFlags.map((f, i) => (
                <li key={i} className="small">
                  <span className="mono">{f.rule}</span> in {f.field}: <span className="quote">{f.excerpt}</span>
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {!c.eligible && (
          <div className="small">
            <span className="strong">Excluded: </span>
            {c.exclusionReasons.join(' · ')}
          </div>
        )}
        {c.suitability?.notes && c.suitability.score === 100 && <div className="small text-2">Agent rationale: {c.suitability.notes}</div>}
      </div>
      <div className="stack" style={{ alignItems: 'flex-end' }}>
        <Badge tone={c.eligible ? 'ok' : 'neutral'}>{c.eligible ? 'Eligible' : 'Excluded'}</Badge>
        {c.buyUrl && (
          <a href={c.buyUrl} target="_blank" rel="noopener noreferrer nofollow" className="small row">
            Listing <IconExternal width={12} height={12} />
          </a>
        )}
      </div>
    </div>
  );
}

export function EvidencePage() {
  const { missionId } = useParams();
  const mq = useMission(missionId!);
  const cq = useCandidates(missionId!);
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Product evidence</h1>
          <p className="lede">Every listing retrieved for this mission, with the evidence behind each decision. Product suitability comes from the catalog; stock and delivery are simulated supplier commitments and are labelled as such.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Filter listings">
        {(['all', 'eligible', 'excluded', 'flagged'] as Filter[]).map((f) => (
          <button key={f} role="tab" className="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {f === 'flagged' ? 'Injection flags' : f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <QueryView q={mq}>
        {(d) => (
          <QueryView q={cq} rows={8}>
            {(cands) => {
              if (cands.length === 0) return <Panel title="No listings yet"><span className="muted">Plan the mission to retrieve products.</span></Panel>;
              const visible = cands.filter((c) => (filter === 'eligible' ? c.eligible : filter === 'excluded' ? !c.eligible : filter === 'flagged' ? c.contentFlags.length > 0 : true));
              return (
                <>
                  {d.mission.catalogSource !== 'channel3' && (
                    <Callout tone="warn" title="Fixture catalog in use">
                      Channel3 is not configured or was unavailable for this mission, so listings come from a labelled offline fixture catalog of fictional .example merchants.
                    </Callout>
                  )}
                  {d.requirements.map((r) => {
                    const list = visible.filter((c) => c.requirementId === r.id);
                    if (list.length === 0) return null;
                    const all = cands.filter((c) => c.requirementId === r.id);
                    return (
                      <Panel key={r.id} title={r.label} sub={`${all.filter((c) => c.eligible).length} eligible of ${all.length} · need ${r.quantity} ${r.unit} · query “${r.searchQuery}”`} flush>
                        {list.map((c) => (
                          <ProductRow key={c.id} c={c} unit={r.unit} tz={d.mission.timezone} />
                        ))}
                      </Panel>
                    );
                  })}
                </>
              );
            }}
          </QueryView>
        )}
      </QueryView>
    </div>
  );
}
