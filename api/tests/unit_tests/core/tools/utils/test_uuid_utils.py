import uuid

import pytest

from core.tools.utils.uuid_utils import is_valid_uuid


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("00000000-0000-4000-8000-000000000001", True),
        ("not-a-uuid", False),
        ("", False),
        (None, False),
    ],
)
def test_is_valid_uuid(value: str | None, expected: bool) -> None:
    assert is_valid_uuid(value) is expected


def test_is_valid_uuid_accepts_runtime_generated_uuid4() -> None:
    assert is_valid_uuid(str(uuid.uuid4())) is True


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("123e4567-e89b-12d3-a456-426614174000", id="canonical-hyphenated"),
        pytest.param("123E4567-E89B-12D3-A456-426614174000", id="uppercase"),
        pytest.param("123e4567e89b12d3a456426614174000", id="no-hyphens"),
        pytest.param("{123e4567-e89b-12d3-a456-426614174000}", id="braced"),
        pytest.param("urn:uuid:123e4567-e89b-12d3-a456-426614174000", id="urn-prefixed"),
    ],
)
def test_is_valid_uuid_accepts_supported_formats(value: str) -> None:
    assert is_valid_uuid(value) is True


@pytest.mark.parametrize(
    "value",
    [
        pytest.param(None, id="none"),
        pytest.param("", id="empty-string"),
        pytest.param("not-a-uuid", id="plain-words"),
        pytest.param("123e4567-e89b-12d3-a456-4266141740000", id="one-hex-too-many"),
        pytest.param("123e4567-e89b-12d3-a456-42661417400", id="one-hex-missing"),
        pytest.param("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", id="non-hex-characters"),
    ],
)
def test_is_valid_uuid_rejects_invalid_values(value: str | None) -> None:
    assert is_valid_uuid(value) is False
