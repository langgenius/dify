import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from graphon.nodes import BuiltinNodeTypes
from models import Account
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowType
from services.snippet_dsl_service import (
    ImportMode,
    ImportStatus,
    SnippetDslService,
    SnippetPendingData,
    _check_version_compatibility,
)
from tests.unit_tests.model_factories import make_account, make_tenant

SQLITE_MODELS = (CustomizedSnippet,)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@pytest.fixture
def service(sqlite_session: Session) -> SnippetDslService:
    """Create the service with a real caller-owned SQLite session."""
    return SnippetDslService(session=sqlite_session)


def _account(*, account_id: str = "account-1", tenant_id: str = "tenant-1") -> Account:
    return make_account(
        account_id=account_id,
        name="Snippet author",
        email=f"{account_id}@example.com",
        tenant=make_tenant(tenant_id=tenant_id, name="Snippet workspace"),
    )


def _snippet(
    *,
    snippet_id: str = "snippet-1",
    tenant_id: str = "tenant-1",
    name: str = "Snippet",
    description: str | None = None,
    snippet_type: SnippetType = SnippetType.NODE,
    icon_info: dict | None = None,
    input_fields: list[dict] | None = None,
) -> CustomizedSnippet:
    return CustomizedSnippet(
        id=snippet_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        type=snippet_type.value,
        icon_info=icon_info,
        input_fields=json.dumps(input_fields) if input_fields else None,
        created_by="account-1",
    )


def _workflow(*, graph: dict | None = None) -> Workflow:
    return Workflow(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="snippet-1",
        type=WorkflowType.WORKFLOW,
        version="draft",
        graph=json.dumps(graph or {"nodes": [], "edges": []}),
        _features="{}",
        created_by="account-1",
    )


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("not-a-version", ImportStatus.FAILED),
        ("999.0.0", ImportStatus.PENDING),
        ("0.1.0", ImportStatus.COMPLETED_WITH_WARNINGS),
    ],
)
def test_check_version_compatibility_special_cases(version, expected):
    assert _check_version_compatibility(version) == expected


def test_check_version_compatibility_returns_pending_for_older_major() -> None:
    assert _check_version_compatibility("0.0.9") == ImportStatus.COMPLETED_WITH_WARNINGS


def test_import_snippet_rejects_invalid_mode(service: SnippetDslService):
    with pytest.raises(ValueError, match="Invalid import_mode"):
        service.import_snippet(account=_account(), import_mode="bad-mode")


def test_import_snippet_requires_yaml_content(service: SnippetDslService):
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "yaml_content is required when import_mode is yaml-content"


def test_import_snippet_requires_yaml_url(service: SnippetDslService) -> None:
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "yaml_url is required when import_mode is yaml-url"


def test_import_snippet_rejects_invalid_yaml_url_scheme(service: SnippetDslService) -> None:
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="file:///tmp/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid URL scheme, only http and https are allowed"


def test_import_snippet_returns_failed_when_yaml_url_fetch_fails(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=404, text="not found")),
    )

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Failed to fetch YAML from URL: 404"


def test_import_snippet_rejects_oversized_yaml_url_content(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("services.snippet_dsl_service.DSL_MAX_SIZE", 3)
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=200, content=b"too large")),
    )

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "YAML content size exceeds maximum limit" in result.error


def test_import_snippet_rejects_oversized_yaml_url_bytes_before_decode(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("services.snippet_dsl_service.DSL_MAX_SIZE", 1)
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=200, content=b"\xff\xff")),
    )

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "YAML content size exceeds maximum limit" in result.error


def test_import_snippet_returns_decode_error_for_invalid_yaml_url_bytes(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=200, content=b"\xff")),
    )

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "utf-8" in result.error


def test_import_snippet_returns_failed_when_yaml_url_fetch_raises(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(side_effect=RuntimeError("network down")),
    )

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Failed to fetch YAML from URL: network down"


def test_import_snippet_rejects_oversized_yaml_content(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("services.snippet_dsl_service.DSL_MAX_SIZE", 1)

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="é",
    )

    assert result.status == ImportStatus.FAILED
    assert "YAML content size exceeds maximum limit" in result.error


@pytest.mark.parametrize(
    ("yaml_content", "expected_error"),
    [
        ("- item", "Invalid YAML format: expected a dictionary"),
        ("version: 0.1.0\nsnippet:\n  name: Missing Kind\n", "Missing 'kind' field in DSL"),
        (
            "version: 0.1.0\nkind: app\nsnippet:\n  name: Wrong Kind\n",
            "Invalid DSL kind: expected 'snippet', got 'app'",
        ),
        ("version: 0.1.0\nkind: snippet\n", "Missing snippet data in YAML content"),
    ],
)
def test_import_snippet_rejects_invalid_yaml_shapes(service: SnippetDslService, yaml_content, expected_error) -> None:
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert expected_error in result.error


def test_import_snippet_returns_failed_for_invalid_version_type(service: SnippetDslService) -> None:
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="version: 1\nkind: snippet\nsnippet:\n  name: Bad Version\n",
    )

    assert result.status == ImportStatus.FAILED
    assert "Invalid version type" in result.error


def test_import_snippet_returns_failed_for_invalid_yaml_syntax(service: SnippetDslService) -> None:
    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="kind: snippet\nsnippet: [",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error.startswith("Invalid YAML format:")


def test_import_snippet_rejects_forbidden_nodes(service: SnippetDslService):
    yaml_content = """
version: 0.3.0
kind: snippet
snippet:
  name: Bad Snippet
workflow:
  graph:
    nodes:
      - id: start-1
        data:
          type: start
    edges: []
"""

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Snippet cannot contain the following node types: start"


def test_import_snippet_stores_pending_data_for_newer_dsl(service: SnippetDslService, monkeypatch: pytest.MonkeyPatch):
    setex = Mock()
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.setex", setex)
    yaml_content = """
version: 999.0.0
kind: snippet
snippet:
  name: Future Snippet
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
        name="Override",
        description="Override description",
    )

    assert result.status == ImportStatus.PENDING
    setex.assert_called_once()
    assert setex.call_args.args[0] == f"snippet_import_info:{result.id}"
    pending = SnippetPendingData.model_validate_json(setex.call_args.args[2])
    assert pending.tenant_id == "tenant-1"
    assert pending.account_id == "account-1"
    assert pending.name == "Override"
    assert pending.description == "Override description"


def test_import_snippet_returns_failed_when_update_target_missing(service: SnippetDslService):
    yaml_content = """
version: 0.1.0
kind: snippet
snippet:
  name: Existing Snippet
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
        snippet_id="missing-snippet",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Snippet not found"


def test_import_snippet_passes_dependencies_to_create_or_update(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    snippet = _snippet()
    create_or_update = Mock(return_value=snippet)
    monkeypatch.setattr(service, "_create_or_update_snippet", create_or_update)
    yaml_content = """
version: 0.1.0
kind: snippet
snippet:
  name: Dependency Snippet
dependencies:
  - type: marketplace
    value:
      marketplace_plugin_unique_identifier: langgenius/openai:0.0.1
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS
    assert result.snippet_id == "snippet-1"
    dependencies = create_or_update.call_args.kwargs["dependencies"]
    assert dependencies[0].value.plugin_unique_identifier == "langgenius/openai:0.0.1"


def test_import_snippet_rolls_back_when_create_or_update_raises(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    rollback_events: list[str] = []
    event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))
    sqlite_session.begin()
    monkeypatch.setattr(service, "_create_or_update_snippet", Mock(side_effect=RuntimeError("boom")))

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="version: 0.1.0\nkind: snippet\nsnippet:\n  name: Bad\n",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "boom"
    assert rollback_events == ["rollback"]


def test_confirm_import_returns_failed_when_pending_data_missing(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=None))

    result = service.confirm_import(import_id="missing", account=_account())

    assert result.status == ImportStatus.FAILED
    assert result.error == "Import information expired or does not exist"


def test_confirm_import_returns_failed_for_invalid_pending_payload(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=object()))

    result = service.confirm_import(import_id="bad", account=_account())

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid import information"


def test_confirm_import_is_scoped_to_its_owner(service: SnippetDslService, monkeypatch: pytest.MonkeyPatch):
    account = _account()
    snippet = _snippet(snippet_id="snippet-new")
    yaml_content = """
version: 9.0.0
kind: snippet
snippet:
  name: From DSL
  type: node
workflow:
  graph:
    nodes: []
    edges: []
"""
    pending = SnippetPendingData(
        tenant_id="tenant-1",
        account_id="account-1",
        import_mode="yaml-content",
        yaml_content=yaml_content,
        name="Override name",
        description="Override description",
        snippet_id=None,
    )
    create_or_update = Mock(return_value=snippet)
    monkeypatch.setattr(service, "_create_or_update_snippet", create_or_update)
    redis_key = "snippet_import_info:import-1"
    monkeypatch.setattr(
        "services.snippet_dsl_service.redis_client.get",
        Mock(side_effect=lambda key: pending.model_dump_json() if key == redis_key else None),
    )
    redis_delete = Mock()
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.delete", redis_delete)

    for other_account in (
        _account(tenant_id="tenant-2"),
        _account(account_id="account-2"),
    ):
        assert service.confirm_import(import_id="import-1", account=other_account).status == ImportStatus.FAILED

    create_or_update.assert_not_called()
    result = service.confirm_import(import_id="import-1", account=account)

    assert result.status == ImportStatus.COMPLETED
    assert result.snippet_id == "snippet-new"
    assert result.imported_dsl_version == "9.0.0"
    create_or_update.assert_called_once()
    _, kwargs = create_or_update.call_args
    assert kwargs["snippet"] is None
    assert kwargs["account"] is account
    assert kwargs["name"] == "Override name"
    assert kwargs["description"] == "Override description"
    redis_delete.assert_called_once_with(redis_key)


def test_confirm_import_returns_failed_for_non_mapping_yaml(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    pending = SnippetPendingData(
        import_mode="yaml-content",
        yaml_content="- item",
        snippet_id=None,
    )
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=pending.model_dump_json()))

    result = service.confirm_import(import_id="import-1", account=_account())

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid YAML format: expected a dictionary"


def test_confirm_import_returns_failed_when_create_or_update_raises(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    rollback_events: list[str] = []
    event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))
    pending = SnippetPendingData(
        import_mode="yaml-content",
        yaml_content="version: 0.1.0\nkind: snippet\nsnippet:\n  name: Bad\n",
        snippet_id="snippet-1",
    )
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=pending.model_dump_json()))
    monkeypatch.setattr(service, "_create_or_update_snippet", Mock(side_effect=RuntimeError("boom")))

    result = service.confirm_import(
        import_id="import-1",
        account=_account(),
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "boom"
    assert rollback_events == ["rollback"]


def test_check_dependencies_returns_empty_without_draft_workflow(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    result = service.check_dependencies(_snippet())

    assert result.leaked_dependencies == []


def test_check_dependencies_returns_generated_dependencies(service: SnippetDslService, monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow()
    leaked_dependencies = [
        {
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": "langgenius/openai:0.0.1"},
        }
    ]
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=workflow)),
    )
    monkeypatch.setattr(service, "_extract_dependencies_from_workflow", Mock(return_value=["langgenius/openai"]))
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=leaked_dependencies),
    )

    result = service.check_dependencies(_snippet())

    assert result.leaked_dependencies[0].value.plugin_unique_identifier == "langgenius/openai:0.0.1"


def test_create_or_update_snippet_updates_existing_snippet_and_syncs_workflow(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    snippet = _snippet(
        name="Old",
        description="Old",
        icon_info=None,
    )
    sqlite_session.add(snippet)
    sqlite_session.commit()
    draft_workflow = _workflow()
    snippet_service = SimpleNamespace(
        get_draft_workflow=Mock(return_value=draft_workflow),
        sync_draft_workflow=Mock(return_value=draft_workflow),
    )
    monkeypatch.setattr("services.snippet_dsl_service.SnippetService", lambda *_args, **_kwargs: snippet_service)
    monkeypatch.setattr(
        "services.snippet_dsl_service.WorkflowAgentPublishService.sync_agent_bindings_for_draft",
        Mock(return_value={"retired-agent"}),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.WorkflowAgentPublishService.validate_agent_nodes_for_draft_sync",
        Mock(),
    )
    retire_unowned = Mock()
    monkeypatch.setattr(
        "services.snippet_dsl_service.WorkflowAgentRetirementService.retire_unowned",
        retire_unowned,
    )

    result = service._create_or_update_snippet(
        snippet=snippet,
        data={
            "snippet": {
                "name": "New",
                "description": "New description",
                "type": "unknown-type",
                "icon_info": {"icon": "x"},
                "input_fields": [{"variable": "query"}],
            },
            "workflow": {"graph": {"nodes": [], "edges": []}},
        },
        account=_account(),
    )

    assert result is snippet
    assert snippet.name == "New"
    assert snippet.type == "node"
    assert snippet.icon_info == {"icon": "x"}
    snippet_service.sync_draft_workflow.assert_called_once()
    assert not sqlite_session.in_transaction()
    persisted = sqlite_session.get(CustomizedSnippet, snippet.id)
    assert persisted is not None
    assert persisted.name == "New"
    retire_unowned.assert_called_once_with(
        tenant_id="tenant-1",
        agent_ids={"retired-agent"},
        account_id="account-1",
    )


def test_create_or_update_snippet_creates_new_snippet_and_flushes(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    snippet_service = SimpleNamespace(
        get_draft_workflow=Mock(return_value=None),
        sync_draft_workflow=Mock(return_value=_workflow()),
    )
    monkeypatch.setattr("services.snippet_dsl_service.SnippetService", lambda *_args, **_kwargs: snippet_service)
    monkeypatch.setattr(
        "services.snippet_dsl_service.WorkflowAgentPublishService.sync_agent_bindings_for_draft",
        Mock(return_value=set()),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.WorkflowAgentPublishService.validate_agent_nodes_for_draft_sync",
        Mock(),
    )

    result = service._create_or_update_snippet(
        snippet=None,
        data={
            "snippet": {
                "name": "New Snippet",
                "description": "Description",
                "type": "group",
                "input_fields": [{"variable": "query"}],
            },
            "workflow": {"graph": {"nodes": [], "edges": []}},
        },
        account=_account(),
    )

    assert result.name == "New Snippet"
    assert result.type == "group"
    assert sqlite_session.get(CustomizedSnippet, result.id) is result
    snippet_service.sync_draft_workflow.assert_called_once()
    assert not sqlite_session.in_transaction()


def test_export_snippet_dsl_raises_without_draft_workflow(service: SnippetDslService, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_snippet_dsl(_snippet())


def test_export_snippet_dsl_returns_yaml(service: SnippetDslService, monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow()
    snippet = _snippet(
        name="Exported",
        description=None,
        icon_info=None,
        input_fields=[{"variable": "query"}],
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=workflow)),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )

    result = service.export_snippet_dsl(snippet)

    assert "kind: snippet" in result
    assert "name: Exported" in result
    assert "input_fields:" in result


def test_export_snippet_dsl_uses_requested_published_workflow(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    workflow = _workflow(graph={"nodes": [], "edges": []})
    snippet = _snippet(name="Exported")
    get_published_workflow_by_id = Mock(return_value=workflow)
    get_draft_workflow = Mock()
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(
            get_draft_workflow=get_draft_workflow,
            get_published_workflow_by_id=get_published_workflow_by_id,
        ),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )

    service.export_snippet_dsl(snippet, workflow_id="workflow-1")

    get_published_workflow_by_id.assert_called_once_with(snippet=snippet, workflow_id="workflow-1")
    get_draft_workflow.assert_not_called()


def test_append_workflow_export_data_filters_credentials_and_extracts_dependencies(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    workflow_dict = {
        "graph": {
            "nodes": [
                {"data": {}},
                {
                    "data": {
                        "type": BuiltinNodeTypes.TOOL,
                        "credential_id": "secret",
                        "tool_configurations": {"provider_type": "builtin", "provider": "langgenius/google"},
                    }
                },
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {
                            "tools": {
                                "value": [
                                    {
                                        "provider_type": "builtin",
                                        "provider": "langgenius/openai",
                                        "credential_id": "agent-secret",
                                    }
                                ]
                            }
                        },
                    }
                },
            ]
        },
        "environment_variables": [{"name": "SECRET"}],
        "conversation_variables": [{"name": "memory"}],
    }
    workflow = _workflow(graph=workflow_dict["graph"])
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    export_data = {}

    service._append_workflow_export_data(
        export_data=export_data,
        snippet=_snippet(),
        workflow=workflow,
        include_secret=False,
    )

    nodes = export_data["workflow"]["graph"]["nodes"]
    assert export_data["workflow"]["environment_variables"] == []
    assert export_data["workflow"]["conversation_variables"] == []
    assert "credential_id" not in nodes[1]["data"]
    assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]


def test_append_workflow_export_data_rewrites_knowledge_dataset_ids(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch
):
    workflow_dict = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                        "dataset_ids": ["dataset-1", "dataset-2"],
                    }
                }
            ]
        },
    }
    workflow = _workflow(graph=workflow_dict["graph"])
    monkeypatch.setattr(
        service,
        "_encrypt_dataset_id",
        Mock(side_effect=lambda dataset_id, tenant_id: f"{tenant_id}:{dataset_id}"),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    export_data = {}

    service._append_workflow_export_data(
        export_data=export_data,
        snippet=_snippet(),
        workflow=workflow,
        include_secret=True,
    )

    assert export_data["workflow"]["graph"]["nodes"][0]["data"]["dataset_ids"] == [
        "tenant-1:dataset-1",
        "tenant-1:dataset-2",
    ]
