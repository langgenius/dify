#!/usr/bin/env python3
"""Rule config for v1.17 F-002.

Config only — the logic lives in route.py. Add paths to EXTRA as the feature's
document set grows, then re-run this file to regenerate the JSON.

    python rule_v1.17_F-002.py
"""
from route import build, emit

VERSION = "v1.17"
FEATURE_ID = "F-002"
FEATURE_TITLE = "Workflow Engine and Authoring"

EXTRA = {
    "domain": ["docs/Dify-Specs/ddd/domain_DOM-002-workflow-engine-and-authoring.md"],
    "adrs": ["docs/Dify-Specs/ADRs/adrs_ADR-0001-record-architecture-decisions.md", "docs/Dify-Specs/ADRs/adrs_ADR-0002-application-level-referential-integrity.md", "docs/Dify-Specs/ADRs/adrs_ADR-0003-generated-api-contract.md", "docs/Dify-Specs/ADRs/adrs_ADR-0004-enforced-import-layers.md", "docs/Dify-Specs/ADRs/adrs_ADR-0005-pluggable-provider-packages.md"],
    "runbooks": ["docs/Dify-Specs/runbook/runbook_DEV_RB-001-local-setup.md"],
    "tests": ["docs/Dify-Specs/tests/test_v1.17_F-002.md"],
}

if __name__ == "__main__":
    emit(build(VERSION, FEATURE_ID, FEATURE_TITLE, EXTRA))
