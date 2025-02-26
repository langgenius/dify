import pytest

from core.tools.utils.text_processing_utils import remove_leading_symbols


@pytest.mark.parametrize(
    ("input_text", "expected_output"),
    [
        ("...Hello, World!", "Hello, World!"),
        ("。测试中文标点", "测试中文标点"),
        ("!@#Test symbols", "Test symbols"),
        ("Hello, World!", "Hello, World!"),
        ("", ""),
        ("   ", "   "),
    ],
)
def test_remove_leading_symbols(input_text, expected_output):
    assert remove_leading_symbols(input_text) == expected_output
