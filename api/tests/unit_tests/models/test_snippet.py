import json
from types import SimpleNamespace
from unittest.mock import Mock

from models.snippet import CustomizedSnippet


def test_graph_dict_returns_empty_without_workflow_id() -> None:
    snippet = CustomizedSnippet(workflow_id=None)

    assert snippet.graph_dict == {}


def test_graph_dict_loads_published_workflow_graph(monkeypatch) -> None:
    workflow = SimpleNamespace(graph=json.dumps({"nodes": [{"id": "llm-1"}], "edges": []}))
    session = SimpleNamespace(get=Mock(return_value=workflow))
    monkeypatch.setattr("models.snippet.db.session", session)
    snippet = CustomizedSnippet(workflow_id="workflow-1")

    assert snippet.graph_dict == {"nodes": [{"id": "llm-1"}], "edges": []}
    session.get.assert_called_once()


def test_graph_dict_returns_empty_when_workflow_missing(monkeypatch) -> None:
    session = SimpleNamespace(get=Mock(return_value=None))
    monkeypatch.setattr("models.snippet.db.session", session)
    snippet = CustomizedSnippet(workflow_id="missing-workflow")

    assert snippet.graph_dict == {}


def test_input_fields_list_parses_json_or_returns_empty() -> None:
    assert CustomizedSnippet(input_fields=None).input_fields_list == []
    assert CustomizedSnippet(input_fields=json.dumps([{"variable": "query"}])).input_fields_list == [
        {"variable": "query"}
    ]


def test_tags_returns_query_results_or_empty(monkeypatch) -> None:
    tags = [SimpleNamespace(id="tag-1")]
    session = SimpleNamespace(scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=tags))))
    monkeypatch.setattr("models.snippet.db.session", session)
    snippet = CustomizedSnippet(id="snippet-1", tenant_id="tenant-1")

    assert snippet.tags == tags

    session.scalars.return_value.all.return_value = None
    assert snippet.tags == []


def test_account_properties_and_author_name(monkeypatch) -> None:
    account = SimpleNamespace(id="account-1", name="Ada")
    updated_account = SimpleNamespace(id="account-2", name="Grace")
    session = SimpleNamespace(
        get=Mock(side_effect=lambda _model, account_id: account if account_id == "account-1" else updated_account)
    )
    monkeypatch.setattr("models.snippet.db.session", session)
    snippet = CustomizedSnippet(created_by="account-1", updated_by="account-2")

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
