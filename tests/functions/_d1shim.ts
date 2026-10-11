/**
 * A small in-memory Cloudflare D1 lookalike for the tests, built on Node's built-in SQLite (`node:sqlite`, Node ≥ 22.13 — the same
 * SQLite engine family D1 runs, so json_each, UPDATE … FROM, partial indexes and ON CONFLICT behave as they do in production).
 * It implements only what the functions use: prepare().bind().run()/all()/first(), and batch() (one transaction, rolled back on error).
 * Row-write accounting is NOT simulated — the budget numbers in docs/COMMUNITY-MARKET.md are estimates checked against the code's own
 * accounting, not against Cloudflare's meter.
 */
// Node built-ins come through process.getBuiltinModule so this file type-checks under functions/tsconfig.json (Workers types, no @types/node).
const builtin = <T>(name: string): T => {
  const p = (globalThis as any).process;
  if (!p?.getBuiltinModule) throw new Error('Node with process.getBuiltinModule (≥ 22.3) is required for the D1 test shim');
  return p.getBuiltinModule(name) as T;
};
type Sqlite = { DatabaseSync: new (file: string) => any };
const sqlite = () => builtin<Sqlite>('node:sqlite');

class Stmt {
  constructor(private db: any, readonly sql: string, private params: unknown[] = []) {}
  bind(...p: unknown[]) {
    return new Stmt(this.db, this.sql, p);
  }
  private exec(): { results: any[]; meta: { changes: number } } {
    const st = this.db.prepare(this.sql);
    const p = this.params.map((x) => (x === undefined ? null : x));
    if (st.columns().length > 0) return { results: st.all(...p).map((r: any) => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...p);
    return { results: [], meta: { changes: Number(r.changes) } };
  }
  async run() {
    const r = this.exec();
    return { success: true, results: r.results, meta: r.meta };
  }
  async all() {
    const r = this.exec();
    return { success: true, results: r.results, meta: r.meta };
  }
  async first(col?: string) {
    const r = this.exec().results[0] ?? null;
    return col && r ? r[col] : r;
  }
  _exec() {
    return this.exec();
  }
}

export interface FakeD1 {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<Array<{ success: boolean; results: any[]; meta: { changes: number } }>>;
  /** Raw access for assertions. */
  raw: any;
  /** Every batch() call's statement count, to assert "a few statements, not hundreds". */
  batches: number[];
}

/** A fresh in-memory database with every migration in `dir` applied in order. */
export function fakeD1(dir = decodeURIComponent(new URL('../../migrations/market', (import.meta as any).url).pathname)): FakeD1 {
  const fs = builtin<any>('node:fs');
  const db = new (sqlite().DatabaseSync)(':memory:');
  for (const f of (fs.readdirSync(dir) as string[]).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const batches: number[] = [];
  return {
    raw: db,
    batches,
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      batches.push(stmts.length);
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => {
          const r = s._exec();
          return { success: true, results: r.results, meta: r.meta };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** Read a UTF-8 file (Node built-ins aren't typed under functions/tsconfig.json). */
export const readText = (file: string): string => builtin<any>('node:fs').readFileSync(file, 'utf8');
