from werkzeug.datastructures import MultiDict

from controllers.console.snippets.payloads import SnippetListQuery
from controllers.console.workspace.snippets import _normalize_snippet_list_query_args


def test_snippet_list_query_accepts_comma_separated_tag_ids() -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"

    query = SnippetListQuery.model_validate({"tag_ids": f"{first},{second}"})

    assert query.tag_ids == [first, second]


def test_normalize_snippet_list_query_accepts_indexed_tag_ids() -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"

    normalized = _normalize_snippet_list_query_args(
        MultiDict(
            [
                ("tag_ids[1]", second),
                ("tag_ids[0]", first),
                ("keyword", "search"),
            ]
        )
    )

    assert normalized == {"keyword": "search", "tag_ids": [first, second]}
