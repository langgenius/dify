import pytest

from controllers.console.version import _has_new_version


@pytest.mark.parametrize(
    ("latest_version", "current_version", "expected"),
    [
        ("1.0.1", "1.0.0", True),
        ("1.1.0", "1.0.0", True),
        ("2.0.0", "1.9.9", True),
        ("1.0.0", "1.0.0", False),
        ("1.0.0", "1.0.1", False),
        ("1.0.0", "2.0.0", False),
        ("1.0.1", "1.0.0-beta", True),
        ("1.0.0", "1.0.0-alpha", True),
        ("1.0.0-beta", "1.0.0-alpha", True),
        ("1.0.0", "1.0.0-rc1", True),
        ("1.0.0", "0.9.9", True),
        ("1.0.0", "1.0.0-dev", True),
    ],
)
def test_has_new_version(latest_version, current_version, expected):
    assert _has_new_version(latest_version=latest_version, current_version=current_version) == expected


def test_has_new_version_invalid_input():
    with pytest.raises(ValueError):
        _has_new_version(latest_version="1.0", current_version="1.0.0")

    with pytest.raises(ValueError):
        _has_new_version(latest_version="1.0.0", current_version="1.0")

    with pytest.raises(ValueError):
        _has_new_version(latest_version="invalid", current_version="1.0.0")

    with pytest.raises(ValueError):
        _has_new_version(latest_version="1.0.0", current_version="invalid")
