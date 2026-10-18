import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Provenance } from '../../../shared/types';
import { ApiError } from '../api/client';
import { humanize, type Tone } from '../lib/format';
import { IconAlert, IconInfo, IconCheck, IconX } from './icons';

export function Badge({
  tone = 'neutral',
  children,
  plain,
}: {
  tone?: Tone;
  children: ReactNode;
  plain?: boolean;
}) {
  return <span className={`badge ${tone}${plain ? ' plain' : ''}`}>{children}</span>;
}

export function StatusBadge({ status, tones }: { status: string; tones: Record<string, Tone> }) {
  return <Badge tone={tones[status] ?? 'neutral'}>{humanize(status)}</Badge>;
}

const PROVENANCE: Record<Provenance, { cls: string; label: string; title: string }> = {
  channel3: {
    cls: 'live',
    label: 'Channel3',
    title: 'Live product data returned by the Channel3 API',
  },
  fixture: {
    cls: 'fixture',
    label: 'Fixture',
    title: 'Offline fixture listing (fictional .example merchant); not live market data',
  },
  'simulated-adversarial': {
    cls: 'adv',
    label: 'Adversarial sim',
    title: 'Simulated adversarial listing injected by a drill',
  },
};
export function ProvenanceTag({ p }: { p: Provenance }) {
  const v = PROVENANCE[p];
  return (
    <span className={`tag ${v.cls}`} title={v.title}>
      {v.label}
    </span>
  );
}
export const SimTag = ({ label = 'Simulated' }: { label?: string }) => (
  <span
    className="tag sim"
    title="Simulated value: no merchant API provides it. Clearly separated from verified data."
  >
    {label}
  </span>
);

export function Button({
  children,
  variant,
  size,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className={['btn', variant, size].filter(Boolean).join(' ')}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Panel({
  title,
  sub,
  actions,
  children,
  flush,
  id,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className="panel" id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {sub && <span className="sub">{sub}</span>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Callout({
  tone,
  title,
  children,
  icon,
}: {
  tone: 'danger' | 'warn' | 'ok' | 'info';
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  const Ic = tone === 'ok' ? IconCheck : tone === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`callout ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon ?? <Ic className="ic" />}
      <div>
        {title && <div className="t">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="t">{title}</div>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={16} w={`${92 - i * 9}%`} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong';
  const code = error instanceof ApiError ? error.code : null;
  return (
    <Callout tone="danger" title="Could not load this view">
      <div className="small">
        {msg}
        {code && <span className="mono"> ({code})</span>}
      </div>
      {retry && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
    </Callout>
  );
}

/** Wraps a react-query result with consistent loading / error / empty handling. */
export function QueryView<T>({
  q,
  children,
  rows,
}: {
  q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  rows?: number;
}) {
  if (q.isLoading) return <LoadingBlock rows={rows} />;
  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  if (q.data === undefined) return null;
  return <>{children(q.data)}</>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <IconX width={14} height={14} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; tone: 'ok' | 'danger' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'info' ? '' : t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? `${e.message}` : e instanceof Error ? e.message : 'Request failed';
