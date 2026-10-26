import uuid

import pytest

from core.tools.utils.uuid_utils import is_valid_uuid


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (str(uuid.uuid4()), True),
        ("not-a-uuid", False),
        ("", False),
        (None, False),
    ],
)
def test_is_valid_uuid(value: str | None, expected: bool) -> None:
    assert is_valid_uuid(value) is expected
