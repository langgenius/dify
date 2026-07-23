import assert from "node:assert/strict";
import test from "node:test";

import { collectBlockingBackendAdvisories } from "./audit-backend-dependencies.mjs";

test("ignores Admin-only findings while retaining backend high and critical findings", () => {
  const result = collectBlockingBackendAdvisories({
    advisories: {
      admin: {
        findings: [{ paths: ["apps__admin>next"] }],
        severity: "high",
      },
      backend: {
        findings: [
          {
            paths: [
              "apps__admin>shared-package",
              "apps__api>shared-package",
              "packages__api>shared-package",
            ],
          },
        ],
        github_advisory_id: "GHSA-backend",
        module_name: "shared-package",
        severity: "critical",
        title: "Backend issue",
        url: "https://example.test/GHSA-backend",
      },
      moderate: {
        findings: [{ paths: ["apps__api>moderate-package"] }],
        severity: "moderate",
      },
    },
  });

  assert.deepEqual(result, [
    {
      id: "GHSA-backend",
      module: "shared-package",
      paths: ["apps__api>shared-package", "packages__api>shared-package"],
      severity: "critical",
      title: "Backend issue",
      url: "https://example.test/GHSA-backend",
    },
  ]);
});

test("fails closed for malformed blocking advisories", () => {
  assert.deepEqual(collectBlockingBackendAdvisories(undefined), []);
  assert.deepEqual(collectBlockingBackendAdvisories({ advisories: [] }), []);
  assert.deepEqual(
    collectBlockingBackendAdvisories({
      advisories: {
        malformed: {
          findings: "invalid",
          github_advisory_id: "GHSA-malformed",
          module_name: "unknown",
          severity: "high",
          title: "Malformed issue",
          url: "https://example.test/GHSA-malformed",
        },
      },
    }),
    [
      {
        id: "GHSA-malformed",
        module: "unknown",
        paths: ["<unresolved>"],
        severity: "high",
        title: "Malformed issue",
        url: "https://example.test/GHSA-malformed",
      },
    ],
  );
});
