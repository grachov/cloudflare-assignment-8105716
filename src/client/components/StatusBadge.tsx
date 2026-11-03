import type { InvoiceStatus } from '../api';
import { INVOICE_STATUS_LABELS } from '../labels';

const ICONS: Record<InvoiceStatus, string> = {
  matched: '✓',
  underpaid: '▼',
  overpaid: '▲',
  unpaid_overdue: '!',
  open: '○',
  not_reconciled: '–',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{ICONS[status]}</span>{' '}
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}
