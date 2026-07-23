"""Enforce focused KnowledgeFS coverage without hiding integration-critical glue.

The primary threshold aggregates statement and branch coverage for every Dify
module owned by the KnowledgeFS integration. Large pre-existing Dify modules
that only contain narrow integration hooks are checked with changed-line
coverage instead, so unrelated legacy code cannot dilute or inflate the gate.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
NON_CORE_COVERAGE_ALLOWLIST = frozenset(
    {
        "api/dev/check_knowledge_fs_coverage.py",
        "api/dev/generate_knowledge_fs_contract.py",
        "api/dev/knowledge_fs_product_contract.py",
        "api/migrations/versions/2026_07_21_1200-a4e7c2f91b30_add_knowledge_fs_control_plane.py",
        "api/migrations/versions/2026_07_21_1300-b7f2a9d41c60_add_knowledge_fs_cutover.py",
        "api/migrations/versions/2026_07_21_1400-c8e31b7d52a4_add_knowledge_fs_cleanup_authorization.py",
        "api/migrations/versions/2026_07_21_1500-d4f6e8a1c305_add_knowledge_fs_remote_freeze_evidence.py",
        "api/migrations/versions/2026_07_21_1600-e5a7c9b2d416_add_knowledge_fs_cleanup_completion.py",
    }
)
HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
logger = logging.getLogger(__name__)


class CoverageSummary(TypedDict):
    """Coverage.py counts required by the aggregate gate."""

    covered_lines: int
    num_statements: int
    covered_branches: int
    num_branches: int


class CoverageFile(TypedDict):
    """Per-file coverage data emitted by ``coverage json``."""

    executed_lines: list[int]
    missing_lines: list[int]
    summary: CoverageSummary


class CoverageReport(TypedDict):
    """Relevant top-level shape of a coverage.py JSON report."""

    files: dict[str, CoverageFile]


@dataclass(frozen=True, slots=True)
class CoverageTotals:
    """Covered and measurable units for one gate surface."""

    covered: int
    total: int

    @property
    def percent(self) -> float:
        return 100.0 if self.total == 0 else self.covered * 100 / self.total


class CoverageGateError(RuntimeError):
    """Raised when coverage input is incomplete or below its threshold."""


def main() -> None:
    """Validate focused module coverage and changed integration glue."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--coverage-json", type=Path, required=True)
    parser.add_argument("--glue-manifest", type=Path, required=True)
    parser.add_argument("--workspace-root", type=Path, default=WORKSPACE_ROOT)
    parser.add_argument("--base", default="")
    parser.add_argument("--minimum", type=float, default=90.0)
    parser.add_argument("--glue-minimum", type=float, default=90.0)
    args = parser.parse_args()

    workspace_root = args.workspace_root.resolve()
    report = load_coverage_report(args.coverage_json)
    core_totals = validate_core_coverage(report, workspace_root=workspace_root, minimum=args.minimum)
    base = resolve_diff_base(workspace_root, args.base)
    glue_paths = load_glue_coverage_paths(args.glue_manifest, workspace_root=workspace_root)
    changed_lines = collect_changed_glue_lines(workspace_root, base, glue_paths=glue_paths)
    glue_totals = validate_changed_glue_coverage(
        report,
        changed_lines=changed_lines,
        minimum=args.glue_minimum,
    )
    logger.info(
        "Dify KnowledgeFS coverage passed: core lines+branches %.2f%% (%d/%d); changed glue lines %.2f%% (%d/%d)",
        core_totals.percent,
        core_totals.covered,
        core_totals.total,
        glue_totals.percent,
        glue_totals.covered,
        glue_totals.total,
    )


def load_coverage_report(path: Path) -> CoverageReport:
    """Load the detailed JSON report used by both coverage checks."""
    if not path.is_file():
        raise CoverageGateError(f"coverage JSON does not exist: {path}")
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or not isinstance(document.get("files"), dict):
        raise CoverageGateError(f"coverage JSON has no files object: {path}")
    return cast(CoverageReport, document)


def load_glue_coverage_paths(path: Path, *, workspace_root: Path) -> tuple[str, ...]:
    """Load the workflow's authoritative NUL-delimited integration touchpoints."""
    if not path.is_file():
        raise CoverageGateError(f"KnowledgeFS glue manifest does not exist: {path}")
    try:
        paths = tuple(item.decode() for item in path.read_bytes().split(b"\0") if item)
    except UnicodeDecodeError as error:
        raise CoverageGateError(f"KnowledgeFS glue manifest is not UTF-8: {path}") from error
    if not paths:
        raise CoverageGateError("Dify KnowledgeFS glue coverage target set is empty")
    if len(paths) != len(set(paths)):
        raise CoverageGateError("Dify KnowledgeFS glue coverage manifest contains duplicate paths")
    invalid_paths = [
        candidate
        for candidate in paths
        if not candidate.startswith("api/")
        or not candidate.endswith(".py")
        or not (workspace_root / candidate).is_file()
    ]
    if invalid_paths:
        raise CoverageGateError(f"Dify KnowledgeFS glue coverage paths are invalid: {', '.join(invalid_paths)}")
    return paths


def is_core_coverage_path(path: str) -> bool:
    """Return whether a repository-relative path belongs to the focused aggregate."""
    if not path.endswith(".py"):
        return False
    if path in {
        "api/commands/knowledge_fs.py",
        "api/configs/extra/knowledge_fs_config.py",
        "api/extensions/ext_knowledge_fs_observability.py",
        "api/services/knowledge_fs_capability.py",
    }:
        return True
    if path.startswith(
        (
            "api/controllers/console/knowledge_fs/",
            "api/controllers/inner_api/knowledge_fs/",
            "api/controllers/service_api/knowledge_fs/",
            "api/core/tools/builtin_tool/providers/knowledge_fs/",
            "api/services/knowledge_fs/",
        )
    ):
        return True
    filename = path.rsplit("/", maxsplit=1)[-1]
    return (
        path.startswith("api/models/")
        and filename.startswith("knowledge_fs")
        or path.startswith("api/repositories/")
        and "knowledge_fs" in filename
        or path.startswith("api/tasks/")
        and "knowledge_fs" in filename
    )


def discover_core_coverage_paths(workspace_root: Path) -> tuple[str, ...]:
    """Classify every KnowledgeFS-named production file or fail closed."""
    named_paths = discover_knowledge_fs_production_paths(workspace_root)
    core_paths = {path for path in named_paths if is_core_coverage_path(path)}
    unclassified_paths = set(named_paths) - core_paths - NON_CORE_COVERAGE_ALLOWLIST
    if unclassified_paths:
        raise CoverageGateError(
            "unclassified Dify KnowledgeFS production files must join the core coverage scope or explicit allowlist: "
            + ", ".join(sorted(unclassified_paths))
        )
    if not core_paths:
        raise CoverageGateError("Dify KnowledgeFS core coverage target set is empty")
    return tuple(sorted(core_paths))


def discover_knowledge_fs_production_paths(workspace_root: Path) -> tuple[str, ...]:
    """Mirror the workflow's dynamic KnowledgeFS filename discovery."""
    api_root = workspace_root / "api"
    if not api_root.is_dir():
        raise CoverageGateError(f"Dify API directory does not exist: {api_root}")
    paths: set[str] = set()
    for directory, child_directories, filenames in os.walk(api_root):
        current_directory = Path(directory)
        if current_directory == api_root:
            child_directories[:] = [name for name in child_directories if name not in {".venv", "storage", "tests"}]
        child_directories[:] = [name for name in child_directories if name != "__pycache__"]
        for filename in filenames:
            path = (current_directory / filename).relative_to(workspace_root).as_posix()
            if filename.endswith(".py") and "knowledge_fs" in path:
                paths.add(path)
    if not paths:
        raise CoverageGateError("Dify KnowledgeFS production target set is empty")
    return tuple(sorted(paths))


def validate_core_coverage(
    report: CoverageReport,
    *,
    workspace_root: Path,
    minimum: float,
) -> CoverageTotals:
    """Require the exact combined line-and-branch percentage for all core files."""
    paths = discover_core_coverage_paths(workspace_root)
    missing_paths = [path for path in paths if path not in report["files"]]
    if missing_paths:
        raise CoverageGateError(f"coverage report is missing core files: {', '.join(missing_paths)}")

    covered = 0
    total = 0
    for path in paths:
        summary = report["files"][path]["summary"]
        covered += summary["covered_lines"] + summary["covered_branches"]
        total += summary["num_statements"] + summary["num_branches"]
    if total == 0:
        raise CoverageGateError("Dify KnowledgeFS core coverage has no measurable statements or branches")

    totals = CoverageTotals(covered=covered, total=total)
    _require_minimum(totals, minimum=minimum, label="Dify KnowledgeFS core line-and-branch coverage")
    return totals


def resolve_diff_base(workspace_root: Path, preferred: str) -> str:
    """Resolve an explicit event base, falling back to the previous commit for manual runs."""
    base = preferred.strip()
    if not base or set(base) == {"0"}:
        base = "HEAD^"
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{base}^{{commit}}"],
        cwd=workspace_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "commit is unavailable"
        raise CoverageGateError(f"cannot resolve coverage diff base {base}: {detail}")
    return base


def collect_changed_glue_lines(
    workspace_root: Path,
    base: str,
    *,
    glue_paths: tuple[str, ...],
) -> dict[str, set[int]]:
    """Return added line numbers in the narrow Dify modules touched by this integration."""
    result = subprocess.run(
        [
            "git",
            "diff",
            "--no-ext-diff",
            "--no-color",
            "--unified=0",
            base,
            "--",
            *glue_paths,
        ],
        cwd=workspace_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "git diff failed"
        raise CoverageGateError(f"cannot collect KnowledgeFS glue diff from {base}: {detail}")
    return parse_added_lines(result.stdout)


def parse_added_lines(diff: str) -> dict[str, set[int]]:
    """Parse repository paths and added-side line numbers from a zero-context Git diff."""
    changed_lines: dict[str, set[int]] = {}
    current_path: str | None = None
    current_line: int | None = None
    for raw_line in diff.splitlines():
        if raw_line.startswith("diff --git "):
            current_line = None
            continue
        if raw_line.startswith("+++ "):
            candidate = raw_line[4:]
            current_path = candidate[2:] if candidate.startswith("b/") else None
            if current_path is not None:
                changed_lines.setdefault(current_path, set())
            current_line = None
            continue
        if raw_line.startswith("@@ "):
            match = HUNK_HEADER.match(raw_line)
            current_line = int(match.group(1)) if match is not None else None
            continue
        if current_path is None or current_line is None:
            continue
        if raw_line.startswith("+"):
            changed_lines[current_path].add(current_line)
            current_line += 1
        elif raw_line.startswith("-") or raw_line.startswith("\\"):
            continue
        else:
            current_line += 1
    return changed_lines


def validate_changed_glue_coverage(
    report: CoverageReport,
    *,
    changed_lines: dict[str, set[int]],
    minimum: float,
) -> CoverageTotals:
    """Require added executable glue lines to be exercised by the focused unit suite."""
    covered = 0
    total = 0
    for path, lines in sorted(changed_lines.items()):
        if not lines:
            continue
        file_coverage = report["files"].get(path)
        if file_coverage is None:
            raise CoverageGateError(f"coverage report is missing changed glue file: {path}")
        executed_lines = set(file_coverage["executed_lines"])
        executable_lines = executed_lines | set(file_coverage["missing_lines"])
        changed_executable_lines = lines & executable_lines
        covered += len(changed_executable_lines & executed_lines)
        total += len(changed_executable_lines)

    totals = CoverageTotals(covered=covered, total=total)
    _require_minimum(totals, minimum=minimum, label="Dify KnowledgeFS changed-glue line coverage")
    return totals


def _require_minimum(totals: CoverageTotals, *, minimum: float, label: str) -> None:
    if totals.percent + 1e-12 < minimum:
        raise CoverageGateError(f"{label} is {totals.percent:.2f}%; minimum {minimum:.2f}%")


if __name__ == "__main__":
    main()
