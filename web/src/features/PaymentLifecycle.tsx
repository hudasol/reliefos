import type { PaymentOperation } from '../../../shared/types';
import type { PaymentStatus } from '../../../shared/states';

const STEPS: { key: PaymentStatus; label: string }[] = [
  { key: 'NOT_CREATED', label: 'Recorded' },
  { key: 'CREATED', label: 'Order created' },
  { key: 'APPROVAL_PENDING', label: 'Payer approval' },
  { key: 'CAPTURE_PENDING', label: 'Capture' },
  { key: 'COMPLETED', label: 'Verified' },
];

/** Progress through the PayPal Orders v2 lifecycle; terminal failures and ambiguity are explicit. */
export function PaymentLifecycle({ op }: { op: PaymentOperation }) {
  const order: PaymentStatus[] = ['NOT_CREATED', 'CREATED', 'APPROVAL_PENDING', 'CAPTURE_PENDING', 'COMPLETED'];
  const reached = op.status === 'UNKNOWN' || op.status === 'PROVIDER_PENDING' ? (op.providerOrderId ? 3 : 0) : op.status === 'FAILED' || op.status === 'CANCELLED' ? (op.providerOrderId ? 2 : 0) : order.indexOf(op.status);
  const off = ['UNKNOWN', 'PROVIDER_PENDING', 'FAILED', 'CANCELLED'].includes(op.status);
  return (
    <ol style={{ display: 'flex', listStyle: 'none', margin: 0, padding: 0, gap: 0 }} aria-label="Payment lifecycle">
      {STEPS.map((s, i) => {
        const done = i < reached || (i === reached && op.status === 'COMPLETED');
        const current = i === reached && !done;
        const color = current && off ? (op.status === 'FAILED' ? 'var(--danger)' : 'var(--warn)') : done ? 'var(--ok)' : current ? 'var(--accent)' : 'var(--border-strong)';
        return (
          <li key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }} aria-current={current ? 'step' : undefined}>
            <div style={{ height: 4, background: color, borderRadius: 2, marginRight: 4 }} />
            <span className="small" style={{ color: current || done ? 'var(--text)' : 'var(--text-3)', fontWeight: current ? 600 : 400 }}>
              {current && off ? op.status.replace('_', ' ').toLowerCase() : s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
