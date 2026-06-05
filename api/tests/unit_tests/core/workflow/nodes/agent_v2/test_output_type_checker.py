"""Unit tests for PerOutputTypeChecker.

Stage 4 §5.1-§5.3.
"""

from __future__ import annotations

from collections.abc import Mapping

import pytest

from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.agent_v2.output_type_checker import (
    OutputTypeCheckStatus,
    PerOutputTypeChecker,
)
from graphon.file import FileTransferMethod
from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputConfig,
    DeclaredOutputType,
)


class StubFileValidator:
    """Trivially records the set of file mappings that pass tenant scope."""

    def __init__(
        self,
        *,
        allowed: Mapping[str, set[str]] | None = None,
        allowed_by_method: Mapping[tuple[str, str], set[str]] | None = None,
    ) -> None:
        # Mapping: tenant_id -> {file_id, ...}
        self._allowed = {tenant: set(ids) for tenant, ids in (allowed or {}).items()}
        self._allowed_by_method = {
            (tenant, transfer_method): set(ids)
            for (tenant, transfer_method), ids in (allowed_by_method or {}).items()
        }

    def is_accessible_file_mapping(
        self,
        *,
        file_id: str,
        tenant_id: str,
        transfer_method: FileTransferMethod,
    ) -> bool:
        scoped_ids = self._allowed_by_method.get((tenant_id, transfer_method.value))
        if self._allowed_by_method:
            return file_id in (scoped_ids or set())
        return file_id in self._allowed.get(tenant_id, set())


def _str_output(name: str = "summary", required: bool = True) -> DeclaredOutputConfig:
    return DeclaredOutputConfig(name=name, type=DeclaredOutputType.STRING, required=required)


def _make_checker(
    *,
    allowed: Mapping[str, set[str]] | None = None,
    allowed_by_method: Mapping[tuple[str, str], set[str]] | None = None,
) -> PerOutputTypeChecker:
    return PerOutputTypeChecker(file_validator=StubFileValidator(allowed=allowed, allowed_by_method=allowed_by_method))


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
    allowed_reference = build_file_reference(record_id="file-A")
    denied_reference = build_file_reference(record_id="other-tenant-file")

    ok = checker.check(
        declared_outputs=[declared],
        raw_output={"docs": [{"transfer_method": "tool_file", "reference": allowed_reference}]},
        tenant_id="t-1",
    )
    cross_tenant = checker.check(
        declared_outputs=[declared],
        raw_output={"docs": [{"transfer_method": "tool_file", "reference": denied_reference}]},
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
    allowed_reference = build_file_reference(record_id="my-file")
    denied_reference = build_file_reference(record_id="other")

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"transfer_method": "local_file", "reference": allowed_reference}},
        tenant_id="t-1",
    )
    assert not outcome.has_failures

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"transfer_method": "local_file", "reference": denied_reference}},
        tenant_id="t-1",
    )
    assert outcome.has_failures


def test_file_ref_must_match_transfer_method_family():
    tool_reference = build_file_reference(record_id="tool-file-1")
    checker = _make_checker(
        allowed={"t-1": {"tool-file-1"}},
        allowed_by_method={
            ("t-1", FileTransferMethod.TOOL_FILE.value): {"tool-file-1"},
        },
    )
    declared = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"transfer_method": "local_file", "reference": tool_reference}},
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert "not accessible" in (outcome.failures[0].reason or "")


def test_datasource_file_ref_is_accepted_for_matching_transfer_method_family():
    datasource_reference = build_file_reference(record_id="datasource-file-1")
    checker = _make_checker(
        allowed={"t-1": {"datasource-file-1"}},
        allowed_by_method={
            ("t-1", FileTransferMethod.DATASOURCE_FILE.value): {"datasource-file-1"},
        },
    )
    declared = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"transfer_method": "datasource_file", "reference": datasource_reference}},
        tenant_id="t-1",
    )

    assert not outcome.has_failures


def test_datasource_file_ref_rejects_transfer_method_family_mismatch():
    tool_reference = build_file_reference(record_id="tool-file-1")
    checker = _make_checker(
        allowed={"t-1": {"tool-file-1"}},
        allowed_by_method={
            ("t-1", FileTransferMethod.TOOL_FILE.value): {"tool-file-1"},
        },
    )
    declared = DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"report": {"transfer_method": "datasource_file", "reference": tool_reference}},
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert "not accessible" in (outcome.failures[0].reason or "")


def test_file_ref_missing_reference_or_url_fails():
    checker = _make_checker()
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"transfer_method": "tool_file"}},
        tenant_id="t-1",
    )

    assert outcome.failures[0].reason == (
        "tool_file file mapping must contain exactly ['reference', 'transfer_method'] (missing reference)"
    )


def test_file_ref_accepts_remote_url_mapping_without_tenant_lookup():
    checker = _make_checker()
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"transfer_method": "remote_url", "url": "https://example.com/report.pdf"}},
        tenant_id="t-1",
    )

    assert not outcome.has_failures


def test_file_ref_rejects_legacy_id_only_shape():
    checker = _make_checker(allowed={"t-1": {"tool-file-1"}})
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"id": "tool-file-1"}},
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert outcome.failures[0].reason == "file mapping missing transfer_method"


def test_file_ref_rejects_extra_rich_descriptor_fields() -> None:
    checker = _make_checker(allowed={"t-1": {"tool-file-1"}})
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)
    reference = build_file_reference(record_id="tool-file-1")

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={
            "r": {
                "transfer_method": "tool_file",
                "reference": reference,
                "filename": "report.pdf",
            }
        },
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert "unexpected filename" in (outcome.failures[0].reason or "")


def test_file_ref_rejects_non_canonical_reference() -> None:
    checker = _make_checker(allowed={"t-1": {"tool-file-1"}})
    declared = DeclaredOutputConfig(name="r", type=DeclaredOutputType.FILE)

    outcome = checker.check(
        declared_outputs=[declared],
        raw_output={"r": {"transfer_method": "tool_file", "reference": "raw-tool-file-uuid"}},
        tenant_id="t-1",
    )

    assert outcome.has_failures
    assert outcome.failures[0].reason == "tool_file file mapping has invalid canonical reference"


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
