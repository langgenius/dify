import pytest

from tests.helpers.unit.model_billing_fixture_shapes import (
    fixture_list,
    fixture_object,
    fixture_records,
    fixture_string,
)


def test_fixture_shape_checks_preserve_mutable_identity() -> None:
    row = {"name": "fixture"}
    rows = [row]
    assert fixture_object(row) is row
    assert fixture_list(rows) is rows
    assert fixture_records(rows) is rows
    assert fixture_records(rows)[0] is row
    fixture_records(rows)[0]["changed"] = True
    assert row["changed"] is True
    assert fixture_string("fixture") == "fixture"


@pytest.mark.parametrize("value", [None, [], {1: "wrong-key"}])
def test_fixture_object_rejects_non_objects_and_non_string_keys(value: object) -> None:
    with pytest.raises(TypeError):
        fixture_object(value)


@pytest.mark.parametrize("value", [None, {}, (), "not-a-list", [None], [{1: "wrong-key"}]])
def test_fixture_records_rejects_wrong_container_or_row_shape(value: object) -> None:
    with pytest.raises(TypeError):
        fixture_records(value)


@pytest.mark.parametrize("value", [None, 1, b"not-a-string"])
def test_fixture_string_rejects_non_string_without_coercion(value: object) -> None:
    with pytest.raises(TypeError):
        fixture_string(value)
