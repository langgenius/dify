from services.dsl_content import decode_dsl_content, dsl_content_size, exceeds_dsl_size_limit


def test_dsl_content_size_counts_utf8_bytes_for_text() -> None:
    assert dsl_content_size("你") == 3


def test_exceeds_dsl_size_limit_accepts_text_and_bytes() -> None:
    assert exceeds_dsl_size_limit("abcd", 3)
    assert exceeds_dsl_size_limit(b"abcd", 3)
    assert not exceeds_dsl_size_limit("abc", 3)
    assert not exceeds_dsl_size_limit(b"abc", 3)


def test_decode_dsl_content_accepts_text_and_utf8_bytes() -> None:
    assert decode_dsl_content("kind: app") == "kind: app"
    assert decode_dsl_content("kind: 应用".encode()) == "kind: 应用"
