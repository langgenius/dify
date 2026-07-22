"""Tests for the focused Dify KnowledgeFS Python coverage gate."""

import subprocess
from pathlib import Path

import pytest

from dev.check_knowledge_fs_coverage import (
    CoverageFile,
    CoverageGateError,
    CoverageReport,
    CoverageSummary,
    is_core_coverage_path,
    load_glue_coverage_paths,
    parse_added_lines,
    resolve_diff_base,
    validate_changed_glue_coverage,
    validate_core_coverage,
)


@pytest.mark.parametrize(
    "path",
    [
        "api/commands/knowledge_fs.py",
        "api/configs/extra/knowledge_fs_config.py",
        "api/controllers/console/knowledge_fs/resources.py",
        "api/controllers/service_api/knowledge_fs/resources.py",
        "api/core/tools/builtin_tool/providers/knowledge_fs/knowledge_fs.py",
        "api/extensions/ext_knowledge_fs_observability.py",
        "api/models/knowledge_fs.py",
        "api/repositories/sqlalchemy_knowledge_fs_cutover_repository.py",
        "api/services/knowledge_fs/runtime.py",
        "api/services/knowledge_fs_capability.py",
        "api/tasks/knowledge_fs_lifecycle_tasks.py",
    ],
)
def test_core_coverage_scope_includes_every_required_layer(path: str) -> None:
    assert is_core_coverage_path(path)


@pytest.mark.parametrize(
    "path",
    [
        "api/app_factory.py",
        "api/dev/check_knowledge_fs_coverage.py",
        "api/migrations/versions/revision_knowledge_fs.py",
        "api/tests/unit_tests/services/test_knowledge_fs_runtime.py",
    ],
)
def test_core_coverage_scope_excludes_glue_migrations_and_tests(path: str) -> None:
    assert not is_core_coverage_path(path)


def test_core_coverage_aggregates_lines_and_branches_and_fails_closed(tmp_path: Path) -> None:
    service_path = tmp_path / "api/services/knowledge_fs/runtime.py"
    model_path = tmp_path / "api/models/knowledge_fs.py"
    service_path.parent.mkdir(parents=True)
    model_path.parent.mkdir(parents=True)
    service_path.touch()
    model_path.touch()
    report = coverage_report(
        {
            "api/services/knowledge_fs/runtime.py": coverage_file(
                covered_lines=8,
                num_statements=10,
                covered_branches=1,
                num_branches=2,
            ),
            "api/models/knowledge_fs.py": coverage_file(
                covered_lines=10,
                num_statements=10,
                covered_branches=2,
                num_branches=2,
            ),
        }
    )

    totals = validate_core_coverage(report, workspace_root=tmp_path, minimum=87.5)

    assert totals.covered == 21
    assert totals.total == 24
    assert totals.percent == pytest.approx(87.5)
    with pytest.raises(CoverageGateError, match=r"87\.50%.*minimum 88\.00%"):
        validate_core_coverage(report, workspace_root=tmp_path, minimum=88)

    del report["files"]["api/models/knowledge_fs.py"]
    with pytest.raises(CoverageGateError, match="coverage report is missing.*api/models/knowledge_fs.py"):
        validate_core_coverage(report, workspace_root=tmp_path, minimum=0)


def test_core_coverage_rejects_unclassified_knowledge_fs_production_files(tmp_path: Path) -> None:
    core_path = tmp_path / "api/services/knowledge_fs/runtime.py"
    escaped_path = tmp_path / "api/experimental/knowledge_fs_escape.py"
    core_path.parent.mkdir(parents=True)
    escaped_path.parent.mkdir(parents=True)
    core_path.touch()
    escaped_path.touch()
    report = coverage_report(
        {
            "api/services/knowledge_fs/runtime.py": coverage_file(
                covered_lines=1,
                num_statements=1,
                covered_branches=0,
                num_branches=0,
            )
        }
    )

    with pytest.raises(CoverageGateError, match="unclassified.*api/experimental/knowledge_fs_escape.py"):
        validate_core_coverage(report, workspace_root=tmp_path, minimum=0)


@pytest.mark.parametrize(
    "migration",
    [
        "api/migrations/versions/2026_07_21_1500-d4f6e8a1c305_add_knowledge_fs_remote_freeze_evidence.py",
        "api/migrations/versions/2026_07_21_1600-e5a7c9b2d416_add_knowledge_fs_cleanup_completion.py",
    ],
)
def test_core_coverage_allows_explicit_non_core_migrations(tmp_path: Path, migration: str) -> None:
    core_path = tmp_path / "api/services/knowledge_fs/runtime.py"
    migration_path = tmp_path / migration
    core_path.parent.mkdir(parents=True)
    migration_path.parent.mkdir(parents=True)
    core_path.touch()
    migration_path.touch()
    report = coverage_report(
        {
            "api/services/knowledge_fs/runtime.py": coverage_file(
                covered_lines=1,
                num_statements=1,
                covered_branches=0,
                num_branches=0,
            )
        }
    )

    totals = validate_core_coverage(report, workspace_root=tmp_path, minimum=100)

    assert totals.percent == 100


def test_parse_added_lines_and_validate_changed_glue_coverage() -> None:
    changed_lines = parse_added_lines(
        """diff --git a/api/app_factory.py b/api/app_factory.py
--- a/api/app_factory.py
+++ b/api/app_factory.py
@@ -10,0 +11,3 @@
+covered_call()
+missing_call()
+# non-executable note
diff --git a/api/services/account_service.py b/api/services/account_service.py
--- a/api/services/account_service.py
+++ b/api/services/account_service.py
@@ -40 +42 @@
-old_call()
+replacement_call()
"""
    )
    report = coverage_report(
        {
            "api/app_factory.py": coverage_file(
                covered_lines=1,
                num_statements=2,
                covered_branches=0,
                num_branches=0,
                executed_lines=[11],
                missing_lines=[12],
            ),
            "api/services/account_service.py": coverage_file(
                covered_lines=1,
                num_statements=1,
                covered_branches=0,
                num_branches=0,
                executed_lines=[42],
            ),
        }
    )

    assert changed_lines == {
        "api/app_factory.py": {11, 12, 13},
        "api/services/account_service.py": {42},
    }
    totals = validate_changed_glue_coverage(report, changed_lines=changed_lines, minimum=66)
    assert totals.covered == 2
    assert totals.total == 3
    assert totals.percent == pytest.approx(200 / 3)
    with pytest.raises(CoverageGateError, match=r"66\.67%.*minimum 90\.00%"):
        validate_changed_glue_coverage(report, changed_lines=changed_lines, minimum=90)

    del report["files"]["api/app_factory.py"]
    with pytest.raises(CoverageGateError, match="coverage report is missing changed glue file"):
        validate_changed_glue_coverage(report, changed_lines=changed_lines, minimum=0)


def test_glue_manifest_is_authoritative_and_fail_closed(tmp_path: Path) -> None:
    first = tmp_path / "api/app_factory.py"
    second = tmp_path / "api/extensions/ext_celery.py"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    first.touch()
    second.touch()
    manifest = tmp_path / "glue-files"
    manifest.write_bytes(b"api/app_factory.py\0api/extensions/ext_celery.py\0")

    assert load_glue_coverage_paths(manifest, workspace_root=tmp_path) == (
        "api/app_factory.py",
        "api/extensions/ext_celery.py",
    )

    manifest.write_bytes(b"")
    with pytest.raises(CoverageGateError, match="glue coverage target set is empty"):
        load_glue_coverage_paths(manifest, workspace_root=tmp_path)

    manifest.write_bytes(b"api/missing.py\0")
    with pytest.raises(CoverageGateError, match="glue coverage paths are invalid.*api/missing.py"):
        load_glue_coverage_paths(manifest, workspace_root=tmp_path)


def test_diff_base_resolution_is_explicit_and_fail_closed_for_a_single_commit(tmp_path: Path) -> None:
    subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)
    source = tmp_path / "source.py"
    source.write_text("value = 1\n")
    subprocess.run(["git", "add", "source.py"], cwd=tmp_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.email=coverage-test@example.com",
            "-c",
            "user.name=Coverage Test",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ],
        cwd=tmp_path,
        check=True,
    )
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    assert resolve_diff_base(tmp_path, head) == head
    with pytest.raises(CoverageGateError, match=r"cannot resolve coverage diff base HEAD\^"):
        resolve_diff_base(tmp_path, "")
    with pytest.raises(CoverageGateError, match="cannot resolve coverage diff base missing-base"):
        resolve_diff_base(tmp_path, "missing-base")


def coverage_report(files: dict[str, CoverageFile]) -> CoverageReport:
    return {"files": files}


def coverage_file(
    *,
    covered_lines: int,
    num_statements: int,
    covered_branches: int,
    num_branches: int,
    executed_lines: list[int] | None = None,
    missing_lines: list[int] | None = None,
) -> CoverageFile:
    summary = CoverageSummary(
        covered_lines=covered_lines,
        num_statements=num_statements,
        covered_branches=covered_branches,
        num_branches=num_branches,
    )
    return {
        "executed_lines": executed_lines or [],
        "missing_lines": missing_lines or [],
        "summary": summary,
    }
