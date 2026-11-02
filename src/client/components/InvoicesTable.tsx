import { useEffect, useState } from 'react';
import { formatMinor } from '../../shared/money';
import { api, type InvoicesResponse } from '../api';
import { StatusBadge } from './StatusBadge';

export function InvoicesTable({
  refreshKey,
  onLoaded,
}: {
  refreshKey: number;
  onLoaded?: (data: InvoicesResponse) => void;
}) {
  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getInvoices()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        onLoaded?.(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (error)
    return (
      <p role="alert" className="error-text">
        Could not load invoices: {error}
      </p>
    );
  if (!data) return <p className="muted">Loading invoices…</p>;

  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Invoices"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Customer</th>
            <th scope="col">Period</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Paid (net of duplicates)
            </th>
            <th scope="col" className="num">
              Duplicates
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.invoices.map((inv) => (
            <tr key={inv.id}>
              <th scope="row" className="mono">
                {inv.id}
              </th>
              <td>{inv.customer}</td>
              <td className="nowrap">
                {inv.period_start} – {inv.period_end}
              </td>
              <td className="num">
                {formatMinor(inv.amount_minor, inv.currency)}
              </td>
              <td className="num">
                {formatMinor(
                  inv.paid_minor - inv.duplicate_minor,
                  inv.currency,
                )}
              </td>
              <td className="num">
                {inv.duplicate_minor > 0
                  ? formatMinor(inv.duplicate_minor, inv.currency)
                  : ''}
              </td>
              <td>
                <StatusBadge status={inv.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
