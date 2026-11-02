-- Synthetic demo ledger (plan section 6). Idempotent: INSERT OR IGNORE. No BEGIN/COMMIT (D1 rejects them).
-- One statement per line, each ending in ';' (the integration setup splits on that).

INSERT OR IGNORE INTO subscriptions (id, customer_name, plan, unit_price_minor, currency, billing_interval) VALUES ('S1', 'Acme Corp', 'Pro', 4900, 'USD', 'monthly');
INSERT OR IGNORE INTO subscriptions (id, customer_name, plan, unit_price_minor, currency, billing_interval) VALUES ('S2', 'Globex', 'Team', 12000, 'USD', 'monthly');
INSERT OR IGNORE INTO subscriptions (id, customer_name, plan, unit_price_minor, currency, billing_interval) VALUES ('S3', 'Initech', 'Starter', 1900, 'USD', 'monthly');
INSERT OR IGNORE INTO subscriptions (id, customer_name, plan, unit_price_minor, currency, billing_interval) VALUES ('S4', 'Umbrella GmbH', 'Business', 25000, 'EUR', 'monthly');
INSERT OR IGNORE INTO subscriptions (id, customer_name, plan, unit_price_minor, currency, billing_interval) VALUES ('S5', 'Hooli', 'Enterprise', 99000, 'USD', 'monthly');

INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1001', 'S1', '2026-08-01', '2026-08-31', 4900, 'USD', '2026-08-01', '2026-08-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1002', 'S1', '2026-09-01', '2026-09-30', 4900, 'USD', '2026-09-01', '2026-09-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1003', 'S1', '2026-10-01', '2026-10-31', 4900, 'USD', '2026-10-01', '2026-10-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1004', 'S2', '2026-08-01', '2026-08-31', 12000, 'USD', '2026-08-01', '2026-08-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1005', 'S2', '2026-09-01', '2026-09-30', 12000, 'USD', '2026-09-01', '2026-09-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1006', 'S2', '2026-10-01', '2026-10-31', 12000, 'USD', '2026-10-01', '2026-10-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1007', 'S3', '2026-08-01', '2026-08-31', 1900, 'USD', '2026-08-01', '2026-08-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1008', 'S3', '2026-09-01', '2026-09-30', 1900, 'USD', '2026-09-01', '2026-09-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1009', 'S3', '2026-10-01', '2026-10-31', 1900, 'USD', '2026-10-01', '2026-10-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1010', 'S4', '2026-08-01', '2026-08-31', 25000, 'EUR', '2026-08-01', '2026-08-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1011', 'S4', '2026-09-01', '2026-09-30', 25000, 'EUR', '2026-09-01', '2026-09-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1012', 'S4', '2026-10-01', '2026-10-31', 25000, 'EUR', '2026-10-01', '2026-10-15');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1013', 'S5', '2026-08-01', '2026-08-31', 99000, 'USD', '2026-08-01', '2026-08-31');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1014', 'S5', '2026-09-01', '2026-09-30', 99000, 'USD', '2026-09-01', '2026-10-01');
INSERT OR IGNORE INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-1015', 'S5', '2026-10-01', '2026-10-31', 99000, 'USD', '2026-10-01', '2026-10-31');

INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2001', 'INV-1001', 4900, 'USD', '2026-08-10', 'pi_P2001');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2002', 'INV-1002', 4900, 'USD', '2026-09-10', 'pi_P2002');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2003', 'INV-1002', 4900, 'USD', '2026-09-11', 'pi_P2003');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2004', 'INV-1003', 4900, 'USD', '2026-10-08', 'pi_P2004');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2005', 'INV-1004', 6000, 'USD', '2026-08-05', 'pi_P2005');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2006', 'INV-1004', 6000, 'USD', '2026-08-12', 'pi_P2006');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2007', 'INV-1005', 5000, 'USD', '2026-09-14', 'pi_P2007');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2008', 'INV-1009', 2500, 'USD', '2026-10-09', 'pi_P2008');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2009', 'INV-1010', 10000, 'EUR', '2026-08-03', 'pi_P2009');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2010', 'INV-1010', 7500, 'EUR', '2026-08-10', 'pi_P2010');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2011', 'INV-1010', 7500, 'EUR', '2026-08-14', 'pi_P2011');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2012', 'INV-1011', 25000, 'EUR', '2026-09-05', 'pi_P2012');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2013', 'INV-1011', 25000, 'EUR', '2026-09-06', 'pi_P2013');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2014', 'INV-1011', 1000, 'EUR', '2026-09-12', 'pi_P2014');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2015', 'INV-1012', 24000, 'EUR', '2026-10-10', 'pi_P2015');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2016', 'INV-1013', 99000, 'USD', '2026-08-25', 'pi_P2016');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2017', NULL, 1900, 'USD', '2026-09-20', 'pi_P2017');
INSERT OR IGNORE INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('P2018', 'INV-9999', 4900, 'USD', '2026-10-02', 'pi_P2018');
