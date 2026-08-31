"""Snippet model properties backed by the shared SQLite test session."""

import json

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from models.enums import TagType
from models.model import Tag, TagBinding
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowType

TENANT_ID = "11111111-1111-1111-1111-111111111111"
WORKFLOW_ID = "22222222-2222-2222-2222-222222222222"
APP_ID = "33333333-3333-3333-3333-333333333333"
SNIPPET_ID = "44444444-4444-4444-4444-444444444444"
ACCOUNT_1_ID = "55555555-5555-5555-5555-555555555555"
ACCOUNT_2_ID = "55555555-5555-5555-5555-555555555556"
SQLITE_MODELS = (Workflow, Tag, TagBinding, Account)


def test_graph_dict_returns_empty_without_workflow_id(sqlite_session: Session) -> None:
    snippet = CustomizedSnippet(workflow_id=None)

    assert snippet.graph_dict(session=sqlite_session) == {}


@pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
def test_graph_dict_loads_published_workflow_graph(sqlite_session: Session) -> None:
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
    sqlite_session.add(workflow)
    sqlite_session.commit()
    snippet = CustomizedSnippet(workflow_id=WORKFLOW_ID)

    assert snippet.graph_dict(session=sqlite_session) == {"nodes": [{"id": "llm-1"}], "edges": []}


@pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
def test_graph_dict_returns_empty_when_workflow_missing(sqlite_session: Session) -> None:
    snippet = CustomizedSnippet(workflow_id=WORKFLOW_ID)

    assert snippet.graph_dict(session=sqlite_session) == {}


def test_input_fields_list_parses_json_or_returns_empty() -> None:
    assert CustomizedSnippet(input_fields=None).input_fields_list == []
    assert CustomizedSnippet(input_fields=json.dumps([{"variable": "query"}])).input_fields_list == [
        {"variable": "query"}
    ]


@pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
def test_tags_returns_query_results_or_empty(sqlite_session: Session) -> None:
    tag = Tag(tenant_id=TENANT_ID, type=TagType.SNIPPET, name="Reusable", created_by=ACCOUNT_1_ID)
    binding = TagBinding(tenant_id=TENANT_ID, tag_id=tag.id, target_id=SNIPPET_ID, created_by=ACCOUNT_1_ID)
    sqlite_session.add_all((tag, binding))
    sqlite_session.commit()
    snippet = CustomizedSnippet(id=SNIPPET_ID, tenant_id=TENANT_ID)

    assert snippet.tags(session=sqlite_session) == [tag]

    sqlite_session.delete(binding)
    sqlite_session.commit()
    assert snippet.tags(session=sqlite_session) == []


@pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
def test_account_properties_and_author_name(sqlite_session: Session) -> None:
    account = Account(name="Ada", email="ada@example.com")
    account.id = ACCOUNT_1_ID
    updated_account = Account(name="Grace", email="grace@example.com")
    updated_account.id = ACCOUNT_2_ID
    sqlite_session.add_all((account, updated_account))
    sqlite_session.commit()
    snippet = CustomizedSnippet(created_by=ACCOUNT_1_ID, updated_by=ACCOUNT_2_ID)

    assert snippet.created_by_account(session=sqlite_session) is account
    assert snippet.author_name(session=sqlite_session) == "Ada"
    assert snippet.updated_by_account(session=sqlite_session) is updated_account


def test_account_properties_return_none_without_account_ids(sqlite_session: Session) -> None:
    snippet = CustomizedSnippet(created_by=None, updated_by=None)

    assert snippet.created_by_account(session=sqlite_session) is None
    assert snippet.author_name(session=sqlite_session) is None
    assert snippet.updated_by_account(session=sqlite_session) is None


def test_version_str_returns_string_value() -> None:
    snippet = CustomizedSnippet(version=7)

    assert snippet.version_str == "7"


class TestCustomizedSnippetSessionAccessors:
    """Regression coverage for ``CustomizedSnippet`` accessors refactored to take a caller-provided session.

    ``graph_dict`` / ``tags`` / ``created_by_account`` / ``updated_by_account`` were ``@property``
    accessors reaching for the global ``db.session`` internally; they are now plain methods
    accepting a ``Session`` explicitly. ``author_name`` threads the session through to
    ``created_by_account``.
    """

    def test_accessors_return_none_when_related_rows_are_absent(self, sqlite_session: Session):
        missing_account_id = "66666666-6666-6666-6666-666666666666"
        snippet = CustomizedSnippet(
            id=SNIPPET_ID,
            tenant_id=TENANT_ID,
            created_by=missing_account_id,
            updated_by=missing_account_id,
            workflow_id=None,
        )

        assert snippet.created_by_account(session=sqlite_session) is None
        assert snippet.updated_by_account(session=sqlite_session) is None
        assert snippet.author_name(session=sqlite_session) is None
        assert snippet.graph_dict(session=sqlite_session) == {}
        assert snippet.tags(session=sqlite_session) == []
