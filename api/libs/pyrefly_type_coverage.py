"""Helpers for generating type-coverage summaries from pyrefly report output."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import TypedDict

    class CoverageSummary(TypedDict):
        n_modules: int
        n_typable: int
        n_typed: int
        n_any: int
        n_untyped: int
        coverage: float
        strict_coverage: float
else:
    CoverageSummary = dict


def parse_summary(report_json: str) -> CoverageSummary:
    """Extract the summary section from ``pyrefly report`` JSON output."""

    data = json.loads(report_json)
    summary = data["summary"]
    return CoverageSummary(
        n_modules=summary["n_modules"],
        n_typable=summary["n_typable"],
        n_typed=summary["n_typed"],
        n_any=summary["n_any"],
        n_untyped=summary["n_untyped"],
        coverage=summary["coverage"],
        strict_coverage=summary["strict_coverage"],
    )


def format_summary_markdown(summary: CoverageSummary) -> str:
    """Format a single coverage summary as a Markdown table."""

    return (
        "| Metric | Value |\n"
        "| --- | ---: |\n"
        f"| Modules | {summary['n_modules']} |\n"
        f"| Typable symbols | {summary['n_typable']:,} |\n"
        f"| Typed symbols | {summary['n_typed']:,} |\n"
        f"| Untyped symbols | {summary['n_untyped']:,} |\n"
        f"| Any symbols | {summary['n_any']:,} |\n"
        f"| **Type coverage** | **{summary['coverage']:.2f}%** |\n"
        f"| Strict coverage | {summary['strict_coverage']:.2f}% |"
    )


def format_comparison_markdown(
    base: CoverageSummary,
    pr: CoverageSummary,
) -> str:
    """Format a comparison between base and PR coverage as Markdown."""

    coverage_delta = pr["coverage"] - base["coverage"]
    strict_delta = pr["strict_coverage"] - base["strict_coverage"]
    typed_delta = pr["n_typed"] - base["n_typed"]
    untyped_delta = pr["n_untyped"] - base["n_untyped"]

    def _fmt_delta(value: float, fmt: str = ".2f") -> str:
        sign = "+" if value > 0 else ""
        return f"{sign}{value:{fmt}}"

    lines = [
        "| Metric | Base | PR | Delta |",
        "| --- | ---: | ---: | ---: |",
        (
            f"| **Type coverage** | {base['coverage']:.2f}% "
            f"| {pr['coverage']:.2f}% "
            f"| {_fmt_delta(coverage_delta)}% |"
        ),
        (
            f"| Strict coverage | {base['strict_coverage']:.2f}% "
            f"| {pr['strict_coverage']:.2f}% "
            f"| {_fmt_delta(strict_delta)}% |"
        ),
        (
            f"| Typed symbols | {base['n_typed']:,} "
            f"| {pr['n_typed']:,} "
            f"| {_fmt_delta(typed_delta, ',')} |"
        ),
        (
            f"| Untyped symbols | {base['n_untyped']:,} "
            f"| {pr['n_untyped']:,} "
            f"| {_fmt_delta(untyped_delta, ',')} |"
        ),
        (
            f"| Modules | {base['n_modules']} "
            f"| {pr['n_modules']} "
            f"| {_fmt_delta(pr['n_modules'] - base['n_modules'], ',')} |"
        ),
    ]
    return "\n".join(lines)


def main() -> int:
    """Read pyrefly report JSON from stdin and print a Markdown summary.

    Accepts an optional ``--base <file>`` argument. When provided, the output
    includes a base-vs-PR comparison table.
    """

    args = sys.argv[1:]

    base_file: str | None = None
    if "--base" in args:
        idx = args.index("--base")
        if idx + 1 >= len(args):
            sys.stderr.write("error: --base requires a file path\n")
            return 1
        base_file = args[idx + 1]

    pr_report = sys.stdin.read()
    pr_summary = parse_summary(pr_report)

    if base_file is not None:
        base_summary = parse_summary(Path(base_file).read_text())
        sys.stdout.write(format_comparison_markdown(base_summary, pr_summary) + "\n")
    else:
        sys.stdout.write(format_summary_markdown(pr_summary) + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
