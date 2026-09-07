from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.knowledge_fs import (
    KnowledgeFsBinding,
    KnowledgeFsCitation,
    KnowledgeFsCommand,
    KnowledgeFsError,
    KnowledgeFsPrepareRequest,
)
from sqlalchemy.orm import Session

from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from models.model import App, AppMode
from services.agent import knowledge_gateway as gateway
from services.agent.knowledge_citations import knowledge_sources_from_tool_part
from services.agent.knowledge_spaces import collect_workflow_agent_knowledge_space_ids
from tests.unit_tests.config_override import apply_config_overrides

SPACE = "00000000-0000-4000-8000-000000000001"
NODE = "00000000-0000-4000-8000-000000000002"
DOC = "00000000-0000-4000-8000-000000000003"
BINDING = KnowledgeFsBinding(id="docs", control_space_id=SPACE, name="产品说明")
SOUL = AgentSoulConfig.model_validate({"knowledge": {"spaces": [BINDING.model_dump()]}})
CONTEXT = DifyExecutionContextLayerConfig(
    tenant_id="tenant",
    app_id="app",
    agent_id="agent",
    user_id="account",
    user_from="account",
    agent_mode="agent_app",
    invoke_from="published",
    agent_config_version_id="snapshot",
    agent_config_version_kind="snapshot",
)
CITATION = KnowledgeFsCitation(
    id="kfs_" + "a" * 32,
    control_space_id=SPACE,
    space_name=BINDING.name,
    node_id=NODE,
    document_asset_id=DOC,
    artifact_hash="a" * 64,
    parse_artifact_id="parse",
    document_version=2,
    document_title="说明.pdf",
)


def request(name="spaces", context=CONTEXT, **args):
    cmd = KnowledgeFsCommand(
        command_id=uuid4(), command=name, **({"space": "docs"} if name != "spaces" else {}), **args
    )
    return KnowledgeFsPrepareRequest(
        execution_context=context,
        bindings=[BINDING],
        command=cmd,
        agent_supports_vision=True,
        citation=CITATION if cmd.receipt_id else None,
    )


@pytest.fixture
def authorized_gateway(monkeypatch):
    monkeypatch.setattr(gateway.AgentKnowledgeGateway, "_authorize_context", staticmethod(lambda _: SOUL))
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_BASE_URL="http://kfs:8000")
    issued = SimpleNamespace(token="private-token", knowledge_space_id=SPACE, trace_id="trace")
    runtime = SimpleNamespace(
        broker=SimpleNamespace(issue_interactive=Mock(return_value=issued)),
        app_capabilities=SimpleNamespace(issue=Mock(return_value=issued)),
    )
    return gateway.AgentKnowledgeGateway(runtime), runtime


@pytest.mark.parametrize(
    ("name", "args", "operation", "query"),
    [
        ("capabilities", {}, "getSettings", {}),
        ("search", {"query": "hello"}, "retrieveEvidence", {}),
        ("ls", {"path": "/knowledge"}, "listKnowledgeFs", {"path": "/knowledge", "limit": "10"}),
        (
            "tree",
            {"path": "/knowledge", "cursor": "next", "depth": 3},
            "treeKnowledgeFs",
            {"path": "/knowledge", "limit": "10", "cursor": "next", "depth": "3"},
        ),
        (
            "find",
            {"path": "/knowledge", "query": "manual"},
            "findKnowledgeFs",
            {"path": "/knowledge", "limit": "10", "nameContains": "manual"},
        ),
        (
            "grep",
            {"path": "/knowledge", "query": "manual"},
            "grepKnowledgeFs",
            {"path": "/knowledge", "limit": "10", "q": "manual", "timeoutMs": "5000"},
        ),
        ("cat", {"path": "/knowledge/a", "limit": 5}, "catKnowledgeFs", {"path": "/knowledge/a", "limit": "5"}),
        ("stat", {"path": "/knowledge/a"}, "statKnowledgeFs", {"path": "/knowledge/a"}),
        (
            "diff",
            {"old_path": "/knowledge/a", "new_path": "/knowledge/b"},
            "diffKnowledgeFs",
            {"oldPath": "/knowledge/a", "newPath": "/knowledge/b", "mode": "line"},
        ),
        ("open", {"node_id": NODE}, "openNodeKnowledgeFs", {"nodeId": NODE}),
        ("images", {"receipt_id": CITATION.id}, "getDocumentMultimodalManifest", {}),
        (
            "image",
            {"receipt_id": CITATION.id, "item_id": "image-1"},
            "getDocumentMultimodalAsset",
            {"variant": "thumbnail", "expectedArtifactHash": CITATION.artifact_hash},
        ),
    ],
)
def test_every_command_maps_to_exact_current_product_contract(authorized_gateway, name, args, operation, query):
    service, runtime = authorized_gateway
    result = service.prepare(request(name, **args))
    assert result.operation == operation
    assert result.query == query
    assert result.url.startswith(f"http://kfs:8000/knowledge-spaces/{SPACE}/")
    assert runtime.app_capabilities.issue.call_args.kwargs["caller_kind"] is KnowledgeFSAppSpaceJoinType.AGENT
    assert "private-token" not in repr(result)
    if name == "search":
        assert result.payload["mode"] == "fast"
        assert result.payload["includeText"] is True
        assert "plan" not in result.payload
        assert "answer" not in result.payload


def test_space_subset_changed_config_and_receipt_scope_fail_closed(authorized_gateway):
    service, runtime = authorized_gateway
    value = request("search", query="x")
    value.command.space = "another-space"
    with pytest.raises(KnowledgeFsError, match="Choose a space"):
        service.prepare(value)
    value = request()
    value.bindings = [BINDING.model_copy(update={"name": "swapped"})]
    with pytest.raises(KnowledgeFsError, match="bindings changed"):
        service.prepare(value)
    value = request("image", receipt_id=CITATION.id, item_id="image-1")
    value.citation = CITATION.model_copy(update={"control_space_id": DOC})
    with pytest.raises(KnowledgeFsError, match="receipt"):
        service.prepare(value)
    value = request("image", receipt_id=CITATION.id, item_id="image-1")
    value.agent_supports_vision = False
    with pytest.raises(KnowledgeFsError, match="cannot consume images"):
        service.prepare(value)
    runtime.app_capabilities.issue.assert_not_called()


def test_preview_never_issues_app_grants_and_revocation_is_rechecked(authorized_gateway):
    service, runtime = authorized_gateway
    preview = CONTEXT.model_copy(update={"agent_config_version_kind": "draft", "invoke_from": "debugger"})
    service.prepare(request("search", context=preview, query="x"))
    runtime.broker.issue_interactive.assert_called_once()
    runtime.app_capabilities.issue.assert_not_called()
    runtime.app_capabilities.issue.side_effect = PermissionError("revoked")
    with pytest.raises(PermissionError):
        service.prepare(request("search", query="x"))
    assert service.prepare(request()).data == {"spaces": [{"id": "docs", "name": "产品说明", "available": False}]}


def test_preview_query_images_use_current_account_authorization_without_app_grants(authorized_gateway, monkeypatch):
    service, runtime = authorized_gateway
    image_id = str(uuid4())
    validate = Mock(return_value=[SimpleNamespace(upload_file_id=image_id)])
    monkeypatch.setattr(gateway, "validate_query_image_references", validate)
    preview = CONTEXT.model_copy(update={"agent_config_version_kind": "draft", "invoke_from": "debugger"})
    result = service.prepare(request("search", context=preview, image_file_ids=[image_id]))
    validate.assert_called_once_with(
        tenant_id="tenant", account_id="account", upload_file_ids=[image_id], mark_used=False
    )
    assert result.payload["queryImages"] == [{"uploadFileId": image_id}]
    assert result.payload["query"] == ""
    runtime.app_capabilities.issue.assert_not_called()
    validate.side_effect = PermissionError("revoked")
    with pytest.raises(PermissionError):
        service.prepare(request("search", context=preview, image_file_ids=[image_id]))


def test_published_query_images_use_file_scope_and_keep_grants_out_of_public_payload(authorized_gateway, monkeypatch):
    from services.knowledge_fs.product_remote import KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER

    service, _ = authorized_gateway
    image_id = str(uuid4())
    file = object()
    resolve = Mock(return_value=file)
    grant = Mock(
        return_value=SimpleNamespace(upload_file_id=image_id, byte_size=10, access_grant="private-image-grant")
    )
    scope = Mock(side_effect=lambda _: nullcontext())
    monkeypatch.setattr(gateway, "build_from_mapping", resolve)
    monkeypatch.setattr(gateway, "issue_workflow_query_image_reference", grant)
    monkeypatch.setattr(gateway, "bind_file_access_scope", scope)
    context = CONTEXT.model_copy(update={"invoke_from": "web-app"})
    result = service.prepare(request("search", context=context, query="diagram", image_file_ids=[image_id]))
    assert resolve.call_args.kwargs["mapping"] == {
        "type": "image",
        "transfer_method": "local_file",
        "upload_file_id": image_id,
    }
    assert scope.call_args.args[0].user_id == "account"
    grant.assert_called_once_with(app_id="app", tenant_id="tenant", file=file)
    assert result.payload["queryImages"] == [{"uploadFileId": image_id}]
    assert result.headers[KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER]
    assert "private-image-grant" not in repr(result)


@pytest.mark.parametrize("sqlite_session", [(App, Agent, WorkflowAgentNodeBinding)], indirect=True)
def test_real_context_scope_rejects_foreign_tenant_wrong_agent_and_changed_workflow(
    sqlite_session: Session, monkeypatch
):
    sqlite_session.add_all(
        [
            App(
                id="app",
                tenant_id="tenant",
                name="Agent",
                mode=AppMode.AGENT,
                status=AppStatus.NORMAL,
                enable_site=True,
                enable_api=True,
                max_active_requests=0,
            ),
            Agent(
                id="agent",
                tenant_id="tenant",
                name="Agent",
                app_id="app",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
            ),
        ]
    )
    sqlite_session.flush()
    monkeypatch.setattr(gateway.session_factory, "create_session", lambda: nullcontext(sqlite_session))
    monkeypatch.setattr(gateway.TenantService, "account_belongs_to_tenant", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        gateway.AgentConfigService, "resolve_target", lambda *_args, **_kwargs: SimpleNamespace(agent_soul=SOUL)
    )
    assert gateway.AgentKnowledgeGateway._authorize_context(request()) == SOUL
    for changes in (
        {"tenant_id": "foreign"},
        {"agent_id": "foreign-agent"},
        {"agent_mode": "workflow_run", "workflow_id": "wf", "node_id": "node"},
    ):
        with pytest.raises(KnowledgeFsError):
            gateway.AgentKnowledgeGateway._authorize_context(request(context=CONTEXT.model_copy(update=changes)))
    monkeypatch.setattr(gateway.TenantService, "account_belongs_to_tenant", lambda *_args, **_kwargs: False)
    with pytest.raises(KnowledgeFsError, match="membership"):
        gateway.AgentKnowledgeGateway._authorize_context(request())
    monkeypatch.setattr(gateway.TenantService, "account_belongs_to_tenant", lambda *_args, **_kwargs: True)
    agent = sqlite_session.get(Agent, "agent")
    agent.status = AgentStatus.ARCHIVED
    sqlite_session.flush()
    with pytest.raises(KnowledgeFsError, match="unavailable"):
        gateway.AgentKnowledgeGateway._authorize_context(request())


def test_only_trusted_tool_metadata_produces_sources():
    content = {"knowledge_results": [{"data": {"items": [{"receipt_id": CITATION.id, "text": "evidence"}]}}]}
    assert knowledge_sources_from_tool_part({"part_kind": "tool-return", "content": content}) == []
    part = {
        "part_kind": "tool-return",
        "content": content,
        "metadata": {"knowledge_fs_citations": [CITATION.model_dump(), CITATION.model_dump(), {"id": "forged"}]},
    }
    sources = knowledge_sources_from_tool_part(part)
    assert len(sources) == 1
    assert sources[0].knowledge_fs_citation == CITATION
    assert sources[0].content == "evidence"
    assert sources[0].score is None


def test_workflow_space_union_reads_frozen_snapshots_not_graph_soul():
    session = Mock()
    session.scalars.return_value = [
        AgentConfigSnapshot(config_snapshot=SOUL),
        AgentConfigSnapshot(config_snapshot=SOUL),
    ]
    workflow = SimpleNamespace(tenant_id="tenant", app_id="app", id="workflow", version="published")
    assert collect_workflow_agent_knowledge_space_ids(session=session, workflow=workflow) == (SPACE,)
    sql = str(session.scalars.call_args.args[0])
    assert "workflow_agent_node_bindings.current_snapshot_id" in sql
    assert "workflow_agent_node_bindings.workflow_version" in sql
