import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { PaymentOperation } from '../../../shared/types';
import { useCancelPayment, useCapture } from '../api/hooks';
import { Button, Callout, errorText, Panel, StatusBadge } from '../components/ui';
import { PaymentLifecycle } from '../features/PaymentLifecycle';
import { PAYMENT_TONE, usd } from '../lib/format';

// PayPal redirects the payer here. The page only asks the server to verify and capture; it never
// decides on its own that a payment succeeded.
export function CheckoutReturnPage() {
  const { missionId } = useParams();
  const [params] = useSearchParams();
  const opId = params.get('op') ?? '';
  const result = params.get('result');
  const orderId = params.get('token') ?? '';
  const capture = useCapture(missionId!);
  const cancel = useCancelPayment(missionId!);
  const [op, setOp] = useState<PaymentOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !/^[0-9a-f-]{36}$/.test(opId)) return;
    started.current = true;
    if (result === 'return' && orderId) {
      capture.mutate(
        { opId, orderId },
        { onSuccess: setOp, onError: (e) => setError(errorText(e)) },
      );
    } else if (result === 'cancel') {
      cancel.mutate(opId, { onSuccess: setOp, onError: (e) => setError(errorText(e)) });
    }
  }, [opId, result, orderId, capture, cancel]);

  const pending = capture.isPending || cancel.isPending;
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{result === 'cancel' ? 'Checkout cancelled' : 'Verifying your PayPal approval'}</h1>
          <p className="lede">
            RELIEFOS re-validates the approval, confirms the order with PayPal, and only then
            captures. The result below comes from PayPal, not from this redirect.
          </p>
        </div>
      </div>
      <Panel title="Outcome">
        <div className="stack">
          {!/^[0-9a-f-]{36}$/.test(opId) && (
            <Callout tone="danger">This return link is missing its payment reference.</Callout>
          )}
          {pending && <Callout tone="info">Contacting PayPal…</Callout>}
          {error && (
            <Callout tone="danger" title="Not captured">
              {error}
            </Callout>
          )}
          {op && (
            <>
              <div className="row">
                <StatusBadge status={op.status} tones={PAYMENT_TONE} />
                <span className="strong">{usd(op.amountCents)}</span>
                <span className="small muted">order {op.providerOrderId}</span>
              </div>
              <PaymentLifecycle op={op} />
              {op.status === 'COMPLETED' && (
                <Callout tone="ok" title="Payment captured and verified with PayPal">
                  Capture {op.providerCaptureId}. The mission and delivery schedule have been
                  updated.
                </Callout>
              )}
              {op.status === 'CANCELLED' && (
                <Callout tone="info">
                  No funds moved. The approval remains valid; you can start a new checkout.
                </Callout>
              )}
              {['UNKNOWN', 'PROVIDER_PENDING'].includes(op.status) && (
                <Callout tone="warn" title="Outcome not confirmed">
                  {op.lastError?.message ?? 'Reconcile from the payments page.'}
                </Callout>
              )}
            </>
          )}
          <div className="row">
            <Link to={`/missions/${missionId}/payments`}>
              <Button>Payments</Button>
            </Link>
            <Link to={`/missions/${missionId}/report`}>
              <Button variant="primary">Mission report</Button>
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  );
}
