from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from fields.snippet_fields import SnippetListItemResponse
from libs.helper import dump_response
from models import snippet as snippet_module
from models.account import Account
from models.snippet import CustomizedSnippet


@pytest.mark.parametrize("sqlite_session", [(CustomizedSnippet, Account)], indirect=True)
def test_snippet_list_fields_include_author_name(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    account = Account(name="Alice", email="alice@example.com")
    account.id = "account-1"
    snippet = CustomizedSnippet(
        id="snippet-1",
        tenant_id="tenant-1",
        name="Snippet",
        description="Reusable node",
        type="node",
        version=1,
        use_count=0,
        is_published=False,
        icon_info=None,
        created_by="account-1",
        created_at=datetime.fromtimestamp(1704067200, tz=UTC),
        updated_by="account-1",
        updated_at=datetime.fromtimestamp(1704067201, tz=UTC),
    )
    sqlite_session.add_all([account, snippet])
    sqlite_session.flush()
    monkeypatch.setattr(snippet_module.db, "session", sqlite_session)

    result = dump_response(SnippetListItemResponse, snippet)

    assert result["author_name"] == "Alice"
