import pytest

from configs.remote_settings_sources.nacos.utils import parse_config


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("APP_NAME=知识库", "知识库"),
        ("APP_NAME=café", "café"),
        ("APP_NAME=😀", "😀"),
        (r"APP_NAME=\u4e2d\u6587", "中文"),
        ("APP_NAME=plain ascii", "plain ascii"),
    ],
)
def test_parse_config_preserves_value_text(content: str, expected: str) -> None:
    assert parse_config(content)["APP_NAME"] == expected


def test_parse_config_decodes_escape_sequences() -> None:
    config = parse_config(r"""
KEY_NEWLINE=first\nsecond
KEY_CARRIAGE=a\rb
KEY_TAB=a\tb
KEY_HEX=\x41\x42
URL=http\://example.com
KV=a\=b
""")

    assert config["KEY_NEWLINE"] == "first\nsecond"
    assert config["KEY_CARRIAGE"] == "a\rb"
    assert config["KEY_TAB"] == "a\tb"
    assert config["KEY_HEX"] == "AB"
    assert config["URL"] == "http://example.com"
    assert config["KV"] == "a=b"


def test_parse_config_keeps_literal_text_next_to_escapes() -> None:
    assert parse_config(r"KEY=mixed 中文 and \u4e2d")["KEY"] == "mixed 中文 and 中"


def test_parse_config_decodes_each_escape_once() -> None:
    config = parse_config(r"""
DOUBLED=\\u0041
BACKSLASH=a\\nb
""")

    assert config["DOUBLED"] == r"\u0041"
    assert config["BACKSLASH"] == r"a\nb"


def test_parse_config_leaves_malformed_escapes_alone() -> None:
    assert parse_config(r"KEY=\uZZZZ")["KEY"] == r"\uZZZZ"


def test_parse_config_skips_comments_and_blank_lines() -> None:
    config = parse_config("""
# a comment
! also a comment

KEY=value
""")

    assert config == {"KEY": "value"}
