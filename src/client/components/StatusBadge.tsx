import type { InvoiceStatus } from '../api';

const LABELS: Record<InvoiceStatus, string> = {
  MATCHED: 'Matched',
  UNDERPAID: 'Underpaid',
  OVERPAID: 'Overpaid',
  UNPAID_OVERDUE: 'Unpaid overdue',
  OPEN: 'Open',
  NOT_RECONCILED: 'Not reconciled',
};

const ICONS: Record<InvoiceStatus, string> = {
  MATCHED: '✓',
  UNDERPAID: '▼',
  OVERPAID: '▲',
  UNPAID_OVERDUE: '!',
  OPEN: '○',
  NOT_RECONCILED: '–',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{ICONS[status]}</span> {LABELS[status] ?? status}
    </span>
  );
}
