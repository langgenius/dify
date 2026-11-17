from libs.url_utils import normalize_api_base_url


def test_normalize_api_base_url_appends_v1() -> None:
    assert normalize_api_base_url("https://api.example.com") == "https://api.example.com/v1"
    assert normalize_api_base_url("https://api.example.com/") == "https://api.example.com/v1"
    assert normalize_api_base_url("https://api.example.com/v1") == "https://api.example.com/v1"
    assert normalize_api_base_url("https://api.example.com/v1/") == "https://api.example.com/v1"


def test_normalize_api_base_url_preserves_query_and_fragment() -> None:
    assert normalize_api_base_url("https://api.example.com/v1?timeout=30") == "https://api.example.com/v1?timeout=30"
    assert normalize_api_base_url("https://api.example.com?timeout=30") == "https://api.example.com/v1?timeout=30"
    assert normalize_api_base_url("https://api.example.com/v1#section") == "https://api.example.com/v1#section"


def test_normalize_api_base_url_strips_surrounding_whitespace() -> None:
    assert normalize_api_base_url("  https://api.example.com/v1  ") == "https://api.example.com/v1"
