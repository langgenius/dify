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
