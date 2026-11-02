import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyDb } from '../../src/server/agent-tools';

function fakeD1() {
  const all = vi.fn(async () => ({ results: [{ one: 1 }] as never[] }));
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, all };
}

describe('ReadOnlyDb', () => {
  it.each([
    'UPDATE invoices SET amount_minor = 0',
    "INSERT INTO payments (id) VALUES ('x')",
    'DELETE FROM findings',
    'SELECT 1; DROP TABLE invoices',
    'SELECT 1;',
    '  drop table invoices',
    'WITH x AS (SELECT 1) DELETE FROM findings',
    'SELECT',
  ])('rejects %j without touching D1', async (sql) => {
    const d1 = fakeD1();
    const db = new ReadOnlyDb(d1);
    await expect(db.query(sql)).rejects.toThrow(/only a single SELECT/);
    expect(d1.prepare).not.toHaveBeenCalled();
  });

  it('runs a SELECT (any case, leading whitespace) with its params', async () => {
    const d1 = fakeD1();
    const db = new ReadOnlyDb(d1);
    expect(
      await db.query('  select id FROM invoices WHERE id=?1', 'INV-1'),
    ).toEqual([{ one: 1 }]);
    expect(d1.prepare).toHaveBeenCalledWith(
      '  select id FROM invoices WHERE id=?1',
    );
    expect(d1.bind).toHaveBeenCalledWith('INV-1');
  });

  it('exposes no prepare/batch/exec and hides the D1 handle', () => {
    const db = new ReadOnlyDb(fakeD1()) as unknown as Record<string, unknown>;
    for (const key of ['prepare', 'batch', 'exec', 'db'])
      expect(db[key]).toBeUndefined();
    expect(Object.keys(db)).toEqual([]);
  });
});
