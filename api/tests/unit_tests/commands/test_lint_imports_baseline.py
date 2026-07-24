import importlib.util
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError


def _load_lint_imports_baseline_module():
    repo_root = Path(__file__).parents[4]
    script_path = repo_root / "scripts" / "lint_imports_baseline.py"
    spec = importlib.util.spec_from_file_location("lint_imports_baseline", script_path)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@dataclass(frozen=True)
class _FakeContract:
    name: str


@dataclass(frozen=True)
class _ProtectedImportGroup:
    top_level_module: str
    illegal_links: list[dict[str, object]]
    original_expression: str | None = None


class _FakeReport:
    def __init__(self, entries: list[tuple[_FakeContract, SimpleNamespace]]) -> None:
        self._entries = entries

    def get_contracts_and_checks(self):
        return iter(self._entries)


def test_snapshot_from_report_collects_unique_direct_imports_from_nested_metadata():
    module = _load_lint_imports_baseline_module()
    report = _FakeReport(
        [
            (
                _FakeContract("layers"),
                SimpleNamespace(
                    kept=False,
                    metadata={
                        "invalid_dependencies": [
                            {
                                "routes": [
                                    {
                                        "chain": [
                                            {
                                                "importer": "controllers.apps.list",
                                                "imported": "services.apps",
                                                "line_numbers": (3,),
                                            },
                                            {
                                                "importer": "services.apps",
                                                "imported": "core.apps",
                                                "line_numbers": (4,),
                                            },
                                        ],
                                        "extra_firsts": [],
                                        "extra_lasts": [],
                                    },
                                    {
                                        "chain": [
                                            {
                                                "importer": "controllers.apps.list",
                                                "imported": "services.apps",
                                                "line_numbers": (9,),
                                            }
                                        ],
                                        "extra_firsts": [],
                                        "extra_lasts": [],
                                    },
                                ]
                            }
                        ]
                    },
                ),
            ),
            (
                _FakeContract("protected"),
                SimpleNamespace(
                    kept=False,
                    metadata={
                        "illegal_imports": [
                            _ProtectedImportGroup(
                                top_level_module="extensions.secret",
                                illegal_links=[
                                    {
                                        "importer": "controllers.apps.list",
                                        "imported": "extensions.secret",
                                        "line_numbers": (12,),
                                    }
                                ],
                            )
                        ]
                    },
                ),
            ),
        ]
    )

    assert module.snapshot_from_report(report) == {
        "layers": {
            "controllers.apps.list": ["services.apps"],
            "services.apps": ["core.apps"],
        },
        "protected": {
            "controllers.apps.list": ["extensions.secret"],
        },
    }


def test_compare_snapshots_reports_new_direct_imports_in_subset_mode():
    module = _load_lint_imports_baseline_module()

    failures = module.compare_snapshots(
        current_snapshot={
            "layers": {
                "controllers.apps.list": ["services.apps", "services.billing"],
            }
        },
        baseline_snapshot={
            "layers": {
                "controllers.apps.list": ["services.apps"],
            }
        },
        comparison="subset",
    )

    assert len(failures) == 1
    assert failures[0].contract_name == "layers"
    assert failures[0].importer == "controllers.apps.list"
    assert failures[0].extra_imports == ("services.billing",)
    assert failures[0].baseline_count == 1
    assert failures[0].current_count == 2


def test_compare_snapshots_count_mode_rejects_only_growth():
    module = _load_lint_imports_baseline_module()

    failures = module.compare_snapshots(
        current_snapshot={
            "layers": {
                "controllers.apps.list": ["services.apps", "services.billing", "services.audit"],
            }
        },
        baseline_snapshot={
            "layers": {
                "controllers.apps.list": ["services.apps", "services.billing"],
            }
        },
        comparison="count",
    )

    assert len(failures) == 1
    assert failures[0].current_count == 3
    assert failures[0].baseline_count == 2


def test_main_writes_baseline_snapshot(tmp_path: Path, monkeypatch):
    module = _load_lint_imports_baseline_module()
    baseline_path = tmp_path / "import-baseline.json"

    monkeypatch.setattr(
        module,
        "load_report",
        lambda **_: _FakeReport(
            [
                (
                    _FakeContract("layers"),
                    SimpleNamespace(
                        kept=False,
                        metadata={
                            "invalid_dependencies": [
                                {
                                    "routes": [
                                        {
                                            "chain": [
                                                {
                                                    "importer": "controllers.apps.list",
                                                    "imported": "services.apps",
                                                    "line_numbers": (3,),
                                                }
                                            ],
                                            "extra_firsts": [],
                                            "extra_lasts": [],
                                        }
                                    ]
                                }
                            ]
                        },
                    ),
                )
            ]
        ),
    )

    assert module.main(["--baseline", str(baseline_path), "--write-baseline"]) == 0
    assert json.loads(baseline_path.read_text(encoding="utf-8")) == {
        "version": 1,
        "contracts": {
            "layers": {
                "controllers.apps.list": ["services.apps"],
            }
        },
    }


def test_main_fails_on_replacement_violation_in_default_subset_mode(tmp_path: Path, monkeypatch, capsys):
    module = _load_lint_imports_baseline_module()
    baseline_path = tmp_path / "import-baseline.json"
    baseline_path.write_text(
        json.dumps(
            {
                "version": 1,
                "contracts": {
                    "layers": {
                        "controllers.apps.list": ["services.apps"],
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        module,
        "load_report",
        lambda **_: _FakeReport(
            [
                (
                    _FakeContract("layers"),
                    SimpleNamespace(
                        kept=False,
                        metadata={
                            "invalid_dependencies": [
                                {
                                    "routes": [
                                        {
                                            "chain": [
                                                {
                                                    "importer": "controllers.apps.list",
                                                    "imported": "services.billing",
                                                    "line_numbers": (8,),
                                                }
                                            ],
                                            "extra_firsts": [],
                                            "extra_lasts": [],
                                        }
                                    ]
                                }
                            ]
                        },
                    ),
                )
            ]
        ),
    )

    assert module.main(["--baseline", str(baseline_path)]) == 1
    output = capsys.readouterr().out
    assert "controllers.apps.list" in output
    assert "services.billing" in output


def test_load_baseline_rejects_unexpected_top_level_fields(tmp_path: Path):
    module = _load_lint_imports_baseline_module()
    baseline_path = tmp_path / "import-baseline.json"
    baseline_path.write_text(
        json.dumps(
            {
                "version": 1,
                "contracts": {},
                "unexpected": True,
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        module.load_baseline(baseline_path)
