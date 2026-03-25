import pytest

from dify_graph.utils.json_in_md_parser import (
    OutputParserError,
    parse_and_check_json_markdown,
    parse_json_markdown,
)


def test_parse_json_markdown_extracts_fenced_json_object() -> None:
    src = """
    ```json
    {"a": 1, "b": "x"}
    ```
    """

    assert parse_json_markdown(src) == {"a": 1, "b": "x"}


def test_parse_json_markdown_extracts_raw_json_array() -> None:
    assert parse_json_markdown('[{"a": 1}]') == {"a": 1}


def test_parse_json_markdown_raises_when_no_json_block_exists() -> None:
    with pytest.raises(ValueError, match="could not find json block"):
        parse_json_markdown("plain text only")


def test_parse_and_check_json_markdown_unwraps_single_dict_list() -> None:
    parsed = parse_and_check_json_markdown(
        """
        ```json
        [{"present": 1, "other": 2}]
        ```
        """,
        ["present"],
    )

    assert parsed == {"present": 1, "other": 2}


def test_parse_and_check_json_markdown_rejects_invalid_json() -> None:
    with pytest.raises(OutputParserError, match="got invalid json object"):
        parse_and_check_json_markdown(
            """
            ```json
            {invalid json}
            ```
            """,
            [],
        )


def test_parse_and_check_json_markdown_rejects_invalid_return_shapes() -> None:
    with pytest.raises(OutputParserError, match="got invalid return object"):
        parse_and_check_json_markdown(
            """
            ```json
            [1, 2]
            ```
            """,
            ["present"],
        )


def test_parse_and_check_json_markdown_requires_expected_keys() -> None:
    with pytest.raises(OutputParserError, match="expected key `missing`"):
        parse_and_check_json_markdown(
            """
            ```json
            {"present": 1}
            ```
            """,
            ["present", "missing"],
        )
