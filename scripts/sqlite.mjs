import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'holders'").get()) {
    db.exec(readFileSync(new URL('../migrations/0001_stock.sql', import.meta.url), 'utf8'));
  }
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pass_reasons'").get()) {
    db.exec(`BEGIN;\n${readFileSync(new URL('../migrations/0002_pass_reasons.sql', import.meta.url), 'utf8')}\nCOMMIT;`);
  }
  return {
    db,
    binding: {
      prepare(sql) {
        const statement = db.prepare(sql);
        const wrap = values => ({
          bind: (...inner) => wrap(inner),
          all: async () => ({ results: statement.all(...values) }),
          first: async () => statement.get(...values) ?? null,
          run: async () => statement.run(...values),
        });
        return wrap([]);
      },
    },
  };
}
