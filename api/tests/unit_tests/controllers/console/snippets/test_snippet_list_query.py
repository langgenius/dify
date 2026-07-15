import pytest
from pydantic import ValidationError

from controllers.console.snippets.payloads import SnippetListQuery


def test_snippet_list_query_accepts_tag_id_lists() -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"

    query = SnippetListQuery.model_validate({"tag_ids": [first, second]})

    assert query.tag_ids == [first, second]


def test_snippet_list_query_returns_none_for_blank_tag_ids() -> None:
    query = SnippetListQuery.model_validate({"tag_ids": ["", "  "]})

    assert query.tag_ids is None


def test_snippet_list_query_rejects_invalid_tag_id() -> None:
    with pytest.raises(ValidationError, match="Invalid UUID format in tag_ids"):
        SnippetListQuery.model_validate({"tag_ids": ["not-a-uuid"]})


def test_snippet_list_query_rejects_comma_separated_tag_ids() -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"

    with pytest.raises(ValidationError, match="Unsupported tag_ids type"):
        SnippetListQuery.model_validate({"tag_ids": f"{first},{second}"})


def test_snippet_list_query_accepts_creator_id_alias() -> None:
    creator_id = "1886f96a-5bf0-42bf-961d-8d2129049076"

    query = SnippetListQuery.model_validate({"creator_id": creator_id})

    assert query.creators == [creator_id]


def test_snippet_list_query_normalizes_creator_lists() -> None:
    query = SnippetListQuery.model_validate({"creators": ["account-1", "", " account-2 "]})

    assert query.creators == ["account-1", "account-2"]


def test_snippet_list_query_rejects_unsupported_list_value_type() -> None:
    with pytest.raises(ValidationError, match="Unsupported creators type"):
        SnippetListQuery.model_validate({"creators": {"bad": "value"}})
