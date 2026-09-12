import json

import pytest

from core.llm_generator.output_parser.errors import OutputParserError
from libs.json_in_md_parser import (
    parse_and_check_json_markdown,
    parse_json_markdown,
)


def test_parse_json_markdown_triple_backticks_json():
    src = """
    ```json
    {"a": 1, "b": "x"}
    ```
    """
    assert parse_json_markdown(src) == {"a": 1, "b": "x"}


def test_parse_json_markdown_triple_backticks_generic():
    src = """
    ```
    {"k": [1, 2, 3]}
    ```
    """
    assert parse_json_markdown(src) == {"k": [1, 2, 3]}


def test_parse_json_markdown_single_backticks():
    src = '`{"x": true}`'
    assert parse_json_markdown(src) == {"x": True}


def test_parse_json_markdown_braces_only():
    src = '  {\n  \t"ok": "yes"\n}  '
    assert parse_json_markdown(src) == {"ok": "yes"}


def test_parse_json_markdown_not_found():
    with pytest.raises(ValueError):
        parse_json_markdown("no json here")


def test_parse_and_check_json_markdown_missing_key():
    src = """
    ```
    {"present": 1}
    ```
    """
    with pytest.raises(OutputParserError) as exc:
        parse_and_check_json_markdown(src, ["present", "missing"])
    assert "expected key `missing`" in str(exc.value)


def test_parse_and_check_json_markdown_invalid_json():
    src = """
    ```json
    {invalid json}
    ```
    """
    with pytest.raises(OutputParserError) as exc:
        parse_and_check_json_markdown(src, [])
    assert "got invalid json object" in str(exc.value)


def test_parse_and_check_json_markdown_success():
    src = """
    ```json
    {"present": 1, "other": 2}
    ```
    """
    obj = parse_and_check_json_markdown(src, ["present"])
    assert obj == {"present": 1, "other": 2}


def test_parse_and_check_json_markdown_multiple_blocks_fails():
    src = """
    ```json
    {"a": 1}
    ```
    Some text
    ```json
    {"b": 2}
    ```
    """
    # The current implementation is greedy and will match from the first
    # opening fence to the last closing fence, causing JSON decode failure.
    with pytest.raises(OutputParserError):
        parse_and_check_json_markdown(src, [])


def test_parse_and_check_json_markdown_handles_think_fenced_and_raw_variants():
    expected = {"keywords": ["2"], "category_id": "2", "category_name": "2"}
    cases = [
        """
        ```json
        [{"keywords": ["2"], "category_id": "2", "category_name": "2"}]
        ```, error: Expecting value: line 1 column 1 (char 0)
        """,
        """
        ```json
        {"keywords": ["2"], "category_id": "2", "category_name": "2"}
        ```, error: Extra data: line 2 column 5 (char 66)
        """,
        '{"keywords": ["2"], "category_id": "2", "category_name": "2"}',
        '[{"keywords": ["2"], "category_id": "2", "category_name": "2"}]',
    ]
    for src in cases:
        obj = parse_and_check_json_markdown(src, ["keywords", "category_id", "category_name"])
        assert obj == expected


def test_parse_json_markdown_backtick_inside_string_value():
    """Backticks inside JSON string values must not be mistaken for code fences."""
    src = '{"code": "use `print` function", "n": 1}'
    assert parse_json_markdown(src) == {"code": "use `print` function", "n": 1}


def test_parse_json_markdown_backtick_in_surrounding_prose():
    """Backticks in prose before the JSON must not break extraction."""
    src = 'Here is `the` result: {"a": 1}'
    assert parse_json_markdown(src) == {"a": 1}


def test_parse_json_markdown_fenced_scalar_still_supported():
    """Fenced content without brackets still parses via the fence fallback."""
    assert parse_json_markdown('```json\n"hello"\n```') == "hello"


def test_parse_json_markdown_returns_first_unfenced_json_object():
    """Two unfenced objects must not be concatenated into one json.loads() call."""
    src = '{"a": 1}\n{"a": 2}'
    assert parse_json_markdown(src) == {"a": 1}


def test_parse_json_markdown_returns_first_unfenced_json_array():
    src = "[1, 2]\n[3, 4]"
    assert parse_json_markdown(src) == [1, 2]


def test_parse_json_markdown_first_unfenced_value_keeps_nested_objects():
    src = '{"a": {"b": [1, {"c": 2}]}}\n{"a": 2}'
    assert parse_json_markdown(src) == {"a": {"b": [1, {"c": 2}]}}


def test_parse_json_markdown_brackets_inside_string_values():
    """Brackets inside string values must not terminate the value early."""
    src = '{"s": "{not json} [nor this]"}\n{"a": 2}'
    assert parse_json_markdown(src) == {"s": "{not json} [nor this]"}


def test_parse_json_markdown_first_value_followed_by_prose():
    src = '{"a": 1}\nThat is the answer.'
    assert parse_json_markdown(src) == {"a": 1}


def test_parse_json_markdown_malformed_first_value_still_fails():
    with pytest.raises(json.JSONDecodeError):
        parse_json_markdown('{"a": }\n{"a": 2}')


def test_parse_and_check_json_markdown_multiple_unfenced_objects():
    """The reported failure mode now resolves to the first value instead of raising."""
    src = '{"keywords": ["a"], "category_id": "1", "category_name": "x"}\n{"category_id": "2"}'
    obj = parse_and_check_json_markdown(src, ["keywords", "category_id", "category_name"])
    assert obj == {"keywords": ["a"], "category_id": "1", "category_name": "x"}


def test_parse_json_markdown_backtick_in_string_value_followed_by_second_unfenced_value():
    """A backtick inside a string value must not disable the first-value-only fix.

    Regression case from PR review: a single stray backtick anywhere in the
    input previously fell back to anchoring on the *last* bracket, which
    reintroduces the original "Extra data" bug from #42006 once a second
    unfenced value follows.
    """
    src = '{"code":"use `print` function","n":1}\n{"a": 2}'
    assert parse_json_markdown(src) == {"code": "use `print` function", "n": 1}


def test_parse_json_markdown_multiple_backticks_in_string_value():
    """Several backtick pairs inside one string value are still just data."""
    src = '{"code": "`a` and `b` and `c`", "n": 1}\n{"a": 2}'
    assert parse_json_markdown(src) == {"code": "`a` and `b` and `c`", "n": 1}


def test_parse_json_markdown_fenced_block_with_backtick_in_string_value():
    """A real ``` fence still uses the bracket-anchored fenced path, even
    when the fenced JSON itself contains a backtick in a string value."""
    src = '```json\n{"code": "use `print` function", "n": 1}\n```'
    assert parse_json_markdown(src) == {"code": "use `print` function", "n": 1}
