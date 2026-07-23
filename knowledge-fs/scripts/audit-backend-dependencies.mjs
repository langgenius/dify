import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const blockingSeverities = new Set(["high", "critical"]);
const adminWorkspacePrefix = "apps__admin";

export function collectBlockingBackendAdvisories(report) {
  const advisories =
    report &&
    typeof report === "object" &&
    report.advisories &&
    typeof report.advisories === "object"
      ? Object.values(report.advisories)
      : [];

  return advisories.flatMap((advisory) => {
    if (!advisory || typeof advisory !== "object" || !blockingSeverities.has(advisory.severity)) {
      return [];
    }

    const findingsValid =
      Array.isArray(advisory.findings) &&
      advisory.findings.length > 0 &&
      advisory.findings.every(
        (finding) =>
          finding &&
          typeof finding === "object" &&
          Array.isArray(finding.paths) &&
          finding.paths.every((path) => typeof path === "string"),
      );
    const paths = findingsValid
      ? advisory.findings
          .flatMap((finding) => finding.paths)
          .filter(
            (path) => path !== adminWorkspacePrefix && !path.startsWith(`${adminWorkspacePrefix}>`),
          )
      : ["<unresolved>"];
    if (paths.length === 0) return [];

    return [
      {
        id: advisory.github_advisory_id ?? advisory.id,
        module: advisory.module_name,
        paths: [...new Set(paths)].sort(),
        severity: advisory.severity,
        title: advisory.title,
        url: advisory.url,
      },
    ];
  });
}

function runAudit() {
  const audit = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (audit.error) {
    console.error(`Unable to run pnpm audit: ${audit.error.message}`);
    return 2;
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error(audit.stderr || audit.stdout || "pnpm audit returned invalid JSON");
    return 2;
  }

  const blocking = collectBlockingBackendAdvisories(report);
  if (blocking.length > 0) {
    console.error(JSON.stringify({ advisories: blocking }, null, 2));
    return 1;
  }

  console.log("No high or critical vulnerabilities found in backend production dependencies.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runAudit();
}
