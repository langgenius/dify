"""Unit tests for PerOutputTypeChecker.

Stage 4 §5.1-§5.3.
"""

from __future__ import annotations

from collections.abc import Mapping

import pytest

from core.workflow.nodes.agent_v2.output_type_checker import (
    OutputTypeCheckStatus,
    PerOutputTypeChecker,
)
from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputConfig,
    DeclaredOutputType,
)


class StubFileValidator:
    """Trivially records the set of file_ids that pass tenant scope."""

    def __init__(self, *, allowed: Mapping[str, set[str]] | None = None) -> None:
        # Mapping: tenant_id -> {file_id, ...}
        self._allowed = {tenant: set(ids) for tenant, ids in (allowed or {}).items()}

    def is_owned_by_tenant(self, *, file_id: str, tenant_id: str) -> bool:
        return file_id in self._allowed.get(tenant_id, set())


def _str_output(name: str = "summary", required: bool = True) -> DeclaredOutputConfig:
    return DeclaredOutputConfig(name=name, type=DeclaredOutputType.STRING, required=required)


def _make_checker(*, allowed: Mapping[str, set[str]] | None = None) -> PerOutputTypeChecker:
    return PerOutputTypeChecker(file_validator=StubFileValidator(allowed=allowed))


# ──────────────────────────────────────────────────────────────────────────────
# Happy path per type
# ──────────────────────────────────────────────────────────────────────────────


def test_all_scalar_types_ready_on_correct_payload():
    checker = _make_checker()
    declared = [
        DeclaredOutputConfig(name="s", type=DeclaredOutputType.STRING),
        DeclaredOutputConfig(name="n", type=DeclaredOutputType.NUMBER),
        DeclaredOutputConfig(name="b", type=DeclaredOutputType.BOOLEAN),
        DeclaredOutputConfig(name="o", type=DeclaredOutputType.OBJECT),
    ]
    payload = {"s": "hello", "n": 3.14, "b": True, "o": {"k": "v"}}

    outcome = checker.check(declared_outputs=declared, raw_output=payload, tenant_id="t-1")

    assert not outcome.has_failures
    assert {r.name: r.status for r in outcome.results} == {
        "s": OutputTypeCheckStatus.READY,
        "n": OutputTypeCheckStatus.READY,
        "b": OutputTypeCheckStatus.READY,
        "o": OutputTypeCheckStatus.READY,
    }


def test_number_rejects_bool_even_though_python_says_isinstance_int():
    checker = _make_checker()
    outcome = checker.check(
        declared_outputs=[DeclaredOutputConfig(name="n", type=DeclaredOutputType.NUMBER)],
        raw_output={"n": True},
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert outcome.failures[0].reason == "expected number, got bool"


@pytest.mark.parametrize(
    ("declared_type", "wrong_value", "expected_kind"),
    [
        (DeclaredOutputType.STRING, 123, "int"),
        (DeclaredOutputType.NUMBER, "x", "str"),
        (DeclaredOutputType.BOOLEAN, "yes", "str"),
        (DeclaredOutputType.OBJECT, [1, 2], "list"),
    ],
)
def test_type_mismatch_reported_with_actual_kind(declared_type, wrong_value, expected_kind):
    checker = _make_checker()
    outcome = checker.check(
        declared_outputs=[DeclaredOutputConfig(name="x", type=declared_type)],
        raw_output={"x": wrong_value},
        tenant_id="t-1",
    )

    assert outcome.failures[0].status == OutputTypeCheckStatus.TYPE_CHECK_FAILED
    assert expected_kind in (outcome.failures[0].reason or "")


# ──────────────────────────────────────────────────────────────────────────────
# Array + array_item recursion
# ──────────────────────────────────────────────────────────────────────────────


def test_array_of_strings_validates_each_item():
    checker = _make_checker()
    declared = DeclaredOutputConfig(
        name="tags",
        type=DeclaredOutputType.ARRAY,
        array_item=DeclaredArrayItem(type=DeclaredOutputType.STRING),
    )

    ok = checker.check(declared_outputs=[declared], raw_output={"tags": ["a", "b"]}, tenant_id="t-1")
    bad = checker.check(declared_outputs=[declared], raw_output={"tags": ["a", 2]}, tenant_id="t-1")

    assert not ok.has_failures
    reason = bad.failures[0].reason
    assert reason is not None
    assert reason.startswith("items[1]:")


def test_array_of_files_validates_per_item_file_ref():
    checker = _make_checker(allowed={"t-1": {"file-A"}})
    declared = DeclaredOutputConfig(
        name="docs",
        type=DeclaredOutputType.ARRAY,
        array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
    )

    ok = checker.check(
        declared_outputs=[declared],
        raw_output={"docs": [{"file_id": "file-A", "filename": "a.pdf"}]},
        tenant_id="t-1",
    )
    cross_tenant = checker.check(
        declared_outputs=[declared],
        raw_output={"docs": [{"file_id": "other-tenant-file", "filename": "x.pdf"}]},
        tenant_id="t-1",
    )

    assert not ok.has_failures
    assert cross_tenant.failures[0].reason is not None
    assert "not accessible" in cross_tenant.failures[0].reason


# ──────────────────────────────────────────────────────────────────────────────
# File ref tenant scope
# ──────────────────────────────────────────────────────────────────────────────


def test_file_ref_must_be_tenant_owned():
    checker = _make_checker(allowed={"t-1": {"my-file"}})
    declared = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"file_id": "my-file", "filename": "r.pdf"}},
        tenant_id="t-1",
    )
    assert not outcome.has_failures

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"file_id": "other", "filename": "r.pdf"}},
        tenant_id="t-1",
    )
    assert outcome.has_failures


def test_file_ref_missing_id_field_fails():
    checker = _make_checker()
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"filename": "x.pdf"}},  # no file_id / upload_file_id / tool_file_id
        tenant_id="t-1",
    )

    assert outcome.failures[0].reason == "file ref missing a recognized file_id field"


def test_file_ref_accepts_upload_file_id_alias():
    checker = _make_checker(allowed={"t-1": {"alt-file"}})
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"upload_file_id": "alt-file"}},
        tenant_id="t-1",
    )

    assert not outcome.has_failures


# ──────────────────────────────────────────────────────────────────────────────
# Missing values + required flag
# ──────────────────────────────────────────────────────────────────────────────


def test_optional_output_missing_is_not_produced_not_a_failure():
    checker = _make_checker()
    declared = [
        DeclaredOutputConfig(name="opt", type=DeclaredOutputType.STRING, required=False),
    ]

    outcome = checker.check(declared_outputs=declared, raw_output={}, tenant_id="t-1")

    assert not outcome.has_failures
    assert outcome.results[0].status == OutputTypeCheckStatus.NOT_PRODUCED


def test_required_output_missing_is_failure():
    checker = _make_checker()
    declared = [_str_output(required=True)]

    outcome = checker.check(declared_outputs=declared, raw_output={}, tenant_id="t-1")

    assert outcome.has_failures
    assert outcome.failures[0].reason is not None
    assert "missing" in outcome.failures[0].reason


def test_non_dict_payload_fails_all_required_outputs():
    """If backend returns a string instead of an object, every required declared
    output is marked failed; optional outputs are marked failed too because we
    can't even attempt a lookup."""
    checker = _make_checker()
    declared = [_str_output("req", required=True), _str_output("opt", required=False)]

    outcome = checker.check(declared_outputs=declared, raw_output="raw text", tenant_id="t-1")

    assert all(r.status == OutputTypeCheckStatus.TYPE_CHECK_FAILED for r in outcome.results)
    assert outcome.failures[0].reason == "Backend output is not a JSON object."


# ──────────────────────────────────────────────────────────────────────────────
# Aggregation helpers
# ──────────────────────────────────────────────────────────────────────────────


def test_outcome_by_name_indexes_results():
    checker = _make_checker()
    declared = [_str_output("a"), _str_output("b")]

    outcome = checker.check(
        declared_outputs=declared,
        raw_output={"a": "x", "b": 1},  # b wrong type
        tenant_id="t-1",
    )

    indexed = outcome.by_name()
    assert indexed["a"].status == OutputTypeCheckStatus.READY
    assert indexed["b"].status == OutputTypeCheckStatus.TYPE_CHECK_FAILED
    assert len(outcome.failures) == 1
