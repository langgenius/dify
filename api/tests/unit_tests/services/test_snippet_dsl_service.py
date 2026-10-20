import json
from collections.abc import Iterable, Iterator
from typing import NoReturn
from unittest.mock import Mock

import httpx
import pytest
import yaml
from redis import Redis
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from graphon.nodes import BuiltinNodeTypes
from models import Account
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowKind
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.snippet_dsl_service import (
    IMPORT_INFO_REDIS_EXPIRY,
    ImportMode,
    ImportStatus,
    SnippetDslService,
    SnippetPendingData,
    _check_version_compatibility,
)
from services.snippet_service import SnippetService
from tests.unit_tests.model_factories import make_account, make_tenant, make_workflow

SQLITE_MODELS = (CustomizedSnippet,)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]

type PendingCache = tuple[Redis[bytes], dict[str, bytes], list[tuple[object, ...]]]


@pytest.fixture
def service(sqlite_session: Session) -> SnippetDslService:
    """Create the service with a real caller-owned SQLite session."""
    return SnippetDslService(session=sqlite_session)


@pytest.fixture
def pending_cache(monkeypatch: pytest.MonkeyPatch) -> Iterator[PendingCache]:
    """Use real Redis commands, with network dispatch confined to an in-memory store."""
    values: dict[str, bytes] = {}
    commands: list[tuple[object, ...]] = []

    def execute_command(*args: object, **_kwargs: object) -> bytes | bool | int | None:
        commands.append(args)
        command, key, *arguments = args
        assert isinstance(key, str)
        if command == "GET":
            return values.get(key)
        if command == "SETEX":
            expiry, value = arguments
            assert expiry == IMPORT_INFO_REDIS_EXPIRY
            assert isinstance(value, str | bytes)
            values[key] = value.encode() if isinstance(value, str) else value
            return True
        if command == "DEL":
            return int(values.pop(key, None) is not None)
        raise AssertionError(f"Unexpected Redis command: {command}")

    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", execute_command)
        monkeypatch.setattr("services.snippet_dsl_service.redis_client", client)
        yield client, values, commands


@pytest.fixture
def plugin_catalog(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, object]]]:
    """Run dependency analysis and plugin response validation against HTTP responses."""
    installations: list[dict[str, object]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/plugin/tenant-1/management/installation/fetch/batch")
        requested = json.loads(request.content)["plugin_ids"]
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "",
                "data": [installation for installation in installations if installation["plugin_id"] in requested],
            },
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr("core.plugin.impl.base._httpx_client", client)
        yield installations


def _fail_creation(**_kwargs: object) -> NoReturn:
    raise RuntimeError("boom")


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
    return make_workflow(workflow_id="workflow-1", app_id="snippet-1", kind=WorkflowKind.SNIPPET, graph=graph)


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
        lambda *_args, **_kwargs: httpx.Response(404, text="not found"),
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
        lambda *_args, **_kwargs: httpx.Response(200, content=b"too large"),
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
        lambda *_args, **_kwargs: httpx.Response(200, content=b"\xff\xff"),
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
        lambda *_args, **_kwargs: httpx.Response(200, content=b"\xff"),
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
    def fail_request(*_args: object, **_kwargs: object) -> NoReturn:
        raise RuntimeError("network down")

    monkeypatch.setattr("services.snippet_dsl_service.ssrf_proxy.get", fail_request)

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


def test_import_snippet_stores_pending_data_for_newer_dsl(
    service: SnippetDslService, pending_cache: PendingCache
) -> None:
    _, values, commands = pending_cache
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

    account_without_tenant = _account()
    account_without_tenant._current_tenant = None
    missing_tenant = service.import_snippet(
        account=account_without_tenant,
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )
    assert missing_tenant.status == ImportStatus.FAILED
    assert missing_tenant.error == "Current tenant is not set"
    assert commands == []

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
        name="Override",
        description="Override description",
    )

    assert result.status == ImportStatus.PENDING
    assert len(commands) == 1
    assert commands[0][:3] == ("SETEX", f"snippet_import_info:{result.id}", IMPORT_INFO_REDIS_EXPIRY)
    pending = SnippetPendingData.model_validate_json(values[f"snippet_import_info:{result.id}"])
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
    monkeypatch.setattr(service, "_create_or_update_snippet", _fail_creation)

    result = service.import_snippet(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="version: 0.1.0\nkind: snippet\nsnippet:\n  name: Bad\n",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "boom"
    assert rollback_events == ["rollback"]


@pytest.mark.usefixtures("pending_cache")
def test_confirm_import_returns_failed_when_pending_data_missing(service: SnippetDslService):
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


def test_confirm_import_is_scoped_to_its_owner(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, pending_cache: PendingCache, sqlite_session: Session
) -> None:
    account = _account()
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
    _, values, commands = pending_cache
    redis_key = "snippet_import_info:import-1"
    values[redis_key] = pending.model_dump_json(exclude={"tenant_id", "account_id"}).encode()

    def forbidden_yaml_load(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("Unauthorized pending imports must not reach YAML parsing")

    with monkeypatch.context() as unauthorized:
        unauthorized.setattr("services.snippet_dsl_service.yaml.safe_load", forbidden_yaml_load)
        assert service.confirm_import(import_id="import-1", account=account).status == ImportStatus.FAILED
        assert commands == [("GET", redis_key)]
        values[redis_key] = pending.model_dump_json().encode()
        for other_account in (
            _account(tenant_id="tenant-2"),
            _account(account_id="account-2"),
        ):
            assert service.confirm_import(import_id="import-1", account=other_account).status == ImportStatus.FAILED

    assert all(command == ("GET", redis_key) for command in commands)
    assert sqlite_session.scalar(select(CustomizedSnippet)) is None
    result = service.confirm_import(import_id="import-1", account=account)

    assert result.status == ImportStatus.COMPLETED
    assert result.imported_dsl_version == "9.0.0"
    snippet = sqlite_session.get(CustomizedSnippet, result.snippet_id)
    assert snippet is not None
    assert snippet.tenant_id == account.current_tenant_id
    assert snippet.created_by == account.id
    assert snippet.name == "Override name"
    assert snippet.description == "Override description"
    assert SnippetService(session=sqlite_session).get_draft_workflow(snippet) is not None
    assert commands[-1] == ("DEL", redis_key)
    assert redis_key not in values


def test_confirm_import_returns_failed_for_non_mapping_yaml(
    service: SnippetDslService, pending_cache: PendingCache
) -> None:
    pending = SnippetPendingData(
        tenant_id="tenant-1",
        account_id="account-1",
        import_mode="yaml-content",
        yaml_content="- item",
        snippet_id=None,
    )
    _, values, _ = pending_cache
    values["snippet_import_info:import-1"] = pending.model_dump_json().encode()

    result = service.confirm_import(import_id="import-1", account=_account())

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid YAML format: expected a dictionary"


def test_confirm_import_returns_failed_when_create_or_update_raises(
    service: SnippetDslService, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, pending_cache: PendingCache
) -> None:
    rollback_events: list[str] = []
    event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))
    pending = SnippetPendingData(
        tenant_id="tenant-1",
        account_id="account-1",
        import_mode="yaml-content",
        yaml_content="version: 0.1.0\nkind: snippet\nsnippet:\n  name: Bad\n",
        snippet_id="snippet-1",
    )
    _, values, _ = pending_cache
    values["snippet_import_info:import-1"] = pending.model_dump_json().encode()
    monkeypatch.setattr(service, "_create_or_update_snippet", _fail_creation)

    result = service.confirm_import(
        import_id="import-1",
        account=_account(),
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "boom"
    assert rollback_events == ["rollback"]


def test_check_dependencies_returns_empty_without_draft_workflow(service: SnippetDslService):
    result = service.check_dependencies(_snippet())

    assert result.leaked_dependencies == []


def test_check_dependencies_returns_generated_dependencies(
    service: SnippetDslService, sqlite_session: Session, plugin_catalog: list[dict[str, object]]
) -> None:
    workflow = _workflow(
        graph={
            "nodes": [{"data": {"type": BuiltinNodeTypes.LLM, "model": {"provider": "langgenius/openai/openai"}}}],
            "edges": [],
        }
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()
    plugin_catalog.append(
        {
            "id": "installation-1",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "tenant_id": "tenant-1",
            "endpoints_setups": 0,
            "endpoints_active": 0,
            "runtime_type": "local",
            "source": "marketplace",
            "meta": {},
            "plugin_id": "langgenius/openai",
            "plugin_unique_identifier": "langgenius/openai:0.0.1",
            "version": "0.0.1",
            "checksum": "test-checksum",
            "declaration": {
                "version": "0.0.1",
                "author": "langgenius",
                "name": "openai",
                "description": {"en_US": "OpenAI"},
                "icon": "icon.svg",
                "label": {"en_US": "OpenAI"},
                "category": "model",
                "created_at": "2026-01-01T00:00:00Z",
                "resource": {"memory": 1024},
                "plugins": {},
                "meta": {},
            },
        }
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
    binding = WorkflowAgentNodeBinding(
        id="retired-binding",
        tenant_id=snippet.tenant_id,
        app_id=snippet.id,
        workflow_id=draft_workflow.id,
        workflow_version=draft_workflow.version,
        node_id="removed-agent",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="retired-agent",
        node_job_config={},
    )
    sqlite_session.add_all([draft_workflow, binding])
    sqlite_session.commit()
    retirement_calls: list[dict[str, object]] = []
    original_retire = WorkflowAgentRetirementService.retire_unowned

    def retire_unowned(*, tenant_id: str, agent_ids: Iterable[str], account_id: str | None) -> None:
        assert not sqlite_session.in_transaction()
        retirement_calls.append({"tenant_id": tenant_id, "agent_ids": set(agent_ids), "account_id": account_id})
        original_retire(tenant_id=tenant_id, agent_ids=agent_ids, account_id=account_id)

    monkeypatch.setattr(WorkflowAgentRetirementService, "retire_unowned", retire_unowned)

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
    assert not sqlite_session.in_transaction()
    persisted = sqlite_session.get(CustomizedSnippet, snippet.id)
    assert persisted is not None
    assert persisted.name == "New"
    workflow = SnippetService(session=sqlite_session).get_draft_workflow(snippet)
    assert workflow is draft_workflow
    assert workflow.graph_dict == {"nodes": [], "edges": []}
    assert sqlite_session.get(WorkflowAgentNodeBinding, "retired-binding") is None
    assert retirement_calls == [
        {
            "tenant_id": "tenant-1",
            "agent_ids": {"retired-agent"},
            "account_id": "account-1",
        }
    ]


def test_create_or_update_snippet_creates_new_snippet_and_flushes(service: SnippetDslService, sqlite_session: Session):
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
    assert not sqlite_session.in_transaction()
    assert sqlite_session.get(CustomizedSnippet, result.id) is result
    workflow = SnippetService(session=sqlite_session).get_draft_workflow(result)
    assert workflow is not None
    assert workflow.graph_dict == {"nodes": [], "edges": []}
    assert workflow.created_by == "account-1"
    assert result.input_fields_list == [{"variable": "query"}]


def test_export_snippet_dsl_raises_without_draft_workflow(service: SnippetDslService):
    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_snippet_dsl(_snippet())


@pytest.mark.usefixtures("plugin_catalog")
def test_export_snippet_dsl_returns_yaml(service: SnippetDslService, sqlite_session: Session):
    workflow = _workflow()
    snippet = _snippet(
        name="Exported",
        description=None,
        icon_info=None,
        input_fields=[{"variable": "query"}],
    )
    sqlite_session.add_all([snippet, workflow])
    sqlite_session.commit()

    result = service.export_snippet_dsl(snippet)

    assert "kind: snippet" in result
    assert "name: Exported" in result
    assert "input_fields:" in result


@pytest.mark.usefixtures("plugin_catalog")
def test_export_snippet_dsl_uses_requested_published_workflow(service: SnippetDslService, sqlite_session: Session):
    workflow = _workflow(graph={"nodes": [], "edges": []})
    workflow.version = "published-1"
    draft_workflow = _workflow(graph={"nodes": [], "edges": [], "draft_only": True})
    draft_workflow.id = "draft-1"
    snippet = _snippet(name="Exported")
    sqlite_session.add_all([snippet, workflow, draft_workflow])
    sqlite_session.commit()

    result = yaml.safe_load(service.export_snippet_dsl(snippet, workflow_id=workflow.id))

    assert result["workflow"]["graph"] == workflow.graph_dict
    assert result["workflow"]["graph"] != draft_workflow.graph_dict


def test_extract_dependencies_from_workflow_graph_covers_plugin_and_model_nodes(service: SnippetDslService) -> None:
    graph = {
        "nodes": [
            {"data": {"type": BuiltinNodeTypes.TOOL, "provider_type": "builtin", "provider_id": "acme/search/search"}},
            {
                "data": {
                    "type": BuiltinNodeTypes.TOOL,
                    "tool_configurations": {"provider_type": "builtin", "provider": "acme/legacy"},
                }
            },
            {"data": {"type": BuiltinNodeTypes.TOOL, "provider_type": "api", "provider_id": "custom-api"}},
            {"data": {"type": BuiltinNodeTypes.LLM, "model": {"provider": "acme/llm/llm"}}},
            {"data": {"type": "trigger-plugin", "plugin_id": "acme/trigger"}},
            {"data": {"type": BuiltinNodeTypes.AGENT, "agent_strategy_provider_name": "acme/agent/agent"}},
        ]
    }

    assert service._extract_dependencies_from_workflow_graph(graph) == [
        "acme/search",
        "acme/legacy",
        "acme/llm",
        "acme/trigger",
        "acme/agent",
    ]


def test_extract_dependencies_from_workflow_graph_covers_model_variants(service: SnippetDslService) -> None:
    graph = {
        "nodes": [
            {
                "data": {
                    "type": BuiltinNodeTypes.QUESTION_CLASSIFIER,
                    "model": {"provider": "acme/classifier/classifier"},
                }
            },
            {"data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "model": {"provider": "acme/extractor/extractor"}}},
            {
                "data": {
                    "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                    "retrieval_mode": "single",
                    "single_retrieval_config": {"model": {"provider": "acme/single/single"}},
                }
            },
            {
                "data": {
                    "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {
                        "reranking_mode": "reranking_model",
                        "reranking_model": {"provider": "acme/reranker/reranker"},
                    },
                }
            },
            {
                "data": {
                    "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {
                        "reranking_mode": "weighted_score",
                        "weights": {"vector_setting": {"embedding_provider_name": "acme/embedding/embedding"}},
                    },
                }
            },
        ]
    }

    assert service._extract_dependencies_from_workflow_graph(graph) == [
        "acme/classifier",
        "acme/extractor",
        "acme/single",
        "acme/reranker",
        "acme/embedding",
    ]


@pytest.mark.usefixtures("plugin_catalog")
def test_append_workflow_export_data_filters_credentials_and_extracts_dependencies(service: SnippetDslService):
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


@pytest.mark.usefixtures("plugin_catalog")
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
