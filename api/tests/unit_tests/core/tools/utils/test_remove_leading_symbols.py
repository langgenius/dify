import pytest

from core.tools.utils.text_processing_utils import remove_leading_symbols


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        pytest.param("~hello world", "hello world", id="ascii-tilde"),
        pytest.param("\"#$%&'()*+,./:;<=>?@^_`~tail", "tail", id="ascii-punctuation-run"),
        pytest.param("。中文标题", "中文标题", id="cjk-period"),
        pytest.param("、。ItemList", "ItemList", id="cjk-comma-and-period"),
        pytest.param("\u3000full-width-space", "full-width-space", id="ideographic-space"),
        pytest.param("\u201cquoted\u201d", "quoted\u201d", id="left-double-quote-only"),
        pytest.param("—–dash", "dash", id="em-and-en-dash"),
    ],
)
def test_remove_leading_symbols_strips_supported_punctuation(text: str, expected: str):
    assert remove_leading_symbols(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("plain text", id="no-leading-symbols"),
        pytest.param("hello, world", id="internal-punctuation-kept"),
        pytest.param("!exclamation-kept", id="ascii-exclamation-not-in-class"),
        pytest.param("-hyphen-kept", id="ascii-hyphen-not-in-class"),
        pytest.param("[bracket-kept", id="ascii-bracket-excluded-by-design"),
        pytest.param("【lenticular-kept", id="cjk-lenticular-bracket-excluded-by-design"),
        pytest.param("…ellipsis-kept", id="horizontal-ellipsis-outside-ranges"),
        pytest.param("", id="empty-string"),
    ],
)
def test_remove_leading_symbols_preserves_unmatched_inputs(text: str):
    assert remove_leading_symbols(text) == text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        pytest.param("[label](https://example.com)", "[label](https://example.com)", id="bare-markdown-link"),
        pytest.param(
            "[label](https://example.com) trailing text",
            "[label](https://example.com) trailing text",
            id="markdown-link-with-trailing-text",
        ),
        pytest.param("[label](https://example.com/a(b))", "[label](https://example.com/a(b))", id="url-with-parens"),
    ],
)
def test_remove_leading_symbols_preserves_leading_markdown_links(text: str, expected: str):
    assert remove_leading_symbols(text) == expected


def test_remove_leading_symbols_non_http_link_is_kept():
    # Only http(s) markdown links match the preserve-pattern; other schemes fall through to
    # normal stripping, which leaves the text unchanged because brackets are excluded
    # from the strip class.
    assert remove_leading_symbols("[label](ftp://example.com)") == "[label](ftp://example.com)"
