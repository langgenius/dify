"""Enforce coverage thresholds against an explicit immutable file scope."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, TypeAdapter

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class CoverageGateError(RuntimeError):
    """Coverage data or a measured percentage violates the configured gate."""


class _CoverageFileSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    covered_lines: int
    num_statements: int
    covered_branches: int
    num_branches: int


class _CoverageFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: _CoverageFileSummary


class _CoverageReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    files: dict[str, _CoverageFile]


_SCOPE_MANIFEST_ADAPTER = TypeAdapter(dict[str, tuple[str, ...]])


@dataclass(frozen=True, slots=True)
class CoverageSummary:
    """Aggregated statement and branch counts for one fixed file scope."""

    scoped_files: tuple[str, ...]
    covered_statements: int
    statements: int
    covered_branches: int
    branches: int

    @property
    def statement_percent(self) -> float:
        return _percentage(self.covered_statements, self.statements)

    @property
    def branch_percent(self) -> float:
        return _percentage(self.covered_branches, self.branches)

    @property
    def total_percent(self) -> float:
        return _percentage(
            self.covered_statements + self.covered_branches,
            self.statements + self.branches,
        )


def load_scope(manifest_path: Path, scope_name: str, *, repository_root: Path) -> tuple[str, ...]:
    """Load one named scope and reject denominator drift before reading coverage."""

    manifest = _SCOPE_MANIFEST_ADAPTER.validate_json(manifest_path.read_text())
    try:
        scoped_files = manifest[scope_name]
    except KeyError as error:
        raise CoverageGateError(f"coverage scope is not declared: {scope_name}") from error
    if not scoped_files:
        raise CoverageGateError(f"coverage scope is empty: {scope_name}")
    if len(set(scoped_files)) != len(scoped_files):
        raise CoverageGateError(f"coverage scope contains a duplicate file: {scope_name}")
    for relative_path in scoped_files:
        if not (repository_root / relative_path).is_file():
            raise CoverageGateError(f"coverage scope file does not exist: {relative_path}")
    return scoped_files


def summarize_coverage(
    report_data: Mapping[str, object] | _CoverageReport,
    scoped_files: Sequence[str],
) -> CoverageSummary:
    """Aggregate only declared files and fail if coverage omitted one of them."""

    report = report_data if isinstance(report_data, _CoverageReport) else _CoverageReport.model_validate(report_data)
    covered_statements = 0
    statements = 0
    covered_branches = 0
    branches = 0
    for relative_path in scoped_files:
        measured_file = report.files.get(relative_path)
        if measured_file is None:
            raise CoverageGateError(f"coverage data omitted scoped file: {relative_path}")
        summary = measured_file.summary
        covered_statements += summary.covered_lines
        statements += summary.num_statements
        covered_branches += summary.covered_branches
        branches += summary.num_branches
    return CoverageSummary(
        tuple(scoped_files),
        covered_statements,
        statements,
        covered_branches,
        branches,
    )


def enforce_coverage(
    summary: CoverageSummary,
    *,
    minimum_statement: float | None = None,
    minimum_branch: float | None = None,
    minimum_total: float | None = None,
) -> None:
    """Enforce each configured threshold without substituting another metric."""

    _enforce_metric("statement", summary.statement_percent, minimum_statement)
    _enforce_metric("branch", summary.branch_percent, minimum_branch)
    _enforce_metric("total", summary.total_percent, minimum_total)


def _enforce_metric(metric: str, actual: float, minimum: float | None) -> None:
    if minimum is not None and actual < minimum:
        raise CoverageGateError(f"{metric} coverage {actual:.2f}% is below {minimum:.2f}%")


def _percentage(covered: int, total: int) -> float:
    if total == 0:
        return 100.0
    return covered / total * 100


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--coverage-json", type=Path, required=True)
    parser.add_argument("--scope-manifest", type=Path, required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--repository-root", type=Path, default=REPOSITORY_ROOT)
    parser.add_argument("--minimum-statement", type=float)
    parser.add_argument("--minimum-branch", type=float)
    parser.add_argument("--minimum-total", type=float)
    args = parser.parse_args()

    try:
        scoped_files = load_scope(args.scope_manifest, args.scope, repository_root=args.repository_root)
        report = _CoverageReport.model_validate_json(args.coverage_json.read_text())
        summary = summarize_coverage(report, scoped_files)
        enforce_coverage(
            summary,
            minimum_statement=args.minimum_statement,
            minimum_branch=args.minimum_branch,
            minimum_total=args.minimum_total,
        )
    except CoverageGateError as error:
        print(f"Coverage gate failed: {error}", file=sys.stderr)  # noqa: T201
        return 1

    print(  # noqa: T201
        f"Coverage gate passed for {len(scoped_files)} files: "
        f"statements={summary.statement_percent:.2f}%, "
        f"branches={summary.branch_percent:.2f}%, total={summary.total_percent:.2f}%"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
