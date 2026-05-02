import Database from 'better-sqlite3'

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS h3_provider_map (
      h3_index TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      h3_index TEXT NOT NULL,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observations_h3_fetched
      ON observations (h3_index, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      h3_index TEXT NOT NULL,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forecasts_h3_fetched
      ON forecasts (h3_index, fetched_at DESC);
  `)
}
