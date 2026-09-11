from libs.json_in_md_parser import parse_json_markdown


def test_parse_json_markdown_uses_first_unfenced_json_value() -> None:
    src = '{"category_id": "first"}\n{"category_id": "second"}'

    assert parse_json_markdown(src) == {"category_id": "first"}
