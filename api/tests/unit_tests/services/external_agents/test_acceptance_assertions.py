"""Keep acceptance proofs strict when Python treats bool and number as equal."""

import pytest

from services.external_agents.io_contracts import JsonValue
from tests.e2e_tests.external_agents.matrix_support import same_json_value


@pytest.mark.parametrize(
    ("actual", "expected"),
    [
        (False, 0),
        (0, False),
        (True, 1),
        (1, True),
        ({"flag": 0}, {"flag": False}),
        ({"zero": False}, {"zero": 0}),
        ([0, False], [False, 0]),
        ({"value": None}, {}),
        ("0", 0),
        ([], {}),
    ],
)
def test_acceptance_does_not_hide_json_type_or_presence_errors(actual: JsonValue, expected: JsonValue) -> None:
    assert not same_json_value(actual, expected)


def test_acceptance_preserves_json_number_semantics_and_typed_empty_values() -> None:
    assert same_json_value(
        {"zero": 0.0, "flag": False, "empty": "", "items": [], "object": {}},
        {"zero": 0, "flag": False, "empty": "", "items": [], "object": {}},
    )
