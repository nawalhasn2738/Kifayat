import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

const drizzleDirectory = new URL('../../drizzle/', import.meta.url);
const migrationImportPattern = /import\s+(m\d{4})\s+from\s+['](.+?\.sql)['];?/g;

export function loadBundledMigrationConfig() {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', drizzleDirectory), 'utf8'));
  const bundleSource = readFileSync(new URL('migrations.js', drizzleDirectory), 'utf8');
  const imports = new Map(
    [...bundleSource.matchAll(migrationImportPattern)].map((match) => [match[1], match[2]]),
  );
  const migrationsBlock = bundleSource.match(/migrations\s*:\s*\{([\s\S]*?)\}/)?.[1];

  if (!migrationsBlock) throw new Error('The Expo migration bundle has no migrations map');

  const migrations = {};
  for (const entry of journal.entries) {
    const key = `m${String(entry.idx).padStart(4, '0')}`;
    const relativeSqlPath = imports.get(key);

    if (!relativeSqlPath) throw new Error(`The Expo migration bundle does not import ${key} (${entry.tag})`);
    if (!new RegExp(`\\b${key}\\b`).test(migrationsBlock)) {
      throw new Error(`The Expo migration bundle does not export ${key} (${entry.tag})`);
    }

    migrations[key] = readFileSync(new URL(relativeSqlPath, drizzleDirectory), 'utf8');
  }

  return { journal, migrations };
}

export async function migrateWithExpoPath(sqlite, config = loadBundledMigrationConfig()) {
  const database = drizzle(sqlite);
  await migrate(database, config);
}

export async function withDisposableDatabase(run) {
  const sqlite = new Database(':memory:');
  try {
    await run(sqlite);
  } finally {
    sqlite.close();
  }
}

export function appendSyntheticMigration(config, { sql, tag }) {
  const previous = config.journal.entries.at(-1);
  if (!previous) throw new Error('A baseline migration is required');

  const idx = previous.idx + 1;
  const key = `m${String(idx).padStart(4, '0')}`;
  return {
    journal: {
      ...config.journal,
      entries: [
        ...config.journal.entries,
        { idx, version: previous.version, when: previous.when + 1, tag, breakpoints: true },
      ],
    },
    migrations: { ...config.migrations, [key]: sql },
  };
}
