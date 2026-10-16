"""S1 orchestration and real Flask boundary; SQL/storage/backend doubles are explicit."""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from flask import Flask
from services.dify_builder.execution_contracts import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from services.dify_builder.native_testing import state_store as state
from services.dify_builder.native_testing.agent_contracts import (
    AgentDefinitionReceipt,
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
)
from services.dify_builder.native_testing.contracts import NativeTestContextRef

REF = NativeTestContextRef(
    request_id="req", invocation_id="inv", context_digest="a" * 64
)
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


class SQLDouble:
    """One root lock namespace only; this is not a PostgreSQL race proof."""

    def __init__(self):
        self.rows = []
        self.locked = False

    def scalar(self, _query):
        return self.rows[0] if self.rows else None

    def add(self, row):
        self.rows.append(row)

    def flush(self):
        pass

    @contextmanager
    def locked_root(self, **_kwargs):
        assert not self.locked
        self.locked = True
        try:
            yield self, SimpleNamespace(tenant_id="tenant"), None
        finally:
            self.locked = False


def claim_store(monkeypatch):
    sql = SQLDouble()
    store = state.NativeExecutionStateStore(SimpleNamespace(locked=sql.locked_root))
    prep = SimpleNamespace(
        parent=PARENT,
        context=SimpleNamespace(
            tenant_id="tenant", native_run_id="workflow", generation=4
        ),
        workspace=WORKSPACE,
        resource_digest="e" * 64,
        objects=[],
    )
    monkeypatch.setattr(store, "_agent_prepare", lambda **_kwargs: prep)
    monkeypatch.setattr(store, "_agent_recheck", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        store, "_agent_refresh_access", lambda *_args: None, raising=False
    )
    monkeypatch.setattr(store, "_agent_object", lambda *_args, **_kwargs: None)

    def prepare(**_kwargs):
        assert not sql.locked, "crypto/storage must precede SQL writer"
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


def test_claim_observes_first_insertion_under_actual_state_owner(monkeypatch):
    assert hasattr(state.NativeExecutionStateStore, "claim_agent_create"), (
        "S1 atomic create claim missing"
    )
    store, sql = claim_store(monkeypatch)
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
    assert len(sql.rows) == 1
    assert first.config_digest == canonical_digest(CONFIG)
    with pytest.raises(BuilderExecutionPolicyError):
        store.claim_agent_create(
            ref=REF,
            parent_node=PARENT,
            expected_invocation_generation=4,
            definition_receipt=AgentDefinitionReceipt("node", "s"),
            config=CONFIG | {"session_snapshot": {"schema_version": 2, "layers": {}}},
        )


def test_storage_mutation_invalidates_final_claim(monkeypatch):
    assert hasattr(state.NativeExecutionStateStore, "claim_agent_create"), (
        "S1 atomic create claim missing"
    )
    store, sql = claim_store(monkeypatch)

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
    assert not sql.rows


@pytest.mark.parametrize("path", ["prepare-run", "prepared-config"])
@pytest.mark.parametrize("key", [None, "wrong"])
def test_actual_flask_service_auth_stops_before_preparation_lookup(
    monkeypatch, path, key
):
    import controllers.inner_api.agent.native_testing as controller
    from controllers.inner_api import bp

    from tests.unit_tests.config_override import config_overrides_context

    assert hasattr(controller, "AgentNativePrepareRunApi"), (
        "S1 authenticated callback missing"
    )
    calls = []
    monkeypatch.setattr(
        controller, "agent_preparation_for_ref", lambda ref: calls.append(ref)
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with config_overrides_context(
        PLUGIN_DAEMON_KEY="synthetic", INNER_API_KEY_FOR_PLUGIN="key"
    ):
        response = app.test_client().post(
            "/inner/api/agent/native-testing/" + path,
            json={"private": "canary"},
            headers={} if key is None else {"X-Inner-Api-Key": key},
        )
    assert response.status_code == 404
    assert not calls


@pytest.mark.parametrize("mutation", ["run", "mode", "parent", "digest", "generation"])
def test_backend_identity_is_read_outside_writer_before_bind(mutation):
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRuntimeIdentity,
    )
    from services.dify_builder.native_testing import agent_preparation as owner
    from services.dify_builder.native_testing.agent_contracts import AgentPreparedConfig

    config = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="cfg",
        config_digest=canonical_digest(CONFIG),
        config=CONFIG,
    )
    calls = []

    class Store:
        def load_prepared_config(self, **_kwargs):
            calls.append("load")
            return config

        def prepared_config_ref(self, **_kwargs):
            return "cfg"

        def bind_agent_run(self, **_kwargs):
            calls.append("bind")
            return "association"

        def load_context(self, **_kwargs):
            return SimpleNamespace(generation=4)

    class Backend:
        def read_run_identity_sync(self, _run_id, _selection):
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
                raw["parent_node"] = PARENT.model_dump(mode="json") | {
                    "input_result_ref": "foreign"
                }
            if mutation == "digest":
                raw["request_digest"] = "f" * 64
            if mutation == "generation":
                raw["agent_generation"] = 1
            return AgentRuntimeIdentity.model_validate(raw)

    service = owner.AgentPreparationService(
        state_store=Store(), backend=Backend(), workspace=None, config_builder=None
    )
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
def test_inert_composer_uses_real_layer_dtos_without_model_schema_or_session(
    monkeypatch, routes
):
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

    class Declarations:
        def prepare(self, **_kwargs):
            return PreparedAgentToolDeclarations(None, None, ())

    builder = NativeAgentRuntimeConfigBuilder(loader=None, declarations=Declarations())
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
    context = SimpleNamespace(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow-id",
        native_run_id="workflow",
    )
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
    config = request.model_dump(
        mode="json", include={"composition", "session_snapshot"}
    )
    assert (
        state.NativeExecutionStateStore._agent_executable_config(config, PARENT)
        == config
    )
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
    with pytest.raises(
        BuilderExecutionPolicyError, match="native_agent_config_credentials"
    ):
        state.NativeExecutionStateStore._agent_executable_config(raw, PARENT)


@pytest.mark.parametrize(
    "kind", ["valid", "duplicate", "lost-ack", "changed-run", "during-backend"]
)
def test_callback_idempotency_and_mutation_recheck(kind):
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRuntimeIdentity,
    )
    from services.dify_builder.native_testing.agent_contracts import AgentPreparedConfig
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

    class Store:
        def load_context(self, **_kwargs):
            return SimpleNamespace(generation=4)

        def load_prepared_config(self, **_kwargs):
            loads.append(_kwargs)
            if mutated:
                return config.model_copy(update={"config_digest": "d" * 64})
            return config

        def bind_agent_run(self, **_kwargs):
            association = _kwargs["association"]
            if rows and rows[0] != association:
                raise BuilderExecutionPolicyError("native_payload_conflict")
            if not rows:
                rows.append(association)
            return "association"

    class Backend:
        def read_run_identity_sync(self, run_id, selection):
            if kind == "during-backend":
                mutated.append(True)
            return AgentRuntimeIdentity(
                run_id=run_id,
                execution_mode="builder_test",
                parent_node=selection.parent_node,
                request_digest=selection.request_digest,
                agent_generation=0,
            )

    service = AgentPreparationService(
        state_store=Store(), backend=Backend(), workspace=None, config_builder=None
    )
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
            service.bind_created_run(
                payload=payload.model_copy(update={"agent_run_id": "other"})
            )
    assert len(rows) == 1
    assert len(loads) >= 2


@pytest.mark.parametrize(
    "mutation", ["none", "input", "context", "bound-node", "config"]
)
def test_initial_preparation_uses_bound_uuid_typed_inputs_and_rechecks_every_io(
    mutation,
):

    from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
    from dify_agent.protocol.schemas import CreateRunRequest
    from services.dify_builder.native_testing.agent_contracts import AgentCreateInserted
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
    context = SimpleNamespace(ref=REF, generation=4, graph=graph)
    definition = SimpleNamespace(snapshot_id="pin", stamp="s")
    values = {"query": False, "values": {"start.rows": [1, True, "1"]}}
    current = []
    claims = []
    stored = []

    class Association:
        node_id = "node"
        execution_id = PARENT.execution_id
        bound_node = SimpleNamespace(node_data=data)

        def resolve(self):
            return (
                SimpleNamespace(ref=REF, generation=5, graph=graph)
                if "context" in current
                else context
            )

    class Builder:
        def load_definition(self, **_kwargs):
            return (
                SimpleNamespace(snapshot_id="other")
                if "config" in current
                else definition
            )

        def typed_inputs(self, **_kwargs):
            return {"query": "changed", "values": {}} if "input" in current else values

        def compose(self, **_kwargs):
            return CreateRunRequest(
                composition={"layers": []},
                execution_mode="builder_test",
                native_test_ref=REF.model_dump(mode="json"),
                native_parent_node=_kwargs["parent_node"].model_dump(mode="json"),
                native_test_protocol_version=1,
            )

    class Workspace:
        def prepare(self, **_kwargs):
            current.append(mutation)
            if mutation == "bound-node":
                data.agent_task = "mutated"
            return WORKSPACE

    class Store:
        def store_node_inputs(self, **_kwargs):
            stored.append(_kwargs)
            return "input"

        def claim_agent_create(self, **_kwargs):
            claims.append(_kwargs)
            return AgentCreateInserted("cfg", canonical_digest(CONFIG))

    service = AgentPreparationService(Store(), None, Workspace(), Builder())
    if mutation == "none":
        result = service.prepare_initial(association=Association())
        assert result.parent_node.execution_id == PARENT.execution_id
        assert result.parent_node.input_digest == canonical_digest(values)
        assert result.claim.kind == "inserted"
        assert len(claims) == 1
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service.prepare_initial(association=Association())
        assert not claims
    assert stored[0]["generation"] == 4
    assert stored[0]["inputs"] == values
    assert stored[0]["native_execution_id"] == PARENT.execution_id


@pytest.mark.parametrize(
    "mutation",
    ["none", "parent", "workspace", "run", "owner", "config-ref", "resource"],
)
def test_private_config_read_rechecks_exact_stored_owner_and_resource_relations(
    monkeypatch, mutation
):
    sql = SQLDouble()

    @contextmanager
    def session_factory():
        yield sql

    loader = SimpleNamespace(locked=sql.locked_root, session_factory=session_factory)
    store = state.NativeExecutionStateStore(loader)
    prep = SimpleNamespace(
        parent=PARENT,
        context=SimpleNamespace(
            tenant_id="tenant", native_run_id="workflow", generation=4
        ),
        workspace=WORKSPACE,
        resource_digest="e" * 64,
        objects=[],
    )
    value = {
        "schema": "agent-config-v2",
        "parent_node": PARENT.model_dump(mode="json"),
        "workflow_native_run_id": "workflow",
        "workspace": WORKSPACE.model_dump(mode="json"),
        "resource_digest": "e" * 64,
        "config": CONFIG,
    }
    if mutation == "parent":
        value["parent_node"] = PARENT.model_dump(mode="json") | {
            "input_result_ref": "foreign"
        }
    if mutation == "workspace":
        value["workspace"] = WORKSPACE.model_dump(mode="json") | {
            "home_snapshot_id": "foreign"
        }
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
    sql.rows = [SimpleNamespace(**vars(receipt))]
    monkeypatch.setattr(store, "_agent_prepare", lambda **_kwargs: prep)
    monkeypatch.setattr(store, "_agent_refresh_access", lambda *_args: None)
    checked = []
    monkeypatch.setattr(
        store, "_agent_recheck", lambda *_args, **_kwargs: checked.append(True)
    )
    limits = []

    def read(_receipt, *, max_bytes=None):
        limits.append(max_bytes)
        return value

    monkeypatch.setattr(store, "_read_object", read)
    if mutation == "none":
        result = store.load_prepared_config(
            ref=REF, parent_node=PARENT, config_ref="cfg"
        )
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


@pytest.mark.parametrize(
    ("payload", "expected"), [(b" " * 4097, 413), (b'{"approved":true}', 400)]
)
def test_actual_flask_control_caps_and_validation_before_factory(
    monkeypatch, payload, expected
):
    import controllers.inner_api.agent.native_testing as controller
    from controllers.inner_api import bp
    from dify_agent.protocol.native_testing import AgentRunTransportSelection

    from tests.unit_tests.config_override import config_overrides_context
    from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import (
        encoded,
    )

    calls = []
    monkeypatch.setattr(
        controller, "agent_preparation_for_ref", lambda ref: calls.append(ref)
    )
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
):
    """Real Flask→HTTPX SDK wire; SQL/config/storage are explicitly bounded doubles."""
    import controllers.inner_api.agent.native_testing as controller
    import httpx
    from controllers.inner_api import bp
    from dify_agent.client import Client
    from dify_agent.protocol.native_testing import (
        AgentPrepareRunPayload,
        AgentRunTransportSelection,
    )
    from services.dify_builder.native_testing.agent_contracts import AgentPreparedConfig
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

    class Store:
        def load_context(self, **_kwargs):
            return SimpleNamespace(
                generation=4,
                tenant_id="tenant",
                actor_id="actor",
                app_id="app",
                native_run_id="workflow",
            )

        def load_prepared_config(self, **_kwargs):
            return owned

        def discover_agent_run(self, **_kwargs):
            return bindings[0] if bindings else None

        def bind_agent_run(self, **_kwargs):
            selected = _kwargs["association"]
            if bindings and selected != bindings[0]:
                raise BuilderExecutionPolicyError("private-canary")
            if not bindings:
                bindings.append(selected)
            return "association"

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
        service = AgentPreparationService(Store(), sdk, None, None)
        from services.dify_builder.native_testing.agent_lineage import (
            NativeAgentEndpointLineage,
        )

        app.extensions["native_agent_endpoint_lineage"] = NativeAgentEndpointLineage(
            backend=sdk, preparation_for_ref=lambda _ref: service
        )
        monkeypatch.setattr(
            controller, "agent_preparation_for_ref", lambda _ref: service
        )
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
                json=payload.model_copy(update={"agent_run_id": "other"}).model_dump(
                    mode="json"
                ),
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
    assert (
        conflicting.status_code == 409
        and "private-canary" not in conflicting.get_data(as_text=True)
    )
    assert config.json["config"] == CONFIG and config.json[
        "parent_node"
    ] == PARENT.model_dump(mode="json")
    assert len(bindings) == 1 and len(reads) == 5


def test_config_creation_readback_cap_precedes_decryption_and_sql(monkeypatch):
    import inspect

    assert (
        "max_bytes"
        in inspect.signature(state.NativeExecutionStateStore.prepare_object).parameters
    ), "S1 protected config creation readback cap missing"
    calls = []
    monkeypatch.setattr(
        state.encrypter, "encrypt_token", lambda _tenant, _raw: "small-cipher"
    )
    monkeypatch.setattr(state.storage, "save", lambda *_args: None)
    monkeypatch.setattr(state.storage, "load", lambda *_args: b"x" * (4096 + 1))
    monkeypatch.setattr(
        state.encrypter, "decrypt_token", lambda *_args: calls.append("decrypt")
    )
    with pytest.raises(BuilderExecutionPolicyError):
        state.NativeExecutionStateStore(None).prepare_object(
            ref=REF,
            tenant_id="tenant",
            kind="result",
            logical_key="agent-config:owned",
            payload=CONFIG,
            max_bytes=4096,
        )
    assert not calls


@pytest.mark.parametrize('mutation',['none','outputs','routes','binding-kind'])
def test_current_published_binding_must_match_graph_outputs_and_routes(monkeypatch,mutation):
    """Real definition loader and graph renderer, explicit SQL/access stand-ins."""
    import services.dify_builder.native_testing.agent_runtime_config as config_module
    from core.dify_builder.models import Actor
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
    job=WorkflowNodeJobConfig(workflow_prompt='Review')
    data=native_node_data(agent_id='agent',snapshot_id='pin',node_job=job)
    if mutation=='outputs': data['agent_declared_outputs']=[{"name": 'foreign',"type": 'string'}]
    if mutation=='routes': data['agent_output_routes']={'enabled':True,'routes':[{'id':'a','name':'A'},{'id':'b','name':'B'}]}
    soul=AgentSoulConfig.model_validate({'model':{'plugin_id':'langgenius/openai','model_provider':'openai','model':'test'}})
    agent=SimpleNamespace(tenant_id='tenant',active_config_snapshot_id='pin')
    snapshot=SimpleNamespace(tenant_id='tenant',agent_id='agent',config_snapshot_dict=soul.model_dump(mode='json'))
    binding=SimpleNamespace(agent_id='agent',current_snapshot_id='pin',node_job_config_dict=job.model_dump(mode='json'),binding_type='foreign' if mutation=='binding-kind' else WorkflowAgentBindingType.ROSTER_AGENT)
    class Session:
        def get(self,model,_identity):return snapshot if model is AgentConfigSnapshot else agent
        def scalar(self,query):return binding if query.column_descriptions[0]['entity'] is WorkflowAgentNodeBinding else agent
    @contextmanager
    def sessions():yield Session()
    monkeypatch.setattr(AgentBindingService,'authorize',lambda **_kwargs:None)
    monkeypatch.setattr(AgentBindingService,'recheck_access',lambda *_args,**_kwargs:None)
    monkeypatch.setattr(config_module,'validate_invocation_workflow',lambda *_args,**_kwargs:SimpleNamespace(version='draft',_environment_variables='[]'))
    loader=SimpleNamespace(actor=Actor(account_id='actor',tenant_id='tenant'),session_factory=sessions)
    builder=config_module.NativeAgentRuntimeConfigBuilder(loader=loader)
    context=SimpleNamespace(tenant_id='tenant',actor_id='actor',app_id='app',workflow_id='workflow',graph={'nodes':[{'id':'node','data':data}]})
    if mutation=='none':assert builder.load_definition(context=context,node_id='node').snapshot_id=='pin'
    else:
        with pytest.raises(BuilderExecutionPolicyError):builder.load_definition(context=context,node_id='node')


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
    monkeypatch, owner, kind, field, value
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

    class Declarations:
        def prepare(self, **_kwargs):
            calls.append("declarations")
            return PreparedAgentToolDeclarations(None, None, ())

    env = {kind: [{"name": "SERVICE_TOKEN", field: value}]}
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "test",
            },
            **(
                {"env": env}
                if owner == "soul"
                else {"tools": {"cli_tools": [{"name": "tool", "env": env}]}}
            ),
        }
    )
    builder = NativeAgentRuntimeConfigBuilder(loader=None, declarations=Declarations())
    definition = NativeAgentDefinition(
        "node",
        "agent",
        "pin",
        soul,
        WorkflowNodeJobConfig(workflow_prompt="Review"),
        "s",
    )
    context = SimpleNamespace(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        native_run_id="workflow",
    )
    store, sql = claim_store(monkeypatch)
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
        config = request.model_dump(
            mode="json", include={"composition", "session_snapshot"}
        )
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
        assert len(sql.rows) == 1
    else:
        expected = (
            "native_agent_config_credentials"
            if kind == "secret_refs"
            else "native_agent_environment_requires_owner"
        )
        with pytest.raises(BuilderExecutionPolicyError, match=expected):
            prepare()
        assert not persisted and not sql.rows
        assert not calls, (
            "native env refusal must precede ordinary mapping/declaration helpers"
        )


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
    monkeypatch, resource, boundary
):
    """Actual initial service/composer/claim/resource checks; SQL/access/storage are doubles.

    Removing the composition-owned receipt comparison must admit config A after
    an initial-claim SQL mutation to B, before the state's first resource capture.
    """
    from datetime import UTC, datetime, timedelta

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
    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

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
                "data": native_node_data(
                    agent_id="agent", snapshot_id="pin", node_job=job
                ),
            }
        ]
    }
    context = SimpleNamespace(
        ref=REF,
        generation=4,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        native_run_id="workflow",
        graph=graph,
    )
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
    snapshot = SimpleNamespace(
        id="pin",
        tenant_id="tenant",
        agent_id="agent",
        home_snapshot_id="home",
        config_snapshot_dict=soul.model_dump(mode="json"),
    )
    published = SimpleNamespace(
        agent_id="agent",
        current_snapshot_id="pin",
        binding_type=state.WorkflowAgentBindingType.ROSTER_AGENT,
        node_job_config_dict=job.model_dump(mode="json"),
    )
    rows = {
        state.AgentConfigSnapshot: snapshot,
        state.Agent: SimpleNamespace(
            tenant_id="tenant", active_config_snapshot_id="pin"
        ),
        state.AgentHomeSnapshot: SimpleNamespace(
            id="home",
            tenant_id="tenant",
            agent_id="agent",
            status=state.AgentWorkingResourceStatus.ACTIVE,
            snapshot_ref="published-home",
        ),
        state.AgentWorkspace: SimpleNamespace(
            id="workspace",
            tenant_id="tenant",
            app_id="app",
            owner_type=state.AgentWorkspaceOwnerType.WORKFLOW_RUN,
            owner_id="workflow",
            owner_scope_key="native:inv",
            status=state.AgentWorkingResourceStatus.ACTIVE,
            backend_workspace_ref=workspace.backend_workspace_ref,
        ),
        state.AgentWorkspaceBinding: SimpleNamespace(
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
        state.NativeTestInvocation: SimpleNamespace(
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
            snapshot.config_snapshot_dict = {
                **snapshot.config_snapshot_dict,
                "model": {**snapshot.config_snapshot_dict["model"], "model": "model-B"},
            }
        else:
            published.node_job_config_dict = {
                **published.node_job_config_dict,
                "workflow_prompt": "Task B",
            }

    class ResourceSQL(SQLDouble):
        def get(self, model, _key):
            return rows[model]

        def scalar(self, query):
            model = query.column_descriptions[0]["entity"]
            if model is state.NativePayloadObject:
                return super().scalar(query)
            return rows[model]

    sql = ResourceSQL()

    @contextmanager
    def sessions():
        yield sql

    loader = SimpleNamespace(
        actor=SimpleNamespace(account_id="actor", tenant_id="tenant"),
        load=lambda **_kwargs: mutate("claim-loader"),
        session_factory=sessions,
        locked=sql.locked_root,
        _load=lambda *_args, **_kwargs: (SimpleNamespace(tenant_id="tenant"), None),
    )
    store = state.NativeExecutionStateStore(loader)

    def private_read(*_args):
        mutate("claim-rbac")
        return "authority"

    monkeypatch.setattr(state, "validate_private_read", private_read)
    monkeypatch.setattr(
        store, "_validate_node_inputs_owner", lambda *_args, **_kwargs: None
    )
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
        assert not sql.locked
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
    workflow = SimpleNamespace(version="published", _environment_variables="[]")
    monkeypatch.setattr(
        state, "validate_invocation_workflow", lambda *_args, **_kwargs: workflow
    )
    monkeypatch.setattr(
        config_module,
        "validate_invocation_workflow",
        lambda *_args, **_kwargs: workflow,
    )
    monkeypatch.setattr(AgentBindingService, "authorize", lambda **_kwargs: None)
    monkeypatch.setattr(
        AgentBindingService, "recheck_access", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        access_service, "require_builder_agent_access", lambda **_kwargs: None
    )

    class Declarations:
        def prepare(self, **_kwargs):
            return PreparedAgentToolDeclarations(None, None, ())

    builder = config_module.NativeAgentRuntimeConfigBuilder(
        loader=loader, declarations=Declarations()
    )
    monkeypatch.setattr(builder, "typed_inputs", lambda **_kwargs: inputs)
    association = SimpleNamespace(
        node_id="node",
        execution_id=PARENT.execution_id,
        bound_node=SimpleNamespace(
            node_data=DifyAgentNodeData.model_validate(graph["nodes"][0]["data"])
        ),
        resolve=lambda: context,
    )
    service = AgentPreparationService(
        store, None, SimpleNamespace(prepare=lambda **_kwargs: workspace), builder
    )
    if boundary == "none":
        result = service.prepare_initial(association=association)
        assert result.claim.kind == "inserted"
        assert "model-A" in str(persisted) and "model-B" not in str(persisted)
        assert len(sql.rows) == 1
    else:
        with pytest.raises(
            BuilderExecutionPolicyError, match="native_agent_owner_mismatch"
        ):
            service.prepare_initial(association=association)
        assert changed == [boundary]
        assert not sql.rows, "stale composed bytes must never receive a SQL ACK"
