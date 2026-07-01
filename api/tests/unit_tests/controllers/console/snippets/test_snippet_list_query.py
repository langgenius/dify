import pytest
from pydantic import ValidationError
from werkzeug.datastructures import MultiDict

from controllers.console.snippets.payloads import SnippetListQuery
from controllers.console.workspace.snippets import _normalize_snippet_list_query_args


def test_snippet_list_query_accepts_comma_separated_tag_ids() -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"

    query = SnippetListQuery.model_validate({"tag_ids": f"{first},{second}"})

    assert query.tag_ids == [first, second]


def test_snippet_list_query_returns_none_for_blank_tag_ids() -> None:
    query = SnippetListQuery.model_validate({"tag_ids": " , "})

    assert query.tag_ids is None


def test_snippet_list_query_rejects_invalid_tag_id() -> None:
    with pytest.raises(ValidationError, match="Invalid UUID format in tag_ids"):
        SnippetListQuery.model_validate({"tag_ids": "not-a-uuid"})


def test_snippet_list_query_accepts_creator_id_alias() -> None:
    creator_id = "1886f96a-5bf0-42bf-961d-8d2129049076"

    query = SnippetListQuery.model_validate({"creator_id": creator_id})

    assert query.creators == [creator_id]


def test_snippet_list_query_normalizes_creator_lists() -> None:
    query = SnippetListQuery.model_validate({"creators": ["account-1", "", " account-2 "]})

    assert query.creators == ["account-1", "account-2"]


def test_snippet_list_query_ignores_unsupported_list_value_type() -> None:
    query = SnippetListQuery.model_validate({"creators": {"bad": "value"}})

    assert query.creators is None


def test_normalize_snippet_list_query_accepts_indexed_creator_ids() -> None:
    first = "9e8959cf-a67b-4d34-9906-1d687517b248"
    second = "1886f96a-5bf0-42bf-961d-8d2129049076"

    normalized = _normalize_snippet_list_query_args(
        MultiDict(
            [
                ("creator_ids[1]", second),
                ("creator_ids[0]", first),
                ("keyword", "search"),
            ]
        )
    )

    assert normalized == {"keyword": "search", "creators": [first, second]}


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
