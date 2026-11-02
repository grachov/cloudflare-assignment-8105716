// Rows mirror the D1 schema (migrations/0001_init.sql); keys are in schema column order.

export interface Subscription {
  id: string;
  customer_name: string;
  plan: string;
  unit_price_minor: number;
  currency: string;
  billing_interval: string;
}

export interface Invoice {
  id: string;
  subscription_id: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  currency: string;
  issued_at: string;
  due_at: string;
}

export interface Payment {
  id: string;
  invoice_ref: string | null;
  amount_minor: number;
  currency: string;
  received_at: string;
  provider_ref: string;
}

export interface Dataset {
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: Payment[];
}

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetValidationError';
  }
}
