"""Behavior tests for fixed-scope coverage gates."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dev.check_coverage_gate import REPOSITORY_ROOT, CoverageGateError, enforce_coverage, load_scope, summarize_coverage

_PLANNER_MODULE = "api/core/human_input_v2/im_integration/sync_reconciliation.py"
_PROJECT_MODULES = (
    "api/controllers/common/human_input_v2_contracts.py",
    "api/controllers/console/workspace/human_input.py",
    "api/core/human_input_v2/contact_directory/ports.py",
    "api/core/human_input_v2/im_integration/__init__.py",
    "api/core/human_input_v2/im_integration/binding_commands.py",
    "api/core/human_input_v2/im_integration/binding_resolution.py",
    "api/core/human_input_v2/im_integration/change_log.py",
    "api/core/human_input_v2/im_integration/ports.py",
    "api/core/human_input_v2/im_integration/state.py",
    _PLANNER_MODULE,
    "api/core/human_input_v2/im_integration/sync_records.py",
    "api/core/human_input_v2/shared/__init__.py",
    "api/core/human_input_v2/shared/values.py",
    "api/migrations/versions/2026_08_11_1000-b7d3e5f9a1c2_add_im_reconciliation_change_log.py",
    "api/migrations/versions/2026_08_11_1100-c9e4f7a2b6d1_relax_im_identity_email_constraint.py",
    "api/models/__init__.py",
    "api/models/human_input_v2.py",
    "api/repositories/human_input_v2/contact_directory/repository.py",
    "api/repositories/human_input_v2/im_integration/__init__.py",
    "api/repositories/human_input_v2/im_integration/mappers.py",
    "api/repositories/human_input_v2/im_integration/repository.py",
    "api/repositories/human_input_v2/im_integration/unit_of_work.py",
    "api/repositories/human_input_v2/organization_write_unit_of_work.py",
    "api/services/human_input_v2/im_contact_sync/__init__.py",
    "api/services/human_input_v2/im_contact_sync/binding_service.py",
    "api/services/human_input_v2/im_contact_sync/composition.py",
    "api/services/human_input_v2/im_contact_sync/coordinator.py",
    "api/services/human_input_v2/im_contact_sync/errors.py",
    "api/services/human_input_v2/im_contact_sync/locking.py",
    "api/services/human_input_v2/im_contact_sync/service.py",
    "api/services/human_input_v2/im_contact_sync/worker.py",
    "api/tasks/im_contact_sync_tasks.py",
)


def _coverage_report() -> dict[str, object]:
    return {
        "files": {
            "api/a.py": {
                "summary": {
                    "covered_lines": 95,
                    "num_statements": 100,
                    "covered_branches": 18,
                    "num_branches": 20,
                }
            },
            "api/b.py": {
                "summary": {
                    "covered_lines": 45,
                    "num_statements": 50,
                    "covered_branches": 10,
                    "num_branches": 10,
                }
            },
        }
    }


def test_planner_gate_enforces_statement_and_branch_percentages_independently() -> None:
    summary = summarize_coverage(_coverage_report(), ("api/a.py",))

    enforce_coverage(summary, minimum_statement=95, minimum_branch=90)
    with pytest.raises(CoverageGateError, match=r"branch.*90\.00%.*95\.00%"):
        enforce_coverage(summary, minimum_statement=95, minimum_branch=95)


def test_project_gate_uses_combined_branch_coverage_for_the_complete_fixed_scope() -> None:
    summary = summarize_coverage(_coverage_report(), ("api/a.py", "api/b.py"))

    assert summary.statement_percent == pytest.approx(140 / 150 * 100)
    assert summary.branch_percent == pytest.approx(28 / 30 * 100)
    assert summary.total_percent == pytest.approx(168 / 180 * 100)
    enforce_coverage(summary, minimum_total=93)


def test_gate_rejects_a_scope_file_missing_from_coverage_data() -> None:
    with pytest.raises(CoverageGateError, match=r"api/missing\.py"):
        summarize_coverage(_coverage_report(), ("api/a.py", "api/missing.py"))


def test_scope_loader_rejects_duplicates_and_missing_files(tmp_path: Path) -> None:
    manifest_path = tmp_path / "scope.json"
    manifest_path.write_text(json.dumps({"planner": ["api/a.py", "api/a.py"]}))

    with pytest.raises(CoverageGateError, match="duplicate"):
        load_scope(manifest_path, "planner", repository_root=tmp_path)

    manifest_path.write_text(json.dumps({"planner": ["api/missing.py"]}))
    with pytest.raises(CoverageGateError, match=r"does not exist.*api/missing\.py"):
        load_scope(manifest_path, "planner", repository_root=tmp_path)


def test_im_contact_sync_manifest_fixes_planner_and_complete_project_scopes() -> None:
    manifest_path = REPOSITORY_ROOT / "api/dev/im_contact_sync_coverage_scope.json"

    planner_scope = load_scope(manifest_path, "planner", repository_root=REPOSITORY_ROOT)
    project_scope = load_scope(manifest_path, "project", repository_root=REPOSITORY_ROOT)

    assert planner_scope == (_PLANNER_MODULE,)
    assert project_scope == _PROJECT_MODULES
    assert project_scope == tuple(sorted(project_scope))
