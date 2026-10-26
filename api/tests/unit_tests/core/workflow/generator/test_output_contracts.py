"""Planner representations are bounded hints for declared dynamic outputs only."""

import pytest

from services.workflow_generation.output_contracts import normalize_output_contracts


def test_contracts_bind_to_normalized_declared_names_and_skip_kept_producers() -> None:
    raw = {
        " code ": {
            " elapsed ": {"meaning": " Duration ", "representation": " Numeric seconds "},
            "missing": {"meaning": "Other", "representation": "Milliseconds"},
        },
        "kept": {"elapsed": {"meaning": "Duration", "representation": "Milliseconds"}},
        "unknown": {"elapsed": {"meaning": "Duration", "representation": "Milliseconds"}},
    }
    assert normalize_output_contracts(
        raw,
        {"code": ["elapsed"], "kept": ["elapsed"]},
        [{"id": " code ", "node_type": "code"}, {"id": "kept", "node_type": "code", "action": "keep"}],
    ) == {"code": {"elapsed": {"meaning": "Duration", "representation": "Numeric seconds"}}}


@pytest.mark.parametrize("raw", [None, [], "seconds", 7, {"code": []}, {"code": {"elapsed": None}}])
def test_malformed_contracts_degrade_to_names_only(raw: object) -> None:
    assert normalize_output_contracts(raw, {"code": ["elapsed"]}, [{"id": "code"}]) == {}


@pytest.mark.parametrize(
    "contract",
    [
        {},
        {"meaning": "Duration", "representation": ""},
        {"meaning": 7, "representation": "Seconds"},
        {"meaning": "x" * 161, "representation": "Seconds"},
        {"meaning": "Duration", "representation": "x" * 241},
    ],
)
def test_bad_entries_do_not_discard_valid_siblings(contract: object) -> None:
    valid = {"meaning": "x" * 160, "representation": "y" * 240}
    assert normalize_output_contracts(
        {"code": {"bad": contract, "good": valid}},
        {"code": ["bad", "good"]},
        [{"id": "code"}],
    ) == {"code": {"good": valid}}


def test_contracts_are_capped_at_ten_producers_and_six_outputs() -> None:
    contract = {"meaning": "Duration", "representation": "Numeric seconds"}
    names = [f"out{i}" for i in range(7)]
    raw = {f"node{i}": dict.fromkeys(names, contract) for i in range(11)}
    result = normalize_output_contracts(
        raw,
        dict.fromkeys(raw, names),
        [{"id": node_id} for node_id in raw],
    )
    assert list(result) == [f"node{i}" for i in range(10)]
    assert all(list(outputs) == [f"out{i}" for i in range(6)] for outputs in result.values())


@pytest.mark.parametrize(
    "representation",
    [
        "Numeric seconds, including fractional seconds",
        "Numeric proportion from 0 to 1",
        "JSON text with an array root",
        "ISO 8601 date-time string with explicit UTC offset",
    ],
)
def test_representations_preserve_generic_units_scale_shape_and_timezone(representation: str) -> None:
    contract = {"meaning": "User requested result", "representation": representation}
    assert normalize_output_contracts({"code": {"value": contract}}, {"code": ["value"]}, [{"id": "code"}]) == {
        "code": {"value": contract}
    }
