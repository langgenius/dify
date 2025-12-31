import pytest

from core.tools.utils.text_processing_utils import remove_leading_symbols


@pytest.mark.parametrize(
    ("input_text", "expected_output"),
    [
        ("...Hello, World!", "Hello, World!"),
        ("。测试中文标点", "测试中文标点"),
        # Note: ! is not in the removal pattern, only @# are removed, leaving "!Test symbols"
        # The pattern intentionally excludes ! as per #11868 fix
        ("@#Test symbols", "Test symbols"),
        ("Hello, World!", "Hello, World!"),
        ("", ""),
        ("   ", "   "),
        ("【测试】", "【测试】"),
        # Markdown link preservation - should be preserved if text starts with a markdown link
        ("[Google](https://google.com) is a search engine", "[Google](https://google.com) is a search engine"),
        ("[Example](http://example.com) some text", "[Example](http://example.com) some text"),
        # Leading symbols before markdown link are removed, including the opening bracket [
        ("@[Test](https://example.com)", "Test](https://example.com)"),
    ],
)
def test_remove_leading_symbols(input_text, expected_output):
    assert remove_leading_symbols(input_text) == expected_output
