"""Gate import-linter violations against a committed baseline snapshot.

This wrapper keeps import-linter as the source of truth for architectural
contracts, then snapshots the broken direct-import edges per contract and
importer module. The default comparison mode is ``subset`` because it prevents
same-count replacements from silently regressing the architecture. A weaker
``count`` mode is also available when a team explicitly wants count-only gating.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from importlinter import configuration
from importlinter.application import use_cases

type ComparisonMode = Literal["subset", "count"]
type Snapshot = dict[str, dict[str, list[str]]]

BASELINE_VERSION = 1
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / ".importlinter"


@dataclass(frozen=True)
class SnapshotFailure:
    contract_name: str
    importer: str
    baseline_count: int
    current_count: int
    extra_imports: tuple[str, ...]


def load_report(config_path: str | None = None, contract_ids: tuple[str, ...] = ()) -> Any:
    """Build and return an import-linter report using the same path setup as the CLI."""

    configuration.configure()
    api_dir = str(DEFAULT_CONFIG_PATH.parent)
    cwd = os.getcwd()
    for candidate in (api_dir, cwd):
        if candidate not in sys.path:
            sys.path.insert(0, candidate)
    resolved_config_path = config_path or str(DEFAULT_CONFIG_PATH)
    user_options = use_cases.read_user_options(config_filename=resolved_config_path)
    return use_cases.create_report(
        user_options=user_options,
        limit_to_contracts=contract_ids,
    )


def snapshot_from_report(report: Any) -> Snapshot:
    """Return broken direct-import edges grouped by contract and importer module."""

    snapshot: dict[str, dict[str, set[str]]] = {}
    for contract, check in report.get_contracts_and_checks():
        if check.kept:
            continue

        imports_by_importer: dict[str, set[str]] = defaultdict(set)
        for importer, imported in _iter_direct_imports(check.metadata):
            imports_by_importer[importer].add(imported)

        if check.metadata and not imports_by_importer:
            raise ValueError(f"Broken contract '{contract.name}' does not expose direct import edges in metadata.")

        if imports_by_importer:
            snapshot[contract.name] = {
                importer: sorted(imported_modules) for importer, imported_modules in sorted(imports_by_importer.items())
            }

    return {contract_name: snapshot[contract_name] for contract_name in sorted(snapshot)}


def compare_snapshots(
    current_snapshot: Snapshot,
    baseline_snapshot: Snapshot,
    comparison: ComparisonMode = "subset",
) -> list[SnapshotFailure]:
    """Compare the current and baseline snapshots and return any regressions."""

    failures: list[SnapshotFailure] = []

    contract_names = sorted(set(current_snapshot) | set(baseline_snapshot))
    for contract_name in contract_names:
        current_by_importer = current_snapshot.get(contract_name, {})
        baseline_by_importer = baseline_snapshot.get(contract_name, {})

        for importer in sorted(set(current_by_importer) | set(baseline_by_importer)):
            current_imports = set(current_by_importer.get(importer, []))
            baseline_imports = set(baseline_by_importer.get(importer, []))
            extra_imports = tuple(sorted(current_imports - baseline_imports))

            if comparison == "subset":
                is_failure = bool(extra_imports)
            else:
                is_failure = len(current_imports) > len(baseline_imports)

            if is_failure:
                failures.append(
                    SnapshotFailure(
                        contract_name=contract_name,
                        importer=importer,
                        baseline_count=len(baseline_imports),
                        current_count=len(current_imports),
                        extra_imports=extra_imports,
                    )
                )

    return failures


def load_baseline(path: Path) -> Snapshot:
    """Load and validate a baseline file."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    version = payload.get("version")
    if version != BASELINE_VERSION:
        raise ValueError(f"Unsupported baseline version {version!r}; expected {BASELINE_VERSION}.")

    contracts = payload.get("contracts")
    if not isinstance(contracts, dict):
        raise ValueError("Baseline file must contain a 'contracts' object.")

    normalized: Snapshot = {}
    for contract_name, importers in contracts.items():
        if not isinstance(contract_name, str) or not isinstance(importers, dict):
            raise ValueError("Each baseline contract entry must be an object keyed by contract name.")

        normalized[contract_name] = {}
        for importer, imported_modules in importers.items():
            if not isinstance(importer, str) or not isinstance(imported_modules, list):
                raise ValueError("Each baseline importer entry must map to a list of modules.")
            if not all(isinstance(module_name, str) for module_name in imported_modules):
                raise ValueError("Each baseline imported module must be a string.")
            normalized[contract_name][importer] = sorted(set(imported_modules))

    return normalized


def write_baseline(path: Path, snapshot: Snapshot) -> None:
    """Persist the supplied snapshot as a JSON baseline file."""

    payload = {
        "version": BASELINE_VERSION,
        "contracts": snapshot,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = build_argument_parser()
    args = parser.parse_args(argv)

    baseline_path = args.baseline
    current_snapshot = snapshot_from_report(load_report(config_path=args.config, contract_ids=tuple(args.contract)))

    if args.write_baseline:
        write_baseline(baseline_path, current_snapshot)
        _write_line(f"Wrote import baseline to {baseline_path}.")
        return 0

    baseline_snapshot = load_baseline(baseline_path)
    failures = compare_snapshots(
        current_snapshot=current_snapshot,
        baseline_snapshot=baseline_snapshot,
        comparison=args.comparison,
    )
    if failures:
        _print_failures(failures, comparison=args.comparison)
        return 1

    _write_line(
        "Import baseline OK. "
        f"Checked {sum(len(importers) for importers in current_snapshot.values())} importer entries."
    )
    return 0


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare current import-linter violations against a committed baseline."
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        required=True,
        help="Path to the committed baseline JSON file.",
    )
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Write the current violation snapshot to the baseline file and exit.",
    )
    parser.add_argument(
        "--comparison",
        choices=("subset", "count"),
        default="subset",
        help="Comparison strategy. 'subset' is stricter and is the default.",
    )
    parser.add_argument(
        "--config",
        help="Optional import-linter config file path.",
    )
    parser.add_argument(
        "--contract",
        action="append",
        default=[],
        help="Optional contract id filter. May be passed multiple times.",
    )
    return parser


def _iter_direct_imports(node: object, seen: set[int] | None = None):
    if seen is None:
        seen = set()

    if node is None or isinstance(node, (str, int, float, bool)):
        return

    if dataclasses.is_dataclass(node):
        yield from _iter_direct_imports(dataclasses.asdict(node), seen)
        return

    if isinstance(node, dict):
        marker = id(node)
        if marker in seen:
            return
        seen.add(marker)

        importer = node.get("importer")
        imported = node.get("imported")
        if isinstance(importer, str) and isinstance(imported, str):
            yield importer, imported

        for value in node.values():
            yield from _iter_direct_imports(value, seen)
        return

    if isinstance(node, (list, tuple, set, frozenset)):
        marker = id(node)
        if marker in seen:
            return
        seen.add(marker)

        for item in node:
            yield from _iter_direct_imports(item, seen)
        return

    if hasattr(node, "__dict__"):
        marker = id(node)
        if marker in seen:
            return
        seen.add(marker)
        yield from _iter_direct_imports(vars(node), seen)


def _print_failures(failures: list[SnapshotFailure], comparison: ComparisonMode) -> None:
    _write_line(f"Import baseline regression detected ({comparison} mode):")
    for failure in failures:
        _write_line(
            f"- [{failure.contract_name}] {failure.importer}: "
            f"baseline={failure.baseline_count}, current={failure.current_count}"
        )
        if failure.extra_imports:
            _write_line(f"  new imports: {', '.join(failure.extra_imports)}")


def _write_line(message: str) -> None:
    sys.stdout.write(f"{message}\n")


if __name__ == "__main__":
    raise SystemExit(main())
