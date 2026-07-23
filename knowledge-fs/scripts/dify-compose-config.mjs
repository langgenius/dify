import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Materialize the ignored Dify service env only when it is absent. The returned cleanup preserves
 * pre-existing user configuration and refuses to remove a file that was replaced while config ran.
 */
export function materializeDifyComposeEnv({ envPath, examplePath }) {
  if (existsSync(envPath)) return () => {};

  copyFileSync(examplePath, envPath, constants.COPYFILE_EXCL);
  const materialized = statSync(envPath);

  return () => {
    if (!existsSync(envPath)) return;
    const current = statSync(envPath);
    if (current.dev === materialized.dev && current.ino === materialized.ino) {
      rmSync(envPath);
    }
  };
}

function runDifyComposeConfig() {
  const dockerRoot = fileURLToPath(new URL("../../docker/", import.meta.url));
  const envPath = resolve(dockerRoot, ".env");
  const examplePath = resolve(dockerRoot, ".env.example");
  const composePath = resolve(dockerRoot, "docker-compose.yaml");
  const removeMaterializedEnv = materializeDifyComposeEnv({ envPath, examplePath });

  try {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        dockerRoot,
        "--env-file",
        examplePath,
        "-f",
        composePath,
        "config",
        "--quiet",
      ],
      { cwd: dockerRoot, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    removeMaterializedEnv();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runDifyComposeConfig();
}
