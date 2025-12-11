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
    ],
)
def test_remove_leading_symbols(input_text, expected_output):
    assert remove_leading_symbols(input_text) == expected_output
