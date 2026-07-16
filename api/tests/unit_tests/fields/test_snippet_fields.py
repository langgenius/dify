from datetime import UTC, datetime
from types import SimpleNamespace

from fields.snippet_fields import SnippetListItemResponse
from libs.helper import dump_response


def test_snippet_list_fields_include_author_name() -> None:
    snippet = SimpleNamespace(
        id="snippet-1",
        name="Snippet",
        description="Reusable node",
        type="node",
        version=1,
        use_count=0,
        is_published=False,
        icon_info=None,
        tags=[],
        created_by="account-1",
        author_name="Alice",
        created_at=datetime.fromtimestamp(1704067200, tz=UTC),
        updated_by="account-1",
        updated_at=datetime.fromtimestamp(1704067201, tz=UTC),
    )

    result = dump_response(SnippetListItemResponse, snippet)

    assert result["author_name"] == "Alice"
