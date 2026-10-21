"""S1 boundaries with real owner/entity types, SQLite ACKs and explicit I/O ports."""

from contextlib import contextmanager

import pytest
from flask import Flask

from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.agent_contracts import (
    AgentDefinitionReceipt,
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
)
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing import state_store as state
from tests.unit_tests.services.dify_builder import native_owner_fixtures

REF = NativeTestContextRef(request_id="req", invocation_id="inv", context_digest="a" * 64)
PARENT = AgentParentNodeRef(
    ref=REF,
    execution_id="4c959aea-9025-4db9-9361-eed1191c11c7",
    input_result_ref="input",
    input_digest="b" * 64,
)
WORKSPACE = AgentTestWorkspaceRef(
    binding_id="binding",
    workspace_id="workspace",
    backend_binding_ref="scope",
    backend_workspace_ref="scope",
    pinned_snapshot_id="pin",
    home_snapshot_id="home",
    workspace_generation=9,
)
CONFIG = {"composition": {"schema_version": 2, "layers": []}, "session_snapshot": None}


operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


def resolved_context(**updates):
    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext

    return ResolvedNativeTestContext(
        ref=REF,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph={},
        inputs={},
        graph_revision="a" * 64,
        input_revision="b" * 64,
        resource_manifest=(),
        generation=4,
        root_native_run_id="workflow",
        native_run_id="workflow",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="budget",
        cancellation_ref="cancel",
        execution_mode="native",
    ).model_copy(update=updates)


def read_authority():
    from datetime import UTC, datetime

    from services.dify_builder.native_testing.private_reads import PrivateReadOwner

    return PrivateReadOwner(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        parent_invocation_id=None,
        context_object_id="context",
        generation=4,
        graph_revision="a" * 64,
        root_revision_matches=True,
        input_revision="b" * 64,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        cancelled=False,
        active=True,
        request_state="running",
    )


def prepared_state():
    return state._AgentPreparation(
        parent=PARENT,
        context=resolved_context(),
        authority=read_authority(),
        workspace=WORKSPACE,
        resource_digest="e" * 64,
        objects=[],
    )


def payloads(session):
    from sqlalchemy import select

    return session.scalars(select(state.NativePayloadObject)).all()


def preparation_owner():
    from datetime import UTC, datetime

    from services.dify_builder.native_testing.repository import OwnedNativeTest

    return OwnedNativeTest(
        ref=REF,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=4,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )


def preparation_session(monkeypatch, operations_service, preparation_sql):
    from datetime import UTC, datetime

    from services.dify_builder.native_testing.repository import OwnedNativeTest

    loader = operations_service.loader
    session = preparation_sql
    owned = OwnedNativeTest(
        ref=REF,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=4,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )
    from models.dify_builder_native_tests import NativeTestScope

    scope = NativeTestScope(
        tenant_id="tenant",
        request_id="req",
        max_calls=10,
        max_dispatches=10,
        max_cost_units=10,
        generation=4,
        task_approved=False,
        cancelled=False,
        expires_at=owned.expires_at,
        budget_limits={},
        budget_spent={},
        profile={},
    )
    session.info["locked"] = False

    @contextmanager
    def locked_root(**_kwargs):
        assert not session.info["locked"]
        session.info["locked"] = True
        try:
            yield session, owned, scope
            session.commit()
        except BaseException:
            session.rollback()
            raise
        finally:
            session.info["locked"] = False

    monkeypatch.setattr(loader, "locked", locked_root)
    return session, owned, scope


def node_association(monkeypatch, operations_service, context, data):
    from graphon.runtime import InitParams
    from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
    from services.dify_builder.native_testing.control import marked_native_node_class
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation, NativeRuntimeBridge
    from services.workflow_runtime.agent_node import DifyAgentNode
    from tests.unit_tests.services.dify_builder.test_effect_mock import _factory

    store = operations_service.state_store
    lifecycle = NativeTestLifecycleService(operations_service.loader, state_store=store)
    host = NativeHostLaunch(
        context=context,
        dispatch_id="dispatch",
        lifetime=NativeHostLifetime(context=context, dispatch_id="dispatch"),
        journal=NodeOperationJournal(state=store, authorization=operations_service.bridge.authorization),
        checkpoints=NativeCheckpointBridge(state=store, lifecycle=lifecycle),
        fence_pending=lifecycle.fence_pending,
        stop_sealer=lifecycle,
        authorization=operations_service.bridge.authorization,
        http_baseline=(1.0, 1.0, 1.0),
    )

    def unused(**_kwargs):
        pytest.fail("Node association attempted effect collaborator construction")

    bridge = NativeRuntimeBridge(
        state=store,
        collaborators=unused,
        boundary_owner=host.boundary_owner,
        control_sink=host.control_sink,
        node_arguments=unused,
    )
    monkeypatch.setattr(bridge, "resolve", lambda _ref: context)
    from tests.unit_tests.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, AGENT_BACKEND_BASE_URL="http://agent.invalid")
    factory = _factory(frozenset())
    node_class = marked_native_node_class(DifyAgentNode, marked=True)
    association = NativeNodePreparation(
        bridge=bridge, ref=context.ref, node_id="node", node_class=node_class, runtime_state=factory.runtime_state
    )
    node = node_class(
        node_id="node",
        data=data,
        init_params=InitParams(
            workflow_id="workflow",
            graph_config=context.graph,
            run_context=factory.init_params.run_context,
            call_depth=0,
        ),
        runtime_state=factory.runtime_state,
        native_control_owner=host.boundary_owner,
        native_control_sink=host.control_sink,
        **factory._build_agent_node_init_kwargs(node_class=DifyAgentNode),
    )
    association.attach(node)
    node.bind_execution_id(PARENT.execution_id)
    return association


def workspace_service(monkeypatch, operations_service, prepare):
    from shellctl.shared.schemas import NativeScopeLimits

    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService

    service = AgentTestWorkspaceService(
        operations_service.loader,
        state_store=operations_service.state_store,
        limits=NativeScopeLimits(
            cpu_quota=1000,
            memory_bytes=64 << 20,
            pids=8,
            fds=32,
            wall_seconds=60,
            input_bytes=1024,
            output_bytes=4096,
            disk_bytes=1 << 20,
        ),
    )
    monkeypatch.setattr(service, "prepare", prepare)
    return service


def claim_store(monkeypatch, operations_service, preparation_sql):
    sql, _owned, _scope = preparation_session(monkeypatch, operations_service, preparation_sql)
    store = operations_service.state_store
    prep = prepared_state()
    monkeypatch.setattr(store, "_agent_prepare", lambda **_kwargs: prep)
    monkeypatch.setattr(store, "_agent_recheck", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(store, "_agent_refresh_access", lambda *_args: None, raising=False)
    monkeypatch.setattr(store, "_agent_object", lambda *_args, **_kwargs: None)

    def prepare(**_kwargs):
        assert not sql.info["locked"], "crypto/storage must precede SQL writer"
        return state.ObjectReceipt(
            "obj",
            "tenant",
            "req",
            "inv",
            "result",
            _kwargs["logical_key"],
            "opaque-key",
            canonical_digest(_kwargs["payload"]),
            canonical_digest(_kwargs["payload"]),
        )

    monkeypatch.setattr(store, "prepare_object", prepare)
    return store, sql


def test_claim_observes_first_insertion_under_actual_state_owner(monkeypatch, operations_service, preparation_sql):
    assert hasattr(state.NativeExecutionStateStore, "claim_agent_create"), "S1 atomic create claim missing"
    store, sql = claim_store(monkeypatch, operations_service, preparation_sql)
    first = store.claim_agent_create(
        ref=REF,
        parent_node=PARENT,
        expected_invocation_generation=4,
        definition_receipt=AgentDefinitionReceipt("node", "s"),
        config=CONFIG,
    )
    second = store.claim_agent_create(
        ref=REF,
        parent_node=PARENT,
        expected_invocation_generation=4,
        definition_receipt=AgentDefinitionReceipt("node", "s"),
        config=CONFIG,
    )
    assert first.kind == "inserted"
    assert second.kind == "existing"
    assert first.config_ref == second.config_ref
    assert len(payloads(sql)) == 1
    assert first.config_digest == canonical_digest(CONFIG)
    with pytest.raises(BuilderExecutionPolicyError):
        store.claim_agent_create(
            ref=REF,
            parent_node=PARENT,
            expected_invocation_generation=4,
            definition_receipt=AgentDefinitionReceipt("node", "s"),
            config=CONFIG | {"session_snapshot": {"schema_version": 2, "layers": {}}},
        )


def test_storage_mutation_invalidates_final_claim(monkeypatch, operations_service, preparation_sql):
    assert hasattr(state.NativeExecutionStateStore, "claim_agent_create"), "S1 atomic create claim missing"
    store, sql = claim_store(monkeypatch, operations_service, preparation_sql)

    def refuse(*_args, **_kwargs):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")

    monkeypatch.setattr(store, "_agent_recheck", refuse)
    with pytest.raises(BuilderExecutionPolicyError):
        store.claim_agent_create(
            ref=REF,
            parent_node=PARENT,
            expected_invocation_generation=4,
            definition_receipt=AgentDefinitionReceipt("node", "s"),
            config=CONFIG,
        )
    assert not payloads(sql)


@pytest.mark.parametrize("path", ["prepare-run", "prepared-config"])
@pytest.mark.parametrize("key", [None, "wrong"])
def test_actual_flask_service_auth_stops_before_preparation_lookup(monkeypatch, path, key):
    import controllers.inner_api.agent.native_testing as controller
    from controllers.inner_api import bp
    from tests.unit_tests.config_override import config_overrides_context

    assert hasattr(controller, "AgentNativePrepareRunApi"), "S1 authenticated callback missing"
    calls = []
    monkeypatch.setattr(controller, "agent_preparation_for_ref", lambda ref: calls.append(ref))
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with config_overrides_context(PLUGIN_DAEMON_KEY="synthetic", INNER_API_KEY_FOR_PLUGIN="key"):
        response = app.test_client().post(
            "/inner/api/agent/native-testing/" + path,
            json={"private": "canary"},
            headers={} if key is None else {"X-Inner-Api-Key": key},
        )
    assert response.status_code == 404
    assert not calls


@pytest.mark.parametrize("mutation", ["run", "mode", "parent", "digest", "generation"])
def test_backend_identity_is_read_outside_writer_before_bind(mutation, monkeypatch, operations_service):
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRuntimeIdentity,
    )

    from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
    from services.dify_builder.native_testing import agent_preparation as owner

    config = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="cfg",
        config_digest=canonical_digest(CONFIG),
        config=CONFIG,
    )
    calls = []

    def load_prepared_config(**_kwargs):
        calls.append("load")
        return config

    def bind_agent_run(**_kwargs):
        calls.append("bind")
        return "association"

    def load_context(**_kwargs):
        return resolved_context()

    store = operations_service.state_store
    monkeypatch.setattr(store, "load_prepared_config", load_prepared_config)
    monkeypatch.setattr(store, "bind_agent_run", bind_agent_run)
    monkeypatch.setattr(store, "load_context", load_context)

    def read_run_identity_sync(_run_id, _selection):
        calls.append("backend")
        raw = {
            "run_id": "run",
            "execution_mode": "builder_test",
            "parent_node": PARENT.model_dump(mode="json"),
            "request_digest": canonical_digest(CONFIG),
            "agent_generation": 0,
        }
        if mutation == "run":
            raw["run_id"] = "foreign"
        if mutation == "mode":
            raw["execution_mode"] = "ordinary"
        if mutation == "parent":
            raw["parent_node"] = PARENT.model_dump(mode="json") | {"input_result_ref": "foreign"}
        if mutation == "digest":
            raw["request_digest"] = "f" * 64
        if mutation == "generation":
            raw["agent_generation"] = 1
        return AgentRuntimeIdentity.model_validate(raw)

    from dify_agent.client import Client

    backend = Client(base_url="http://agent.invalid")
    monkeypatch.setattr(backend, "read_run_identity_sync", read_run_identity_sync)

    service = owner.AgentPreparationService(state_store=store, backend=backend, workspace=None, config_builder=None)
    with pytest.raises(BuilderExecutionPolicyError):
        service.bind_created_run(
            payload=AgentPrepareRunPayload(
                parent_node=PARENT.model_dump(mode="json"),
                agent_run_id="run",
                request_digest=canonical_digest(CONFIG),
            )
        )
    assert "backend" in calls
    assert "bind" not in calls


@pytest.mark.parametrize("routes", [False, True])
def test_inert_composer_uses_real_layer_dtos_without_model_schema_or_session(monkeypatch, routes, operations_service):
    from core.app.llm import model_access
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_runtime_config import (
        NativeAgentDefinition,
        NativeAgentRuntimeConfigBuilder,
    )
    from services.dify_builder.native_testing.agent_tool_declarations import (
        PreparedAgentToolDeclarations,
    )

    calls = []

    def forbidden(*_args, **_kwargs):
        calls.append("forbidden")
        raise AssertionError("ordinary model schema/credential call")

    monkeypatch.setattr(model_access, "resolve_model_context_window", forbidden)

    def prepare(**_kwargs):
        return PreparedAgentToolDeclarations(None, None, ())

    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolDeclarationService

    declarations = AgentToolDeclarationService()
    monkeypatch.setattr(declarations, "prepare", prepare)

    builder = NativeAgentRuntimeConfigBuilder(loader=operations_service.loader, declarations=declarations)
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "test-model",
            }
        }
    )
    definition = NativeAgentDefinition(
        "node",
        "agent",
        "pin",
        soul,
        WorkflowNodeJobConfig(
            workflow_prompt="Review inputs",
            output_routes={
                "enabled": routes,
                "routes": [
                    {"id": "yes", "name": "Positive"},
                    {"id": "no", "name": "Negative"},
                ],
            },
        ),
        "s",
    )
    context = resolved_context(workflow_id="workflow-id")
    request = builder.compose(
        context=context,
        definition=definition,
        parent_node=PARENT,
        workspace=WORKSPACE,
        inputs={
            "query": True,
            "values": {"rows": [1, False]},
            "route_names": {"yes": "Positive", "no": "Negative"},
        },
    )
    assert request.execution_mode == "builder_test"
    assert request.native_parent_node.execution_id == PARENT.execution_id
    assert request.session_snapshot is None
    assert not calls
    config = request.model_dump(mode="json", include={"composition", "session_snapshot"})
    assert state.NativeExecutionStateStore._agent_executable_config(config, PARENT) == config
    raw = {
        "composition": {
            "layers": [
                {
                    "name": "llm",
                    "config": {"credentials": {"api_key": "private-canary"}},
                }
            ]
        },
        "session_snapshot": None,
    }
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_config_credentials"):
        state.NativeExecutionStateStore._agent_executable_config(raw, PARENT)


@pytest.mark.parametrize("kind", ["valid", "duplicate", "lost-ack", "changed-run", "during-backend"])
def test_callback_idempotency_and_mutation_recheck(kind, monkeypatch, operations_service):
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRuntimeIdentity,
    )

    from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
    from services.dify_builder.native_testing.agent_preparation import (
        AgentPreparationService,
    )

    config = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="cfg",
        config_digest=canonical_digest(CONFIG),
        config=CONFIG,
    )
    rows = []
    loads = []
    mutated = []

    def load_context(**_kwargs):
        return resolved_context()

    def load_prepared_config(**_kwargs):
        loads.append(_kwargs)
        if mutated:
            return config.model_copy(update={"config_digest": "d" * 64})
        return config

    def bind_agent_run(**_kwargs):
        association = _kwargs["association"]
        if rows and rows[0] != association:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        if not rows:
            rows.append(association)
        return "association"

    store = operations_service.state_store
    monkeypatch.setattr(store, "load_context", load_context)
    monkeypatch.setattr(store, "load_prepared_config", load_prepared_config)
    monkeypatch.setattr(store, "bind_agent_run", bind_agent_run)

    def read_run_identity_sync(run_id, selection):
        if kind == "during-backend":
            mutated.append(True)
        return AgentRuntimeIdentity(
            run_id=run_id,
            execution_mode="builder_test",
            parent_node=selection.parent_node,
            request_digest=selection.request_digest,
            agent_generation=0,
        )

    from dify_agent.client import Client

    backend = Client(base_url="http://agent.invalid")
    monkeypatch.setattr(backend, "read_run_identity_sync", read_run_identity_sync)

    service = AgentPreparationService(state_store=store, backend=backend, workspace=None, config_builder=None)
    payload = AgentPrepareRunPayload(
        parent_node=PARENT.model_dump(mode="json"),
        agent_run_id="run",
        request_digest=config.config_digest,
    )
    if kind == "during-backend":
        with pytest.raises(BuilderExecutionPolicyError):
            service.bind_created_run(payload=payload)
        assert not rows
        return
    reply = service.bind_created_run(payload=payload)
    assert reply.association_object_ref == "association"
    if kind in ("duplicate", "lost-ack"):
        assert service.bind_created_run(payload=payload) == reply
    if kind == "changed-run":
        with pytest.raises(BuilderExecutionPolicyError):
            service.bind_created_run(payload=payload.model_copy(update={"agent_run_id": "other"}))
    assert len(rows) == 1
    assert len(loads) >= 2


@pytest.mark.parametrize("mutation", ["none", "input", "context", "bound-node", "config"])
def test_initial_preparation_uses_bound_uuid_typed_inputs_and_rechecks_every_io(
    mutation,
    monkeypatch,
    operations_service,
):

    from dify_agent.protocol.schemas import CreateRunRequest

    from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
    from runtime_contracts.builder.native.agent_contracts import AgentCreateInserted
    from services.dify_builder.native_testing.agent_preparation import (
        AgentPreparationService,
    )

    data = DifyAgentNodeData.model_validate(
        {
            "type": "agent",
            "version": "2",
            "agent_node_kind": "dify_agent",
            "title": "Agent",
            "agent_task": "Review",
        }
    )
    graph = {"nodes": [{"id": "node", "data": data.model_dump(mode="json")}]}
    from dataclasses import replace

    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_runtime_config import (
        NativeAgentDefinition,
        NativeAgentRuntimeConfigBuilder,
    )

    context = resolved_context(graph=graph)
    definition = NativeAgentDefinition("node", "agent", "pin", AgentSoulConfig(), WorkflowNodeJobConfig(), "s")
    values = {"query": False, "values": {"start.rows": [1, True, "1"]}}
    current = []
    claims = []
    stored = []
    association = node_association(monkeypatch, operations_service, context, data)
    monkeypatch.setattr(
        association,
        "resolve",
        lambda: context.model_copy(update={"generation": 5}) if "context" in current else context,
    )
    builder = NativeAgentRuntimeConfigBuilder(loader=operations_service.loader)
    monkeypatch.setattr(
        builder,
        "load_definition",
        lambda **_kwargs: replace(definition, snapshot_id="other") if "config" in current else definition,
    )
    monkeypatch.setattr(
        builder, "typed_inputs", lambda **_kwargs: {"query": "changed", "values": {}} if "input" in current else values
    )

    def compose(**kwargs):
        return CreateRunRequest(
            composition={"layers": []},
            execution_mode="builder_test",
            native_test_ref=REF.model_dump(mode="json"),
            native_parent_node=kwargs["parent_node"].model_dump(mode="json"),
            native_test_protocol_version=1,
        )

    monkeypatch.setattr(builder, "compose", compose)

    def prepare(**_kwargs):
        current.append(mutation)
        if mutation == "bound-node":
            association.bound_node.node_data.agent_task = "mutated"
        return WORKSPACE

    workspace = workspace_service(monkeypatch, operations_service, prepare)
    store = operations_service.state_store
    monkeypatch.setattr(store, "store_node_inputs", lambda **kwargs: stored.append(kwargs) or "input")
    monkeypatch.setattr(
        store,
        "claim_agent_create",
        lambda **kwargs: claims.append(kwargs) or AgentCreateInserted("cfg", canonical_digest(CONFIG)),
    )
    service = AgentPreparationService(store, None, workspace, builder)
    if mutation == "none":
        result = service.prepare_initial(association=association)
        assert result.parent_node.execution_id == PARENT.execution_id
        assert result.parent_node.input_digest == canonical_digest(values)
        assert result.claim.kind == "inserted"
        assert len(claims) == 1
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service.prepare_initial(association=association)
        assert not claims
    assert stored[0]["generation"] == 4
    assert stored[0]["inputs"] == values
    assert stored[0]["native_execution_id"] == PARENT.execution_id


@pytest.mark.parametrize(
    "mutation",
    ["none", "parent", "workspace", "run", "owner", "config-ref", "resource"],
)
def test_private_config_read_rechecks_exact_stored_owner_and_resource_relations(
    monkeypatch,
    mutation,
    operations_service,
    preparation_sql,
):
    sql, _owned, _scope = preparation_session(monkeypatch, operations_service, preparation_sql)
    store = operations_service.state_store
    prep = prepared_state()
    value = {
        "schema": "agent-config-v2",
        "parent_node": PARENT.model_dump(mode="json"),
        "workflow_native_run_id": "workflow",
        "workspace": WORKSPACE.model_dump(mode="json"),
        "resource_digest": "e" * 64,
        "config": CONFIG,
    }
    if mutation == "parent":
        value["parent_node"] = PARENT.model_dump(mode="json") | {"input_result_ref": "foreign"}
    if mutation == "workspace":
        value["workspace"] = WORKSPACE.model_dump(mode="json") | {"home_snapshot_id": "foreign"}
    if mutation == "run":
        value["workflow_native_run_id"] = "foreign"
    if mutation == "resource":
        value["resource_digest"] = "f" * 64
    receipt = state.ObjectReceipt(
        "cfg",
        "foreign" if mutation == "owner" else "tenant",
        "req",
        "inv",
        "result",
        store._agent_key("agent-config", PARENT),
        "key",
        "a" * 64,
        canonical_digest(value),
    )
    sql.add(state.NativePayloadObject(**vars(receipt)))
    sql.commit()
    monkeypatch.setattr(store.loader, "session_factory", lambda: sql)
    monkeypatch.setattr(store, "_agent_prepare", lambda **_kwargs: prep)
    monkeypatch.setattr(store, "_agent_refresh_access", lambda *_args: None)
    checked = []
    monkeypatch.setattr(store, "_agent_recheck", lambda *_args, **_kwargs: checked.append(True))
    limits = []

    def read(_receipt, *, max_bytes=None):
        limits.append(max_bytes)
        return value

    monkeypatch.setattr(store, "_read_object", read)
    if mutation == "none":
        result = store.load_prepared_config(ref=REF, parent_node=PARENT, config_ref="cfg")
        assert result.config == CONFIG
        assert result.config_ref == "cfg"
        assert checked == [True]
        assert limits == [1024 * 1024]
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            store.load_prepared_config(
                ref=REF,
                parent_node=PARENT,
                config_ref="foreign" if mutation == "config-ref" else "cfg",
            )
        assert not checked


@pytest.mark.parametrize(("payload", "expected"), [(b" " * 4097, 413), (b'{"approved":true}', 400)])
def test_actual_flask_control_caps_and_validation_before_factory(monkeypatch, payload, expected):
    from dify_agent.protocol.native_testing import AgentRunTransportSelection

    import controllers.inner_api.agent.native_testing as controller
    from controllers.inner_api import bp
    from tests.unit_tests.config_override import config_overrides_context
    from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import (
        encoded,
    )

    calls = []
    monkeypatch.setattr(controller, "agent_preparation_for_ref", lambda ref: calls.append(ref))
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with config_overrides_context(
        PLUGIN_DAEMON_KEY="synthetic",
        INNER_API_KEY_FOR_PLUGIN="key",
        AGENT_BACKEND_API_TOKEN="synthetic-backend",
    ):
        response = app.test_client().post(
            "/inner/api/agent/runtime/native-testing/prepare-run",
            data=payload,
            content_type="application/json",
            headers={
                "Authorization": "Bearer synthetic-backend",
                "X-Dify-Agent-Run": encoded(
                    AgentRunTransportSelection(
                        agent_run_id="run",
                        parent_node=PARENT.model_dump(mode="json"),
                        request_digest=canonical_digest(CONFIG),
                        agent_generation=0,
                    )
                ),
            },
        )
    assert response.status_code == expected
    assert not calls


def test_authenticated_flask_callback_through_real_sdk_readback_is_idempotent_and_conflict_safe(
    monkeypatch,
    operations_service,
):
    """Real Flask→HTTPX SDK wire with explicit identity and storage method ports."""
    import httpx
    from dify_agent.client import Client
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRunTransportSelection,
    )

    import controllers.inner_api.agent.native_testing as controller
    from controllers.inner_api import bp
    from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
    from services.dify_builder.native_testing.agent_preparation import (
        AgentPreparationService,
    )
    from tests.unit_tests.config_override import config_overrides_context
    from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import (
        encoded,
    )

    owned = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="cfg",
        config_digest=canonical_digest(CONFIG),
        config=CONFIG,
    )
    bindings = []
    reads = []

    def load_context(**_kwargs):
        return resolved_context()

    def load_prepared_config(**_kwargs):
        return owned

    def discover_agent_run(**_kwargs):
        return bindings[0] if bindings else None

    def bind_agent_run(**_kwargs):
        selected = _kwargs["association"]
        if bindings and selected != bindings[0]:
            raise BuilderExecutionPolicyError("private-canary")
        if not bindings:
            bindings.append(selected)
        return "association"

    store = operations_service.state_store
    monkeypatch.setattr(store, "load_context", load_context)
    monkeypatch.setattr(store, "load_prepared_config", load_prepared_config)
    monkeypatch.setattr(store, "discover_agent_run", discover_agent_run)
    monkeypatch.setattr(store, "bind_agent_run", bind_agent_run)

    def handle(request):
        reads.append(request)
        assert request.headers["Authorization"] == "Bearer synthetic-backend"
        run_id = request.url.path.split("/")[2]
        return httpx.Response(
            200,
            json={
                "run_id": run_id,
                "execution_mode": "builder_test",
                "parent_node": PARENT.model_dump(mode="json"),
                "request_digest": owned.config_digest,
                "agent_generation": 0,
            },
        )

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with (
        httpx.Client(transport=httpx.MockTransport(handle)) as http,
        Client(
            base_url="http://synthetic.invalid",
            headers={"Authorization": "Bearer synthetic-backend"},
            sync_http_client=http,
        ) as sdk,
    ):
        service = AgentPreparationService(store, sdk, None, None)
        from services.dify_builder.native_testing.agent_lineage import (
            NativeAgentEndpointLineage,
        )

        app.extensions["native_agent_endpoint_lineage"] = NativeAgentEndpointLineage(
            backend=sdk, preparation_for_ref=lambda _ref: service
        )
        monkeypatch.setattr(controller, "agent_preparation_for_ref", lambda _ref: service)
        payload = AgentPrepareRunPayload(
            parent_node=PARENT.model_dump(mode="json"),
            agent_run_id="run",
            request_digest=owned.config_digest,
        )
        with config_overrides_context(
            PLUGIN_DAEMON_KEY="synthetic",
            INNER_API_KEY_FOR_PLUGIN="key",
            AGENT_BACKEND_API_TOKEN="synthetic-backend",
        ):
            client = app.test_client()
            headers = {
                "Authorization": "Bearer synthetic-backend",
                "X-Dify-Agent-Run": encoded(
                    AgentRunTransportSelection(
                        agent_run_id="run",
                        parent_node=PARENT.model_dump(mode="json"),
                        request_digest=owned.config_digest,
                        agent_generation=0,
                    )
                ),
            }
            first = client.post(
                "/inner/api/agent/runtime/native-testing/prepare-run",
                json=payload.model_dump(mode="json"),
                headers=headers,
            )
            repeated = client.post(
                "/inner/api/agent/runtime/native-testing/prepare-run",
                json=payload.model_dump(mode="json"),
                headers=headers,
            )
            conflicting = client.post(
                "/inner/api/agent/runtime/native-testing/prepare-run",
                json=payload.model_copy(update={"agent_run_id": "other"}).model_dump(mode="json"),
                headers=headers,
            )
            config = client.post(
                "/inner/api/agent/runtime/native-testing/prepared-config",
                json={
                    "parent_node": PARENT.model_dump(mode="json"),
                    "config_ref": "cfg",
                },
                headers=headers,
            )
    assert first.status_code == repeated.status_code == config.status_code == 200
    assert (
        first.json
        == repeated.json
        == {
            "config_ref": "cfg",
            "config_digest": owned.config_digest,
            "association_object_ref": "association",
        }
    )
    assert first.headers["Cache-Control"] == "no-store"
    assert conflicting.status_code == 409
    assert "private-canary" not in conflicting.get_data(as_text=True)
    assert config.json["config"] == CONFIG
    assert config.json["parent_node"] == PARENT.model_dump(mode="json")
    assert len(bindings) == 1
    assert len(reads) == 5


def test_config_creation_readback_cap_precedes_decryption_and_sql(monkeypatch, operations_service):
    import inspect

    assert "max_bytes" in inspect.signature(state.NativeExecutionStateStore.prepare_object).parameters, (
        "S1 protected config creation readback cap missing"
    )
    calls = []
    monkeypatch.setattr(state.encrypter, "encrypt_token", lambda _tenant, _raw: "small-cipher")
    monkeypatch.setattr(state.storage, "save", lambda *_args: None)
    monkeypatch.setattr(state.storage, "load", lambda *_args: b"x" * (4096 + 1))
    monkeypatch.setattr(state.encrypter, "decrypt_token", lambda *_args: calls.append("decrypt"))
    with pytest.raises(BuilderExecutionPolicyError):
        operations_service.state_store.prepare_object(
            ref=REF,
            tenant_id="tenant",
            kind="result",
            logical_key="agent-config:owned",
            payload=CONFIG,
            max_bytes=4096,
        )
    assert not calls


@pytest.mark.parametrize("mutation", ["none", "outputs", "routes", "binding-kind"])
def test_current_published_binding_must_match_graph_outputs_and_routes(monkeypatch, mutation, operations_service):
    """Real definition loader, graph renderer, ORM rows and Session query boundaries."""
    import services.dify_builder.native_testing.agent_runtime_config as config_module
    from models.agent import (
        AgentConfigSnapshot,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import (
        AgentBindingService,
        native_node_data,
    )

    job = WorkflowNodeJobConfig(workflow_prompt="Review")
    data = native_node_data(agent_id="agent", snapshot_id="pin", node_job=job)
    if mutation == "outputs":
        data["agent_declared_outputs"] = [{"name": "foreign", "type": "string"}]
    if mutation == "routes":
        data["agent_output_routes"] = {"enabled": True, "routes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]}
    soul = AgentSoulConfig.model_validate(
        {"model": {"plugin_id": "langgenius/openai", "model_provider": "openai", "model": "test"}}
    )
    agent = state.Agent(id="agent", tenant_id="tenant", active_config_snapshot_id="pin")
    snapshot = AgentConfigSnapshot(id="pin", tenant_id="tenant", agent_id="agent", config_snapshot=soul)
    binding = WorkflowAgentNodeBinding(
        id="binding",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        node_id="node",
        agent_id="agent",
        current_snapshot_id="pin",
        node_job_config=job,
        binding_type="foreign" if mutation == "binding-kind" else WorkflowAgentBindingType.ROSTER_AGENT,
    )

    loader = operations_service.loader
    session = loader.session_factory()
    monkeypatch.setattr(session, "get", lambda model, _identity: snapshot if model is AgentConfigSnapshot else agent)
    monkeypatch.setattr(
        session,
        "scalar",
        lambda query: binding if query.column_descriptions[0]["entity"] is WorkflowAgentNodeBinding else agent,
    )
    monkeypatch.setattr(loader, "session_factory", lambda: session)
    monkeypatch.setattr(AgentBindingService, "authorize", lambda **_kwargs: None)
    monkeypatch.setattr(AgentBindingService, "recheck_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        config_module,
        "validate_invocation_workflow",
        lambda *_args, **_kwargs: Workflow(version="draft", environment_variables=[]),
    )
    from models.workflow import Workflow

    builder = config_module.NativeAgentRuntimeConfigBuilder(loader=loader)
    context = resolved_context(graph={"nodes": [{"id": "node", "data": data}]})
    if mutation == "none":
        assert builder.load_definition(context=context, node_id="node").snapshot_id == "pin"
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            builder.load_definition(context=context, node_id="node")


@pytest.mark.parametrize("owner", ["soul", "cli"])
@pytest.mark.parametrize(
    ("kind", "field", "value"),
    [
        ("secret_refs", "value", "NESTED_SECRET_CANARY"),
        ("secret_refs", "value", ""),
        ("secret_refs", "default", "NESTED_DEFAULT_CANARY"),
        ("variables", "value", "NESTED_VARIABLE_CANARY"),
        ("variables", "value", False),
        ("variables", "default", "NESTED_VARIABLE_DEFAULT_CANARY"),
        ("secret_refs", "ref", "opaque-secret-reference"),
    ],
)
def test_composer_to_claim_shell_env_is_reference_only(
    monkeypatch, owner, kind, field, value, operations_service, preparation_sql
):
    """Actual composer + claim owner; only SQL/storage and declaration I/O are doubles."""
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_runtime_config import (
        NativeAgentDefinition,
        NativeAgentRuntimeConfigBuilder,
    )
    from services.dify_builder.native_testing.agent_tool_declarations import (
        PreparedAgentToolDeclarations,
    )

    calls = []

    def prepare(**_kwargs):
        calls.append("declarations")
        return PreparedAgentToolDeclarations(None, None, ())

    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolDeclarationService

    declarations = AgentToolDeclarationService()
    monkeypatch.setattr(declarations, "prepare", prepare)

    env = {kind: [{"name": "SERVICE_TOKEN", field: value}]}
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "test",
            },
            **({"env": env} if owner == "soul" else {"tools": {"cli_tools": [{"name": "tool", "env": env}]}}),
        }
    )
    builder = NativeAgentRuntimeConfigBuilder(loader=operations_service.loader, declarations=declarations)
    definition = NativeAgentDefinition(
        "node",
        "agent",
        "pin",
        soul,
        WorkflowNodeJobConfig(workflow_prompt="Review"),
        "s",
    )
    context = resolved_context()
    store, sql = claim_store(monkeypatch, operations_service, preparation_sql)
    original = store.prepare_object
    persisted = []

    def save(**kwargs):
        persisted.append(kwargs["payload"])
        return original(**kwargs)

    monkeypatch.setattr(store, "prepare_object", save)

    def prepare():
        request = builder.compose(
            context=context,
            definition=definition,
            parent_node=PARENT,
            workspace=WORKSPACE,
            inputs={"query": "review"},
        )
        config = request.model_dump(mode="json", include={"composition", "session_snapshot"})
        return store.claim_agent_create(
            ref=REF,
            parent_node=PARENT,
            expected_invocation_generation=4,
            config=config,
            definition_receipt=AgentDefinitionReceipt("node", definition.stamp),
        )

    if field == "ref":
        assert prepare().kind == "inserted"
        assert "opaque-secret-reference" in str(persisted)
        assert len(payloads(sql)) == 1
    else:
        expected = (
            "native_agent_config_credentials" if kind == "secret_refs" else "native_agent_environment_requires_owner"
        )
        with pytest.raises(BuilderExecutionPolicyError, match=expected):
            prepare()
        assert not persisted
        assert not payloads(sql)
        assert not calls, "native env refusal must precede ordinary mapping/declaration helpers"


@pytest.mark.parametrize("resource", ["snapshot", "node-job"])
@pytest.mark.parametrize(
    "boundary",
    [
        "none",
        "claim-loader",
        "claim-rbac",
        "claim-context",
        "claim-private-input",
        "crypto-storage",
        "final-access",
    ],
)
def test_composed_definition_receipt_survives_initial_claim_io(
    monkeypatch, resource, boundary, operations_service, preparation_sql
):
    """Actual initial service/composer/claim/resource checks; SQL/access/storage are doubles.

    Removing the composition-owned receipt comparison must admit config A after
    an initial-claim SQL mutation to B, before the state's first resource capture.
    """
    from datetime import UTC, datetime, timedelta

    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

    from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
    from services.agent import access_service
    from services.dify_builder.native_testing import (
        agent_runtime_config as config_module,
    )
    from services.dify_builder.native_testing.agent_binding import (
        AgentBindingService,
        native_node_data,
    )
    from services.dify_builder.native_testing.agent_preparation import (
        AgentPreparationService,
    )
    from services.dify_builder.native_testing.agent_tool_declarations import (
        PreparedAgentToolDeclarations,
    )
    from services.dify_builder.native_testing.agent_workspace import (
        AgentWorkspaceAllocation,
        _ref,
    )

    job = WorkflowNodeJobConfig(workflow_prompt="Task A")
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "model-A",
            }
        }
    )
    graph = {
        "nodes": [
            {
                "id": "node",
                "data": native_node_data(agent_id="agent", snapshot_id="pin", node_job=job),
            }
        ]
    }
    context = resolved_context(graph=graph)
    scope = NativeScopeSpec(
        scope_id="binding",
        generation=9,
        binding_ref="binding",
        base_snapshot_ref="published-home",
        capability_digest="c" * 64,
        deadline=datetime.now(UTC) + timedelta(minutes=5),
        limits=NativeScopeLimits(
            cpu_quota=1000,
            memory_bytes=64 << 20,
            pids=8,
            fds=32,
            wall_seconds=60,
            input_bytes=1024,
            output_bytes=4096,
            disk_bytes=1 << 20,
        ),
    )
    allocation = AgentWorkspaceAllocation(
        tenant_id="tenant",
        app_id="app",
        request_id="req",
        invocation_id="inv",
        owner_run_id="workflow",
        binding_id="binding",
        workspace_id="workspace",
        agent_id="agent",
        pinned_snapshot_id="pin",
        home_snapshot_id="home",
        native_scope=scope,
        phase="ready",
    )
    workspace = _ref(allocation)
    snapshot = state.AgentConfigSnapshot(
        id="pin",
        tenant_id="tenant",
        agent_id="agent",
        home_snapshot_id="home",
        config_snapshot=soul,
    )
    published = state.WorkflowAgentNodeBinding(
        id="published",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        node_id="node",
        agent_id="agent",
        current_snapshot_id="pin",
        binding_type=state.WorkflowAgentBindingType.ROSTER_AGENT,
        node_job_config=job,
    )
    rows = {
        state.AgentConfigSnapshot: snapshot,
        state.Agent: state.Agent(id="agent", tenant_id="tenant", active_config_snapshot_id="pin"),
        state.AgentHomeSnapshot: state.AgentHomeSnapshot(
            id="home",
            tenant_id="tenant",
            agent_id="agent",
            status=state.AgentWorkingResourceStatus.ACTIVE,
            snapshot_ref="published-home",
        ),
        state.AgentWorkspace: state.AgentWorkspace(
            id="workspace",
            tenant_id="tenant",
            app_id="app",
            owner_type=state.AgentWorkspaceOwnerType.WORKFLOW_RUN,
            owner_id="workflow",
            owner_scope_key="native:inv",
            status=state.AgentWorkingResourceStatus.ACTIVE,
            backend_workspace_ref=workspace.backend_workspace_ref,
        ),
        state.AgentWorkspaceBinding: state.AgentWorkspaceBinding(
            tenant_id="tenant",
            app_id="app",
            workspace_id="workspace",
            agent_id="agent",
            base_home_snapshot_id="home",
            agent_config_version_id="pin",
            agent_config_version_kind=state.AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref=workspace.backend_binding_ref,
            status=state.AgentWorkingResourceStatus.ACTIVE,
        ),
        state.NativeTestInvocation: state.NativeTestInvocation(
            active=True,
            tenant_id="tenant",
            request_id="req",
            invocation_id="inv",
            bindings={"_agent_workspace_v1": allocation.model_dump(mode="json")},
        ),
        state.WorkflowAgentNodeBinding: published,
    }
    changed = []

    def mutate(stage):
        if stage != boundary or changed:
            return
        changed.append(stage)
        if resource == "snapshot":
            snapshot.config_snapshot = AgentSoulConfig.model_validate(
                {
                    **snapshot.config_snapshot_dict,
                    "model": {**snapshot.config_snapshot_dict["model"], "model": "model-B"},
                }
            )
        else:
            published.node_job_config = WorkflowNodeJobConfig.model_validate(
                {
                    **published.node_job_config_dict,
                    "workflow_prompt": "Task B",
                }
            )

    sql, owned, scope_row = preparation_session(monkeypatch, operations_service, preparation_sql)
    original_scalar = sql.scalar
    monkeypatch.setattr(sql, "get", lambda model, _key: rows[model])

    def scalar(query):
        model = query.column_descriptions[0]["entity"]
        return original_scalar(query) if model is state.NativePayloadObject else rows[model]

    monkeypatch.setattr(sql, "scalar", scalar)
    loader = operations_service.loader
    monkeypatch.setattr(loader, "load", lambda **_kwargs: mutate("claim-loader"))
    monkeypatch.setattr(loader, "session_factory", lambda: sql)
    monkeypatch.setattr(loader, "_load", lambda *_args, **_kwargs: (owned, scope_row))
    store = operations_service.state_store

    def private_read(*_args):
        mutate("claim-rbac")
        return read_authority()

    monkeypatch.setattr(state, "validate_private_read", private_read)
    monkeypatch.setattr(store, "_validate_node_inputs_owner", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(store, "_agent_single_parent", lambda *_args, **_kwargs: None)

    def load_context(**_kwargs):
        mutate("claim-context")
        return context

    monkeypatch.setattr(store, "load_context", load_context)
    monkeypatch.setattr(store, "store_node_inputs", lambda **_kwargs: "input")
    inputs = {"query": "Review", "values": {}, "route_names": {}}

    def read_input(*_args, **_kwargs):
        mutate("claim-private-input")
        return (None, inputs)

    monkeypatch.setattr(store, "_agent_object", read_input)
    persisted = []

    def prepare_object(**kwargs):
        assert not sql.info["locked"]
        persisted.append(kwargs["payload"])
        mutate("crypto-storage")
        return state.ObjectReceipt(
            "obj",
            "tenant",
            "req",
            "inv",
            "result",
            kwargs["logical_key"],
            "opaque-key",
            canonical_digest(kwargs["payload"]),
            canonical_digest(kwargs["payload"]),
        )

    monkeypatch.setattr(store, "prepare_object", prepare_object)

    def refresh(_prepared):
        mutate("final-access")

    monkeypatch.setattr(store, "_agent_refresh_access", refresh)
    from models.workflow import Workflow

    workflow = Workflow(version="published", environment_variables=[])
    monkeypatch.setattr(state, "validate_invocation_workflow", lambda *_args, **_kwargs: workflow)
    monkeypatch.setattr(
        config_module,
        "validate_invocation_workflow",
        lambda *_args, **_kwargs: workflow,
    )
    monkeypatch.setattr(AgentBindingService, "authorize", lambda **_kwargs: None)
    monkeypatch.setattr(AgentBindingService, "recheck_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(access_service, "require_builder_agent_access", lambda **_kwargs: None)

    def prepare(**_kwargs):
        return PreparedAgentToolDeclarations(None, None, ())

    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolDeclarationService

    declarations = AgentToolDeclarationService()
    monkeypatch.setattr(declarations, "prepare", prepare)

    builder = config_module.NativeAgentRuntimeConfigBuilder(loader=loader, declarations=declarations)
    monkeypatch.setattr(builder, "typed_inputs", lambda **_kwargs: inputs)
    association = node_association(
        monkeypatch, operations_service, context, DifyAgentNodeData.model_validate(graph["nodes"][0]["data"])
    )
    workspace_owner = workspace_service(monkeypatch, operations_service, lambda **_kwargs: workspace)
    service = AgentPreparationService(store, None, workspace_owner, builder)
    if boundary == "none":
        result = service.prepare_initial(association=association)
        assert result.claim.kind == "inserted"
        assert "model-A" in str(persisted)
        assert "model-B" not in str(persisted)
        assert len(payloads(sql)) == 1
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_owner_mismatch"):
            service.prepare_initial(association=association)
        assert changed == [boundary]
        assert not payloads(sql), "stale composed bytes must never receive a SQL ACK"
