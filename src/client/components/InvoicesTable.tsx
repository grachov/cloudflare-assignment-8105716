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
    let isCancelled = false;

    api
      .getInvoices()
      .then((data) => {
        if (isCancelled) {
          return;
        }

        setData(data);
        setError(null);
        onLoaded?.(data);
      })
      .catch((error: Error) => !isCancelled && setError(error.message));

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (error) {
    return (
      <p role="alert" className="error-text">
        Could not load invoices: {error}
      </p>
    );
  }

  if (!data) {
    return <p className="muted">Loading invoices…</p>;
  }

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
          {data.invoices.map((invoice) => (
            <tr key={invoice.id}>
              <th scope="row" className="mono">
                {invoice.id}
              </th>
              <td>{invoice.customer}</td>
              <td className="nowrap">
                {invoice.period_start} – {invoice.period_end}
              </td>
              <td className="num">
                {formatMinor(invoice.amount_minor, invoice.currency)}
              </td>
              <td className="num">
                {formatMinor(
                  invoice.paid_minor - invoice.duplicate_minor,
                  invoice.currency,
                )}
              </td>
              <td className="num">
                {invoice.duplicate_minor > 0
                  ? formatMinor(invoice.duplicate_minor, invoice.currency)
                  : ''}
              </td>
              <td>
                <StatusBadge status={invoice.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
