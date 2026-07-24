"""Snippet model properties backed by persisted SQLite collaborators."""

import json
from collections.abc import Iterator

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from models import snippet as snippet_module
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


@pytest.fixture
def snippet_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    models = (Workflow, Tag, TagBinding, Account)
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    Workflow.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        monkeypatch.setattr(snippet_module.db, "session", session)
        yield session


def test_graph_dict_returns_empty_without_workflow_id() -> None:
    snippet = CustomizedSnippet(workflow_id=None)

    assert snippet.graph_dict == {}


def test_graph_dict_loads_published_workflow_graph(snippet_session: Session) -> None:
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
    snippet_session.add(workflow)
    snippet_session.commit()
    snippet = CustomizedSnippet(workflow_id=WORKFLOW_ID)

    assert snippet.graph_dict == {"nodes": [{"id": "llm-1"}], "edges": []}


def test_graph_dict_returns_empty_when_workflow_missing(snippet_session: Session) -> None:
    snippet = CustomizedSnippet(workflow_id=WORKFLOW_ID)

    assert snippet.graph_dict == {}


def test_input_fields_list_parses_json_or_returns_empty() -> None:
    assert CustomizedSnippet(input_fields=None).input_fields_list == []
    assert CustomizedSnippet(input_fields=json.dumps([{"variable": "query"}])).input_fields_list == [
        {"variable": "query"}
    ]


def test_tags_returns_query_results_or_empty(snippet_session: Session) -> None:
    tag = Tag(tenant_id=TENANT_ID, type=TagType.SNIPPET, name="Reusable", created_by=ACCOUNT_1_ID)
    binding = TagBinding(tenant_id=TENANT_ID, tag_id=tag.id, target_id=SNIPPET_ID, created_by=ACCOUNT_1_ID)
    snippet_session.add_all((tag, binding))
    snippet_session.commit()
    snippet = CustomizedSnippet(id=SNIPPET_ID, tenant_id=TENANT_ID)

    assert snippet.tags == [tag]

    snippet_session.delete(binding)
    snippet_session.commit()
    assert snippet.tags == []


def test_account_properties_and_author_name(snippet_session: Session) -> None:
    account = Account(name="Ada", email="ada@example.com")
    account.id = ACCOUNT_1_ID
    updated_account = Account(name="Grace", email="grace@example.com")
    updated_account.id = ACCOUNT_2_ID
    snippet_session.add_all((account, updated_account))
    snippet_session.commit()
    snippet = CustomizedSnippet(created_by=ACCOUNT_1_ID, updated_by=ACCOUNT_2_ID)

    assert snippet.created_by_account is account
    assert snippet.author_name == "Ada"
    assert snippet.updated_by_account is updated_account


def test_account_properties_return_none_without_account_ids() -> None:
    snippet = CustomizedSnippet(created_by=None, updated_by=None)

    assert snippet.created_by_account is None
    assert snippet.author_name is None
    assert snippet.updated_by_account is None


def test_version_str_returns_string_value() -> None:
    snippet = CustomizedSnippet(version=7)

    assert snippet.version_str == "7"
