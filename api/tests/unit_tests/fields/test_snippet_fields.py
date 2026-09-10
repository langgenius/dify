import json
from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from fields.snippet_fields import snippet_list_item_response, snippet_response
from models.account import Account
from models.enums import TagType
from models.model import Tag, TagBinding
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowType

TENANT_ID = "11111111-1111-1111-1111-111111111111"
WORKFLOW_ID = "22222222-2222-2222-2222-222222222222"
APP_ID = "33333333-3333-3333-3333-333333333333"
SNIPPET_ID = "44444444-4444-4444-4444-444444444444"
ACCOUNT_1_ID = "55555555-5555-5555-5555-555555555555"
ACCOUNT_2_ID = "55555555-5555-5555-5555-555555555556"


@pytest.mark.parametrize("sqlite_session", [(CustomizedSnippet, Account)], indirect=True)
def test_snippet_list_fields_include_author_name(sqlite_session: Session) -> None:
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

    result = snippet_list_item_response(snippet, session=sqlite_session).model_dump(mode="json")

    assert result["author_name"] == "Alice"


@pytest.fixture
def populated_snippet(sqlite_session: Session) -> CustomizedSnippet:
    """Persist a snippet plus the workflow, accounts and tag its response resolves."""
    workflow = Workflow(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=WorkflowType.WORKFLOW,
        version="1",
        graph=json.dumps({"nodes": [{"id": "llm-1"}], "edges": []}),
        _features="{}",
        created_by=ACCOUNT_1_ID,
    )
    workflow.id = WORKFLOW_ID
    author = Account(name="Ada", email="ada@example.com")
    author.id = ACCOUNT_1_ID
    editor = Account(name="Grace", email="grace@example.com")
    editor.id = ACCOUNT_2_ID
    tag = Tag(tenant_id=TENANT_ID, type=TagType.SNIPPET, name="Reusable", created_by=ACCOUNT_1_ID)
    binding = TagBinding(tenant_id=TENANT_ID, tag_id=tag.id, target_id=SNIPPET_ID, created_by=ACCOUNT_1_ID)
    sqlite_session.add_all((workflow, author, editor, tag, binding))
    sqlite_session.commit()

    return CustomizedSnippet(
        id=SNIPPET_ID,
        tenant_id=TENANT_ID,
        name="Snippet",
        description="Reusable node",
        type=SnippetType.NODE,
        workflow_id=WORKFLOW_ID,
        is_published=True,
        version=1,
        use_count=0,
        icon_info=None,
        input_fields=json.dumps([{"variable": "query"}]),
        created_by=ACCOUNT_1_ID,
        updated_by=ACCOUNT_2_ID,
        created_at=datetime.fromtimestamp(1704067200, tz=UTC),
        updated_at=datetime.fromtimestamp(1704067201, tz=UTC),
    )


def test_snippet_response_resolves_fields_from_the_given_session(
    populated_snippet: CustomizedSnippet, sqlite_session: Session
) -> None:
    result = snippet_response(populated_snippet, session=sqlite_session).model_dump(mode="json")

    assert result["graph"] == {"nodes": [{"id": "llm-1"}], "edges": []}
    assert result["input_fields"] == [{"variable": "query"}]
    assert result["created_by"]["name"] == "Ada"
    assert result["updated_by"]["name"] == "Grace"
    assert [tag["name"] for tag in result["tags"]] == ["Reusable"]


def test_snippet_list_item_resolves_author_and_tags_from_the_given_session(
    populated_snippet: CustomizedSnippet, sqlite_session: Session
) -> None:
    result = snippet_list_item_response(populated_snippet, session=sqlite_session).model_dump(mode="json")

    assert result["author_name"] == "Ada"
    assert [tag["name"] for tag in result["tags"]] == ["Reusable"]
    # The list row carries the raw audit ids; only the detail response resolves them to accounts.
    assert result["created_by"] == ACCOUNT_1_ID
    assert result["updated_by"] == ACCOUNT_2_ID
