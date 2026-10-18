import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MissionInputSchema, type MissionInput } from '../../../shared/contracts';
import type { MissionInterpretation } from '../../../shared/types';
import { useCreateMission, useInterpret, useMission, useMissionInput, useUpdateMission } from '../api/hooks';
import { Badge, Button, Callout, errorText, LoadingBlock, Panel, useToast } from '../components/ui';
import { humanize } from '../lib/format';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico', 'UTC'];

function F({ k, label, help, children, span, errors }: { k: keyof MissionInput; label: string; help?: string; children: React.ReactNode; span?: number; errors: Record<string, string> }) {
  return (
    <div className={'field' + (span ? ' span-' + span : '')}>
      <label htmlFor={'f-' + k}>{label}</label>
      {children}
      {errors[k] ? <span className="err">{errors[k]}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): MissionInput => ({
  title: '',
  organization: '',
  narrative: '',
  budgetUsd: 4000,
  population: 100,
  infants: 0,
  householdSize: 4,
  coverageDays: 3,
  destination: '',
  date: today(),
  startTime: '11:00',
  deadlineTime: '17:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  plannerMode: 'claude',
});

export function MissionFormPage({ edit }: { edit?: boolean }) {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useMissionInput(edit ? missionId! : '');
  const detail = useMission(edit ? missionId! : '');
  const create = useCreateMission();
  const update = useUpdateMission(missionId ?? '');
  const interpret = useInterpret();
  const [form, setForm] = useState<MissionInput>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [interp, setInterp] = useState<(MissionInterpretation & { error: string | null }) | null>(null);

  useEffect(() => {
    if (edit && existing.data) setForm(existing.data.input);
  }, [edit, existing.data]);

  const set = <K extends keyof MissionInput>(k: K, v: MissionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const numField = (k: keyof MissionInput) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === '' ? NaN : Number(e.target.value)) as never);

  const applyInterpretation = (r: MissionInterpretation) => {
    const get = (f: string) => r.fields.find((x) => x.field === f && x.status === 'extracted')?.value;
    setForm((f) => ({
      ...f,
      organization: (get('organization') as string) ?? f.organization,
      population: (get('population') as number) ?? f.population,
      infants: (get('infants') as number) ?? f.infants,
      budgetUsd: (get('budgetUsd') as number) ?? f.budgetUsd,
      deadlineTime: (get('deadlineLocalTime') as string) ?? f.deadlineTime,
      destination: (get('destination') as string) ?? f.destination,
      householdSize: (get('householdSize') as number) ?? f.householdSize,
      coverageDays: (get('coverageDays') as number) ?? f.coverageDays,
      title: f.title || ((get('destination') as string) ? `Relief supply — ${get('destination')}` : f.title),
    }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = MissionInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    if (edit) {
      update.mutate(
        { expectedVersion: existing.data!.version, mission: parsed.data },
        {
          onSuccess: (m) => {
            toast('ok', `Mission updated to v${m.version}. Earlier approvals were invalidated.`);
            navigate(`/missions/${m.id}`);
          },
          onError: (err) => toast('danger', errorText(err)),
        },
      );
    } else {
      create.mutate(parsed.data, { onSuccess: (m) => navigate(`/missions/${m.id}`), onError: (err) => toast('danger', errorText(err)) });
    }
  };

  if (edit && (existing.isLoading || detail.isLoading)) return <div className="content"><LoadingBlock rows={8} /></div>;
  const hasApproval = edit && detail.data?.approvals.some((a) => a.status === 'ACTIVE');
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{edit ? 'Edit mission terms' : 'New mission'}</h1>
          <p className="lede">
            {edit
              ? 'Changing any term creates a new mission version. Every existing approval and open proposal is invalidated and must be re-validated.'
              : 'Describe the need in plain language; the planner extracts parameters with quoted evidence. You confirm every value — the AI never sets the budget.'}
          </p>
        </div>
      </div>
      {hasApproval && <Callout tone="warn" title="An approval is active">Saving changes will invalidate it. The coordinator will need to review and approve again.</Callout>}

      <form onSubmit={submit} className="stack" noValidate>
        <Panel title="Request" sub="Natural-language mission brief">
          <div className="stack">
            <textarea
              id="f-narrative"
              className="input"
              rows={4}
              value={form.narrative}
              onChange={(e) => set('narrative', e.target.value)}
              placeholder="e.g. We need supplies for 120 people displaced by flooding, including 8 infants, delivered to the East Shelter before 5 PM. Budget $4,000."
              aria-invalid={!!errors.narrative}
            />
            {errors.narrative && <span className="err small">{errors.narrative}</span>}
            <div className="row">
              <Button
                loading={interpret.isPending}
                disabled={form.narrative.trim().length < 10}
                onClick={() =>
                  interpret.mutate(form.narrative, {
                    onSuccess: (r) => {
                      setInterp(r);
                      applyInterpretation(r);
                    },
                    onError: (e) => toast('danger', errorText(e)),
                  })
                }
              >
                Interpret request
              </Button>
              <span className="small muted">Extracted values are pre-filled below for your confirmation.</span>
            </div>
            {interp && (
              <div className="stack">
                <div className="row">
                  <Badge tone={interp.mode === 'claude' ? 'accent' : 'neutral'}>{interp.mode === 'claude' ? 'Claude interpretation' : 'Deterministic interpreter'}</Badge>
                  {interp.error && <span className="small muted">Model output was not used: {interp.error}</span>}
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Value</th>
                      <th>Status</th>
                      <th>Evidence from request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interp.fields.map((f) => (
                      <tr key={f.field}>
                        <td>{humanize(f.field.replace(/([A-Z])/g, '_$1'))}</td>
                        <td className="strong">{f.value ?? '—'}</td>
                        <td>
                          <Badge tone={f.status === 'extracted' ? 'ok' : f.status === 'defaulted' ? 'neutral' : 'warn'}>{f.status}</Badge>
                        </td>
                        <td>{f.evidence ? <span className="quote">“{f.evidence}”</span> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {interp.ambiguities.length > 0 && (
                  <Callout tone="info" title="Needs confirmation">
                    <ul>
                      {interp.ambiguities.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Authoritative mission terms" sub="These values bind the policy gate">
          <div className="form-grid">
            <F errors={errors} k="title" label="Mission title" span={2}>
              <input id="f-title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} />
            </F>
            <F errors={errors} k="organization" label="Organization" span={2}>
              <input id="f-organization" className="input" value={form.organization} onChange={(e) => set('organization', e.target.value)} aria-invalid={!!errors.organization} />
            </F>
            <F errors={errors} k="budgetUsd" label="Authorised budget (USD)" help="Hard cap including shipping">
              <input id="f-budgetUsd" className="input" type="number" min={1} step="0.01" value={Number.isNaN(form.budgetUsd) ? '' : form.budgetUsd} onChange={numField('budgetUsd')} aria-invalid={!!errors.budgetUsd} />
            </F>
            <F errors={errors} k="population" label="People to support">
              <input id="f-population" className="input" type="number" min={1} value={Number.isNaN(form.population) ? '' : form.population} onChange={numField('population')} aria-invalid={!!errors.population} />
            </F>
            <F errors={errors} k="infants" label="Infants" help="Drives baby-supply quantities">
              <input id="f-infants" className="input" type="number" min={0} value={Number.isNaN(form.infants) ? '' : form.infants} onChange={numField('infants')} aria-invalid={!!errors.infants} />
            </F>
            <F errors={errors} k="householdSize" label="People per household" help="Hygiene kits: 1 per household">
              <input id="f-householdSize" className="input" type="number" min={1} value={Number.isNaN(form.householdSize) ? '' : form.householdSize} onChange={numField('householdSize')} />
            </F>
            <F errors={errors} k="coverageDays" label="Supply coverage (days)">
              <input id="f-coverageDays" className="input" type="number" min={1} max={14} value={Number.isNaN(form.coverageDays) ? '' : form.coverageDays} onChange={numField('coverageDays')} />
            </F>
            <F errors={errors} k="destination" label="Delivery destination" span={2}>
              <input id="f-destination" className="input" value={form.destination} onChange={(e) => set('destination', e.target.value)} aria-invalid={!!errors.destination} />
            </F>
            <F errors={errors} k="plannerMode" label="Planner">
              <select id="f-plannerMode" className="input" value={form.plannerMode} onChange={(e) => set('plannerMode', e.target.value as MissionInput['plannerMode'])}>
                <option value="claude">Claude (falls back if unavailable)</option>
                <option value="deterministic">Deterministic only</option>
              </select>
            </F>
            <F errors={errors} k="date" label="Mission date">
              <input id="f-date" className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} aria-invalid={!!errors.date} />
            </F>
            <F errors={errors} k="startTime" label="Planning window opens">
              <input id="f-startTime" className="input" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </F>
            <F errors={errors} k="deadlineTime" label="Hard delivery deadline">
              <input id="f-deadlineTime" className="input" type="time" value={form.deadlineTime} onChange={(e) => set('deadlineTime', e.target.value)} aria-invalid={!!errors.deadlineTime} />
            </F>
            <F errors={errors} k="timezone" label="Time zone">
              <select id="f-timezone" className="input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </F>
          </div>
        </Panel>
        <div className="row">
          <Button variant="primary" size="lg" type="submit" loading={create.isPending || update.isPending}>
            {edit ? 'Save new mission version' : 'Create mission'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
