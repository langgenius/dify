import pytest

from extensions.storage.opendal_storage import is_r2_endpoint


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("https://bucket.r2.cloudflarestorage.com", True),
        ("https://custom-domain.r2.cloudflarestorage.com/", True),
        ("https://bucket.r2.cloudflarestorage.com/path", True),
        ("https://s3.amazonaws.com", False),
        ("https://storage.googleapis.com", False),
        ("http://localhost:9000", False),
        ("invalid-url", False),
        ("", False),
    ],
)
def test_is_r2_endpoint(endpoint: str, expected: bool):
    assert is_r2_endpoint(endpoint) == expected
