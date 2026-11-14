"""Regression tests for bracket pairing in ``parse_json_markdown``.

LLM replies often append a short prose note after the JSON payload. When that
note contains a bracket of the *other* kind -- a markdown link ``[docs]`` after
an object, or ``{braces}`` after an array -- the closing-bracket search must
not extend the extracted document past the real JSON value.
"""

import pytest

from libs.json_in_md_parser import parse_json_markdown


def test_object_with_trailing_bracketed_prose() -> None:
    src = '{"result": "ok"}\nSee [docs] for details.'
    assert parse_json_markdown(src) == {"result": "ok"}


def test_array_with_trailing_braced_prose() -> None:
    src = "[1, 2, 3]\nNote: use {braces} sparingly."
    assert parse_json_markdown(src) == [1, 2, 3]


def test_nested_mixed_brackets_are_preserved() -> None:
    """Mixed bracket types *inside* the JSON value must stay intact."""
    src = '```json\n[{"a": 1}, {"b": 2}]\n```'
    assert parse_json_markdown(src) == [{"a": 1}, {"b": 2}]


def test_bracket_inside_string_value_is_preserved() -> None:
    """A ']' inside a JSON string value must not truncate the object."""
    src = '{"text": "see [note]", "n": 1}'
    assert parse_json_markdown(src) == {"text": "see [note]", "n": 1}


def test_multiple_json_blocks_still_rejected() -> None:
    """Greedy extraction contract: two fenced blocks must still be rejected."""
    src = """
    ```json
    {"a": 1}
    ```
    Some text
    ```json
    {"b": 2}
    ```
    """
    with pytest.raises(ValueError, match="Extra data"):
        parse_json_markdown(src)
