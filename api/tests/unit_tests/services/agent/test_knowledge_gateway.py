from __future__ import annotations

from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TypedDict, Unpack, cast
from uuid import uuid4

import pytest
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.knowledge_fs import (
    KnowledgeFsBinding,
    KnowledgeFsCitation,
    KnowledgeFsCommand,
    KnowledgeFsCommandName,
    KnowledgeFsError,
    KnowledgeFsPrepareRequest,
)
from sqlalchemy.orm import Session

from core.app.file_access import FileAccessScope
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from models.model import App, AppMode
from models.workflow import Workflow
from services.agent import knowledge_gateway as gateway
from services.agent.knowledge_citations import knowledge_sources_from_tool_part
from services.agent.knowledge_spaces import collect_workflow_agent_knowledge_space_ids
from services.agent_config_service import AgentConfigTarget, AgentConfigVersionKind
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.errors import KnowledgeFSWorkflowQueryImageReference
from services.knowledge_fs.query_images import KnowledgeFSQueryImageMetadata
from services.knowledge_fs.runtime import KnowledgeFSRuntime
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.knowledge_fs_services_b_fakes import RecordingCallable

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


ISSUED = KnowledgeFSIssuedProductCapability(
    token="private-token",
    expires_at=datetime(2026, 7, 21, tzinfo=UTC),
    operation_id="operation",
    knowledge_space_id=SPACE,
    knowledge_space_revision=1,
    trace_id="trace",
    authorization_fingerprint="a" * 64,
)


@dataclass
class FakeBroker:
    issued: KnowledgeFSIssuedProductCapability = ISSUED
    issue_interactive_calls: list[dict[str, object]] = field(default_factory=list)

    def issue_interactive(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
        self.issue_interactive_calls.append(kwargs)
        return self.issued


@dataclass
class FakeAppCapabilities:
    """Issues `issued` unless `issue_failure` is set; records issuance and investigation captures."""

    issued: KnowledgeFSIssuedProductCapability = ISSUED
    issue_failure: Exception | None = None
    issue_calls: list[dict[str, object]] = field(default_factory=list)
    capture_calls: list[dict[str, object]] = field(default_factory=list)

    def issue(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
        self.issue_calls.append(kwargs)
        if self.issue_failure is not None:
            raise self.issue_failure
        return self.issued

    def capture_agent_investigation(self, **kwargs: object) -> dict[str, object]:
        self.capture_calls.append(kwargs)
        return {}


@dataclass
class FakeRuntime:
    broker: FakeBroker = field(default_factory=FakeBroker)
    app_capabilities: FakeAppCapabilities = field(default_factory=FakeAppCapabilities)


@dataclass
class _ScalarsSession:
    """Captures the snapshot query and returns preloaded rows."""

    rows: list[AgentConfigSnapshot]
    statements: list[object] = field(default_factory=list)

    def scalars(self, statement: object) -> list[AgentConfigSnapshot]:
        self.statements.append(statement)
        return self.rows


class CommandArgs(TypedDict, total=False):
    query: str
    path: str
    old_path: str
    new_path: str
    cursor: str
    limit: int
    depth: int
    node_id: str
    receipt_id: str
    item_id: str
    image_file_ids: list[str]


def request(
    name: KnowledgeFsCommandName = "spaces",
    context: DifyExecutionContextLayerConfig = CONTEXT,
    **args: Unpack[CommandArgs],
) -> KnowledgeFsPrepareRequest:
    cmd = KnowledgeFsCommand.model_validate(
        {"command_id": uuid4(), "command": name, **({"space": "docs"} if name != "spaces" else {}), **args}
    )
    return KnowledgeFsPrepareRequest(
        execution_context=context,
        bindings=[BINDING],
        command=cmd,
        agent_supports_vision=True,
        citation=CITATION if cmd.receipt_id else None,
    )


@pytest.fixture
def authorized_gateway(monkeypatch: pytest.MonkeyPatch) -> tuple[gateway.AgentKnowledgeGateway, FakeRuntime]:
    monkeypatch.setattr(gateway.AgentKnowledgeGateway, "_authorize_context", staticmethod(lambda _: SOUL))
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_BASE_URL="http://kfs:8000")
    runtime = FakeRuntime()
    return gateway.AgentKnowledgeGateway(cast(KnowledgeFSRuntime, runtime)), runtime


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
def test_every_command_maps_to_exact_current_product_contract(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime],
    name: KnowledgeFsCommandName,
    args: CommandArgs,
    operation: str,
    query: dict[str, str],
) -> None:
    service, runtime = authorized_gateway
    result = service.prepare(request(name, **args))
    assert result.operation == operation
    assert result.query == query
    assert result.url is not None
    assert result.url.startswith(f"http://kfs:8000/knowledge-spaces/{SPACE}/")
    assert runtime.app_capabilities.issue_calls[-1]["caller_kind"] is KnowledgeFSAppSpaceJoinType.AGENT
    assert "private-token" not in repr(result)
    if name == "search":
        assert result.payload is not None
        assert result.payload["mode"] == "fast"
        assert result.payload["includeText"] is True
        assert "plan" not in result.payload
        assert "answer" not in result.payload


def test_space_subset_changed_config_and_receipt_scope_fail_closed(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime],
) -> None:
    service, runtime = authorized_gateway
    value = request("search", query="x")
    value.command.space = "another-space"
    with pytest.raises(KnowledgeFsError, match="Choose an Agent Knowledge Base"):
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
    assert runtime.app_capabilities.issue_calls == []


def test_classic_bindings_do_not_block_knowledge_fs_authorization(
    monkeypatch: pytest.MonkeyPatch,
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime],
) -> None:
    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "spaces": [BINDING.model_dump()],
                "sets": [
                    {
                        "id": "classic",
                        "name": "Classic Docs",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 3},
                    }
                ],
            }
        }
    )
    monkeypatch.setattr(gateway.AgentKnowledgeGateway, "_authorize_context", staticmethod(lambda _: soul))
    service, runtime = authorized_gateway

    result = service.prepare(request("search", query="hello"))

    assert result.operation == "retrieveEvidence"
    assert len(runtime.app_capabilities.issue_calls) == 1


def test_preview_never_issues_app_grants_and_revocation_is_rechecked(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime],
) -> None:
    service, runtime = authorized_gateway
    preview = CONTEXT.model_copy(update={"agent_config_version_kind": "draft", "invoke_from": "debugger"})
    service.prepare(request("search", context=preview, query="x"))
    assert len(runtime.broker.issue_interactive_calls) == 1
    assert runtime.app_capabilities.issue_calls == []
    runtime.app_capabilities.issue_failure = PermissionError("revoked")
    with pytest.raises(PermissionError):
        service.prepare(request("search", query="x"))
    assert service.prepare(request()).data == {"spaces": [{"id": "docs", "name": "产品说明", "available": False}]}


def test_preview_query_images_use_current_account_authorization_without_app_grants(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime], monkeypatch: pytest.MonkeyPatch
) -> None:
    service, runtime = authorized_gateway
    image_id = str(uuid4())
    validate = RecordingCallable(
        result=[KnowledgeFSQueryImageMetadata(upload_file_id=image_id, byte_size=10, mime_type="image/png")]
    )
    monkeypatch.setattr(gateway, "validate_query_image_references", validate)
    preview = CONTEXT.model_copy(update={"agent_config_version_kind": "draft", "invoke_from": "debugger"})
    result = service.prepare(request("search", context=preview, image_file_ids=[image_id]))
    assert [call.kwargs for call in validate.calls] == [
        {"tenant_id": "tenant", "account_id": "account", "upload_file_ids": [image_id], "mark_used": False}
    ]
    assert result.payload is not None
    assert result.payload["queryImages"] == [{"uploadFileId": image_id}]
    assert result.payload["query"] == ""
    assert runtime.app_capabilities.issue_calls == []
    validate.failure = PermissionError("revoked")
    with pytest.raises(PermissionError):
        service.prepare(request("search", context=preview, image_file_ids=[image_id]))


def test_published_query_images_use_file_scope_and_keep_grants_out_of_public_payload(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime], monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.knowledge_fs.product_remote import KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER

    service, _ = authorized_gateway
    image_id = str(uuid4())
    file = object()
    resolve = RecordingCallable(result=file)
    grant = RecordingCallable(
        result=KnowledgeFSWorkflowQueryImageReference(
            upload_file_id=image_id, access_grant="private-image-grant", byte_size=10, mime_type="image/png"
        )
    )
    scope = RecordingCallable[AbstractContextManager[None]](result=nullcontext())
    monkeypatch.setattr(gateway, "build_from_mapping", resolve)
    monkeypatch.setattr(gateway, "issue_workflow_query_image_reference", grant)
    monkeypatch.setattr(gateway, "bind_file_access_scope", scope)
    context = CONTEXT.model_copy(update={"invoke_from": "web-app"})
    result = service.prepare(request("search", context=context, query="diagram", image_file_ids=[image_id]))
    assert resolve.calls[-1].kwargs["mapping"] == {
        "type": "image",
        "transfer_method": "local_file",
        "upload_file_id": image_id,
    }
    bound_scope = scope.calls[-1].args[0]
    assert isinstance(bound_scope, FileAccessScope)
    assert bound_scope.user_id == "account"
    assert [call.kwargs for call in grant.calls] == [{"app_id": "app", "tenant_id": "tenant", "file": file}]
    assert result.payload is not None
    assert result.payload["queryImages"] == [{"uploadFileId": image_id}]
    assert result.headers[KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER]
    assert "private-image-grant" not in repr(result)


@pytest.mark.parametrize("sqlite_session", [(App, Agent, WorkflowAgentNodeBinding)], indirect=True)
def test_real_context_scope_rejects_foreign_tenant_wrong_agent_and_changed_workflow(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    monkeypatch.setattr(gateway, "_account_belongs_to_tenant", lambda *_args, **_kwargs: True)
    target = AgentConfigTarget(
        tenant_id="tenant",
        agent_id="agent",
        version_id="snapshot",
        kind=AgentConfigVersionKind.SNAPSHOT,
        writable=False,
        version=AgentConfigSnapshot(tenant_id="tenant", agent_id="agent", version=1, config_snapshot=SOUL),
        agent_soul=SOUL,
    )
    monkeypatch.setattr(gateway.AgentConfigService, "resolve_target", lambda *_args, **_kwargs: target)
    assert gateway.AgentKnowledgeGateway._authorize_context(request()) == SOUL
    for changes in (
        {"tenant_id": "foreign"},
        {"agent_id": "foreign-agent"},
        {"agent_mode": "workflow_run", "workflow_id": "wf", "node_id": "node"},
    ):
        with pytest.raises(KnowledgeFsError):
            gateway.AgentKnowledgeGateway._authorize_context(request(context=CONTEXT.model_copy(update=changes)))
    monkeypatch.setattr(gateway, "_account_belongs_to_tenant", lambda *_args, **_kwargs: False)
    with pytest.raises(KnowledgeFsError, match="membership"):
        gateway.AgentKnowledgeGateway._authorize_context(request())
    monkeypatch.setattr(gateway, "_account_belongs_to_tenant", lambda *_args, **_kwargs: True)
    agent = sqlite_session.get(Agent, "agent")
    assert agent is not None
    agent.status = AgentStatus.ARCHIVED
    sqlite_session.flush()
    with pytest.raises(KnowledgeFsError, match="unavailable"):
        gateway.AgentKnowledgeGateway._authorize_context(request())


def test_only_trusted_tool_metadata_produces_sources() -> None:
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


def test_workflow_space_union_reads_frozen_snapshots_not_graph_soul() -> None:
    snapshots = _ScalarsSession(
        rows=[
            AgentConfigSnapshot(tenant_id="tenant", agent_id="agent-1", version=1, config_snapshot=SOUL),
            AgentConfigSnapshot(tenant_id="tenant", agent_id="agent-2", version=1, config_snapshot=SOUL),
        ]
    )
    workflow = Workflow(tenant_id="tenant", app_id="app", id="workflow", version="published")
    assert collect_workflow_agent_knowledge_space_ids(session=cast(Session, snapshots), workflow=workflow) == (SPACE,)
    assert len(snapshots.statements) == 1
    sql = str(snapshots.statements[0])
    assert "workflow_agent_node_bindings.current_snapshot_id" in sql
    assert "workflow_agent_node_bindings.workflow_version" in sql


def test_investigation_capture_reauthorizes_agent_and_keeps_stable_id(
    authorized_gateway: tuple[gateway.AgentKnowledgeGateway, FakeRuntime],
) -> None:
    from dify_agent.protocol.knowledge_investigation import KnowledgeAttempt, KnowledgeInvestigationPayload

    service, runtime = authorized_gateway
    report = KnowledgeInvestigationPayload(
        investigation_id=uuid4(),
        execution_context=CONTEXT,
        bindings=[BINDING],
        query="refund",
        answer="unknown",
        status="completed",
        attempts=[
            KnowledgeAttempt(
                command_id=uuid4(),
                control_space_id=SPACE,
                command="search",
                query="refund",
                outcome="empty",
                started_at_ms=1,
                elapsed_ms=4,
                delivered=True,
                authorization_fingerprint="a" * 64,
            )
        ],
    )
    service.capture_investigation(report, SPACE)
    first = runtime.app_capabilities.capture_calls[-1]["payload"]
    service.capture_investigation(report, SPACE)
    assert runtime.app_capabilities.capture_calls[-1]["payload"] == first
    assert isinstance(first, dict)
    assert first["query"] == "refund"
    assert len(first["attempts"]) == 1
    assert runtime.app_capabilities.issue_calls[-1]["caller_kind"] == KnowledgeFSAppSpaceJoinType.AGENT
    assert runtime.app_capabilities.issue_calls[-1]["operation_id"] == "captureAgentKnowledgeInvestigation"
    runtime.app_capabilities.issued = ISSUED._replace(authorization_fingerprint="b" * 64)
    with pytest.raises(KnowledgeFsError, match="authorization changed"):
        service.capture_investigation(report, SPACE)
    assert len(runtime.app_capabilities.capture_calls) == 2
    with pytest.raises(KnowledgeFsError, match="not bound"):
        service.capture_investigation(report, str(uuid4()))
