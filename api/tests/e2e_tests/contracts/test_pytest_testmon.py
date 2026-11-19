from dataclasses import dataclass
from pathlib import Path

from tests.pytest_testmon import UNTRACKED_TEST_FILES, remove_untracked_from_selection

_API_ROOT = Path(__file__).resolve().parents[3]


@dataclass
class _TestmonSelection:
    """Holds the two lists that testmon's selection plugin deselects from."""

    deselected_files: list[str]
    deselected_tests: list[str]


def test_untracked_test_files_exist() -> None:
    missing = sorted(path for path in UNTRACKED_TEST_FILES if not (_API_ROOT / path).is_file())
    assert missing == []


def test_remove_untracked_from_selection_keeps_other_deselections() -> None:
    untracked = "tests/unit_tests/models/test_enums.py"
    tracked = "tests/unit_tests/models/test_account.py"
    selection = _TestmonSelection(
        deselected_files=[untracked, tracked],
        deselected_tests=[f"{untracked}::test_enum", f"{tracked}::test_account"],
    )

    remove_untracked_from_selection(selection)

    assert selection.deselected_files == [tracked]
    assert selection.deselected_tests == [f"{tracked}::test_account"]
