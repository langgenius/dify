import { pathToFileURL } from "node:url";
import { runDatabaseMigrations } from "@knowledge/adapters";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";

export interface ApiMigrationEnv {
  readonly DATABASE_URL?: string | undefined;
}

export interface ApiMigrationAdapter {
  readonly database: Parameters<typeof runDatabaseMigrations>[0]["database"];
  close?: () => Promise<void>;
}

export interface RunApiDatabaseMigrationsOptions {
  readonly adapter?: ApiMigrationAdapter | undefined;
  readonly env?: ApiMigrationEnv | undefined;
  readonly log?: ((message: string) => void) | undefined;
  readonly now?: (() => string) | undefined;
}

export async function runApiDatabaseMigrations({
  adapter = createNodePlatformAdapter(),
  env = process.env,
  log = console.log,
  now,
}: RunApiDatabaseMigrationsOptions = {}) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to run local database migrations");
  }

  try {
    const result = await runDatabaseMigrations({
      database: adapter.database,
      ...(now ? { now } : {}),
    });

    log(
      JSON.stringify(
        {
          appliedMigrationIds: result.appliedMigrationIds,
          pendingBeforeRun: result.pendingBeforeRun,
        },
        null,
        2,
      ),
    );

    return result;
  } finally {
    await adapter.database.close?.();
    await adapter.close?.();
  }
}

if (isMainModule()) {
  runApiDatabaseMigrations().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];

  return Boolean(entrypoint && import.meta.url === pathToFileURL(entrypoint).href);
}
