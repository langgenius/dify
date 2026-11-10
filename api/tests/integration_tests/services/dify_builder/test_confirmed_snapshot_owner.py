"""Actual SQL/protected objects and SDK stores exercise confirmed snapshot ownership.

Disposable PostgreSQL/Redis and filesystem RSA are fixture infrastructure only.
No physical lifecycle, model, tool, mocked owner, or mocked transport is executed.

Recovery tests seed an acknowledged allocated/wait boundary, not normal policy
reachability. The captured official ToolEntity plus explicit typed assessment
DOMAIN DATA exercise the private pure constructor and actual SQL persistence;
they do not prove live metadata freshness or fresh model risk reasoning. The
model-boundary fixture is likewise not ordinary task-grant/wait reachability.

Reproduce with the SDK-locked server-only dependency in a temporary overlay:
uv run --project api --with jwcrypto==1.5.7 pytest --no-cov \
    api/tests/integration_tests/services/dify_builder/test_confirmed_snapshot_owner.py -q
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from collections.abc import Callable, Generator
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from uuid import uuid4

import httpx
import pytest
import uvicorn
from dify_agent.client import Client
from dify_agent.protocol import CreateRunRequest
from dify_agent.protocol.native_testing import AgentReadResultPayload, AgentRuntimeIdentitySeed
from dify_agent.protocol.run_recovery import LookupRunRequest, create_run_fingerprint
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.routes.native_testing import create_native_testing_router
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.storage.redis_run_store import RedisRunStore
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.testclient import TestClient
from pydantic import JsonValue
from redis import Redis as SyncRedis
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import Engine, select, update
from sqlalchemy.orm import sessionmaker
from starlette.middleware.base import RequestResponseEndpoint

from clients.agent_backend.client import DifyAgentBackendRunClient
from core.dify_builder.models import Actor
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.enums import WorkflowExecutionStatus
from libs.key_providers.rsa_key_provider import RSAKeyProvider
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectGrant,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, AppStatus
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
    WorkflowType,
)
from repositories.tenant_public_key_repository import TenantPublicKeyRepository
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.agent_contracts import (
    AgentDefinitionReceipt,
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
)
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.agent_binding import native_node_data
from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION
from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
from services.dify_builder.native_testing.agent_runtime_config import NativeAgentRuntimeConfigBuilder
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands
from services.dify_builder.native_testing.confirmed_agent_continuation import ConfirmedAgentContinuation
from services.dify_builder.native_testing.repository import native_workflow_revision
from tests.integration_tests.services.dify_builder.test_agent_recovery_postgres import ephemeral_postgres
from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row

if TYPE_CHECKING:
    from dify_agent.protocol.confirmed_recovery import AgentRecoverySuccessor, InstallConfirmedRecoverySuccessorReceipt
    from dify_agent.protocol.native_continuation import AgentCheckpoint
    from dify_agent.protocol.native_testing import AgentEffectIntent, AgentPrepareRunResponse

    from runtime_contracts.builder.native.agent_contracts import (
        AgentNodeAssociation,
        AgentPreparedConfig,
        AgentWaitAssociation,
    )
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.agent_operations import AgentOperationService, PreparedAgentOperation
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.dify_builder.native_testing.agent_recovery import (
        PreparedRecoverySelection,
        RecoveryAllocationReceipt,
        SelectedRecovery,
    )
    from services.dify_builder.native_testing.agent_recovery_state import AgentRecoveryRecord
    from services.dify_builder.native_testing.state_store import ObjectReceipt


__all__ = ["ephemeral_postgres"]


@dataclass(frozen=True)
class ProtectedOwner:
    api: NativeTestApiService
    scope: WorkflowAgentSessionScope
    parent: AgentParentNodeRef
    config: CreateRunRequest
    context: ResolvedNativeTestContext


@pytest.fixture(params=[True])
def pinned_home(request: pytest.FixtureRequest) -> bool:
    assert isinstance(request.param, bool)
    return request.param


@pytest.fixture(params=["local"])
def inspection_adapter(request: pytest.FixtureRequest) -> Literal["local", "enterprise"]:
    if request.param == "enterprise":
        return "enterprise"
    assert request.param == "local"
    return "local"


@pytest.fixture
def protected_owner(
    ephemeral_postgres: Engine,
    redis_endpoint: tuple[str, int],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    pinned_home: bool,
    inspection_adapter: Literal["local", "enterprise"],
) -> Generator[ProtectedOwner]:
    """Compose real SQL owner, FS storage and RSA provider; restore globals on exit."""
    from sqlalchemy import Table

    from configs import dify_config
    from core.db import session_factory as session_module

    assert not dify_config.RBAC_ENABLED, "local owner proof requires community RBAC configuration"

    models = (
        Account,
        Tenant,
        TenantAccountJoin,
        App,
        Workflow,
        DifyBuilderSession,
        DifyBuilderSessionCommit,
        DifyBuilderTestInput,
        DifyBuilderExecutionRequest,
        NativeTestScope,
        NativeTestInvocation,
        NativeInvocationState,
        NativePayloadObject,
        NativeContinuation,
        NativeDispatch,
        NativeEffectOperation,
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectGrant,
        NativeEffectOutcome,
        NativePendingAction,
        Agent,
        AgentConfigSnapshot,
        AgentConfigRevision,
        AgentHomeSnapshot,
        AgentWorkspace,
        AgentWorkspaceBinding,
        WorkflowAgentNodeBinding,
        WorkflowRun,
        WorkflowNodeExecutionModel,
        WorkflowPause,
        WorkflowPauseReason,
    )
    for model in models:
        table = model.__table__
        assert isinstance(table, Table)
        table.create(ephemeral_postgres, checkfirst=True)
    sessions = sessionmaker(ephemeral_postgres, expire_on_commit=False)
    monkeypatch.setattr(session_module, "_session_maker", sessions)
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage("fs", root=str(tmp_path / "objects")), raising=False)
    tenant_id, actor_id, app_id, workflow_id, builder_id, input_id, request_id, native_id = [
        str(uuid4()) for _ in range(8)
    ]
    agent_id, pin_id, home_id, binding_id, workspace_id, node_binding_id, execution_id = [
        str(uuid4()) for _ in range(7)
    ]
    scope = WorkflowAgentSessionScope(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=native_id,
        node_id="agent",
        node_execution_id=execution_id,
        workflow_agent_binding_id=node_binding_id,
        agent_id=agent_id,
        agent_config_snapshot_id=pin_id,
    )
    home_id = home_id if pinned_home else None
    job = WorkflowNodeJobConfig()
    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="fixture/plugin", model_provider="fixture/plugin/provider", model="fixture-model"
        )
    )
    graph: dict[str, JsonValue] = {
        "nodes": [{"id": "agent", "data": native_node_data(agent_id=agent_id, snapshot_id=pin_id, node_job=job)}],
        "edges": [],
    }
    workflow = Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        version="draft",
        graph=json.dumps(graph),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=actor_id,
    )
    inputs: dict[str, JsonValue] = {"query": "owned fixture"}
    raw_context = {
        "policy_version": "builder-native-test-v1",
        "tenant_id": tenant_id,
        "actor_id": actor_id,
        "app_id": app_id,
        "workflow_id": workflow_id,
        "session_id": builder_id,
        "test_input_id": input_id,
        "invocation_id": "root",
        "mode": "native",
        "native_run_id": native_id,
        "profile": {"profile_id": "builder-agent-confirmed-v1"},
        "execution_revision": native_workflow_revision(workflow),
        "input_revision": canonical_digest(inputs),
    }
    ref = NativeTestContextRef(
        request_id=request_id, invocation_id="root", context_digest=canonical_digest(raw_context)
    )
    workspace = AgentTestWorkspaceRef(
        binding_id=binding_id,
        workspace_id=workspace_id,
        backend_binding_ref="binding-" + binding_id,
        backend_workspace_ref=("binding-" + binding_id)
        if inspection_adapter == "enterprise"
        else "workspace-" + workspace_id,
        pinned_snapshot_id=pin_id,
        home_snapshot_id=home_id,
        workspace_generation=0,
    )
    execution = _execution_row(
        execution_id=execution_id,
        workflow_run_id=native_id,
        binding_id=binding_id,
        process_data={"workflow_agent_binding_id": node_binding_id},
    )
    execution.tenant_id, execution.app_id, execution.workflow_id = tenant_id, app_id, workflow_id
    execution.node_id, execution.created_by = "agent", actor_id
    account = Account(name="Recovery fixture", email="recovery@example.invalid", status=AccountStatus.ACTIVE)
    account.id = actor_id
    tenant = Tenant(name="Recovery fixture")
    tenant.id = tenant_id
    with sessions.begin() as session:
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(tenant_id=tenant_id, account_id=actor_id, role=TenantAccountRole.OWNER),
                App(
                    id=app_id,
                    tenant_id=tenant_id,
                    mode=AppMode.WORKFLOW,
                    name="Recovery fixture",
                    status=AppStatus.NORMAL,
                    enable_site=False,
                    enable_api=False,
                ),
                workflow,
                DifyBuilderSession(
                    id=builder_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    owner_account_id=actor_id,
                    entry_mode="build",
                    current_state="build.test_and_repair",
                    version=1,
                ),
                DifyBuilderSessionCommit(
                    session_id=builder_id,
                    version=1,
                    state="build.test_and_repair",
                    context={"test_input_ref": input_id},
                    actor="fixture",
                ),
                DifyBuilderTestInput(
                    id=input_id, session_id=builder_id, source="upload", inputs=inputs, start_schema_hash="fixture"
                ),
                DifyBuilderExecutionRequest(
                    id=request_id,
                    tenant_id=tenant_id,
                    actor_id=actor_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    session_id=builder_id,
                    test_input_id=input_id,
                    context=raw_context,
                    context_digest=ref.context_digest,
                    state="running",
                    native_run_id=native_id,
                ),
                NativeTestScope(
                    request_id=request_id,
                    tenant_id=tenant_id,
                    generation=0,
                    task_approved=True,
                    cancelled=False,
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                    max_calls=10,
                    max_dispatches=10,
                    max_cost_units=10,
                    budget_limits={},
                    budget_spent={},
                    profile={},
                ),
                NativeTestInvocation(
                    tenant_id=tenant_id,
                    request_id=request_id,
                    invocation_id="root",
                    active=True,
                    bindings={ALLOCATION: {"scope": asdict(scope), "workspace": workspace.model_dump(mode="json")}},
                ),
                Agent(
                    id=agent_id,
                    tenant_id=tenant_id,
                    name="Recovery fixture",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    active_config_snapshot_id=pin_id,
                    active_config_has_model=True,
                ),
                AgentConfigSnapshot(
                    id=pin_id,
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    version=1,
                    config_snapshot=soul,
                    home_snapshot_id=home_id,
                ),
                AgentWorkspace(
                    id=workspace_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
                    owner_id=native_id,
                    owner_scope_key=scope.workspace_owner.owner_scope_key,
                    backend_workspace_ref=workspace.backend_workspace_ref,
                ),
                AgentWorkspaceBinding(
                    id=binding_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workspace_id=workspace_id,
                    agent_id=agent_id,
                    base_home_snapshot_id=home_id,
                    agent_config_version_id=pin_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                    backend_binding_ref=workspace.backend_binding_ref,
                    session_snapshot='{"schema_version":2,"layers":{}}',
                ),
                WorkflowAgentNodeBinding(
                    id=node_binding_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    workflow_version="draft",
                    node_id="agent",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id=agent_id,
                    current_snapshot_id=pin_id,
                    node_job_config=job,
                ),
                WorkflowRun(
                    id=native_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                    version="draft",
                    graph=json.dumps(graph),
                    inputs="{}",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=actor_id,
                ),
                execution,
            ]
        )
    if home_id is not None:
        with sessions.begin() as session:
            session.add(
                AgentHomeSnapshot(id=home_id, tenant_id=tenant_id, agent_id=agent_id, snapshot_ref="home-" + home_id)
            )
    with sessions() as observer:
        reader = TenantPublicKeyRepository(create_session=sessions, current_session=lambda: observer)
        provider = RSAKeyProvider(public_key_reader=reader.read)
        monkeypatch.setattr(key_provider_manager, "_provider", provider)
        public_key = provider.generate_key_pair(tenant_id)
        with sessions.begin() as session:
            tenant = session.get(Tenant, tenant_id)
            assert tenant is not None
            tenant.encrypt_public_key = public_key
        api = NativeTestApiService(
            session_factory=sessions,
            actor=Actor(tenant_id=tenant_id, account_id=actor_id),
            resolver=AgentOperationBindingResolver(),
            admission=None,
            resolution=None,
            runtime=None,
            disclosure=None,
        )
        context = ResolvedNativeTestContext(
            ref=ref,
            tenant_id=tenant_id,
            actor_id=actor_id,
            app_id=app_id,
            workflow_id=workflow_id,
            graph=graph,
            inputs=inputs,
            graph_revision=native_workflow_revision(workflow),
            input_revision=canonical_digest(inputs),
            resource_manifest=(),
            generation=0,
            root_native_run_id=native_id,
            native_run_id=native_id,
            parent_invocation_id=None,
            call_depth=0,
            budget_ref=request_id,
            cancellation_ref=request_id,
            execution_mode="native",
        )
        api.store.initialize_context(context=context)
        input_ref = api.store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=inputs)
        parent = AgentParentNodeRef(
            ref=ref, execution_id=execution_id, input_result_ref=input_ref, input_digest=canonical_digest(inputs)
        )
        definition = NativeAgentRuntimeConfigBuilder(loader=api.loader, profile="confirmed").load_definition(
            context=context, node_id="agent"
        )
        config = CreateRunRequest.model_validate(
            {
                "execution_mode": "builder_test",
                "native_test_profile": "confirmed",
                "native_test_ref": ref.model_dump(mode="json"),
                "native_parent_node": parent.model_dump(mode="json"),
                "native_test_protocol_version": 1,
                "idempotency_key": "snapshot-" + request_id,
                "composition": {
                    "layers": [
                        {"name": "runtime", "config": {"backend_binding_ref": workspace.backend_binding_ref}},
                        {"name": "shell", "config": {}},
                        {"name": "core_tools", "config": {}},
                        {"name": "config", "config": {}},
                    ]
                },
            }
        )
        api.store.claim_agent_create(
            ref=ref,
            parent_node=parent,
            expected_invocation_generation=0,
            config=config.model_dump(mode="json", include={"composition", "session_snapshot"}),
            definition_receipt=AgentDefinitionReceipt("agent", definition.stamp),
        )
        yield ProtectedOwner(api, scope, parent, config, context)


@dataclass(frozen=True)
class RuntimeOwner:
    store: RedisRunStore
    http: TestClient
    client: Client
    run_id: str
    http_client: httpx.Client
    base_url: str
    recovery_selection: list[AgentRecoverySuccessor]
    requests: list[tuple[str, str]]


@pytest.fixture
def redis_endpoint(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[str, int]]:
    """Wire the API wrapper to the same owned disposable Redis, restoring it on exit."""
    from extensions import ext_redis

    docker = shutil.which("docker")
    assert docker is not None, "disposable Redis container runtime required"
    name = "eng1240-3b-snapshot-" + str(uuid4())
    try:
        subprocess.run(
            [docker, "run", "--rm", "-d", "--name", name, "-p", "127.0.0.1::6379", "redis:7-alpine"],
            check=True,
            capture_output=True,
            timeout=30,
        )
        address = subprocess.run(
            [docker, "port", name, "6379/tcp"], check=True, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        host, port_text = address.split(":")
        assert host == "127.0.0.1"
        port = int(port_text)
        with SyncRedis(host=host, port=port) as redis:
            ready, attempts = False, 0
            while not ready and attempts < 100:
                try:
                    ready = redis.ping()
                except RedisConnectionError:
                    time.sleep(0.01)
                attempts += 1
            assert ready
            with monkeypatch.context() as wiring:
                wiring.setattr(ext_redis.redis_client, "_client", redis)
                wiring.setattr(ext_redis, "_pubsub_redis_client", redis)
                yield host, port
    finally:
        subprocess.run([docker, "stop", "--time", "1", name], check=False, capture_output=True, timeout=15)


@pytest.fixture
def runtime_owner(protected_owner: ProtectedOwner, redis_endpoint: tuple[str, int]) -> Generator[RuntimeOwner]:
    """Use production SDK routes/Redis Lua over ASGI, without scheduling a runner."""
    host, port = redis_endpoint
    redis = Redis(host=host, port=port)
    store = RedisRunStore(redis, prefix="snapshot-owner-" + str(uuid4()))
    app = FastAPI()
    recovery_selection: list[AgentRecoverySuccessor] = []
    requests: list[tuple[str, str]] = []

    @app.middleware("http")
    async def record_requests(request: Request, call_next: RequestResponseEndpoint) -> Response:
        requests.append((request.method, request.url.path))
        if request.method == "POST" and (request.url.path == "/runs" or request.url.path.endswith("/continue")):
            pytest.fail("snapshot proof must not schedule any runner")
        return await call_next(request)

    from flask import Flask

    from controllers.inner_api import bp
    from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointLineage
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from tests.helpers.unit.config_override import config_overrides_context

    api_app = Flask(__name__)
    api_app.config["TESTING"] = True
    api_app.register_blueprint(bp)

    @app.post("/inner/api/agent/runtime/native-testing/read-result")
    def recovery_read(payload: AgentReadResultPayload, request: Request) -> Response:
        # Real bearer middleware, lineage, inherited controller and protected owner.
        with api_app.test_client() as api_http:
            result = api_http.post(
                request.url.path,
                json=payload.model_dump(mode="json"),
                headers={key: value for key, value in request.headers.items() if key != "content-length"},
            )
        return Response(content=result.data, status_code=result.status_code, media_type="application/json")

    scheduler: RunScheduler | None = None

    def confirmed_scheduler() -> RunScheduler:
        assert scheduler is not None
        return scheduler

    app.include_router(create_native_testing_router(lambda: store, confirmed_scheduler))
    app.include_router(create_runs_router(lambda: store, confirmed_scheduler, enable_lookup=True))
    with TestClient(app) as http, ExitStack() as resources:
        portal = http.portal
        assert portal is not None
        portal.call(redis.__aenter__)
        resources.callback(portal.call, redis.__aexit__, None, None, None)
        listener = resources.enter_context(socket.socket())
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=listener.getsockname()[1],
                ws="none",
                lifespan="off",
                log_level="warning",
                access_log=False,
            )
        )
        serving = portal.start_task_soon(server.serve, [listener])

        def stop_server() -> None:
            server.should_exit = True
            serving.result(timeout=10)

        resources.callback(stop_server)
        attempts = 0
        while not server.started and attempts < 100:
            time.sleep(0.01)
            attempts += 1
        assert server.started
        request = protected_owner.config
        assert request.idempotency_key is not None
        selection = LookupRunRequest(
            idempotency_key=request.idempotency_key, request_digest=create_run_fingerprint(request)
        )
        prepared = protected_owner.api.store.load_prepared_config(
            ref=protected_owner.parent.ref, parent_node=protected_owner.parent, config_ref=None
        )
        identity = AgentRuntimeIdentitySeed.model_validate(
            {
                "execution_mode": "builder_test",
                "native_test_profile": "confirmed",
                "parent_node": protected_owner.parent.model_dump(mode="json"),
                "request_digest": prepared.config_digest,
            }
        )
        claim = portal.call(lambda: store.claim_run(selection=selection, identity=identity))
        base_url = "http://127.0.0.1:" + str(listener.getsockname()[1])
        http_client = resources.enter_context(httpx.Client())
        client = resources.enter_context(Client(base_url=base_url, sync_http_client=http_client))
        from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient
        from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
        from dify_agent.runtime.context import Services

        sdk_http = AgentRuntimeHTTPClient(api_url=base_url, api_token="fixture")
        portal.call(sdk_http.__aenter__)
        resources.callback(portal.call, sdk_http.__aexit__, None, None, None)
        confirmed_owner = ConfirmedNativeContinuationOwner(http_client=sdk_http, base_url=base_url)
        store.confirmed_recovery_owner = confirmed_owner
        scheduler = RunScheduler(
            store=store,
            native_owner=confirmed_owner,
            services=Services(
                plugin_daemon_http_client=sdk_http, dify_api_http_client=sdk_http, confirmed_api_http_client=sdk_http
            ),
        )
        preparation = AgentPreparationService(protected_owner.api.store, client, None, None)
        api_app.extensions["native_agent_endpoint_lineage"] = NativeAgentEndpointLineage(
            backend=client, preparation_for_ref=lambda ref: preparation
        )
        with config_overrides_context(
            AGENT_BACKEND_API_TOKEN="fixture",
            PLUGIN_DAEMON_KEY="different-daemon",
            INNER_API_KEY_FOR_PLUGIN="different-plugin",
            INNER_API_KEY="different-inner",
        ):
            yield RuntimeOwner(
                store, http, client, claim.record.run_id, http_client, base_url, recovery_selection, requests
            )
            assert not any(
                method == "POST" and (path == "/runs" or path.endswith("/continue")) for method, path in requests
            )


def test_actual_owned_initial_capture_and_store(protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner) -> None:
    from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding
    from dify_agent.protocol.native_testing import AgentParentNodeRef as WireParent
    from dify_agent.protocol.native_testing import AgentPrepareRunPayload
    from dify_agent.protocol.snapshot import SessionSnapshot

    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService

    owner = protected_owner
    backend = DifyAgentBackendRunClient(runtime_owner.client)
    builder = NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed")
    preparation = AgentPreparationService(owner.api.store, runtime_owner.client, None, builder)
    config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    acknowledged = preparation.bind_created_run(
        payload=AgentPrepareRunPayload(
            parent_node=WireParent.model_validate(owner.parent.model_dump(mode="json")),
            agent_run_id=runtime_owner.run_id,
            request_digest=config.config_digest,
        )
    )
    commands = ConfirmedAgentCommands(
        api=owner.api,
        continuation=ConfirmedAgentContinuation(
            loader=owner.api.loader,
            store=owner.api.store,
            operations=None,
            backend=backend,
            lifecycle=owner.api.lifecycle,
        ),
        backend=backend,
        publish=None,
    )
    workspace = config.workspace
    binding = AgentRecoveryBinding(
        binding_id=workspace.binding_id,
        workspace_id=workspace.workspace_id,
        binding_ref=workspace.backend_binding_ref,
        workspace_ref=workspace.backend_workspace_ref,
        workspace_generation=0,
        association_object_ref=acknowledged.association_object_ref,
        config_ref=config.config_ref,
        config_digest=config.config_digest,
    )
    identity = commands.capture_session_snapshot_identity(
        parent_node=owner.parent,
        parent_generation=0,
        agent_run_id=runtime_owner.run_id,
        agent_generation=0,
        binding=binding,
    )
    commands.save_session_snapshot(
        identity=identity, session_scope=owner.scope, snapshot=SessionSnapshot(layers={"runtime": {}})
    )
    with owner.api.sessions() as session:
        row = session.get(AgentWorkspaceBinding, binding.binding_id)
        assert row is not None
        assert row.session_snapshot == SessionSnapshot(layers={"runtime": {}}).model_dump_json()


def bind_owned_run(
    owner: ProtectedOwner, runtime: RuntimeOwner
) -> tuple[AgentPreparationService, ConfirmedAgentCommands, AgentPrepareRunResponse]:
    from dify_agent.protocol.native_testing import AgentParentNodeRef as WireParent
    from dify_agent.protocol.native_testing import AgentPrepareRunPayload

    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService

    backend = DifyAgentBackendRunClient(runtime.client)
    preparation = AgentPreparationService(
        owner.api.store,
        runtime.client,
        None,
        NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed"),
    )
    config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    receipt = preparation.bind_created_run(
        payload=AgentPrepareRunPayload(
            parent_node=WireParent.model_validate(owner.parent.model_dump(mode="json")),
            agent_run_id=runtime.run_id,
            request_digest=config.config_digest,
        )
    )
    commands = ConfirmedAgentCommands(
        api=owner.api,
        continuation=ConfirmedAgentContinuation(
            loader=owner.api.loader,
            store=owner.api.store,
            operations=None,
            backend=backend,
            lifecycle=owner.api.lifecycle,
        ),
        backend=backend,
        publish=None,
    )
    return preparation, commands, receipt


def owned_wait(
    owner: ProtectedOwner, runtime: RuntimeOwner, association_ref: str, pending_intent: AgentEffectIntent | None = None
) -> tuple[AgentCheckpoint, AgentWaitAssociation, CheckpointRef]:
    from dify_agent.protocol.native_continuation import AgentCheckpoint

    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState

    portal = runtime.http.portal
    assert portal is not None
    config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    checkpoint = AgentCheckpoint.model_validate(
        {
            "native_test_profile": "confirmed",
            "run_id": runtime.run_id,
            "create_idempotency_key": owner.config.idempotency_key,
            "ref": owner.parent.ref.model_dump(mode="json"),
            "generation": 0,
            "stage": "tool",
            "history": [],
            "operation_cursor": 0,
            "result_refs": {},
            "job_refs": [],
            "config_ref": config.config_ref,
            "config_digest": config.config_digest,
            "session_snapshot": {"schema_version": 2, "layers": {"runtime": {}}},
            "pending_calls": [
                {
                    "call_id": "call",
                    "tool_name": "fixture",
                    "native_arguments": {},
                    "stage": "tool",
                    "pending_operation_id": str(uuid4()),
                    "wait_reason": "approval",
                    "intent": {
                        "key": {
                            "invocation_id": owner.parent.ref.invocation_id,
                            "occurrence_path": [owner.parent.execution_id, "core_tool", "call"],
                            "cursor": 0,
                        },
                        "kind": "tool",
                        "resource_ref": "fixture",
                        "implementation_revision": "fixture",
                        "account_ref": None,
                        "target": {},
                        "parameters": {},
                        "input_digest": owner.parent.input_digest,
                        "capability_digest": "a" * 64,
                    },
                }
            ],
        }
    )
    if pending_intent is not None:
        raw_checkpoint = checkpoint.model_dump(mode="json")
        raw_checkpoint["stage"] = "model" if pending_intent.kind == "model" else "tool"
        raw_checkpoint["pending_calls"][0].update(
            stage=raw_checkpoint["stage"], intent=pending_intent.model_dump(mode="json")
        )
        checkpoint = AgentCheckpoint.model_validate(raw_checkpoint)
    event_id = portal.call(
        lambda: runtime.store.persist_waiting(
            run_id=runtime.run_id, checkpoint=checkpoint, event=checkpoint.waiting_event()
        )
    )
    wait = owner.api.store.store_agent_wait(
        ref=owner.parent.ref,
        parent_node=owner.parent,
        association_object_ref=association_ref,
        agent_generation=0,
        checkpoint=checkpoint.model_dump(mode="json"),
        backend_wait_event_id=event_id,
    )
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
    from graphon.entities.pause_reason import SchedulingPause
    from graphon.runtime import RuntimeState, VariablePool
    from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_stream import entity

    assert owner.context.native_run_id is not None
    parent_runtime = RuntimeState(workflow_id=owner.scope.workflow_id, variable_pool=VariablePool(), start_at=0)
    parent_runtime.graph_execution.start()
    execution = parent_runtime.graph_execution.get_or_create_node_execution(frame_id="root", node_id="agent")
    execution.execution_id = owner.parent.execution_id
    parent_runtime.graph_execution.pause(SchedulingPause(message="Agent approval"))
    generate = entity()
    generate.builder_agent_execution = BuilderAgentExecutionContext(
        ref=owner.parent.ref, native_run_id=owner.context.native_run_id
    )
    paused = WorkflowResumptionContext(
        serialized_graph_runtime_state=parent_runtime.dumps(),
        generate_entity=_WorkflowGenerateEntityWrapper(entity=generate),
    )
    storage.save("fixture-owned-parent-pause", paused.dumps().encode())
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id=owner.context.native_run_id,
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json=paused.serialized_graph_runtime_state,
        response_stream_filter_json="{}",
        node_journals=(
            NodeJournalState(
                invocation_id=owner.parent.ref.invocation_id,
                occurrence_path=(owner.parent.execution_id,),
                input_result_ref=owner.parent.input_result_ref,
                input_digest=owner.parent.input_digest,
                cursor=0,
                operation_keys=(),
                result_refs=(),
            ),
        ),
        child_refs=(),
        input_result_refs=(owner.parent.input_result_ref,),
        agent_associations=(wait,),
    )
    parent_checkpoint = owner.api.store.commit_checkpoint(ref=owner.parent.ref, generation=0, payload=payload)
    return checkpoint, wait, parent_checkpoint


@pytest.mark.parametrize("resumed", [False, True])
@pytest.mark.parametrize("terminal", ["succeeded", "failed"])
def test_confirmed_node_captures_before_stream_and_persists_both_terminal_branches(
    protected_owner: ProtectedOwner,
    runtime_owner: RuntimeOwner,
    resumed: bool,
    terminal: str,
) -> None:
    from dify_agent.protocol import RunFailedEvent, RunFailedEventData, RunSucceededEvent, RunSucceededEventData
    from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding
    from dify_agent.protocol.snapshot import SessionSnapshot

    from clients.agent_backend import AgentBackendRunEventAdapter
    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
    from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
    from core.workflow.nodes.agent_v2.file_tenant_validator import AgentOutputFileTenantValidator
    from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
    from core.workflow.nodes.agent_v2.output_failure_orchestrator import OutputFailureOrchestrator
    from core.workflow.nodes.agent_v2.output_type_checker import PerOutputTypeChecker
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeRequestBuilder
    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
    from core.workflow.system_variables import SystemVariableKey
    from graphon.runtime import InitParams, RuntimeState, VariablePool
    from graphon.variables.segments import StringSegment
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
    from services.agent.workflow_run_recovery import AgentCreateScope, WorkflowAgentRunRecovery
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.workflow_runtime.agent_binding import WorkflowAgentBindingResolver
    from services.workflow_runtime.agent_node import DifyAgentNode

    owner, runtime = protected_owner, runtime_owner
    portal = runtime.http.portal
    assert portal is not None
    assert owner.scope.workflow_run_id is not None
    backend = DifyAgentBackendRunClient(runtime.client)
    preparation = AgentPreparationService(
        owner.api.store,
        runtime.client,
        None,
        NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed"),
    )
    commands = ConfirmedAgentCommands(
        api=owner.api,
        continuation=ConfirmedAgentContinuation(
            loader=owner.api.loader,
            store=owner.api.store,
            operations=None,
            backend=backend,
            lifecycle=owner.api.lifecycle,
        ),
        backend=backend,
        publish=None,
    )
    if resumed:
        preparation, commands, association = bind_owned_run(owner, runtime)
        _checkpoint, wait, parent_checkpoint = owned_wait(owner, runtime, association.association_object_ref)
        claim = portal.call(
            lambda: runtime.store.claim_continuation(
                run_id=runtime.run_id, expected_generation=0, idempotency_key="approved-continuation"
            )
        )
        assert claim.generation == 1
        assert portal.call(lambda: runtime.store.start_continuation(claim))
        with owner.api.sessions.begin() as session:
            scope = session.get(NativeTestScope, owner.parent.ref.request_id)
            state = session.scalar(
                select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
            )
            assert scope is not None
            assert state is not None
            scope.generation, state.generation, state.checkpoint_id = 1, 1, parent_checkpoint.checkpoint_id
            session.add(
                NativeDispatch(
                    tenant_id=owner.scope.tenant_id,
                    request_id=owner.parent.ref.request_id,
                    invocation_id=owner.parent.ref.invocation_id,
                    generation=1,
                    idempotency_digest="b" * 64,
                    state="claimed",
                    checkpoint_id=parent_checkpoint.checkpoint_id,
                    claim_expires_at=datetime.now(UTC) + timedelta(minutes=5),
                )
            )
    snapshot = SessionSnapshot(layers={"runtime": {}, "shell": {"initialized": False}})
    event = (
        RunSucceededEvent(
            run_id=runtime.run_id, data=RunSucceededEventData(output="owned result", session_snapshot=snapshot)
        )
        if terminal == "succeeded"
        else RunFailedEvent(
            run_id=runtime.run_id, data=RunFailedEventData(error="fixture terminal", session_snapshot=snapshot)
        )
    )
    assert portal.call(lambda: runtime.store.finalize_run(event)).applied
    recovery = WorkflowAgentRunRecovery(owner.api.sessions)
    create_scope = AgentCreateScope(
        tenant_id=owner.scope.tenant_id,
        app_id=owner.scope.app_id,
        workflow_id=owner.scope.workflow_id,
        workflow_run_id=owner.scope.workflow_run_id,
        node_id=owner.scope.node_id,
        execution_id=owner.scope.node_execution_id,
        workflow_binding_id=owner.scope.workflow_agent_binding_id,
    )
    assert owner.config.idempotency_key is not None
    intent, inserted = recovery.reserve(
        scope=create_scope, attempt=0, key=owner.config.idempotency_key, digest=create_run_fingerprint(owner.config)
    )
    assert inserted
    recovery.bind_child(scope=create_scope, intent=intent, child_run_id=runtime.run_id)
    order: list[str] = []

    def observe(request: httpx.Request) -> None:
        if request.url.path.endswith("native-identity"):
            order.append("capture")
        if request.url.path.endswith("events/sse"):
            assert "capture" in order
            order.append("stream")

    runtime.http_client.event_hooks["request"].append(observe)
    pool = VariablePool()
    pool.add(["sys", SystemVariableKey.WORKFLOW_EXECUTION_ID.value], StringSegment(value=owner.scope.workflow_run_id))
    run_context = DifyRunContext(
        tenant_id=owner.scope.tenant_id,
        app_id=owner.scope.app_id,
        user_id=owner.context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_agent_execution=BuilderAgentExecutionContext(
            ref=owner.parent.ref, native_run_id=owner.scope.workflow_run_id
        ),
    )
    nodes = owner.context.graph["nodes"]
    assert isinstance(nodes, list)
    assert isinstance(nodes[0], dict)
    node = DifyAgentNode(
        node_id=owner.scope.node_id,
        data=DifyAgentNodeData.model_validate(nodes[0]["data"]),
        init_params=InitParams(
            workflow_id=owner.scope.workflow_id,
            graph_config=owner.context.graph,
            run_context={DIFY_RUN_CONTEXT_KEY: run_context},
            call_depth=0,
        ),
        runtime_state=RuntimeState(
            variable_pool=pool, start_at=time.perf_counter(), workflow_id=owner.scope.workflow_id
        ),
        binding_resolver=WorkflowAgentBindingResolver(),
        runtime_request_builder=WorkflowAgentRuntimeRequestBuilder(),
        agent_backend_client=backend,
        event_adapter=AgentBackendRunEventAdapter(),
        output_adapter=WorkflowAgentOutputAdapter(),
        type_checker=PerOutputTypeChecker(AgentOutputFileTenantValidator()),
        failure_orchestrator=OutputFailureOrchestrator(),
        session_store=WorkflowAgentWorkspaceStore(),
        agent_preparation=preparation,
        agent_commands=commands,
        agent_run_recovery=recovery,
    )
    node.bind_execution_id(owner.parent.execution_id)
    events = list(node._run())
    from graphon.node_events import StreamCompletedEvent

    terminal_events = [item for item in events if isinstance(item, StreamCompletedEvent)]
    assert len(terminal_events) == 1
    result = terminal_events[0].node_run_result
    from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus

    assert result.status == (
        WorkflowNodeExecutionStatus.SUCCEEDED if terminal == "succeeded" else WorkflowNodeExecutionStatus.FAILED
    )
    assert (
        result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]["session_snapshot_persisted"]
        is True
    )
    assert order.index("capture") < order.index("stream")
    config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    protected = owner.api.store.load_agent_association(ref=owner.parent.ref, parent_node=owner.parent)
    binding = AgentRecoveryBinding(
        binding_id=config.workspace.binding_id,
        workspace_id=config.workspace.workspace_id,
        binding_ref=config.workspace.backend_binding_ref,
        workspace_ref=config.workspace.backend_workspace_ref,
        workspace_generation=0,
        association_object_ref=protected.association_object_ref,
        config_ref=config.config_ref,
        config_digest=config.config_digest,
    )
    original = commands.capture_session_snapshot_identity(
        parent_node=owner.parent,
        parent_generation=int(resumed),
        agent_run_id=runtime.run_id,
        agent_generation=int(resumed),
        binding=binding,
    )
    assert original.agent_generation == int(resumed)
    with owner.api.sessions.begin() as session:
        row = session.get(AgentWorkspaceBinding, binding.binding_id)
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        assert row is not None
        assert scope is not None
        assert state is not None
        assert row.session_snapshot == snapshot.model_dump_json()
        scope.generation += 1
        state.generation += 1
    with pytest.raises(BuilderExecutionPolicyError):
        commands.save_session_snapshot(
            identity=original, session_scope=owner.scope, snapshot=SessionSnapshot(layers={})
        )
    with owner.api.sessions() as session:
        row = session.get(AgentWorkspaceBinding, binding.binding_id)
        assert row is not None
        assert row.session_snapshot == snapshot.model_dump_json()


def test_recovery_config_payload_wraps_acknowledged_random_receipt(protected_owner: ProtectedOwner) -> None:
    from services.dify_builder.native_testing import agent_recovery

    owner = protected_owner
    payload = agent_recovery.RecoveryPreparedConfigPayload(
        schema_version="agent-recovery-config-v1",
        parent_node=owner.parent,
        config=owner.config.model_dump(mode="json", include={"composition", "session_snapshot"}),
    )
    receipt = owner.api.store.prepare_object(
        ref=owner.parent.ref,
        tenant_id=owner.scope.tenant_id,
        kind="result",
        logical_key="agent-recovery:" + "a" * 64 + ":config",
        payload=payload.model_dump(mode="json"),
    )
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
        owner.api.store.acknowledge_object(session, receipt)
    value = owner.api.store._read_object(receipt)
    wrapped = owner.api.store._recovery_prepared_config(receipt=receipt, value=value)
    assert set(payload.model_dump()) == {"schema_version", "parent_node", "config"}
    assert wrapped.config_ref == receipt.id
    assert wrapped.parent_node.model_dump(mode="json") == owner.parent.model_dump(mode="json")
    assert wrapped.config_digest == canonical_digest(wrapped.config)


@dataclass(frozen=True)
class AllocatedRecovery:
    expected: AgentRecoveryRecord
    checkpoint: AgentCheckpoint
    wait: AgentWaitAssociation
    config: AgentPreparedConfig
    association: AgentNodeAssociation
    allocation: RecoveryAllocationReceipt


def allocated_successor(
    owner: ProtectedOwner,
    runtime: RuntimeOwner,
    *,
    substitution: str,
    model_pending: bool = False,
    core_tool_pending: bool = False,
    inspection_adapter: Literal["local", "enterprise"] = "local",
) -> AllocatedRecovery:
    """Acknowledge actual immutable graph bytes for the unactivated finalizer only.

    This deliberately seeds the allocated fixture boundary; it proves no physical
    allocation or authenticated recovery admission. Every object uses normal
    prepare/readback/acknowledge, including the random-ID config payload.
    """
    from dify_agent.protocol import CreateExecutionBindingRequest, CreateExecutionBindingResponse
    from dify_agent.protocol.confirmed_recovery import (
        AgentRecoveryBinding,
    )
    from dify_agent.protocol.native_testing import AgentCheckpointRef

    from runtime_contracts.builder.native.contracts import OperationKey, operation_digest
    from services.dify_builder.native_testing.agent_recovery import RecoveryAllocationReceipt
    from services.dify_builder.native_testing.agent_recovery_state import (
        RECOVERY_RECORD_KEY,
        AgentRecoveryAttemptIdentity,
        AgentRecoveryRecord,
        recovery_attempt_id,
    )

    _preparation, _commands, binding = bind_owned_run(owner, runtime)
    original_intent = None
    if model_pending:
        from dify_agent.protocol.native_testing import AgentEffectIntent

        from services.dify_builder.native_testing.agent_operations import AgentOperationService
        from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

        operations = AgentOperationService(
            loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
        )
        definition = NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed").load_definition(
            context=owner.context, node_id="agent"
        )
        initial = operations._model_operation(
            ref=owner.parent.ref,
            key=OperationKey(
                invocation_id=owner.parent.ref.invocation_id,
                occurrence_path=(owner.parent.execution_id, "model", "call"),
                cursor=0,
            ),
            target=operations._model_target(definition),
            parameters={},
            parent=owner.parent,
            descriptor={"node_id": "agent"},
        )
        original_intent = AgentEffectIntent.model_validate(initial.intent.model_dump(mode="json"))
        operations._persist(
            ref=owner.parent.ref,
            intent=initial.intent,
            proposal=initial.proposal,
            assessment=initial.assessment,
            descriptor=initial.descriptor,
            binding=initial.binding,
        )
    if core_tool_pending:
        from dify_agent.protocol.native_testing import AgentEffectIntent

        initial_tool = json_tool_preparation(owner, recovery=False)
        from services.dify_builder.native_testing.agent_operations import AgentOperationService
        from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

        operations = AgentOperationService(
            loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
        )
        operations._persist(
            ref=owner.parent.ref,
            intent=initial_tool.intent,
            proposal=initial_tool.proposal,
            assessment=initial_tool.assessment,
            descriptor=initial_tool.descriptor,
            binding=initial_tool.binding,
        )
        original_intent = AgentEffectIntent.model_validate(initial_tool.intent.model_dump(mode="json"))
    checkpoint, wait, parent_checkpoint = owned_wait(owner, runtime, binding.association_object_ref, original_intent)
    old_config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    old_association = owner.api.store.load_agent_association(ref=owner.parent.ref, parent_node=owner.parent).association
    workspace = old_config.workspace
    predecessor = AgentRecoveryBinding(
        binding_id=workspace.binding_id,
        workspace_id=workspace.workspace_id,
        binding_ref=workspace.backend_binding_ref,
        workspace_ref=workspace.backend_workspace_ref,
        workspace_generation=0,
        association_object_ref=binding.association_object_ref,
        config_ref=old_config.config_ref,
        config_digest=old_config.config_digest,
    )
    identity = AgentRecoveryAttemptIdentity(
        invocation_id=owner.parent.ref.invocation_id,
        parent_execution_id=owner.parent.execution_id,
        predecessor_binding_id=workspace.binding_id,
        predecessor_checkpoint_digest=wait.checkpoint_digest,
        predecessor_workspace_generation=0,
    )
    attempt = recovery_attempt_id(identity)
    with owner.api.sessions() as session:
        home = (
            None if workspace.home_snapshot_id is None else session.get(AgentHomeSnapshot, workspace.home_snapshot_id)
        )
        assert workspace.home_snapshot_id is None or home is not None
        home_ref = None if home is None else home.snapshot_ref
        home_digest = None if home is None else owner.api.store.recovery_home_digest(home)
    assert owner.context.native_run_id is not None
    pause = WorkflowPause(
        workflow_id=owner.scope.workflow_id,
        workflow_run_id=owner.context.native_run_id,
        state_object_key="fixture-owned-parent-pause",
    )
    with owner.api.sessions.begin() as session:
        session.add(pause)
    pending_id = checkpoint.pending_calls[0].pending_operation_id
    evidence: dict[str, JsonValue] = {
        "parent_node": owner.parent.model_dump(mode="json"),
        "wait": wait.model_dump(mode="json"),
        "parent_checkpoint": parent_checkpoint.model_dump(mode="json"),
        "pause_id": pause.id,
        "pause_state_object_key": pause.state_object_key,
        "native_run_id": owner.context.native_run_id,
        "inspection": {
            "binding_ref": workspace.backend_binding_ref,
            "workspace_ref": workspace.backend_workspace_ref,
            "adapter": inspection_adapter,
            "state": "definitively_gone",
            "evidence_code": "sandbox_not_found" if inspection_adapter == "enterprise" else "path_absent",
        },
        "agent_run_id": runtime.run_id,
        "pending_ids": [pending_id],
        "allocation_owner": {
            "tenant_id": owner.scope.tenant_id,
            "agent_id": owner.scope.agent_id,
            "home_snapshot_id": workspace.home_snapshot_id,
            "home_snapshot_ref": home_ref,
            "home_snapshot_digest": home_digest,
        },
    }

    def acknowledge(role: str, value: JsonValue) -> ObjectReceipt:
        receipt = owner.api.store.prepare_object(
            ref=owner.parent.ref,
            tenant_id=owner.scope.tenant_id,
            kind="result",
            logical_key="agent-recovery:" + attempt + ":" + role,
            payload=value,
        )
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
            owner.api.store.acknowledge_object(session, receipt)
        assert owner.api.store._read_object(receipt) == value
        return receipt

    evidence_receipt = acknowledge("evidence", evidence)
    new_binding, new_workspace = str(uuid4()), str(uuid4())
    physical_binding, physical_workspace = "fresh-binding-" + new_binding, "fresh-workspace-" + new_workspace
    allocation = RecoveryAllocationReceipt(
        attempt_id=attempt,
        request=CreateExecutionBindingRequest(
            tenant_id=owner.scope.tenant_id,
            agent_id=owner.scope.agent_id,
            binding_id=new_binding,
            workspace_id=new_workspace,
            home_snapshot_ref=home_ref,
        ),
        response=CreateExecutionBindingResponse(binding_ref=physical_binding, workspace_ref=physical_workspace),
    )
    allocation_receipt = acknowledge("allocation", allocation.model_dump(mode="json"))
    prepared = owner.api.store._agent_prepare(ref=owner.parent.ref, parent_node=owner.parent, writing=False)
    expected = AgentRecoveryRecord(
        identity=identity,
        attempt_id=attempt,
        predecessor=predecessor,
        predecessor_checkpoint=AgentCheckpointRef(
            checkpoint_id=wait.checkpoint_object_ref, payload_digest=wait.checkpoint_digest
        ),
        parent_generation=0,
        agent_generation=0,
        reserved_binding_id=new_binding,
        reserved_workspace_id=new_workspace,
        next_workspace_generation=1,
        input_digest=owner.parent.input_digest,
        definition_digest=prepared.resource_digest,
        home_snapshot_id=workspace.home_snapshot_id,
        home_snapshot_digest=home_digest,
        interaction_idempotency_digest="a" * 64,
        phase="allocated",
        evidence_object_ref=evidence_receipt.id,
        allocation_receipt_ref=allocation_receipt.id,
        successor_object_ref=None,
        successor_digest=None,
        sdk_receipt_ref=None,
        successor_wait_ref=None,
    )
    from services.dify_builder.native_testing.agent_bridge import api_intent
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    old_intent = api_intent(checkpoint.pending_calls[0].intent)
    binding_value = owner.api.loader.load(ref=owner.parent.ref).bindings.get(operation_digest(old_intent.key))
    old_scope = (
        "b" * 64 if binding_value is None else _scope_digest(old_intent, NativeBinding.model_validate(binding_value))
    )
    with owner.api.sessions.begin() as session:
        operation = NativeEffectOperation(
            tenant_id=owner.scope.tenant_id,
            request_id=owner.parent.ref.request_id,
            invocation_id=owner.parent.ref.invocation_id,
            operation_digest=operation_digest(
                OperationKey.model_validate(checkpoint.pending_calls[0].intent.key.model_dump())
            ),
            intent_digest=canonical_digest(checkpoint.pending_calls[0].intent.model_dump(mode="json")),
            scope_digest=old_scope,
            state="pending",
        )
        session.add(operation)
        session.flush()
        session.add(
            NativePendingAction(
                id=pending_id,
                tenant_id=owner.scope.tenant_id,
                request_id=owner.parent.ref.request_id,
                invocation_id=owner.parent.ref.invocation_id,
                generation=0,
                category="approval",
                reference_digest=canonical_digest(operation.id),
                reference=operation.id,
                owner_ref=owner.scope.app_id,
                owner_version=old_scope,
                operation_id=operation.id,
            )
        )
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        run = session.get(WorkflowRun, owner.context.native_run_id)
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        assert request is not None
        assert run is not None
        assert invocation is not None
        state.state, state.wait_reason, state.pending_ids, state.checkpoint_id = (
            "waiting",
            "approval",
            [pending_id],
            parent_checkpoint.checkpoint_id,
        )
        request.state, run.status = "waiting", WorkflowExecutionStatus.PAUSED
        invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: expected.model_dump(mode="json")}
    return AllocatedRecovery(expected, checkpoint, wait, old_config, old_association, allocation)


def prepared_successor(
    owner: ProtectedOwner, runtime: RuntimeOwner, *, substitution: str, model_pending: bool = False
) -> PreparedRecoverySelection:
    """Acknowledge explicit finalizer bundle after the allocated-only fixture boundary."""
    from dify_agent.protocol.confirmed_recovery import (
        AgentRecoveryBinding,
        AgentRecoveryReconstruction,
        AgentRecoverySuccessor,
    )
    from dify_agent.protocol.native_continuation import AgentCheckpoint
    from dify_agent.runtime.confirmed_recovery import recovery_snapshot

    from runtime_contracts.builder.native.agent_contracts import AgentNodeAssociation
    from services.dify_builder.native_testing.agent_recovery import (
        PreparedRecoverySelection,
        RecoveryPreparedConfigPayload,
    )

    allocated = allocated_successor(owner, runtime, substitution=substitution, model_pending=model_pending)
    expected, checkpoint, wait, old_config, old_association, allocation = (
        allocated.expected,
        allocated.checkpoint,
        allocated.wait,
        allocated.config,
        allocated.association,
        allocated.allocation,
    )
    workspace = old_config.workspace
    attempt, predecessor = expected.attempt_id, expected.predecessor
    pending_id = checkpoint.pending_calls[0].pending_operation_id
    new_binding, new_workspace = expected.reserved_binding_id, expected.reserved_workspace_id
    physical_binding, physical_workspace = allocation.response.binding_ref, allocation.response.workspace_ref
    home_digest = expected.home_snapshot_digest

    def acknowledge(role: str, value: JsonValue) -> ObjectReceipt:
        receipt = owner.api.store.prepare_object(
            ref=owner.parent.ref,
            tenant_id=owner.scope.tenant_id,
            kind="result",
            logical_key="agent-recovery:" + attempt + ":" + role,
            payload=value,
        )
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
            owner.api.store.acknowledge_object(session, receipt)
        assert owner.api.store._read_object(receipt) == value
        return receipt

    selected_parent = (
        AgentParentNodeRef.model_validate({**owner.parent.model_dump(mode="json"), "input_result_ref": str(uuid4())})
        if substitution == "input_result_ref"
        else owner.parent
    )
    raw_config = json.loads(old_config.model_dump_json())["config"]
    raw_config["composition"]["layers"][0]["config"]["backend_binding_ref"] = physical_binding
    raw_config["session_snapshot"] = recovery_snapshot(checkpoint).model_dump(mode="json")
    payload = RecoveryPreparedConfigPayload(
        schema_version="agent-recovery-config-v1", parent_node=selected_parent, config=raw_config
    )
    config_receipt = acknowledge("config", payload.model_dump(mode="json"))
    new_config = owner.api.store._recovery_prepared_config(
        receipt=config_receipt, value=payload.model_dump(mode="json")
    )
    new_workspace_ref = AgentTestWorkspaceRef(
        binding_id=new_binding,
        workspace_id=new_workspace,
        backend_binding_ref=physical_binding,
        backend_workspace_ref=physical_workspace,
        pinned_snapshot_id=workspace.pinned_snapshot_id,
        home_snapshot_id=workspace.home_snapshot_id,
        workspace_generation=1,
    )
    association = AgentNodeAssociation(
        parent_node=owner.parent,
        workflow_native_run_id=str(uuid4())
        if substitution == "workflow_run"
        else old_association.workflow_native_run_id,
        agent_run_id=runtime.run_id,
        config_ref=new_config.config_ref,
        config_digest=new_config.config_digest,
        pinned_snapshot_id=workspace.pinned_snapshot_id,
        home_snapshot_id=workspace.home_snapshot_id,
        workspace=new_workspace_ref,
    )
    association_receipt = acknowledge("association", association.model_dump(mode="json"))
    new_pending = str(uuid4())
    call = checkpoint.pending_calls[0]
    new_call = {
        **call.model_dump(mode="json"),
        "pending_operation_id": new_pending,
        "intent": {
            **call.intent.model_dump(mode="json"),
            "key": {
                **call.intent.key.model_dump(mode="json"),
                "occurrence_path": [owner.parent.execution_id, "recovery", "1", *call.intent.key.occurrence_path[-2:]],
            },
        },
    }
    new_checkpoint = AgentCheckpoint.model_validate(
        {
            **checkpoint.model_dump(mode="json"),
            "pending_calls": [new_call],
            "config_ref": new_config.config_ref,
            "config_digest": new_config.config_digest,
            "session_snapshot": recovery_snapshot(checkpoint).model_dump(mode="json"),
        }
    )
    checkpoint_receipt = acknowledge("checkpoint", new_checkpoint.model_dump(mode="json"))
    reconstruction = AgentRecoveryReconstruction(
        protocol_version=1,
        kind="empty-bootstrap-v1",
        home_snapshot_id=workspace.home_snapshot_id,
        home_snapshot_digest=home_digest,
    )
    reconstruction_receipt = acknowledge("reconstruction", reconstruction.model_dump(mode="json"))
    successor = AgentRecoveryBinding(
        binding_id=new_binding,
        workspace_id=new_workspace,
        binding_ref=physical_binding,
        workspace_ref=physical_workspace,
        workspace_generation=1,
        association_object_ref=association_receipt.id,
        config_ref=config_receipt.id,
        config_digest=new_config.config_digest,
    )
    relation = AgentRecoverySuccessor.model_validate(
        {
            "attempt_id": attempt,
            "parent_node": selected_parent.model_dump(mode="json"),
            "agent_run_id": runtime.run_id,
            "expected_parent_generation": 0,
            "expected_agent_generation": 0,
            "predecessor": predecessor.model_dump(mode="json"),
            "successor": successor.model_dump(mode="json"),
            "predecessor_checkpoint": expected.predecessor_checkpoint.model_dump(mode="json"),
            "successor_checkpoint": {
                "checkpoint_id": checkpoint_receipt.id,
                "payload_digest": checkpoint_receipt.value_digest,
            },
            "predecessor_waiting_event_id": wait.backend_wait_event_id,
            "reconstruction_object_ref": reconstruction_receipt.id,
            "reconstruction_digest": reconstruction_receipt.value_digest,
            "pending_operation_substitutions": [
                {"predecessor_operation_id": pending_id, "successor_operation_id": new_pending}
            ],
        }
    )
    relation_receipt = acknowledge("relation", relation.model_dump(mode="json"))
    return PreparedRecoverySelection(
        expected,
        relation,
        relation_receipt,
        config_receipt,
        association_receipt,
        checkpoint_receipt,
        reconstruction_receipt,
    )


def test_actual_acknowledged_successor_graph_finalizes(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    selection = prepared_successor(protected_owner, runtime_owner, substitution="none")
    ready = protected_owner.api.store.finalize_recovery_successor(ref=protected_owner.parent.ref, selection=selection)
    assert ready.phase == "ready"
    with protected_owner.api.sessions() as session:
        row = session.get(WorkflowNodeExecutionModel, protected_owner.parent.execution_id)
        assert row is not None
        assert row.agent_workspace_binding_id == selection.expected.reserved_binding_id


@pytest.mark.parametrize("substitution", ["input_result_ref", "workflow_run"])
def test_matching_digest_acknowledged_successor_substitution_refuses_before_retirement(
    protected_owner: ProtectedOwner,
    runtime_owner: RuntimeOwner,
    substitution: str,
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY

    selection = prepared_successor(protected_owner, runtime_owner, substitution=substitution)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
        protected_owner.api.store.finalize_recovery_successor(ref=protected_owner.parent.ref, selection=selection)
    with protected_owner.api.sessions() as session:
        old = session.get(AgentWorkspaceBinding, selection.expected.predecessor.binding_id)
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == protected_owner.parent.ref.request_id)
        )
        assert old is not None
        assert old.status.value == "active"
        assert session.get(AgentWorkspaceBinding, selection.expected.reserved_binding_id) is None
        assert invocation is not None
        assert invocation.bindings[RECOVERY_RECORD_KEY] == selection.expected.model_dump(mode="json")


def test_allocated_role_ack_reuses_actual_receipt_and_rejects_conflicts(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    value = owner.api.store._read_object(selection.config_receipt)
    receipt = owner.api.store.stage_recovery_object(
        ref=owner.parent.ref, expected=selection.expected, role="config", value=value
    )
    assert receipt == selection.config_receipt
    assert (
        owner.api.store.stage_recovery_object(
            ref=owner.parent.ref, expected=selection.expected, role="config", value=value
        )
        == receipt
    )
    assert isinstance(value, dict)
    with pytest.raises(BuilderExecutionPolicyError, match="native_payload_conflict"):
        owner.api.store.stage_recovery_object(
            ref=owner.parent.ref,
            expected=selection.expected,
            role="config",
            value={**value, "schema_version": "wrong"},
        )
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
        owner.api.store.stage_recovery_object(
            ref=owner.parent.ref, expected=selection.expected, role="config", value=value
        )


def test_actual_recovery_pending_is_fresh_inert_and_idempotent(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from models.dify_builder_native_tests import NativeEffectGrant
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none", model_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    staged = operations.stage_recovery_pending(ref=owner.parent.ref, expected=selection.expected)
    assert len(staged) == 1
    assert staged == operations.stage_recovery_pending(ref=owner.parent.ref, expected=selection.expected)
    entry = staged[0]
    assert (
        entry.predecessor_pending_id == selection.relation.pending_operation_substitutions[0].predecessor_operation_id
    )
    assert entry.pending_id != entry.predecessor_pending_id
    assert entry.intent.key.occurrence_path == (owner.parent.execution_id, "recovery", "1", "model", "call")
    assert entry.proposal.key == entry.intent.key
    with owner.api.sessions() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        assert state.pending_ids == [entry.predecessor_pending_id]
        for pending_id in (entry.predecessor_pending_id, entry.pending_id):
            pending = session.get(NativePendingAction, pending_id)
            assert pending is not None
            operation = session.get(NativeEffectOperation, pending.operation_id)
            assert operation is not None
            assert operation.state == "pending"
        assert session.scalar(select(NativeEffectAttempt.id)) is None
        assert session.scalar(select(NativeEffectDispatchClaim.id)) is None
        assert session.scalar(select(NativeEffectGrant.id)) is None


def test_actual_graph_producer_reuses_acknowledged_role_ids_and_preserves_parent(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none", model_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    pending = operations.stage_recovery_pending(ref=owner.parent.ref, expected=allocated.expected)
    evidence = owner.api.store.load_result(ref=owner.parent.ref, result_ref=allocated.expected.evidence_object_ref)
    assert isinstance(evidence, dict)
    original_checkpoint = evidence["parent_checkpoint"]
    with owner.api.sessions() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        before = (state.checkpoint_id, list(state.pending_ids))
        continuation = session.scalar(
            select(NativeContinuation).where(NativeContinuation.request_id == owner.parent.ref.request_id)
        )
        assert continuation is not None
        original = (continuation.checkpoint_id, continuation.payload_digest, continuation.payload_ref)
    first = owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=pending
    )
    assert first == owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=pending
    )
    assert first.relation.successor.config_ref == first.config_receipt.id
    assert first.relation.successor_checkpoint.checkpoint_id == first.checkpoint_receipt.id
    assert first.relation.pending_operation_substitutions[0].successor_operation_id == pending[0].pending_id
    assert first.relation.predecessor == allocated.expected.predecessor
    with owner.api.sessions() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        continuation = session.scalar(
            select(NativeContinuation).where(NativeContinuation.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        assert continuation is not None
        assert (state.checkpoint_id, state.pending_ids) == before
        assert (continuation.checkpoint_id, continuation.payload_digest, continuation.payload_ref) == original
        assert original_checkpoint == {"checkpoint_id": original[0], "payload_digest": original[1]}


def test_current_readers_follow_only_selected_ready_graph_and_keep_parent_bytes(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import CheckpointRef

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    assert owner.api.store.load_selected_recovery(ref=owner.parent.ref, parent_node=owner.parent) is None
    evidence = owner.api.store.load_result(ref=owner.parent.ref, result_ref=selection.expected.evidence_object_ref)
    assert isinstance(evidence, dict)
    parent_checkpoint = CheckpointRef.model_validate(evidence["parent_checkpoint"])
    before = owner.api.store.read_checkpoint(ref=owner.parent.ref, checkpoint=parent_checkpoint)
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    assert owner.api.store.load_selected_recovery(ref=owner.parent.ref, parent_node=owner.parent) == selection.relation
    selected = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    assert (selected.config_ref, selected.config_digest) == (
        selection.relation.successor.config_ref,
        selection.relation.successor.config_digest,
    )
    association = owner.api.store.load_agent_association(ref=owner.parent.ref, parent_node=owner.parent)
    assert association.association_object_ref == selection.association_receipt.id
    assert association.association.config_ref == selected.config_ref
    assert owner.api.store.discover_agent_run(ref=owner.parent.ref, parent_node=owner.parent) == association.association
    assert owner.api.store.read_checkpoint(ref=owner.parent.ref, checkpoint=parent_checkpoint) == before
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.load_prepared_config(
            ref=owner.parent.ref, parent_node=owner.parent, config_ref=selection.expected.predecessor.config_ref
        )
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.capture_confirmed_snapshot_identity(
            parent_node=owner.parent,
            parent_generation=0,
            agent_run_id=runtime_owner.run_id,
            agent_generation=0,
            binding=selection.relation.successor,
        )


def json_tool_preparation(
    owner: ProtectedOwner, *, recovery: bool, schema_changed: bool = False
) -> PreparedAgentOperation:
    """Captured public schema + explicit assessment DOMAIN DATA; no live assessor.

    This exercises the shared pure constructor. It is not PluginDaemon metadata
    freshness, a model-produced assessment, ordinary policy reachability or E2E.
    """
    from core.tools.entities.tool_entities import ToolEntity
    from runtime_contracts.builder.native.contracts import OperationKey
    from services.dify_builder.native_testing.agent_operations import (
        AgentCallAssessment,
        AgentOperationService,
        AgentResolvedTool,
    )
    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolMetadata

    catalogue = json.loads((Path(__file__).parent / "fixtures/json_process_0_0_9.public.json").read_text())
    entity = ToolEntity.model_validate(
        {
            **catalogue["parse_tool"],
            "identity": {**catalogue["parse_tool"]["identity"], "provider": "langgenius/json_process/json_process"},
        }
    )
    assert entity.description is not None
    if schema_changed:
        entity = ToolEntity.model_validate(
            {
                **entity.model_dump(mode="json"),
                "description": {
                    **entity.description.model_dump(mode="json"),
                    "llm": "Changed schema under the same implementation pin",
                },
            }
        )
    target = {"provider_type": "builtin", "provider_id": "langgenius/json_process/json_process", "tool_name": "parse"}
    parameters = {"content": '{"fixture":"retained"}', "json_filter": "$.fixture"}
    assessment = AgentCallAssessment(
        action="parse",
        account_label=None,
        target_summary=target,
        parameters_summary=parameters,
        risk_notice="Domain fixture: parse one supplied JSON value; plugin internals remain opaque.",
        destructive=False,
    )
    tool = AgentResolvedTool(
        "builtin",
        target["provider_id"],
        "parse",
        None,
        AgentToolMetadata(entity, catalogue["plugin_pin"], False),
        {"ensure_ascii": True},
        None,
        None,
        True,
    )
    definition = NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed").load_definition(
        context=owner.context, node_id="agent"
    )
    path = (
        (owner.parent.execution_id, "recovery", "1", "core_tool", "call")
        if recovery
        else (owner.parent.execution_id, "core_tool", "call")
    )
    owned = owner.api.loader.load(ref=owner.parent.ref)
    return AgentOperationService._tool_preparation(
        context=owner.context,
        definition=definition,
        tool=tool,
        target=target,
        parameters=parameters,
        parent=owner.parent,
        key=OperationKey(invocation_id=owner.parent.ref.invocation_id, occurrence_path=path, cursor=0),
        assessment=assessment,
        expires_at=owned.expires_at,
    )


def test_captured_public_core_tool_data_stages_inert_rows_and_graph(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none", core_tool_pending=True)
    fresh = json_tool_preparation(owner, recovery=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    entry = operations._stage_recovery_pending_one(
        ref=owner.parent.ref,
        expected=allocated.expected,
        predecessor_pending_id=allocated.checkpoint.pending_calls[0].pending_operation_id,
        fresh=fresh,
    )
    assert entry == operations._stage_recovery_pending_one(
        ref=owner.parent.ref,
        expected=allocated.expected,
        predecessor_pending_id=entry.predecessor_pending_id,
        fresh=fresh,
    )
    assert (
        operations._staged_recovery_operation(ref=owner.parent.ref, expected=allocated.expected, key=entry.intent.key)
        == fresh
    )
    selected = owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=(entry,)
    )
    assert entry.intent.kind == "tool"
    assert entry.intent.parameters == allocated.checkpoint.pending_calls[0].intent.parameters
    assert selected.relation.pending_operation_substitutions[0].successor_operation_id == entry.pending_id
    ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selected)
    assert ready.phase == "ready"
    assert owner.api.store.load_selected_recovery(ref=owner.parent.ref, parent_node=owner.parent) == selected.relation
    current = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    assert current.workspace.workspace_generation == 1
    assert current.config_ref == selected.config_receipt.id
    with owner.api.sessions() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        assert state.pending_ids == [entry.predecessor_pending_id]
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeEffectAttempt.id)) is None
        assert session.scalar(select(NativeEffectDispatchClaim.id)) is None


@pytest.mark.parametrize("pinned_home", [False], indirect=True)
def test_generation_one_blank_home_requires_selected_relation_and_isolated_admission_stays_pinned(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from shellctl.shared.schemas import NativeScopeLimits

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService

    owner = protected_owner
    isolated = AgentTestWorkspaceService(
        owner.api.loader,
        state_store=owner.api.store,
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
    with pytest.raises(BuilderExecutionPolicyError, match="native_pinned_home_unavailable"):
        isolated.prepare(
            ref=owner.parent.ref, pinned_snapshot_id=owner.scope.agent_config_snapshot_id, input_file_refs=()
        )
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    assert selection.expected.home_snapshot_id is None
    with owner.api.sessions.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
        )
        assert invocation is not None
        previous = invocation.bindings
        allocation = {
            **previous[ALLOCATION],
            "workspace": {**previous[ALLOCATION]["workspace"], "workspace_generation": 1},
        }
        invocation.bindings = {**previous, ALLOCATION: allocation}
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    with owner.api.sessions.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
        )
        assert invocation is not None
        invocation.bindings = previous
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    current = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    assert current.workspace.workspace_generation == 1
    assert current.workspace.home_snapshot_id is None
    assert owner.api.store.load_selected_recovery(ref=owner.parent.ref, parent_node=owner.parent) == selection.relation


@pytest.mark.parametrize("drift", ["home_ref", "soul"])
def test_selected_graph_rechecks_original_home_and_definition_pins(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, drift: str
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    with owner.api.sessions.begin() as session:
        if drift == "home_ref":
            home = session.get(AgentHomeSnapshot, selection.expected.home_snapshot_id)
            assert home is not None
            home.snapshot_ref = "different-home-bytes-owner"
        else:
            snapshot = session.get(AgentConfigSnapshot, owner.scope.agent_config_snapshot_id)
            assert snapshot is not None
            snapshot.config_snapshot = AgentSoulConfig.model_validate(
                {**snapshot.config_snapshot_dict, "config_note": "changed"}
            )
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_pin_mismatch"):
        owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)


def test_concurrent_allocated_role_producers_share_one_stored_receipt(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none")
    value: dict[str, JsonValue] = {
        "protocol_version": 1,
        "kind": "empty-bootstrap-v1",
        "home_snapshot_id": allocated.expected.home_snapshot_id,
        "home_snapshot_digest": allocated.expected.home_snapshot_digest,
    }
    start = Barrier(4)

    def stage() -> ObjectReceipt:
        start.wait(timeout=10)
        return owner.api.store.stage_recovery_object(
            ref=owner.parent.ref, expected=allocated.expected, role="reconstruction", value=value
        )

    with ThreadPoolExecutor(max_workers=4) as workers:
        receipts = list(workers.map(lambda _index: stage(), range(4)))
    assert all(receipt == receipts[0] for receipt in receipts)
    with owner.api.sessions() as session:
        rows = list(
            session.scalars(
                select(NativePayloadObject).where(
                    NativePayloadObject.request_id == owner.parent.ref.request_id,
                    NativePayloadObject.logical_key
                    == "agent-recovery:" + allocated.expected.attempt_id + ":reconstruction",
                )
            )
        )
        assert len(rows) == 1
        assert rows[0].id == receipts[0].id
        assert rows[0].value_digest == canonical_digest(value)


@pytest.mark.parametrize("substitution", ["predecessor_join", "successor_key_digest"])
def test_recovery_staging_refuses_pending_operation_join_substitution(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, substitution: str
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none", core_tool_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    old_id = allocated.checkpoint.pending_calls[0].pending_operation_id
    fresh = json_tool_preparation(owner, recovery=True)
    if substitution == "predecessor_join":
        with owner.api.sessions.begin() as session:
            pending = session.get(NativePendingAction, old_id)
            assert pending is not None
            operation = session.get(NativeEffectOperation, pending.operation_id)
            assert operation is not None
            operation.operation_digest = "f" * 64
        with pytest.raises(BuilderExecutionPolicyError):
            operations._stage_recovery_pending_one(
                ref=owner.parent.ref, expected=allocated.expected, predecessor_pending_id=old_id, fresh=fresh
            )
    else:
        entry = operations._stage_recovery_pending_one(
            ref=owner.parent.ref, expected=allocated.expected, predecessor_pending_id=old_id, fresh=fresh
        )
        with owner.api.sessions.begin() as session:
            pending = session.get(NativePendingAction, entry.pending_id)
            assert pending is not None
            operation = session.get(NativeEffectOperation, pending.operation_id)
            assert operation is not None
            operation.operation_digest = "f" * 64
        with pytest.raises(BuilderExecutionPolicyError):
            owner.api.store.prepare_recovery_selection(
                ref=owner.parent.ref, expected=allocated.expected, pending=(entry,)
            )


@pytest.mark.parametrize("substitution", ["config_bytes", "relation", "receipt_set"])
def test_selected_proof_rechecks_decoded_bytes_and_complete_receipts_under_root(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, substitution: str
) -> None:
    from dataclasses import replace

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    prepared = owner.api.store._agent_prepare(ref=owner.parent.ref, parent_node=owner.parent, writing=False)
    proof = prepared.recovery
    assert proof is not None
    if substitution == "config_bytes":
        invalid = replace(proof, config=proof.config.model_copy(update={"config": {"changed": True}}))
    elif substitution == "relation":
        invalid = replace(proof, relation=proof.relation.model_copy(update={"agent_run_id": "substituted-child"}))
    else:
        invalid = replace(proof, receipts=())
    with pytest.raises(BuilderExecutionPolicyError):
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
            owner.api.store._recheck_selected_recovery(session=session, owned=owned, parent=owner.parent, proof=invalid)


def test_same_plugin_pin_with_changed_current_tool_schema_cannot_stage(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none", core_tool_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    changed = json_tool_preparation(owner, recovery=True, schema_changed=True)
    old = allocated.checkpoint.pending_calls[0].intent
    assert changed.intent.implementation_revision == old.implementation_revision
    assert changed.intent.capability_digest != old.capability_digest
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_drift"):
        operations._stage_recovery_pending_one(
            ref=owner.parent.ref,
            expected=allocated.expected,
            predecessor_pending_id=allocated.checkpoint.pending_calls[0].pending_operation_id,
            fresh=changed,
        )
    with owner.api.sessions() as session:
        rows = list(
            session.scalars(
                select(NativePendingAction).where(NativePendingAction.request_id == owner.parent.ref.request_id)
            )
        )
        assert len(rows) == 1
        assert rows[0].id == allocated.checkpoint.pending_calls[0].pending_operation_id


def selected_shell_metadata(
    owner: ProtectedOwner,
    *,
    require_unacknowledged: bool = True,
) -> tuple[AgentOperationService, dict[str, JsonValue], SelectedRecovery]:
    """Read actual selected metadata; this neither assesses nor invokes a shell."""
    from services.dify_builder.native_testing.agent_confirmed_workspace import current_confirmed_workspace
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    prepared = owner.api.store._agent_prepare(ref=owner.parent.ref, parent_node=owner.parent, writing=False)
    proof = prepared.recovery
    assert proof is not None
    if require_unacknowledged:
        assert proof.record.sdk_receipt_ref is None
        assert proof.record.successor_wait_ref is None
    definition = NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed").load_definition(
        context=prepared.context, node_id=owner.scope.node_id
    )
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
        allocation = owned.bindings[ALLOCATION]
        workspace, stamp = current_confirmed_workspace(
            session=session, owned=owned, context=prepared.context, allocation=allocation, recovery=proof
        )
    nodes = prepared.context.graph["nodes"]
    assert isinstance(nodes, list)
    assert len(nodes) == 1
    descriptor: dict[str, JsonValue] = {
        "node_id": definition.node_id,
        "agent_id": definition.agent_id,
        "snapshot_id": definition.snapshot_id,
        "snapshot_digest": canonical_digest(definition.soul.model_dump(mode="json")),
        "graph_revision": prepared.context.graph_revision,
        "credential_id": None,
        "provider_id": "workspace-shell",
        "account_ref": None,
        "verified_plugin": False,
        "shell_boundary": "shell_run",
        "workspace": workspace.model_dump(mode="json"),
        "workspace_allocation": allocation,
        "workspace_stamp": stamp,
        "workflow_native_run_id": prepared.context.native_run_id,
        "graph_node": nodes[0],
        "composition_digest": proof.config.config_digest,
        "parent_node": owner.parent.model_dump(mode="json"),
        "config_ref": proof.config.config_ref,
    }
    return (
        AgentOperationService(loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor),
        descriptor,
        proof,
    )


@pytest.mark.parametrize("reader", ["shell", "sql"])
def test_selected_generation_one_shell_metadata_and_resource_reads_keep_actual_proof(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, reader: str
) -> None:
    from services.dify_builder.native_testing.agent_operations import _sql_resource

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    operations, descriptor, proof = selected_shell_metadata(owner)
    if reader == "shell":
        context, _definition, endpoint, configs = operations._shell(
            ref=owner.parent.ref,
            boundary="shell_run",
            target={"shell": "shell"},
            parameters={"script": "true"},
            descriptor=descriptor,
        )
        assert context.ref == owner.parent.ref
        assert endpoint.config == proof.config
        assert configs["workspace_stamp"] == descriptor["workspace_stamp"]
        assert configs["recovery"] == proof
    else:
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
            _sql_resource(session=session, owned=owned, descriptor=descriptor, recovery=proof)
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeEffectAttempt.id)) is None
        assert session.scalar(select(NativeEffectDispatchClaim.id)) is None


@pytest.mark.parametrize("proof_state", ["omitted", "forged", "stale"])
def test_selected_shell_resource_recheck_refuses_missing_or_changed_proof(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, proof_state: str
) -> None:
    from dataclasses import replace

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_operations import _sql_resource
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY

    owner = protected_owner
    selection = prepared_successor(owner, runtime_owner, substitution="none")
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    _operations, descriptor, original = selected_shell_metadata(owner)
    proof = (
        None if proof_state == "omitted" else replace(original, receipts=()) if proof_state == "forged" else original
    )
    if proof_state == "stale":
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
            invocation = session.scalar(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
            )
            assert invocation is not None
            # A different existing receipt is not a selected relation. The
            # captured proof must fail rather than adopt this pointer change.
            invocation.bindings = {
                **invocation.bindings,
                RECOVERY_RECORD_KEY: {
                    **invocation.bindings[RECOVERY_RECORD_KEY],
                    "successor_object_ref": selection.config_receipt.id,
                },
            }
    with pytest.raises(BuilderExecutionPolicyError):
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
            _sql_resource(session=session, owned=owned, descriptor=descriptor, recovery=proof)
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeEffectAttempt.id)) is None
        assert session.scalar(select(NativeEffectDispatchClaim.id)) is None


def test_ordinary_shell_metadata_retains_no_recovery_proof(protected_owner: ProtectedOwner) -> None:
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    config = owner.api.store.load_prepared_config(ref=owner.parent.ref, parent_node=owner.parent, config_ref=None)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    _context, _definition, endpoint, configs = operations._shell(
        ref=owner.parent.ref,
        boundary="shell_run",
        target={"shell": "shell"},
        parameters={"script": "true"},
        descriptor={
            "node_id": owner.scope.node_id,
            "parent_node": owner.parent.model_dump(mode="json"),
            "config_ref": config.config_ref,
        },
    )
    assert endpoint.config == config
    assert config.workspace.workspace_generation == 0
    assert configs["recovery"] is None


def assert_selected_ledger_drift_refused(
    owner: ProtectedOwner, old_id: str, fresh_id: str, read: Callable[[], object]
) -> None:
    """Substitute each real old/fresh ledger join, then restore its original value."""
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    for pending_id in (old_id, fresh_id):
        with owner.api.sessions() as session:
            row = session.get(NativePendingAction, pending_id)
            assert row is not None
            other = session.get(NativePendingAction, fresh_id if pending_id == old_id else old_id)
            assert other is not None
            assert other.operation_id is not None
            operation = session.get(NativeEffectOperation, row.operation_id)
            assert operation is not None
            operation_id = operation.id
            changes = (
                (NativeEffectOperation, "operation_digest", operation.operation_digest, "0" * 64),
                (NativeEffectOperation, "intent_digest", operation.intent_digest, "0" * 64),
                (NativeEffectOperation, "scope_digest", operation.scope_digest, "0" * 64),
                (NativePendingAction, "reference", row.reference, str(uuid4())),
                (NativePendingAction, "operation_id", row.operation_id, other.operation_id),
                (NativePendingAction, "reference_digest", row.reference_digest, "0" * 64),
                (NativePendingAction, "owner_version", row.owner_version, "0" * 64),
                (NativePendingAction, "owner_ref", row.owner_ref, str(uuid4())),
            )
        for model, field, original, changed in changes:
            identity = operation_id if model is NativeEffectOperation else pending_id
            with owner.api.sessions.begin() as session:
                session.execute(update(model).where(model.id == identity).values({field: changed}))
            try:
                with pytest.raises(BuilderExecutionPolicyError):
                    read()
                with owner.api.sessions() as session:
                    assert session.scalar(select(NativeEffectGrant.id)) is None
            finally:
                with owner.api.sessions.begin() as session:
                    session.execute(update(model).where(model.id == identity).values({field: original}))


def test_recovery_predecessor_reads_only_current_protected_selection(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    """SDK owner reads the actual selected graph through the protected core port."""
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner = protected_owner
    allocated = allocated_successor(owner, runtime_owner, substitution="none", model_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    pending = operations.stage_recovery_pending(ref=owner.parent.ref, expected=allocated.expected)
    selection = owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=pending
    )
    ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    assert ready.phase == "ready"
    relation = selection.relation
    assert_selected_ledger_drift_refused(
        owner,
        pending[0].predecessor_pending_id,
        pending[0].pending_id,
        lambda: owner.api.store.read_recovery_predecessor_result(
            ref=owner.parent.ref, parent_node=owner.parent, selection=relation, result_ref=selection.relation_receipt.id
        ),
    )
    for result_ref in (
        selection.relation_receipt.id,
        selection.reconstruction_receipt.id,
        selection.checkpoint_receipt.id,
    ):
        actual = owner.api.store.read_recovery_predecessor_result(
            ref=owner.parent.ref, parent_node=owner.parent, selection=relation, result_ref=result_ref
        )
        assert actual == owner.api.store._read_object(
            next(
                receipt
                for receipt in (
                    selection.relation_receipt,
                    selection.reconstruction_receipt,
                    selection.checkpoint_receipt,
                )
                if receipt.id == result_ref
            )
        )
    for binding in (relation.predecessor, relation.successor):
        actual = owner.api.store.read_recovery_predecessor_result(
            ref=owner.parent.ref, parent_node=owner.parent, selection=relation, result_ref=binding.config_ref
        )
        assert actual["config_ref"] == binding.config_ref
        assert actual["config_digest"] == binding.config_digest
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.read_recovery_predecessor_result(
            ref=owner.parent.ref, parent_node=owner.parent, selection=relation, result_ref=str(uuid4())
        )


def test_actual_sdk_receipt_is_acknowledged_without_selecting_wait(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    """Consume the durable Redis receipt from the production SDK owner over HTTP."""
    from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest
    from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest
    from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
    from dify_agent.runtime.native_continuation import NativeContinuationConflict

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    pending = operations.stage_recovery_pending(ref=owner.parent.ref, expected=allocated.expected)
    with owner.api.sessions() as session:
        continuation = session.scalar(
            select(NativeContinuation).where(NativeContinuation.request_id == owner.parent.ref.request_id)
        )
        assert continuation is not None
        original_parent = (continuation.checkpoint_id, continuation.payload_digest, continuation.payload_ref)
    original_bytes = storage.load(original_parent[2])
    selection = owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=pending
    )
    ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.lifecycle.check_resume(
            actor=owner.api.loader.actor,
            request_id=owner.parent.ref.request_id,
            expected_generation=ready.parent_generation,
        )
    runtime.recovery_selection.append(selection.relation)
    portal = runtime.http.portal
    assert portal is not None

    async def install() -> InstallConfirmedRecoverySuccessorReceipt:
        async with AgentRuntimeHTTPClient(api_url=runtime.base_url, api_token="fixture") as http:
            runtime.store.confirmed_recovery_owner = ConfirmedNativeContinuationOwner(
                http_client=http, base_url=runtime.base_url
            )
            request = InstallConfirmedRecoverySuccessorRequest(
                successor=selection.relation,
                successor_object_ref=selection.relation_receipt.id,
                successor_digest=selection.relation_receipt.value_digest,
            )
            receipt = await runtime.store.install_confirmed_recovery_successor(request)
            assert await runtime.store.install_confirmed_recovery_successor(request) == receipt
            return receipt

    before_install = portal.call(lambda: runtime.store.get_run(runtime.run_id))
    with owner.api.sessions.begin() as session:
        fresh = session.get(NativePendingAction, pending[0].pending_id)
        assert fresh is not None
        operation = session.get(NativeEffectOperation, fresh.operation_id)
        assert operation is not None
        old_digest = operation.operation_digest
        operation.operation_digest = "0" * 64
    with pytest.raises(NativeContinuationConflict):
        portal.call(install)
    assert portal.call(lambda: runtime.store.get_run(runtime.run_id)) == before_install
    with owner.api.sessions.begin() as session:
        fresh = session.get(NativePendingAction, pending[0].pending_id)
        assert fresh is not None
        operation = session.get(NativeEffectOperation, fresh.operation_id)
        assert operation is not None
        operation.operation_digest = old_digest
    receipt = portal.call(install)
    assert_selected_ledger_drift_refused(
        owner,
        pending[0].predecessor_pending_id,
        pending[0].pending_id,
        lambda: owner.api.store.acknowledge_recovery_sdk_receipt(ref=owner.parent.ref, expected=ready, receipt=receipt),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.acknowledge_recovery_sdk_receipt(
            ref=owner.parent.ref,
            expected=ready,
            receipt=receipt.model_copy(update={"config_digest": "0" * 64}),
        )
    acknowledged = owner.api.store.acknowledge_recovery_sdk_receipt(
        ref=owner.parent.ref, expected=ready, receipt=receipt
    )
    assert acknowledged.sdk_receipt_ref is not None
    assert acknowledged.successor_wait_ref is None
    assert (
        owner.api.store.acknowledge_recovery_sdk_receipt(ref=owner.parent.ref, expected=ready, receipt=receipt)
        == acknowledged
    )
    selected = portal.call(
        lambda: runtime.store.read_native_checkpoint(
            run_id=runtime.run_id,
            request=ReadNativeCheckpointRequest(
                ref=selection.relation.parent_node.ref,
                expected_generation=receipt.agent_generation,
                waiting_event_id=receipt.waiting_event_id,
                config_ref=receipt.config_ref,
                config_digest=receipt.config_digest,
            ),
        )
    )
    with pytest.raises((BuilderExecutionPolicyError, ValueError)):
        owner.api.store.acknowledge_recovery_wait(
            ref=owner.parent.ref,
            expected=acknowledged,
            receipt=receipt,
            checkpoint=selected.checkpoint,
            event=selected.waiting_event.model_copy(update={"id": "1-1"}),
        )
    assert_selected_ledger_drift_refused(
        owner,
        pending[0].predecessor_pending_id,
        pending[0].pending_id,
        lambda: owner.api.store.acknowledge_recovery_wait(
            ref=owner.parent.ref,
            expected=acknowledged,
            receipt=receipt,
            checkpoint=selected.checkpoint,
            event=selected.waiting_event,
        ),
    )
    proof = owner.api.store.acknowledge_recovery_wait(
        ref=owner.parent.ref,
        expected=acknowledged,
        receipt=receipt,
        checkpoint=selected.checkpoint,
        event=selected.waiting_event,
    )
    assert (
        owner.api.store.acknowledge_recovery_wait(
            ref=owner.parent.ref,
            expected=acknowledged,
            receipt=receipt,
            checkpoint=selected.checkpoint,
            event=selected.waiting_event,
        )
        == proof
    )
    assert proof.selection.approvals[0].pending_id == pending[0].pending_id
    assert proof.value_digest != original_parent[1]
    assert storage.load(original_parent[2]) == original_bytes
    resolved = owner.api.pending.load(
        actor=owner.api.loader.actor, request_id=owner.parent.ref.request_id, pending_operation_id=pending[0].pending_id
    )
    assert resolved.recovery == proof
    assert owner.api.pending.load_terms(resolved=resolved) == pending[0].proposal.terms
    # Typed assessment is fixture domain data, not a model call or a grant.
    from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal
    from runtime_contracts.builder.native.contracts import EffectIntent, OperationKey
    from services.dify_builder.native_testing.agent_operations import AgentCallAssessment, AgentOperationBindingResolver
    from services.dify_builder.native_testing.repository import NativeBinding

    shell_operations, descriptor, shell_graph = selected_shell_metadata(owner, require_unacknowledged=False)
    context, definition, endpoint, layers = shell_operations._shell(
        ref=owner.parent.ref,
        boundary="shell_run",
        target={"shell": "shell"},
        parameters={"script": "true"},
        descriptor=descriptor,
    )
    assert layers["recovery"] == shell_graph
    key = OperationKey(
        invocation_id=owner.parent.ref.invocation_id,
        occurrence_path=(owner.parent.execution_id, "recovery", "1", "shell_run", "shell-call"),
        cursor=1,
    )
    shell_intent = EffectIntent(
        key=key,
        kind="shell",
        resource_ref=endpoint.config.workspace.binding_id,
        implementation_revision=definition.snapshot_id,
        account_ref=None,
        target={"shell": "shell"},
        parameters={"script": "true"},
        input_digest=owner.parent.input_digest,
        capability_digest=canonical_digest(
            {
                "definition": definition.stamp,
                "workspace": endpoint.config.workspace.model_dump(mode="json"),
                "composition": endpoint.config.config_digest,
                "boundary": "shell_run",
            }
        ),
    )
    shell_binding = NativeBinding(
        intent_digest=canonical_digest(shell_intent.model_dump(mode="json")),
        kind="shell",
        resource_ref=shell_intent.resource_ref,
        implementation_revision=shell_intent.implementation_revision,
        account_ref=None,
        capability_digest=shell_intent.capability_digest,
        resource_version=definition.stamp,
        credential_version=None,
        isolated=False,
        egress=True,
        new_data=True,
        destructive=False,
        approval_scope="operation",
        cost_units=1,
        budget={},
        execution_id=owner.parent.execution_id,
        invocation_digest=canonical_digest(shell_intent.model_dump(mode="json")),
    )
    shell_operations._persist(
        ref=owner.parent.ref,
        intent=shell_intent,
        proposal=NativeApprovalProposal(key=key, terms=pending[0].proposal.terms),
        assessment=AgentCallAssessment(
            action="shell",
            account_label=None,
            target_summary={"shell": "shell"},
            parameters_summary={"script": "true"},
            risk_notice="Typed fixture assessment.",
            destructive=False,
        ),
        descriptor=descriptor,
        binding=shell_binding,
        recovery=shell_graph,
    )
    shell_resolver = AgentOperationBindingResolver().for_operation(store=owner.api.store, ref=owner.parent.ref, key=key)
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
        assert shell_resolver.resolve_binding(session=session, owned=owned, key=key) == shell_binding

    bootstrap_target = {"shell": "shell", "runtime": layers["shell"].get("runtime")}
    bootstrap_descriptor = {**descriptor, "shell_boundary": "bootstrap"}
    _, _, _, bootstrap_layers = shell_operations._shell(
        ref=owner.parent.ref,
        boundary="bootstrap",
        target=bootstrap_target,
        parameters={"script": "true"},
        descriptor=bootstrap_descriptor,
    )
    assert bootstrap_layers["recovery"] == shell_graph
    bootstrap_key = OperationKey(
        invocation_id=owner.parent.ref.invocation_id,
        occurrence_path=(owner.parent.execution_id, "recovery", "1", "bootstrap", "bootstrap-call"),
        cursor=2,
    )
    bootstrap_intent = EffectIntent.model_validate(
        {
            **shell_intent.model_dump(mode="json"),
            "key": bootstrap_key.model_dump(mode="json"),
            "kind": "bootstrap",
            "target": bootstrap_target,
            "capability_digest": canonical_digest(
                {
                    "definition": definition.stamp,
                    "workspace": endpoint.config.workspace.model_dump(mode="json"),
                    "composition": endpoint.config.config_digest,
                    "boundary": "bootstrap",
                }
            ),
        }
    )
    bootstrap_binding = NativeBinding.model_validate(
        {
            **shell_binding.model_dump(mode="json"),
            "kind": "bootstrap",
            "intent_digest": canonical_digest(bootstrap_intent.model_dump(mode="json")),
            "invocation_digest": canonical_digest(bootstrap_intent.model_dump(mode="json")),
            "capability_digest": bootstrap_intent.capability_digest,
        }
    )
    shell_operations._persist(
        ref=owner.parent.ref,
        intent=bootstrap_intent,
        proposal=NativeApprovalProposal(key=bootstrap_key, terms=pending[0].proposal.terms),
        assessment=AgentCallAssessment(
            action="bootstrap",
            account_label=None,
            target_summary=bootstrap_target,
            parameters_summary={"script": "true"},
            risk_notice="Typed fixture assessment.",
            destructive=False,
        ),
        descriptor=bootstrap_descriptor,
        binding=bootstrap_binding,
        recovery=shell_graph,
    )
    bootstrap_resolver = AgentOperationBindingResolver().for_operation(
        store=owner.api.store, ref=owner.parent.ref, key=bootstrap_key
    )
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
        assert bootstrap_resolver.resolve_binding(session=session, owned=owned, key=bootstrap_key) == bootstrap_binding

    resolver = AgentOperationBindingResolver().for_operation(
        store=owner.api.store, ref=owner.parent.ref, key=resolved.intent.key
    )
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
        binding = resolver.resolve_binding(session=session, owned=owned, key=resolved.intent.key)
        assert binding.intent_digest == canonical_digest(resolved.intent.model_dump(mode="json"))
        with pytest.raises(BuilderExecutionPolicyError):
            AgentOperationBindingResolver().resolve_binding(session=session, owned=owned, key=resolved.intent.key)
        from dataclasses import replace

        assert resolver.recovery is not None
        forged = replace(resolver.recovery, proof=proof.model_copy(update={"value_digest": "0" * 64}))
        with pytest.raises(BuilderExecutionPolicyError):
            owner.api.store.recheck_recovery_pending_state(
                session=session, owned=owned, state=forged, original_checkpoint=resolved.checkpoint
            )
    with owner.api.sessions() as session:
        from services.dify_builder.native_testing.public_projection import decision_public_revision

        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        assert decision_public_revision(request.observations) == 1
        assert sum(record.get("public_decision_saved") is True for record in request.observations) == 0
        continuation = session.scalar(
            select(NativeContinuation).where(NativeContinuation.request_id == owner.parent.ref.request_id)
        )
        assert continuation is not None
        assert (continuation.checkpoint_id, continuation.payload_digest, continuation.payload_ref) == original_parent
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == owner.parent.ref.request_id)
        )
        assert state is not None
        assert state.pending_ids == [pending[0].pending_id]
        old = session.get(NativePendingAction, pending[0].predecessor_pending_id)
        assert old is not None
        old_operation = session.get(NativeEffectOperation, old.operation_id)
        assert old_operation is not None
        assert old_operation.state == "not_dispatched"
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY

    with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
        )
        assert invocation is not None
        record = dict(invocation.bindings[RECOVERY_RECORD_KEY])
        record["successor_wait_ref"] = selection.relation_receipt.id
        invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: record}
    with pytest.raises(BuilderExecutionPolicyError):
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
            resolver.resolve_binding(session=session, owned=owned, key=resolved.intent.key)
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, _owned, _scope):
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.parent.ref.request_id)
        )
        assert invocation is not None
        record = dict(invocation.bindings[RECOVERY_RECORD_KEY])
        record["successor_wait_ref"] = proof.object_ref
        invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: record}
    owner.api.disclosure = operations
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        action = session.get(NativePendingAction, pending[0].pending_id)
        assert request is not None
        assert action is not None
        session_id, scope_digest = request.session_id, action.owner_version
    public = owner.api.decide(
        actor=owner.api.loader.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=pending[0].pending_id,
        decision="confirm",
        scope_digest=scope_digest,
        expected_version=1,
        idempotency_key="fresh-recovery-approval",
    )
    assert public.decision_public_revision == 2
    assert public.pending[0].decision_status == "confirmed"
    owner.api.lifecycle.check_resume(
        actor=owner.api.loader.actor, request_id=owner.parent.ref.request_id, expected_generation=0
    )
    resumed = owner.api.lifecycle.resume(
        actor=owner.api.loader.actor,
        request_id=owner.parent.ref.request_id,
        expected_generation=0,
        idempotency_key="fixture-resume",
    )
    assert owner.api.lifecycle.claim_dispatch(
        ref=owner.parent.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id
    )
    restored = owner.api.lifecycle.claimed_resume_checkpoint(
        ref=owner.parent.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id
    )
    assert restored == resolved.checkpoint
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is not None


@pytest.mark.parametrize("later_decision", ["confirm", "deny"])
def test_authenticated_interaction_composes_known_allocation_and_fresh_wait(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, later_decision: str
) -> None:
    """Known allocation retries local work and installs/ACKs through real HTTP owners."""
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    backend = DifyAgentBackendRunClient(runtime.client)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    commands = ConfirmedAgentCommands(
        api=owner.api,
        continuation=ConfirmedAgentContinuation(
            loader=owner.api.loader,
            store=owner.api.store,
            operations=operations,
            backend=backend,
            lifecycle=owner.api.lifecycle,
        ),
        backend=backend,
        publish=None,
    )
    proof = commands.prepare_recovery_for_interaction(
        ref=owner.parent.ref,
        expected_parent_generation=allocated.expected.parent_generation,
        idempotency_key="actual-user-confirm",
    )
    assert proof is not None
    assert proof.selection.approvals[0].pending_id != allocated.checkpoint.pending_calls[0].pending_operation_id
    assert (
        commands.prepare_recovery_for_interaction(
            ref=owner.parent.ref,
            expected_parent_generation=allocated.expected.parent_generation,
            idempotency_key="actual-user-confirm-reconnect",
        )
        == proof
    )
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None

    from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding
    from dify_agent.protocol.snapshot import SessionSnapshot

    protected = commands.load_wait(ref=owner.parent.ref, parent_node=owner.parent)
    assert protected is not None
    assert protected.wait == proof.selection.wait
    owner.api.disclosure = operations
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        fresh = session.get(NativePendingAction, proof.selection.approvals[0].pending_id)
        assert request is not None
        assert fresh is not None
        session_id, scope_digest = request.session_id, fresh.owner_version
    stale = commands.decide(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=allocated.checkpoint.pending_calls[0].pending_operation_id,
        decision="confirm",
        scope_digest=scope_digest,
        expected_version=1,
        idempotency_key="stale-old-confirm",
    )
    assert stale.decision_public_revision == 1
    assert stale.pending[0].pending_operation_id == proof.selection.approvals[0].pending_id
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
    unapproved_resume = commands.resume(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        expected_generation=0,
        idempotency_key="fresh-wait-still-requires-approval",
    )
    assert unapproved_resume.generation == 0
    assert not unapproved_resume.can_resume
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeDispatch.id)) is None
    commands.decide(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=proof.selection.approvals[0].pending_id,
        decision="confirm",
        scope_digest=scope_digest,
        expected_version=1,
        idempotency_key="explicit-fresh-confirm",
    )
    resumed = owner.api.lifecycle.resume(
        actor=owner.api.actor,
        request_id=owner.parent.ref.request_id,
        expected_generation=0,
        idempotency_key="ordinary-parent-resume",
    )
    assert owner.api.lifecycle.claim_dispatch(
        ref=owner.parent.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id
    )
    portal = runtime.http.portal
    assert portal is not None
    relation = owner.api.store.load_selected_recovery(ref=owner.parent.ref, parent_node=owner.parent)
    assert relation is not None
    claim = portal.call(
        lambda: runtime.store.claim_continuation(
            run_id=runtime.run_id,
            expected_generation=proof.selection.wait.agent_generation,
            idempotency_key="ordinary-sdk-resume",
            expected_config_digest=relation.successor.config_digest,
        )
    )
    assert portal.call(lambda: runtime.store.start_continuation(claim))
    continued = commands.continue_wait(ref=owner.parent.ref, parent_node=owner.parent)
    assert continued.wait == proof.selection.wait
    identity = commands.capture_session_snapshot_identity(
        parent_node=owner.parent,
        parent_generation=resumed.generation,
        agent_run_id=runtime.run_id,
        agent_generation=claim.generation,
        binding=AgentRecoveryBinding.model_validate(relation.successor.model_dump(mode="json")),
    )
    commands.save_session_snapshot(
        identity=identity,
        session_scope=owner.scope,
        snapshot=SessionSnapshot(layers={"runtime": {}, "shell": {"initialized": False}}),
    )

    # Explicit typed next-call domain input: no provider/model result is invented.
    from dify_agent.protocol.native_continuation import AgentCheckpoint, AgentPendingCall
    from dify_agent.protocol.native_testing import AgentEffectIntent

    from runtime_contracts.builder.native.contracts import OperationKey, operation_digest
    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService, _scope_digest

    definition = NativeAgentRuntimeConfigBuilder(loader=owner.api.loader, profile="confirmed").load_definition(
        context=owner.api.store.load_context(ref=owner.parent.ref), node_id="agent"
    )
    next_call = operations._model_operation(
        ref=owner.parent.ref,
        key=OperationKey(
            invocation_id=owner.parent.ref.invocation_id,
            occurrence_path=(owner.parent.execution_id, "recovery", "1", "model", "next-call"),
            cursor=1,
        ),
        target=operations._model_target(definition),
        parameters={},
        parent=owner.parent,
        descriptor={"node_id": "agent"},
    )
    operations._persist(
        ref=owner.parent.ref,
        intent=next_call.intent,
        proposal=next_call.proposal,
        assessment=next_call.assessment,
        descriptor=next_call.descriptor,
        binding=next_call.binding,
        recovery=identity.recovery.graph if identity.recovery is not None else None,
    )
    with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
        operation = NativeEffectOperation(
            tenant_id=owned.tenant_id,
            request_id=owned.ref.request_id,
            invocation_id=owned.ref.invocation_id,
            operation_digest=operation_digest(next_call.intent.key),
            intent_digest=canonical_digest(next_call.intent.model_dump(mode="json")),
            scope_digest=_scope_digest(next_call.intent, next_call.binding),
            state="pending",
            result_ref=None,
        )
        session.add(operation)
        session.flush()
        next_pending = EffectAuthorizationService._pending(session, owned, operation)
    assert identity.recovery is not None
    next_sdk = AgentCheckpoint.model_validate(
        {
            **identity.recovery.graph.checkpoint.model_dump(mode="json"),
            "generation": 1,
            "operation_cursor": 1,
            "pending_calls": [
                AgentPendingCall(
                    call_id="next-call",
                    tool_name="next-model",
                    native_arguments={},
                    intent=AgentEffectIntent.model_validate(next_call.intent.model_dump(mode="json")),
                    stage="model",
                    pending_operation_id=next_pending.pending_operation_id,
                    wait_reason="approval",
                ).model_dump(mode="json")
            ],
        }
    )
    event_id = portal.call(
        lambda: runtime.store.persist_waiting(
            run_id=runtime.run_id, checkpoint=next_sdk, event=next_sdk.waiting_event()
        )
    )
    next_wait = owner.api.store.store_agent_wait(
        ref=owner.parent.ref,
        parent_node=owner.parent,
        association_object_ref=relation.successor.association_object_ref,
        agent_generation=1,
        checkpoint=next_sdk.model_dump(mode="json"),
        backend_wait_event_id=event_id,
    )
    assert owner.context.native_run_id is not None
    next_payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id=owner.context.native_run_id,
        generation=1,
        generate_entity_json="{}",
        graph_runtime_state_json=owner.api.store.read_checkpoint(
            ref=owner.parent.ref, checkpoint=proof.selection.original_checkpoint
        ).graph_runtime_state_json,
        response_stream_filter_json="{}",
        node_journals=(
            NodeJournalState(
                invocation_id=owner.parent.ref.invocation_id,
                occurrence_path=(owner.parent.execution_id,),
                input_result_ref=owner.parent.input_result_ref,
                input_digest=owner.parent.input_digest,
                cursor=0,
                operation_keys=(),
                result_refs=(),
            ),
            NodeJournalState(
                invocation_id=owner.parent.ref.invocation_id,
                occurrence_path=next_call.intent.key.occurrence_path,
                input_result_ref=owner.parent.input_result_ref,
                input_digest=owner.parent.input_digest,
                cursor=2,
                operation_keys=(next_call.intent.key,),
                intents=(next_call.intent,),
                result_refs=(),
            ),
        ),
        child_refs=(),
        input_result_refs=(owner.parent.input_result_ref,),
        approval_proposals=(next_call.proposal,),
        agent_associations=(next_wait,),
    )
    next_parent = owner.api.store.commit_checkpoint(ref=owner.parent.ref, generation=1, payload=next_payload)
    # A captured snapshot survives a legitimate later ordinary checkpoint.
    saved_snapshot = SessionSnapshot(layers={"runtime": {}, "shell": {"initialized": False}})
    commands.save_session_snapshot(identity=identity, session_scope=owner.scope, snapshot=saved_snapshot)
    with owner.api.sessions() as session:
        binding = session.get(AgentWorkspaceBinding, identity.binding.binding_id)
        assert binding is not None
        assert binding.session_snapshot == saved_snapshot.model_dump_json()
    owner.api.lifecycle.pause(
        ref=owner.parent.ref,
        checkpoint=next_parent,
        pending_operation_ids=(next_pending.pending_operation_id,),
        expected_generation=1,
    )
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    with owner.api.loader.locked(ref=owner.parent.ref, settlement=True) as (session, owned, scope):
        owner.api.lifecycle.finalize_dispatch_locked(
            session=session,
            owned=owned,
            scope=scope,
            dispatch_id=resumed.dispatch_id,
            generation=1,
            outcome=NativeWorkflowOutcome(
                status="waiting",
                ref=owner.parent.ref,
                native_run_id=owner.context.native_run_id,
                checkpoint_ref=next_parent,
                pending_operation_ids=(next_pending.pending_operation_id,),
                reason_code=None,
                wait_reason="approval",
                native_status=None,
                output_result_ref=None,
            ),
        )
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    with pytest.raises(BuilderExecutionPolicyError):
        commands.save_session_snapshot(identity=identity, session_scope=owner.scope, snapshot=saved_snapshot)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.store.load_recovery_pending_state(
            ref=owner.parent.ref, original_checkpoint=proof.selection.original_checkpoint
        )
    resolved_next = owner.api.pending.load(
        actor=owner.api.actor,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=next_pending.pending_operation_id,
    )
    assert resolved_next.checkpoint == next_parent
    assert owner.api.pending.load_terms(resolved=resolved_next) == next_call.proposal.terms
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from services.dify_builder.native_testing.state_store import invocation_state

    resolver = AgentOperationBindingResolver().for_operation(
        store=owner.api.store, ref=owner.parent.ref, key=next_call.intent.key
    )

    def resolve_after_pointer_swap() -> None:
        with owner.api.loader.locked(ref=owner.parent.ref) as (session, owned, _scope):
            invocation_state(
                session, owned.ref, owned.tenant_id
            ).checkpoint_id = proof.selection.original_checkpoint.checkpoint_id
            resolver.resolve_binding(session=session, owned=owned, key=next_call.intent.key)

    with pytest.raises(BuilderExecutionPolicyError):
        resolve_after_pointer_swap()
    with owner.api.sessions() as session:
        assert (
            session.scalar(select(NativeEffectGrant.id).where(NativeEffectGrant.scope_digest == operation.scope_digest))
            is None
        )
    if later_decision == "deny":
        with owner.api.sessions() as session:
            grants_before = len(session.scalars(select(NativeEffectGrant)).all())
        denied = commands.decide(
            actor=owner.api.actor,
            session_id=session_id,
            request_id=owner.parent.ref.request_id,
            pending_operation_id=next_pending.pending_operation_id,
            decision="deny",
            scope_digest=operation.scope_digest,
            expected_version=2,
            idempotency_key="explicit-next-ordinary-deny",
        )
        assert denied.outcome == "cancelled"
        assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"
        with owner.api.sessions() as session:
            assert len(session.scalars(select(NativeEffectGrant)).all()) == grants_before
        return
    public_next = owner.api.decide(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=next_pending.pending_operation_id,
        decision="confirm",
        scope_digest=operation.scope_digest,
        expected_version=2,
        idempotency_key="explicit-next-ordinary-confirm",
    )
    assert public_next.pending[0].decision_status == "confirmed"
    owner.api.lifecycle.check_resume(
        actor=owner.api.actor, request_id=owner.parent.ref.request_id, expected_generation=1
    )


def test_acknowledged_tool_recovery_retires_only_never_dispatched_history(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    """Actual SDK ACK leaves a terminally settled predecessor and a fresh approval.

    Terminal native state below is explicit domain input, not a physical Tool
    execution. It isolates the completion guard from the SDK handoff owner.
    """
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor
    from services.dify_builder.native_testing.confirmed_agent_commands import confirmed_parent_outcome
    from services.dify_builder.native_testing.confirmed_agent_completion import _terminal_proof

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", core_tool_pending=True)
    old_id = allocated.checkpoint.pending_calls[0].pending_operation_id
    with owner.api.sessions() as session:
        old = session.get(NativePendingAction, old_id)
        continuation = session.scalar(select(NativeContinuation))
        assert old is not None
        assert continuation is not None
        old_pending = asdict(old)
        original_continuation = asdict(continuation)
        original_bytes = storage.load(continuation.payload_ref)
    # Reuse captured public Tool metadata/typed assessment domain input. Live
    # plugin lookup and model risk reasoning are outside this owner regression.
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    entry = operations._stage_recovery_pending_one(
        ref=owner.parent.ref,
        expected=allocated.expected,
        predecessor_pending_id=old_id,
        fresh=json_tool_preparation(owner, recovery=True),
    )
    selection = owner.api.store.prepare_recovery_selection(
        ref=owner.parent.ref, expected=allocated.expected, pending=(entry,)
    )
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    commands = recovery_interaction_commands(owner, runtime)
    proof = commands.prepare_recovery_for_interaction(
        ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="retire-old-tool"
    )
    assert proof is not None
    assert (
        commands.prepare_recovery_for_interaction(
            ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="retire-old-tool-reconnect"
        )
        == proof
    )
    fresh_id = proof.selection.approvals[0].pending_id
    assert fresh_id != old_id
    with owner.api.sessions() as session:
        old = session.get(NativePendingAction, old_id)
        fresh = session.get(NativePendingAction, fresh_id)
        continuation = session.scalar(select(NativeContinuation))
        assert old is not None
        assert fresh is not None
        assert continuation is not None
        assert asdict(old) == old_pending
        assert asdict(continuation) == original_continuation
        assert storage.load(continuation.payload_ref) == original_bytes
        old_operation = session.get(NativeEffectOperation, old.operation_id)
        fresh_operation = session.get(NativeEffectOperation, fresh.operation_id)
        assert old_operation is not None
        assert fresh_operation is not None
        assert (old_operation.state, old_operation.result_ref) == ("not_dispatched", None)
        assert (fresh_operation.state, fresh_operation.result_ref) == ("pending", None)
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectOutcome):
            assert session.scalar(select(model.id).where(model.operation_id == old_operation.id)) is None
        assert session.scalar(select(NativeEffectGrant.id)) is None

        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        state = session.scalar(select(NativeInvocationState))
        native = session.get(WorkflowRun, owner.context.native_run_id)
        assert request is not None
        assert state is not None
        assert native is not None
        assert _terminal_proof(session, request=request, ref=owner.parent.ref) is None
        outcome = confirmed_parent_outcome(
            ref=owner.parent.ref,
            native_run_id=native.id,
            native_status="succeeded",
            operation_states=("completed", "not_dispatched"),
        )
        # This uncommitted terminal fixture is rolled back on session exit.
        state.state = "completed"
        state.pending_ids = []
        state.outcome = outcome.model_dump(mode="json")
        fresh_operation.state, fresh_operation.result_ref = "completed", "fixture-tool-result"
        native.status = WorkflowExecutionStatus.SUCCEEDED
        session.flush()
        assert _terminal_proof(session, request=request, ref=owner.parent.ref) == outcome
        for unsettled in ("cancelled", "claimed", "unknown"):
            old_operation.state = unsettled
            session.flush()
            assert _terminal_proof(session, request=request, ref=owner.parent.ref) is None

    # Existing ACKed rows remain readable without relabeling their history.
    with owner.api.sessions.begin() as session:
        session.execute(
            update(NativeEffectOperation)
            .where(NativeEffectOperation.id == old_pending["operation_id"])
            .values(state="cancelled")
        )
    selected = owner.api.store.load_recovery_pending_state(
        ref=owner.parent.ref, original_checkpoint=proof.selection.original_checkpoint
    )
    assert selected is not None
    assert selected.proof == proof
    with owner.api.sessions() as session:
        legacy = session.get(NativeEffectOperation, old_pending["operation_id"])
        assert legacy is not None
        assert legacy.state == "cancelled"


def recovery_interaction_commands(owner: ProtectedOwner, runtime: RuntimeOwner) -> ConfirmedAgentCommands:
    """Compose the production command/operation/continuation owners for boundary cases."""
    from services.dify_builder.native_testing.agent_operations import AgentOperationService
    from services.dify_builder.native_testing.agent_risk_assessor import builder_call_assessor

    backend = DifyAgentBackendRunClient(runtime.client)
    operations = AgentOperationService(
        loader=owner.api.loader, state_store=owner.api.store, assessor=builder_call_assessor
    )
    owner.api.disclosure = operations
    return ConfirmedAgentCommands(
        api=owner.api,
        continuation=ConfirmedAgentContinuation(
            loader=owner.api.loader,
            store=owner.api.store,
            operations=operations,
            backend=backend,
            lifecycle=owner.api.lifecycle,
        ),
        backend=backend,
        publish=None,
    )


def test_authenticated_recovery_read_refuses_credentials_refs_and_expired_scope(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    import base64

    from runtime_contracts.builder.execution import canonical_json

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    transport = {
        "agent_run_id": runtime.run_id,
        "parent_node": owner.parent.model_dump(mode="json"),
        "request_digest": selection.relation.predecessor.config_digest,
        "agent_generation": 0,
    }
    header = base64.urlsafe_b64encode(canonical_json(transport)).rstrip(b"=").decode()
    headers = {"Authorization": "Bearer fixture", "X-Dify-Agent-Run": header}
    native_ref = owner.parent.ref.model_dump(mode="json")
    body = {"ref": native_ref, "result_ref": selection.relation_receipt.id}
    url = runtime.base_url + "/inner/api/agent/runtime/native-testing/read-result"
    positive = runtime.http_client.post(url, json=body, headers=headers)
    assert positive.status_code == 200
    assert positive.json()["result"] == selection.relation.model_dump(mode="json")
    for authorization in (None, "Bearer incorrect"):
        refused = runtime.http_client.post(
            url,
            json=body,
            headers={
                key: value for key, value in {**headers, "Authorization": authorization}.items() if value is not None
            },
        )
        assert refused.status_code == 401
    for altered in ({**transport, "request_digest": "0" * 64}, {**transport, "agent_generation": 1}):
        changed = base64.urlsafe_b64encode(canonical_json(altered)).rstrip(b"=").decode()
        assert (
            runtime.http_client.post(url, json=body, headers={**headers, "X-Dify-Agent-Run": changed}).status_code
            == 409
        )
    for substituted in (
        {**body, "result_ref": owner.parent.input_result_ref},
        {**body, "ref": {**native_ref, "invocation_id": "foreign"}},
    ):
        assert runtime.http_client.post(url, json=substituted, headers=headers).status_code == 409
    with owner.api.sessions.begin() as session:
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        assert scope is not None
        scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert runtime.http_client.post(url, json=body, headers=headers).status_code == 409
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None


@pytest.mark.parametrize("boundary", ["sdk-installed", "sdk-acknowledged", "concurrent"])
def test_recovery_interaction_recovers_exact_durable_ack_without_allocation(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, boundary: str
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest
    from dify_agent.protocol.schemas import RunWaitingEvent

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_recovery import RecoveryPendingProof

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.lifecycle.resume(
            actor=owner.api.actor,
            request_id=owner.parent.ref.request_id,
            expected_generation=0,
            idempotency_key="partial-direct-resume",
        )
    receipt = None
    if boundary != "concurrent":
        receipt = runtime.client.install_confirmed_recovery_successor_sync(
            InstallConfirmedRecoverySuccessorRequest(
                successor=selection.relation,
                successor_object_ref=selection.relation_receipt.id,
                successor_digest=selection.relation_receipt.value_digest,
            )
        )
        if boundary == "sdk-acknowledged":
            owner.api.store.acknowledge_recovery_sdk_receipt(ref=owner.parent.ref, expected=ready, receipt=receipt)
        # Server committed the real receipt; the API has not selected any fresh wait.
        with pytest.raises(BuilderExecutionPolicyError):
            owner.api.lifecycle.check_resume(
                actor=owner.api.actor, request_id=owner.parent.ref.request_id, expected_generation=0
            )

    def interact() -> RecoveryPendingProof | None:
        try:
            return commands.prepare_recovery_for_interaction(
                ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="same-authenticated-confirm"
            )
        except BuilderExecutionPolicyError:
            return None  # A losing exact SQL compare remains fenced; reconnect reads the winner.

    if boundary == "concurrent":
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _index: interact(), range(2)))
        assert any(result is not None for result in results)
    else:
        assert interact() is not None
    proof = interact()
    assert proof is not None
    if receipt is not None:
        assert proof.selection.wait.backend_wait_event_id == receipt.waiting_event_id
    events = runtime.client.get_events_sync(runtime.run_id)
    waits = [event for event in events.events if isinstance(event, RunWaitingEvent)]
    assert len(waits) == 2  # One original wait and exactly one installed fresh wait.
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert len(session.scalars(select(AgentWorkspaceBinding)).all()) == 2
        dispatches = session.scalars(select(NativeDispatch)).all()
        assert len(dispatches) == 0


def test_recovery_unavailable_sdk_stays_ready_without_wait_or_dispatch(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_recovery import recovery_record

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    # Actual SDK owner absence yields its real HTTP409; no invented response or retry.
    runtime.store.confirmed_recovery_owner = None
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_handshake_unavailable"):
        commands.prepare_recovery_for_interaction(
            ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="sdk-unavailable-confirm"
        )
    assert recovery_record(owner.api.loader.load(ref=owner.parent.ref).bindings) == ready
    with pytest.raises(BuilderExecutionPolicyError):
        owner.api.lifecycle.resume(
            actor=owner.api.actor,
            request_id=owner.parent.ref.request_id,
            expected_generation=0,
            idempotency_key="sdk-unavailable-direct-resume",
        )
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeDispatch.id)) is None


@pytest.mark.parametrize("boundary", ["allocated", "ready", "sdk-installed", "wait-acknowledged"])
@pytest.mark.parametrize("expired", [False, True])
def test_recovery_cancel_stops_same_child_without_handshake_authority(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, boundary: str, expired: bool
) -> None:
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest

    from services.dify_builder.native_testing.confirmed_agent_cancellation import PREPARATION

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    session_id = owner.api.loader.load(ref=owner.parent.ref).session_id
    if boundary != "allocated":
        selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
        owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
        if boundary == "sdk-installed":
            runtime.client.install_confirmed_recovery_successor_sync(
                InstallConfirmedRecoverySuccessorRequest(
                    successor=selection.relation,
                    successor_object_ref=selection.relation_receipt.id,
                    successor_digest=selection.relation_receipt.value_digest,
                )
            )
        if boundary == "wait-acknowledged":
            assert (
                commands.prepare_recovery_for_interaction(
                    ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="before-cancel"
                )
                is not None
            )
    if expired:
        with owner.api.sessions.begin() as session:
            scope = session.get(NativeTestScope, owner.parent.ref.request_id)
            assert scope is not None
            scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    receipt = commands.cancel(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        idempotency_key="recovery-cancel",
    )
    assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"
    assert ("POST", "/execution-bindings") not in runtime.requests
    assert receipt.outcome == "cancelled"
    assert receipt.cancellation is not None
    assert receipt.cancellation.status == "cancelling"
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        assert len([record for record in request.observations if PREPARATION in record]) == 1
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeDispatch.id)) is None
        assert len(session.scalars(select(AgentWorkspaceBinding)).all()) == (1 if boundary == "allocated" else 2)


@pytest.mark.parametrize("boundary", ["creating", "allocated", "ready", "sdk-installed", "sdk-acknowledged"])
def test_recovery_terminal_denial_revokes_without_grant_or_handshake(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, boundary: str
) -> None:
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest

    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    session_id = owner.api.loader.load(ref=owner.parent.ref).session_id
    old_id = allocated.checkpoint.pending_calls[0].pending_operation_id
    if boundary == "creating":
        with owner.api.sessions.begin() as session:
            invocation = session.scalar(select(NativeTestInvocation))
            assert invocation is not None
            record = allocated.expected.model_dump(mode="json")
            record.update(phase="creating", allocation_receipt_ref=None)
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: record}
    if boundary not in {"creating", "allocated"}:
        selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
        ready = owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
        if boundary in {"sdk-installed", "sdk-acknowledged"}:
            sdk = runtime.client.install_confirmed_recovery_successor_sync(
                InstallConfirmedRecoverySuccessorRequest(
                    successor=selection.relation,
                    successor_object_ref=selection.relation_receipt.id,
                    successor_digest=selection.relation_receipt.value_digest,
                )
            )
            if boundary == "sdk-acknowledged":
                owner.api.store.acknowledge_recovery_sdk_receipt(ref=owner.parent.ref, expected=ready, receipt=sdk)
    with owner.api.sessions.begin() as session:
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        pending = session.get(NativePendingAction, old_id)
        assert scope is not None
        assert pending is not None
        scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        digest = pending.owner_version
    receipt = commands.decide(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        pending_operation_id=old_id,
        decision="deny",
        scope_digest=digest,
        expected_version=1,
        idempotency_key="partial-deny",
    )
    assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"
    assert ("POST", "/execution-bindings") not in runtime.requests
    assert receipt.outcome == "cancelled"
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeDispatch.id)) is None
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        denials = [
            record["native_terminal_denial"] for record in request.observations if "native_terminal_denial" in record
        ]
        assert len(denials) == 1
        assert denials[0]["pending_operation_id"] == old_id
        assert denials[0]["decision"] == "deny"


@pytest.mark.parametrize("ordering", ["cancel-first", "concurrent"])
def test_recovery_install_cancel_cas_keeps_same_child_revoked(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, ordering: str
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from dify_agent.client import DifyAgentHTTPError
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest
    from dify_agent.protocol.native_testing import ReadAgentRuntimeIdentity

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    session_id = owner.api.loader.load(ref=owner.parent.ref).session_id
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    install = InstallConfirmedRecoverySuccessorRequest(
        successor=selection.relation,
        successor_object_ref=selection.relation_receipt.id,
        successor_digest=selection.relation_receipt.value_digest,
    )

    def handoff() -> int:
        try:
            runtime.client.install_confirmed_recovery_successor_sync(install)
            return 200
        except DifyAgentHTTPError as error:
            return error.status_code

    def cancel() -> None:
        commands.cancel(
            actor=owner.api.actor,
            session_id=session_id,
            request_id=owner.parent.ref.request_id,
            idempotency_key="cas-cancel",
        )

    if ordering == "cancel-first":
        cancel()
        assert handoff() == 409
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            installing, cancelling = pool.submit(handoff), pool.submit(cancel)
            assert installing.result() in {200, 409}
            cancelling.result()
    assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"
    identities = []
    refused = []
    for digest in (selection.relation.predecessor.config_digest, selection.relation.successor.config_digest):
        try:
            identities.append(
                runtime.client.read_run_identity_sync(
                    runtime.run_id,
                    ReadAgentRuntimeIdentity(parent_node=selection.relation.parent_node, request_digest=digest),
                )
            )
        except DifyAgentHTTPError as error:
            refused.append(error.status_code)
    assert refused == [409]
    assert len(identities) == 1
    assert identities[0].run_id == runtime.run_id
    assert identities[0].parent_node == selection.relation.parent_node
    with owner.api.sessions() as session:
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        assert scope is not None
        assert scope.cancelled
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeDispatch.id)) is None


def test_recovery_discarded_cancel_ack_retries_after_revocation_and_resource_gc(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorRequest
    from dify_agent.protocol.schemas import RunCancelledEvent
    from sqlalchemy import delete

    from services.agent.workspace_service import AgentWorkspaceService
    from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    session_id = owner.api.loader.load(ref=owner.parent.ref).session_id
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    runtime.client.install_confirmed_recovery_successor_sync(
        InstallConfirmedRecoverySuccessorRequest(
            successor=selection.relation,
            successor_object_ref=selection.relation_receipt.id,
            successor_digest=selection.relation_receipt.value_digest,
        )
    )  # Discard durable install ACK at the API boundary.
    cancellation = ConfirmedAgentCancellation(commands)
    owner.api.lifecycle.cancel(actor=owner.api.actor, request_id=owner.parent.ref.request_id, idempotency_key="revoke")
    cancellation.prepare(ref=owner.parent.ref)
    commands.backend.cancel_run(runtime.run_id)  # Discard durable cancel ACK before any API terminal observation.
    with owner.api.sessions.begin() as session:
        assert owner.scope.workflow_run_id is not None
        retired = AgentWorkspaceService.retire_workflow_run(
            session=session,
            tenant_id=owner.scope.tenant_id,
            app_id=owner.scope.app_id,
            workflow_run_id=owner.scope.workflow_run_id,
        )
        assert retired
        # Explicit fixture post-GC SQL state; no physical collector/backend is run.
        bindings = session.scalars(select(AgentWorkspaceBinding)).all()
        assert all(binding.status == "retired" for binding in bindings)
        session.execute(delete(AgentWorkspaceBinding))
        session.execute(delete(AgentWorkspace))
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        assert scope is not None
        scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert cancellation.retry_children(ref=owner.parent.ref) == (runtime.run_id,)
    receipt = commands.cancel(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        idempotency_key="retry-discarded-cancel-ack",
    )
    assert receipt.outcome == "cancelled"
    assert (
        commands.get(actor=owner.api.actor, session_id=session_id, request_id=owner.parent.ref.request_id).outcome
        == "cancelled"
    )
    events = runtime.client.get_events_sync(runtime.run_id)
    assert len([event for event in events.events if isinstance(event, RunCancelledEvent)]) == 1
    with owner.api.sessions() as session:
        assert session.scalar(select(AgentWorkspaceBinding.id)) is None
        assert session.scalar(select(AgentWorkspace.id)) is None
        assert session.scalar(select(NativeEffectGrant.id)) is None


def test_recovery_running_cancel_acceptance_waits_for_actual_terminal_observation(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

    owner, runtime = protected_owner, runtime_owner
    allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    session_id = owner.api.loader.load(ref=owner.parent.ref).session_id
    portal = runtime.http.portal
    assert portal is not None
    claim = portal.call(
        lambda: runtime.store.claim_continuation(
            run_id=runtime.run_id, expected_generation=0, idempotency_key="running-protocol-boundary"
        )
    )
    assert portal.call(runtime.store.start_continuation, claim)
    first = commands.cancel(
        actor=owner.api.actor,
        session_id=session_id,
        request_id=owner.parent.ref.request_id,
        idempotency_key="running-cancel",
    )
    assert runtime.client.get_run_sync(runtime.run_id).status == "running"
    assert first.outcome is None
    assert not ConfirmedAgentCancellation(commands).settle(ref=owner.parent.ref)
    intent = portal.call(runtime.store.get_cancellation_intent, runtime.run_id)
    assert intent is not None
    terminal = portal.call(runtime.store.finalize_cancellation, runtime.run_id, intent)
    assert terminal.applied
    final = commands.get(actor=owner.api.actor, session_id=session_id, request_id=owner.parent.ref.request_id)
    assert final.outcome == "cancelled"
    assert final.cancellation is not None
    assert final.cancellation.status == "cancelling"
    # Real Redis running/terminal protocol boundaries; no worker process or
    # shell cleanup is executed or inferred from an accepted CancelRunResponse.


@pytest.mark.parametrize("fault", ["children", "parent-checkpoint", "pointer", "old-join", "fresh-join"])
def test_recovery_cancel_retained_history_refuses_substitution(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, fault: str
) -> None:
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY
    from services.dify_builder.native_testing.confirmed_agent_cancellation import (
        PREPARATION,
        ConfirmedAgentCancellation,
    )

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    proof = commands.prepare_recovery_for_interaction(
        ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="before-substitution"
    )
    assert proof is not None
    cancellation = ConfirmedAgentCancellation(commands)
    owner.api.lifecycle.cancel(actor=owner.api.actor, request_id=owner.parent.ref.request_id, idempotency_key="revoke")
    cancellation.prepare(ref=owner.parent.ref)
    commands.backend.cancel_run(runtime.run_id)
    with owner.api.sessions.begin() as session:
        if fault in {"children", "parent-checkpoint"}:
            request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
            assert request is not None
            observations = json.loads(json.dumps(request.observations))
            saved = next(record[PREPARATION] for record in observations if PREPARATION in record)
            if fault == "children":
                saved["children"] = ["foreign-child"]
            else:
                saved["checkpoint"]["payload_digest"] = "0" * 64
            request.observations = observations
        elif fault == "pointer":
            invocation = session.scalar(select(NativeTestInvocation))
            assert invocation is not None
            changed = {**invocation.bindings[RECOVERY_RECORD_KEY], "successor_digest": "0" * 64}
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: changed}
        else:
            pending = session.get(
                NativePendingAction,
                allocated.checkpoint.pending_calls[0].pending_operation_id
                if fault == "old-join"
                else proof.selection.approvals[0].pending_id,
            )
            assert pending is not None
            pending.reference_digest = "0" * 64
    receipt = commands.get(
        actor=owner.api.actor, session_id=_owner_session_id(owner), request_id=owner.parent.ref.request_id
    )
    assert receipt.outcome is None
    with owner.api.sessions() as session:
        run = session.get(WorkflowRun, owner.context.native_run_id)
        state = session.scalar(select(NativeInvocationState))
        assert run is not None
        assert run.status == "paused"
        assert state is not None
        assert state.outcome is None
        assert session.scalar(select(NativeEffectGrant.id)) is None


def _owner_session_id(owner: ProtectedOwner) -> str:
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        return request.session_id


def test_recovery_cancel_preparation_cannot_freeze_an_unrevoked_handshake(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    selection = commands.prepare_recovery_selection(ref=owner.parent.ref, expected=allocated.expected)
    owner.api.store.finalize_recovery_successor(ref=owner.parent.ref, selection=selection)
    ConfirmedAgentCancellation(commands).prepare(ref=owner.parent.ref)
    assert (
        commands.prepare_recovery_for_interaction(
            ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="handoff-wins-before-revocation"
        )
        is not None
    )
    receipt = commands.cancel(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        idempotency_key="cancel-after-handshake",
    )
    assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"
    assert ("POST", "/execution-bindings") not in runtime.requests
    assert receipt.outcome == "cancelled"


@pytest.mark.parametrize("settlement", ["allocated", "unknown", "blocked-after-allocated", "blocked-after-creating"])
def test_recovery_cancel_retains_same_child_after_late_allocation_settlement(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, settlement: str
) -> None:
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY, AgentRecoveryRecord
    from services.dify_builder.native_testing.confirmed_agent_cancellation import (
        PREPARATION,
        ConfirmedAgentCancellation,
    )

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    creating = AgentRecoveryRecord.model_validate(
        {**allocated.expected.model_dump(), "phase": "creating", "allocation_receipt_ref": None}
    )
    if settlement != "blocked-after-allocated":
        with owner.api.sessions.begin() as session:
            invocation = session.scalar(select(NativeTestInvocation))
            receipt = session.get(NativePayloadObject, allocated.expected.allocation_receipt_ref)
            assert invocation is not None
            assert receipt is not None
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: creating.model_dump(mode="json")}
            session.delete(receipt)  # Seed the actual pre-ACK boundary; no allocation is performed.
    commands = recovery_interaction_commands(owner, runtime)
    cancellation = ConfirmedAgentCancellation(commands)
    owner.api.lifecycle.cancel(
        actor=owner.api.actor, request_id=owner.parent.ref.request_id, idempotency_key="revoke-creating"
    )
    cancellation.prepare(ref=owner.parent.ref)
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        original = next(record[PREPARATION] for record in request.observations if PREPARATION in record)
        assert original["recovery"]["phase"] == ("allocated" if settlement == "blocked-after-allocated" else "creating")
    if settlement in {"allocated", "blocked-after-creating"}:
        final = owner.api.store.acknowledge_recovery_allocation(
            ref=owner.parent.ref, expected=creating, receipt=allocated.allocation
        )
    elif settlement == "unknown":
        final = owner.api.store.mark_recovery_allocation_unknown(ref=owner.parent.ref, expected=creating)
    else:
        final = allocated.expected
    if settlement.startswith("blocked-"):
        final = owner.api.store.block_recovery_allocation(ref=owner.parent.ref, expected=final)
    expected_phase = "blocked" if settlement.startswith("blocked-") else settlement
    assert final.phase == expected_phase
    assert cancellation.retry_children(ref=owner.parent.ref) == (runtime.run_id,)
    receipt = commands.cancel(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        idempotency_key="retry-after-late-settlement",
    )
    assert receipt.outcome == "cancelled"
    assert receipt.cancellation is not None
    assert receipt.cancellation.status == "cancelling"
    with owner.api.sessions() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        assert next(record[PREPARATION] for record in request.observations if PREPARATION in record) == original
        invocation = session.scalar(select(NativeTestInvocation))
        assert invocation is not None
        assert invocation.bindings[RECOVERY_RECORD_KEY]["phase"] == expected_phase
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert len(session.scalars(select(AgentWorkspaceBinding)).all()) == 1


def test_actual_ordinary_cancel_keeps_original_proof_path(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY

    owner, runtime = protected_owner, runtime_owner
    allocated_successor(owner, runtime, substitution="none", model_pending=True)
    with owner.api.sessions.begin() as session:
        invocation = session.scalar(select(NativeTestInvocation))
        assert invocation is not None
        invocation.bindings = {key: value for key, value in invocation.bindings.items() if key != RECOVERY_RECORD_KEY}
    commands = recovery_interaction_commands(owner, runtime)
    receipt = commands.cancel(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        idempotency_key="ordinary-cancel",
    )
    assert receipt.outcome == "cancelled"
    assert runtime.client.get_run_sync(runtime.run_id).status == "cancelled"


@pytest.mark.parametrize("fault", ["actor", "pending", "version", "scope"])
def test_recovery_denial_keeps_exact_request_pending_owner(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, fault: str
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    pending_id = allocated.checkpoint.pending_calls[0].pending_operation_id
    with owner.api.sessions() as session:
        pending = session.get(NativePendingAction, pending_id)
        assert pending is not None
        digest = pending.owner_version
    actor = Actor(tenant_id=owner.api.actor.tenant_id, account_id=str(uuid4())) if fault == "actor" else owner.api.actor
    with pytest.raises(BuilderExecutionPolicyError):
        commands.decide(
            actor=actor,
            session_id=_owner_session_id(owner),
            request_id=owner.parent.ref.request_id,
            pending_operation_id=str(uuid4()) if fault == "pending" else pending_id,
            decision="deny",
            scope_digest="0" * 64 if fault == "scope" else digest,
            expected_version=2 if fault == "version" else 1,
            idempotency_key="bad-denial",
        )
    assert runtime.client.get_run_sync(runtime.run_id).status == "waiting"
    with owner.api.sessions() as session:
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert scope is not None
        assert not scope.cancelled
        assert request is not None
        assert not any("native_terminal_denial" in record for record in request.observations)
        assert session.scalar(select(NativeEffectGrant.id)) is None


@pytest.mark.parametrize("expired_scope", [False, True])
def test_recovery_sealed_stop_rechecks_retained_child_proof(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner, expired_scope: bool
) -> None:
    from services.dify_builder.native_testing.confirmed_agent_cancellation import (
        PREPARATION,
        ConfirmedAgentCancellation,
    )

    owner, runtime = protected_owner, runtime_owner
    allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    first = commands.cancel(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        idempotency_key="sealed-stop",
    )
    assert first.outcome == "cancelled"
    cancellation = ConfirmedAgentCancellation(commands)
    if expired_scope:
        with owner.api.sessions.begin() as session:
            scope = session.get(NativeTestScope, owner.parent.ref.request_id)
            assert scope is not None
            scope.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    from sqlalchemy import event
    from sqlalchemy.orm import ORMExecuteState, SessionTransaction

    queries: list[tuple[SessionTransaction | None, str]] = []

    def observe_sql(execution: ORMExecuteState) -> None:
        queries.append((execution.session.get_transaction(), str(execution.statement)))

    event.listen(owner.api.sessions, "do_orm_execute", observe_sql)
    try:
        assert cancellation.stop_is_saved(ref=owner.parent.ref)
    finally:
        event.remove(owner.api.sessions, "do_orm_execute", observe_sql)
    final_transaction = queries[-1][0]
    assert final_transaction is not None
    final_queries = [statement for transaction, statement in queries if transaction is final_transaction]
    assert any(NativePayloadObject.__tablename__ in statement for statement in final_queries)
    assert any(
        DifyBuilderExecutionRequest.__tablename__ in statement and "FOR UPDATE" in statement
        for statement in final_queries
    ), "The final sealed-stop receipt/ledger reads must share the root writer lock"
    assert cancellation.settle(ref=owner.parent.ref)
    assert (
        commands.peek(
            actor=owner.api.actor, session_id=_owner_session_id(owner), request_id=owner.parent.ref.request_id
        ).outcome
        == "cancelled"
    )
    with owner.api.sessions.begin() as session:
        request = session.get(DifyBuilderExecutionRequest, owner.parent.ref.request_id)
        assert request is not None
        observations = json.loads(json.dumps(request.observations))
        next(record[PREPARATION] for record in observations if PREPARATION in record)["children"] = ["foreign-child"]
        request.observations = observations
    assert not cancellation.stop_is_saved(ref=owner.parent.ref)
    assert not cancellation.settle(ref=owner.parent.ref)


def test_recovery_cancel_ignores_unrelated_late_acknowledged_artifact(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

    owner, runtime = protected_owner, runtime_owner
    allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    owner.api.lifecycle.cancel(actor=owner.api.actor, request_id=owner.parent.ref.request_id, idempotency_key="revoke")
    cancellation = ConfirmedAgentCancellation(commands)
    cancellation.prepare(ref=owner.parent.ref)
    artifact = owner.api.store.prepare_object(
        ref=owner.parent.ref,
        tenant_id=owner.scope.tenant_id,
        kind="result",
        logical_key="late-owned-result",
        payload={"settled": True},
    )
    with owner.api.loader.locked(ref=owner.parent.ref, settlement=True) as (session, _owned, _scope):
        owner.api.store.acknowledge_object(session, artifact)
    assert cancellation.retry_children(ref=owner.parent.ref) == (runtime.run_id,)
    final = commands.cancel(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        idempotency_key="cancel-after-artifact",
    )
    assert final.outcome == "cancelled"


def test_recovery_denial_preserves_existing_decision_idempotency(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner, runtime = protected_owner, runtime_owner
    allocated_successor(owner, runtime, substitution="none", model_pending=True)
    commands = recovery_interaction_commands(owner, runtime)
    proof = commands.prepare_recovery_for_interaction(
        ref=owner.parent.ref, expected_parent_generation=0, idempotency_key="prepare-decision"
    )
    assert proof is not None
    pending_id = proof.selection.approvals[0].pending_id
    with owner.api.sessions() as session:
        pending = session.get(NativePendingAction, pending_id)
        assert pending is not None
        digest = pending.owner_version
    commands.decide(
        actor=owner.api.actor,
        session_id=_owner_session_id(owner),
        request_id=owner.parent.ref.request_id,
        pending_operation_id=pending_id,
        decision="confirm",
        scope_digest=digest,
        expected_version=1,
        idempotency_key="same-decision-key",
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_idempotency_conflict"):
        commands.decide(
            actor=owner.api.actor,
            session_id=_owner_session_id(owner),
            request_id=owner.parent.ref.request_id,
            pending_operation_id=pending_id,
            decision="deny",
            scope_digest=digest,
            expected_version=1,
            idempotency_key="same-decision-key",
        )
    with owner.api.sessions() as session:
        scope = session.get(NativeTestScope, owner.parent.ref.request_id)
        assert scope is not None
        assert not scope.cancelled
    assert runtime.client.get_run_sync(runtime.run_id).status == "waiting"


@pytest.mark.parametrize("inspection_adapter", ["enterprise"], indirect=True)
def test_enterprise_absence_keeps_protected_recovery_eligibility_without_grants(
    protected_owner: ProtectedOwner, runtime_owner: RuntimeOwner
) -> None:
    """Seeded allocation evidence exercises real protected reload, not Dev recovery."""
    owner, runtime = protected_owner, runtime_owner
    allocated = allocated_successor(
        owner, runtime, substitution="none", model_pending=True, inspection_adapter="enterprise"
    )
    prepared, evidence = owner.api.store.prepare_recovery_attempt(ref=owner.parent.ref, expected=allocated.expected)
    assert prepared.workspace.backend_binding_ref == prepared.workspace.backend_workspace_ref
    assert evidence["inspection"] == {
        "binding_ref": prepared.workspace.backend_binding_ref,
        "workspace_ref": prepared.workspace.backend_workspace_ref,
        "adapter": "enterprise",
        "state": "definitively_gone",
        "evidence_code": "sandbox_not_found",
    }
    with owner.api.sessions() as session:
        assert session.scalar(select(NativeEffectGrant.id)) is None
        assert session.scalar(select(NativeEffectAttempt.id)) is None
