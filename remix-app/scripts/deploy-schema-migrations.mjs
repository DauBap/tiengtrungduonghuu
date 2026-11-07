import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = join(appDir, "prisma", "deploy-migrations");
const databaseEnvPath = join(appDir, ".env");
const dryRun = process.argv.includes("--dry-run");
const backupScript = join(
  process.env.HOME ?? "",
  ".local",
  "bin",
  "tiengtrung-db-backup.mjs",
);
const migrationTable = '"_AppSchemaMigration"';

if (typeof process.loadEnvFile !== "function") {
  throw new Error("Deploy schema migrations requires Node.js with process.loadEnvFile support.");
}
process.loadEnvFile(databaseEnvPath);

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL must be configured in remix-app/.env.");

const parsedUrl = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
  throw new Error("The migration database URL must use PostgreSQL.");
}

const pgEnv = { ...process.env };
const urlOptions = {
  host: "PGHOST",
  port: "PGPORT",
  user: "PGUSER",
  password: "PGPASSWORD",
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  connect_timeout: "PGCONNECT_TIMEOUT",
  application_name: "PGAPPNAME",
  target_session_attrs: "PGTARGETSESSIONATTRS",
  gssencmode: "PGGSSENCMODE",
  channel_binding: "PGCHANNELBINDING",
};

for (const [option, variable] of Object.entries(urlOptions)) {
  const value = parsedUrl.searchParams.get(option);
  if (value !== null) pgEnv[variable] = value;
}

pgEnv.PGHOST ||= parsedUrl.hostname;
if (!pgEnv.PGPORT && parsedUrl.port) pgEnv.PGPORT = parsedUrl.port;
pgEnv.PGUSER ||= decodeURIComponent(parsedUrl.username);
pgEnv.PGPASSWORD ||= decodeURIComponent(parsedUrl.password);
pgEnv.PGDATABASE ||= decodeURIComponent(parsedUrl.pathname.slice(1));
if (!pgEnv.PGDATABASE) throw new Error("The database URL must include a database name.");

function runPsql(args, input) {
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", ...args],
    { env: pgEnv, encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`psql exited with code ${result.status ?? "unknown"}.`);
  }
  return result.stdout.trim();
}

function quoteSql(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const files = (await readdir(migrationDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = [];

for (const fileName of files) {
  const name = fileName.slice(0, -".sql".length);
  if (!/^\d{8}_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid schema migration filename: ${fileName}`);
  }

  const sql = await readFile(join(migrationDir, fileName), "utf8");
  migrations.push({
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });
}

if (migrations.length === 0) {
  console.log("No production schema migrations are present.");
  process.exit(0);
}

const tableExists = runPsql([
  "--tuples-only",
  "--no-align",
  "--command",
  `SELECT to_regclass('public.${migrationTable}') IS NOT NULL`,
]) === "t";
const pending = [];

for (const migration of migrations) {
  if (!tableExists) {
    pending.push(migration);
    continue;
  }

  const existingChecksum = runPsql([
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT checksum FROM public.${migrationTable} WHERE name = ${quoteSql(migration.name)}`,
  ]);
  if (existingChecksum && existingChecksum !== migration.checksum) {
    throw new Error(
      `Applied migration ${migration.name} has been modified. Add a new migration instead.`,
    );
  }
  if (!existingChecksum) pending.push(migration);
}

if (pending.length === 0) {
  console.log("Production schema is up to date.");
  process.exit(0);
}

console.log(`Pending production schema migrations: ${pending.map(({ name }) => name).join(", ")}`);
if (dryRun) process.exit(0);

const backup = spawnSync(process.execPath, [backupScript], {
  cwd: appDir,
  env: process.env,
  stdio: "inherit",
});
if (backup.error) throw backup.error;
if (backup.status !== 0) {
  throw new Error(`Database backup failed; refusing to apply schema migrations (exit ${backup.status}).`);
}

for (const migration of pending) {
  const script = [
    "SELECT pg_advisory_xact_lock(747621, 1);",
    `CREATE TABLE IF NOT EXISTS public.${migrationTable} (`,
    '  "name" TEXT PRIMARY KEY,',
    '  "checksum" TEXT NOT NULL,',
    '  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
    ");",
    migration.sql,
    `INSERT INTO public.${migrationTable} ("name", "checksum") VALUES (${quoteSql(migration.name)}, ${quoteSql(migration.checksum)});`,
  ].join("\n");

  console.log(`Applying ${migration.name}...`);
  runPsql(["--single-transaction"], script);
}

console.log(`Applied ${pending.length} production schema migration(s).`);
