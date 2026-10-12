"""CI-only actual-native proofs for one consented Gmail ``get_message`` Builder Tool test.

Everything below runs the real consent owner, dispatch coordinator, Celery task body, port,
generator, Graphon engine, ``DifyNodeFactory``/``DifyToolNodeRuntime``, ``ToolManager``,
``ToolEngine``, ``PluginTool``, native credential encryption with a real per-tenant key, and
native Run/node persistence on the shared PostgreSQL (consent/sidecar tables rebuilt by their
actual migrations) and Redis containers. Native Run/node IDs are only ever read from what the
native pipeline allocated. Only external boundaries are replaced: installed plugin metadata
(installation resolver, provider declaration, verification), the plugin daemon's OAuth refresh
and tool invoke transports, and model resolution (spied: a confirmed command never resolves one).

Installed metadata, qualification constants, tokens and message values are SYNTHETIC test-only
fixtures; they attest nothing about any installed or deployed artifact, daemon or mailbox, and
real qualification stays unavailable outside this module.

``test_stale_recovery_sweep_never_settles_a_fresh_reservation`` is a regression for a known,
root-owned defect in ``reconcile_stranded`` and is expected to fail until that owner is fixed.
"""

import json
import multiprocessing
import os
import traceback
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from multiprocessing.connection import Connection
from pathlib import Path
from threading import Barrier, Event, Lock, Thread, get_ident
from time import monotonic, sleep, time
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import TypeAdapter
from sqlalchemy import Engine, event, func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.dify_builder import gmail_read_policy
from core.dify_builder.errors import BusyError
from core.dify_builder.execution_policy import (
    BuilderExecutionContextValue,
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
)
from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, DifyBuilderContext, NodeEvent, Run
from core.dify_builder.ports import DifyBuilderAgent
from core.dify_builder.real_call_consent import ConsentReceipt, InstalledToolBinding, confirmed_dispatch_headers
from core.dify_builder.state import PcState
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper import encrypter
from core.plugin.entities.oauth import OAuthSchema
from core.plugin.entities.plugin_daemon import CredentialType, PluginOAuthCredentialsResponse, PluginToolProviderEntity
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.impl.tool import PluginToolManager
from core.plugin.plugin_service import PluginService
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
)
from core.workflow import node_factory
from core.workflow.node_runtime import DifyToolNodeRuntime
from core.workflow.system_variables import SystemVariableKey, get_system_text
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle
from graphon.runtime.variable_pool import VariablePool
from libs.datetime_utils import naive_utc_now
from libs.key_providers import generate_key_pair
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder import (
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderRealCallConsent,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.enums import PermissionEnum
from models.model import App
from models.tools import BuiltinToolProvider, ToolOAuthTenantClient
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowNodeExecutionModel, WorkflowRun
from schedule.dify_builder_reconcile_task import reconcile_interrupted_sessions
from services.dify_builder import real_call_consent_service, real_call_metadata, session_lock, wiring
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.agent_factory import set_dify_builder_agent_factory
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import execution_revision
from services.dify_builder.serde import context_to_dict
from tasks import dify_builder_advance_task
from tasks.dify_builder_advance_task import advance_session
from tests.test_containers_integration_tests.core.workflow.test_builder_execution_policy_persistence import race
from tests.test_containers_integration_tests.core.workflow.test_builder_real_call_consent_persistence import (
    MIGRATED_TABLES,
    PLUGIN,
    PROVIDER,
    SECRET,
    SYNTHETIC_ARTIFACT,
    SYNTHETIC_AUDIT,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_real_call_consent_persistence import (
    migrated_builder_tables as migrated_builder_tables,  # noqa: PLC0414 - shared autouse migration fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import configure
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)

FIXTURE = "gmail_confirmed_read.yml"
TOOL_NODE = "gmail"
CREDENTIAL_PLACEHOLDER = "ci-credential-placeholder"
MESSAGE_ID = "18cab_1"
APPROVED_PARAMETERS = {"message_id": MESSAGE_ID, "include_body": False, "include_attachments": False}
# Sentinels: plaintext never leaves the native authorized Run, decrypted runtime or transport.
ACCESS_TOKEN = "ci-access-token-sentinel-4f1"
REFRESH_TOKEN = "ci-refresh-token-sentinel-7a2"
CLIENT_ID = "ci-oauth-client-id"
CLIENT_SECRET = "ci-client-secret-sentinel-0c9"
BODY = "ci-message-body-sentinel-5d3"
NATIVE_SECRET = "ci-native-error-sentinel-8e6"
REFRESHED = {"access_token": "ci-refreshed-access-sentinel", "refresh_token": "ci-refreshed-refresh-sentinel"}
SECRETS = (ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, NATIVE_SECRET, *REFRESHED.values())
SYNTHETIC_INSTALLATION = "synthetic-installation"
DUPLICATE_LAUNCH = {"execution_already_launched", "execution_already_claimed"}
_REAL_DECRYPT = encrypter.decrypt_token

# Bounds: every wait is finite and every started thread/process is joined, also on failure.
_HOLD_SECONDS = 60
_JOIN_SECONDS = 120
_CHILD_RESULT_SECONDS = 180
_CHILD_JOIN_SECONDS = 10
_CRASH_EXIT = 86


# -- external boundary --------------------------------------------------------------------------


class TxWitness:
    """Connection-level transactions open on the shared engine, keyed by the thread that began them."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._lock = Lock()
        self._open: dict[int, tuple[int, str]] = {}
        # Bound methods are created once so ``event.remove`` finds the same listeners.
        self._listeners: tuple[tuple[str, Callable[[object], None]], ...] = (
            ("begin", self._begin),
            ("commit", self._end),
            ("rollback", self._end),
        )
        for name, listener in self._listeners:
            event.listen(engine, name, listener)

    def close(self) -> None:
        for name, listener in self._listeners:
            event.remove(self._engine, name, listener)

    def _begin(self, connection: object) -> None:
        # Product frames only (not this module, pytest or installed packages), innermost first.
        frames = [
            f
            for f in traceback.extract_stack()[:-2]
            if "/api/" in f.filename and "/tests/" not in f.filename and "-packages/" not in f.filename
        ]
        origin = " < ".join(f"{Path(f.filename).name}:{f.lineno}:{f.name}" for f in reversed(frames[-6:]))
        with self._lock:
            self._open[id(connection)] = (get_ident(), origin)

    def _end(self, connection: object) -> None:
        with self._lock:
            self._open.pop(id(connection), None)

    def open_here(self) -> tuple[str, ...]:
        """Origins of transactions the calling thread still holds open."""
        thread = get_ident()
        with self._lock:
            return tuple(origin for owner, origin in self._open.values() if owner == thread)


@dataclass(frozen=True)
class Call:
    """One plugin daemon request as the transport received it."""

    path: str
    headers: dict[str, str]
    payload: dict[str, object]


def _call(path: str, kwargs: Mapping[str, object]) -> Call:
    headers, data = kwargs.get("headers"), kwargs.get("data")
    assert isinstance(headers, dict)
    assert isinstance(data, dict)
    payload = data.get("data")
    assert isinstance(payload, dict)
    return Call(path=path, headers={str(k): str(v) for k, v in headers.items()}, payload=dict(payload))


def _tool_entity(*, extra_parameter: bool = False) -> ToolEntity:
    parameters = [
        ("message_id", ToolParameter.ToolParameterType.STRING),
        ("include_body", ToolParameter.ToolParameterType.BOOLEAN),
        ("include_attachments", ToolParameter.ToolParameterType.BOOLEAN),
    ]
    if extra_parameter:
        parameters.append(("format", ToolParameter.ToolParameterType.STRING))
    return ToolEntity(
        identity=ToolIdentity(
            author="langgenius", name="get_message", label=I18nObject(en_US="Get message"), provider=PROVIDER
        ),
        parameters=[
            ToolParameter.get_simple_instance(name=name, llm_description=name, typ=typ, required=True)
            for name, typ in parameters
        ],
    )


def _declaration(
    *, unique_identifier: str = SYNTHETIC_ARTIFACT, extra_parameter: bool = False
) -> PluginToolProviderEntity:
    """SYNTHETIC provider declaration as the daemon would report it (secret OAuth fields included)."""
    secret = ProviderConfigType.SECRET_INPUT
    return PluginToolProviderEntity(
        provider="dify-gmail",
        plugin_unique_identifier=unique_identifier,
        plugin_id=PLUGIN,
        declaration=ToolProviderEntityWithPlugin(
            identity=ToolProviderIdentity(
                author="langgenius",
                name=PROVIDER,
                description=I18nObject(en_US="Gmail"),
                icon="icon.svg",
                label=I18nObject(en_US="Gmail"),
            ),
            plugin_id=PLUGIN,
            oauth_schema=OAuthSchema(
                client_schema=[
                    ProviderConfig(type=ProviderConfigType.TEXT_INPUT, name="client_id"),
                    ProviderConfig(type=secret, name="client_secret"),
                ],
                credentials_schema=[
                    ProviderConfig(type=secret, name="access_token"),
                    ProviderConfig(type=secret, name="refresh_token"),
                ],
            ),
            tools=[_tool_entity(extra_parameter=extra_parameter)],
        ),
    )


def _installed(tenant_id: str, declaration: PluginToolProviderEntity) -> InstalledToolBinding:
    """The installation binding the real resolver derives from this daemon declaration."""
    tool = declaration.declaration.tools[0]
    return InstalledToolBinding(
        tenant_id=tenant_id,
        installation_id=SYNTHETIC_INSTALLATION,
        plugin_id=PLUGIN,
        provider_id=PROVIDER,
        tool_name=tool.identity.name,
        unique_identifier=declaration.plugin_unique_identifier,
        version="9.9.9",
        checksum="f" * 64,
        schema_digest=real_call_metadata.get_message_schema_digest(tool),
        source_audit_revision=SYNTHETIC_AUDIT,
        daemon_contract_revision=gmail_read_policy.DAEMON_CONTRACT_REVISION,
        runtime_type="local",
    )


def _text(value: str) -> ToolInvokeMessage:
    return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text=value))


def _success_messages() -> list[ToolInvokeMessage]:
    """The audited success grammar: progress TEXT, the ``message_id`` VARIABLE, then one result JSON."""
    return [
        _text("Fetching message"),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=ToolInvokeMessage.VariableMessage(variable_name="message_id", variable_value=MESSAGE_ID),
        ),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message=ToolInvokeMessage.JsonMessage(
                json_object={"message": {"id": MESSAGE_ID, "snippet": BODY}, "message_id": MESSAGE_ID}
            ),
        ),
    ]


@dataclass
class Boundary:
    """Records every external boundary crossing and the SQL transactions open in that thread."""

    witness: TxWitness
    declaration: PluginToolProviderEntity = field(default_factory=_declaration)
    events: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    refresh_calls: list[Call] = field(default_factory=list)
    invoke_calls: list[Call] = field(default_factory=list)
    model_calls: list[str] = field(default_factory=list)
    invoke_messages: list[ToolInvokeMessage] = field(default_factory=_success_messages)
    invoke_fail_after: int | None = None
    on_refresh: Callable[[], None] | None = None
    on_invoke: Callable[[], None] | None = None
    # Set only in a forked crash child: the process exits at that boundary.
    crash_at: Literal["refresh", "invoke"] | None = None
    crash_channel: Connection | None = None
    lock: Lock = field(default_factory=Lock)

    def mark(self, name: str) -> None:
        with self.lock:
            self.events.append((name, self.witness.open_here()))

    def count(self, name: str) -> int:
        with self.lock:
            return sum(1 for event_name, _ in self.events if event_name == name)

    def order(self) -> list[str]:
        with self.lock:
            return [name for name, _ in self.events]

    def crash(self, phase: Literal["refresh", "invoke"]) -> None:
        """Kill this forked child at ``phase`` without unwinding: no ``finally`` or outcome callback runs."""
        if self.crash_at != phase:
            return
        if self.crash_channel is not None:
            self.crash_channel.send(
                {"crashed_at": phase, "refresh_calls": len(self.refresh_calls), "invoke_calls": len(self.invoke_calls)}
            )
            self.crash_channel.close()
        os._exit(_CRASH_EXIT)


def assert_outside_sql(boundary: Boundary, *names: str) -> None:
    for name in names:
        observed = [open_here for event_name, open_here in boundary.events if event_name == name]
        assert observed, f"{name} never happened"
        inside = [origins for origins in observed if origins]
        assert not inside, f"{name} ran inside open SQL transaction(s): {inside}"


def assert_no_secret(*texts: str) -> None:
    for value in texts:
        for sentinel in (*SECRETS, BODY):
            assert sentinel not in value


def reset_provider_cache() -> None:
    # A fresh request-scoped provider cache, exactly as ``get_plugin_provider`` initializes it.
    contexts.plugin_tool_providers.set({})
    contexts.plugin_tool_providers_lock.set(Lock())


def in_request[T](app: Flask, call: Callable[[], T]) -> Callable[[], T]:
    """Run ``call`` in a fresh request context, as a web request thread would."""

    def run() -> T:
        with app.test_request_context():
            reset_provider_cache()
            return call()

    return run


# -- the seeded Builder world ------------------------------------------------------------------


Delivery = tuple[str, dict[str, object], dict[str, object], str]


@dataclass
class Gmail:
    app: Flask
    factory: sessionmaker[Session]
    actor: Actor
    app_id: str
    workflow_id: str
    session_id: str
    test_input_id: str
    credential_id: str
    client_id: str
    inputs: dict[str, object]
    boundary: Boundary
    clock: dict[str, datetime | None]

    def service(self) -> BuilderRealCallConsentService:
        return BuilderRealCallConsentService(self.factory)

    def head(self) -> tuple[str, int, DifyBuilderContext]:
        session, fc = SqlDifyBuilderRepository(self.factory).get_session(self.session_id)
        return str(session.current_state), session.version, fc

    def prepare(self, key: str = "prepare-1") -> ConsentReceipt:
        with self.factory() as session:
            workflow = session.get(Workflow, self.workflow_id)
            assert workflow is not None
            revision = execution_revision(workflow)
        return self.service().prepare(
            actor=self.actor,
            session_id=self.session_id,
            node_id=TOOL_NODE,
            test_input_id=self.test_input_id,
            credential_id=self.credential_id,
            at_version=self.head()[1],
            base_app_revision=revision,
            idempotency_key=key,
        )

    def confirm(self, prepared: ConsentReceipt, key: str = "confirm-1") -> ConsentReceipt:
        return self.service().confirm(
            actor=self.actor,
            session_id=self.session_id,
            consent_id=prepared.consent_id,
            decision="confirm",
            scope_digest=prepared.scope_digest,
            at_version=prepared.at_version,
            idempotency_key=key,
        )

    def confirmed(self, suffix: str = "1") -> ConsentReceipt:
        return self.confirm(self.prepare(f"prepare-{suffix}"), f"confirm-{suffix}")

    def reserve(self, receipt: ConsentReceipt, key: str = "execute-1") -> tuple[ConsentReceipt, bool]:
        return self.service().reserve_execution(
            actor=self.actor,
            session_id=self.session_id,
            consent_id=receipt.consent_id,
            scope_digest=receipt.scope_digest,
            at_version=receipt.at_version,
            idempotency_key=key,
        )

    def reserved(self) -> ConsentReceipt:
        receipt, won = self.reserve(self.confirmed())
        assert won is True
        assert receipt.command_id is not None
        assert receipt.execution_request_id is not None
        return receipt

    def execute(self, receipt: ConsentReceipt, key: str = "execute-1") -> ConsentReceipt:
        """The confirmed dispatch coordinator: Redis lease, then the atomic reservation, then one enqueue."""
        return wiring.build_service().execute_confirmed_tool(
            self.session_id,
            self.actor,
            consent_id=receipt.consent_id,
            scope_digest=receipt.scope_digest,
            at_version=receipt.at_version,
            idempotency_key=key,
        )

    def context(self, request_id: str) -> ConfirmedToolExecutionContext:
        request = self.request(request_id)
        context = TypeAdapter(BuilderExecutionContextValue).validate_json(json.dumps(request.context))
        assert isinstance(context, ConfirmedToolExecutionContext)
        return context

    def run(self, receipt: ConsentReceipt, frames: list[Mapping[str, object]] | None = None) -> Run:
        """The shared port with the reserved pair; authority is reloaded from the consent owner."""
        assert receipt.command_id is not None
        events: list[NodeEvent] = []
        return WorkflowServiceDifyPort().run_draft(
            self.app_id,
            self.actor,
            dict(self.inputs),
            events.append,
            session_id=self.session_id,
            test_input_id=self.test_input_id,
            on_workflow_event=frames.append if frames is not None else None,
            confirmed_consent_id=receipt.consent_id,
            command_id=receipt.command_id,
        )

    def consent(self, consent_id: str) -> DifyBuilderRealCallConsent:
        with self.factory() as session:
            row = session.get(DifyBuilderRealCallConsent, consent_id)
            assert row is not None
            return row

    def request(self, request_id: str) -> DifyBuilderExecutionRequest:
        with self.factory() as session:
            row = session.get(DifyBuilderExecutionRequest, request_id)
            assert row is not None
            return row

    def count(self, model: type[DifyBuilderExecutionRequest] | type[DifyBuilderRealCallConsent]) -> int:
        with self.factory() as session:
            return (
                session.scalar(select(func.count()).select_from(model).where(model.session_id == self.session_id)) or 0
            )

    def native_runs(self) -> list[WorkflowRun]:
        with self.factory() as session:
            return list(session.scalars(select(WorkflowRun).where(WorkflowRun.app_id == self.app_id)))

    def native_nodes(self, run_id: str) -> list[WorkflowNodeExecutionModel]:
        with self.factory() as session:
            return list(
                session.scalars(
                    select(WorkflowNodeExecutionModel)
                    .where(WorkflowNodeExecutionModel.workflow_run_id == run_id)
                    .order_by(WorkflowNodeExecutionModel.index)
                )
            )

    def draft_variables(self) -> int:
        with self.factory() as session:
            return (
                session.scalar(
                    select(func.count())
                    .select_from(WorkflowDraftVariable)
                    .where(WorkflowDraftVariable.app_id == self.app_id)
                )
                or 0
            )

    def builder_state_text(self) -> str:
        """Every Builder-owned durable row of this session, for content/secret absence checks."""
        with self.factory() as session:
            rows: list[object] = []
            for consent in session.scalars(
                select(DifyBuilderRealCallConsent).where(DifyBuilderRealCallConsent.session_id == self.session_id)
            ):
                rows.append(
                    [
                        consent.binding,
                        consent.disclosure,
                        consent.prepare_receipt,
                        consent.confirm_receipt,
                        consent.execute_receipt,
                        consent.reason_code,
                    ]
                )
            for request in session.scalars(
                select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.session_id == self.session_id)
            ):
                rows.append([request.context, request.observations, request.completion_summary])
            for commit in session.scalars(
                select(DifyBuilderSessionCommit).where(DifyBuilderSessionCommit.session_id == self.session_id)
            ):
                rows.append(commit.context)
            for item in session.scalars(
                select(DifyBuilderConversationItem).where(DifyBuilderConversationItem.session_id == self.session_id)
            ):
                rows.append(item.payload)
        return json.dumps(rows, default=str)

    def make_stale(self) -> None:
        """Age the session head past the sweeper's staleness bound (no state or version change)."""
        with self.factory.begin() as session:
            session.execute(
                update(DifyBuilderSession)
                .where(DifyBuilderSession.id == self.session_id)
                .values(updated_at=naive_utc_now() - timedelta(days=1))
            )

    def lease(self) -> str | None:
        value = redis_client.get(f"dify_builder:advance:{self.session_id}")
        if value is None:
            return None
        return value.decode() if isinstance(value, bytes) else str(value)

    def encrypt(self, value: str) -> str:
        token = encrypter.encrypt_token(self.actor.tenant_id, value)
        db.session.commit()  # the key provider reads the tenant through the scoped session
        return token

    def rotated_ciphertext(self, access_token: str) -> str:
        """A different, natively encrypted credential value (encrypt in a Flask request thread)."""
        return json.dumps({"access_token": self.encrypt(access_token), "refresh_token": self.encrypt(access_token)})

    def write_credential(self, ciphertext: str) -> None:
        """The native credential writer: a plain row update that never takes a consent lock."""
        with self.factory.begin() as session:
            row = session.get(BuiltinToolProvider, self.credential_id)
            assert row is not None
            row.encrypted_credentials = ciphertext

    def credential(self) -> BuiltinToolProvider:
        with self.factory() as session:
            row = session.get(BuiltinToolProvider, self.credential_id)
            assert row is not None
            return row


def _now() -> datetime:
    return datetime.now(UTC)


@pytest.fixture
def deliveries(monkeypatch: pytest.MonkeyPatch) -> list[Delivery]:
    """Hold the broker: the real coordinator enqueues through ``advance_session.delay``; tests deliver."""
    captured: list[Delivery] = []

    def delay(session_id: str, action: dict[str, object], actor: dict[str, object], token: str) -> None:
        captured.append((session_id, action, actor, token))

    monkeypatch.setattr(dify_builder_advance_task.advance_session, "delay", delay)
    return captured


@pytest.fixture
def gmail(
    native_owner: tuple[sessionmaker[Session], Actor, App, Workflow, str, str],
    flask_app_with_containers: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Gmail]:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    with factory() as session:
        for table, marker in MIGRATED_TABLES.items():
            comment = session.scalar(text("SELECT obj_description(CAST(:t AS regclass), 'pg_class')"), {"t": table})
            assert comment == marker, f"{table} was not built by its actual migration"
    monkeypatch.setattr(dify_config, "SECRET_KEY", SECRET)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_TOOL_ENABLED", True)
    reset_provider_cache()

    # A real per-tenant key: credentials below are natively encrypted and natively decrypted.
    tenant = db.session.get(Tenant, actor.tenant_id)
    assert tenant is not None
    tenant.encrypt_public_key = generate_key_pair(actor.tenant_id)
    db.session.commit()
    inputs = configure(native_owner, FIXTURE)
    boundary = Boundary(witness=TxWitness(db.engine))
    world = Gmail(
        app=flask_app_with_containers,
        factory=factory,
        actor=actor,
        app_id=app.id,
        workflow_id=workflow.id,
        session_id=session_id,
        test_input_id=test_input_id,
        credential_id="",
        client_id="",
        inputs=dict(inputs),
        boundary=boundary,
        clock={"now": None},
    )
    credentials = json.dumps(
        {"access_token": world.encrypt(ACCESS_TOKEN), "refresh_token": world.encrypt(REFRESH_TOKEN)}
    )
    client_params = json.dumps({"client_id": CLIENT_ID, "client_secret": world.encrypt(CLIENT_SECRET)})
    with factory.begin() as session:
        credential = BuiltinToolProvider(
            name="CI mailbox",
            tenant_id=actor.tenant_id,
            user_id=actor.account_id,
            provider=PROVIDER,
            credential_type=CredentialType.OAUTH2,
            encrypted_credentials=credentials,
            expires_at=int(time()) + 86_400,
            visibility=PermissionEnum.ALL_TEAM,
            is_default=False,
        )
        client = ToolOAuthTenantClient(tenant_id=actor.tenant_id, plugin_id=PLUGIN, provider="dify-gmail")
        client.encrypted_oauth_params = client_params
        client.enabled = True
        session.add_all([credential, client])
        session.flush()
        draft = session.get(Workflow, workflow.id)
        assert draft is not None
        graph = json.loads(draft.graph)
        tools = [node for node in graph["nodes"] if node["id"] == TOOL_NODE]
        assert len(tools) == 1
        assert tools[0]["data"]["credential_id"] == CREDENTIAL_PLACEHOLDER
        tools[0]["data"]["credential_id"] = credential.id
        draft.graph = json.dumps(graph)
        test_input = session.get(DifyBuilderTestInput, test_input_id)
        assert test_input is not None
        test_input.start_schema_hash = schema_hash(start_schema(graph))
        session.add(
            DifyBuilderSessionCommit(
                session_id=session_id,
                version=1,
                state=str(PcState.BUILD_AWAIT_TESTDATA),
                context=context_to_dict(DifyBuilderContext(plan_items=["Read one message"])),
                actor="",
            )
        )
        world.credential_id, world.client_id = credential.id, client.id

    # SYNTHETIC qualification of exactly the fixture declaration's tool schema.
    original_tool = boundary.declaration.declaration.tools[0]
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_ARTIFACT", SYNTHETIC_ARTIFACT)
    monkeypatch.setattr(
        gmail_read_policy, "QUALIFIED_GMAIL_SCHEMA_DIGEST", real_call_metadata.get_message_schema_digest(original_tool)
    )
    monkeypatch.setattr(gmail_read_policy, "GMAIL_SOURCE_AUDIT_REVISION", SYNTHETIC_AUDIT)

    def installed(*, tenant_id: str, provider_id: str) -> InstalledToolBinding:
        # Installation metadata transport, then the real resolver's own qualification check.
        boundary.mark("metadata")
        assert provider_id == PROVIDER
        binding = _installed(tenant_id, boundary.declaration)
        gmail_read_policy.qualify_installed_action(binding)
        return binding

    def verified(_tenant_id: str, _plugin_unique_identifier: str) -> bool:
        boundary.mark("verification")
        return False

    def fetch_tool_provider(_self: PluginToolManager, tenant_id: str, provider: str) -> PluginToolProviderEntity:
        boundary.mark("declaration")
        assert (tenant_id, provider) == (actor.tenant_id, PROVIDER)
        return boundary.declaration.model_copy(deep=True)

    def decrypt_token(token_tenant_id: str, token: str) -> str:
        # Spy only: the real tenant key decrypts.
        boundary.mark("decrypt")
        return _REAL_DECRYPT(token_tenant_id, token)

    def refresh_stream(
        _self: OAuthHandler, method: str, path: str, _type: type, **kwargs: object
    ) -> Iterator[PluginOAuthCredentialsResponse]:
        boundary.mark("refresh")
        assert method == "POST"
        boundary.refresh_calls.append(_call(path, kwargs))
        boundary.crash("refresh")
        if boundary.on_refresh is not None:
            boundary.on_refresh()
        return iter([PluginOAuthCredentialsResponse(credentials=REFRESHED, expires_at=int(time()) + 3600)])

    def invoke_stream(
        _self: PluginToolManager, method: str, path: str, _type: type, **kwargs: object
    ) -> Iterator[ToolInvokeMessage]:
        boundary.crash("invoke")
        boundary.mark("invoke")
        assert method == "POST"
        assert path.endswith("/dispatch/tool/invoke"), path
        boundary.invoke_calls.append(_call(path, kwargs))
        if boundary.on_invoke is not None:
            boundary.on_invoke()
        messages, fail_after = list(boundary.invoke_messages), boundary.invoke_fail_after

        def stream() -> Iterator[ToolInvokeMessage]:
            for index, message in enumerate(messages):
                if fail_after == index:
                    raise RuntimeError(f"plugin daemon transport lost: {NATIVE_SECRET}")
                yield message

        return stream()

    def no_model(_agent: LlmBuilderAgent) -> object:
        boundary.model_calls.append("model")
        raise AssertionError("a Builder model was resolved")

    def utcnow() -> datetime:
        return world.clock["now"] or _now()

    monkeypatch.setattr(real_call_metadata, "resolve_installed_get_message", installed)
    monkeypatch.setattr(PluginService, "is_plugin_verified", verified)
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", fetch_tool_provider)
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt_token)
    monkeypatch.setattr(OAuthHandler, "_request_with_plugin_daemon_response_stream", refresh_stream)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", invoke_stream)
    monkeypatch.setattr(LlmBuilderAgent, "_model", no_model)
    monkeypatch.setattr(real_call_consent_service, "_utcnow", utcnow)
    try:
        yield world
        assert boundary.model_calls == []
    finally:
        boundary.witness.close()
        set_dify_builder_agent_factory(None)
        reset_provider_cache()


@pytest.fixture
def native_claim_candidate(
    gmail: Gmail, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[BuilderRealCallConsentService, ConfirmedToolExecutionContext, str, str]]:
    """A real prepared/confirmed/reserved grant whose native worker is held at its Tool ``get_runtime``.

    The real port runs in a test thread. At entry to the native Tool runtime's ``get_runtime``
    callback (before the original method claims anything) the actual allocated native Run ID and
    node execution ID are captured and the worker waits on a bounded event. The fixture yields
    while that worker is held; teardown always releases and joins it. The test spends the grant
    with those actual IDs, so the held worker's later claim is refused and it reaches no transport.
    """
    reserved = gmail.reserved()
    assert reserved.execution_request_id is not None
    reached, release = Event(), Event()
    captured: dict[str, str] = {}
    original = DifyToolNodeRuntime.get_runtime

    def held(
        runtime: DifyToolNodeRuntime,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool: VariablePool | None,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle:
        if node_id == TOOL_NODE and "node" not in captured:
            # Graphon passes this Run's own pool (Tool parameter format v2) and its bound execution ID.
            pool_run_id = None
            if variable_pool is not None:
                pool_run_id = get_system_text(variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
            captured["run"], captured["node"] = pool_run_id or "", node_execution_id or ""
            reached.set()
            captured["released"] = "yes" if release.wait(timeout=_HOLD_SECONDS) else "timeout"
        return original(
            runtime,
            node_id=node_id,
            node_data=node_data,
            variable_pool=variable_pool,
            node_execution_id=node_execution_id,
        )

    monkeypatch.setattr(DifyToolNodeRuntime, "get_runtime", held)
    outcome: dict[str, object] = {}

    def launch() -> None:
        try:
            outcome["run"] = in_request(gmail.app, lambda: gmail.run(reserved))()
        except BaseException as error:
            outcome["error"] = type(error).__name__

    worker = Thread(target=launch, name="held-native-confirmed-run", daemon=True)
    worker.start()
    try:
        assert reached.wait(timeout=_HOLD_SECONDS), "native worker never reached the Tool get_runtime callback"
        run_id, node_execution_id = captured["run"], captured["node"]
        assert run_id
        assert node_execution_id
        # The captured Run ID is the one the native launch claim already bound to this sidecar.
        request = gmail.request(reserved.execution_request_id)
        assert (request.state, request.native_run_id) == ("running", run_id)
        context = gmail.context(reserved.execution_request_id)
        assert (context.consent_id, context.command_id) == (reserved.consent_id, reserved.command_id)
        yield gmail.service(), context, run_id, node_execution_id
    finally:
        release.set()
        worker.join(timeout=_JOIN_SECONDS)
    assert not worker.is_alive(), "held native worker did not finish"
    assert captured.get("released") == "yes"
    assert "error" not in outcome, outcome
    # The held worker's own claim was refused: nothing was decrypted, refreshed or sent.
    assert [gmail.boundary.count(name) for name in ("decrypt", "refresh", "invoke")] == [0, 0, 0]
    assert {run.id for run in gmail.native_runs()} == {captured["run"]}


# -- one confirmed native Run --------------------------------------------------------------------


def _assert_completed_native_run(gmail: Gmail, reserved: ConsentReceipt, result: Run) -> None:
    """One native Run with ordered Start → Tool → End rows bound to the consent and sealed completed."""
    assert reserved.execution_request_id is not None
    row = gmail.consent(reserved.consent_id)
    request = gmail.request(reserved.execution_request_id)
    runs = gmail.native_runs()
    assert [run.id for run in runs] == [result.dify_run_id]
    native = runs[0]
    assert native.status == "succeeded"
    assert (native.tenant_id, native.app_id, native.workflow_id, native.created_by) == (
        gmail.actor.tenant_id,
        gmail.app_id,
        gmail.workflow_id,
        gmail.actor.account_id,
    )
    nodes = gmail.native_nodes(native.id)
    assert [node.node_id for node in nodes] == ["start", TOOL_NODE, "end"]
    tool = nodes[1]
    assert tool.status == "succeeded"
    assert (row.native_run_id, row.native_node_execution_id) == (native.id, tool.node_execution_id)
    assert (request.state, request.native_run_id) == ("sealed", native.id)
    summary = request.completion_summary
    assert isinstance(summary, dict)
    assert (summary.get("safety_outcome"), summary.get("consent_id"), summary.get("sealed")) == (
        "confirmed_tool_completed",
        reserved.consent_id,
        True,
    )
    assert (row.state, row.outcome_state, row.reason_code, row.business_count) == (
        "completed",
        "completed",
        "message_returned",
        1,
    )
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "confirmed_tool_completed"
    assert result.verification.terminal_outputs is None
    # Content stays in the authorized native Run/node rows only.
    assert BODY in (native.outputs or "")
    assert BODY in (tool.outputs or "")
    assert_no_secret(repr(result), gmail.builder_state_text())


def _confirmed_headers(gmail: Gmail) -> dict[str, str]:
    """Native daemon headers plus exactly the companion headers pinning the stored installation."""
    return {
        "X-Plugin-ID": PLUGIN,
        "Content-Type": "application/json",
        **confirmed_dispatch_headers(_installed(gmail.actor.tenant_id, gmail.boundary.declaration)),
    }


def _assert_confirmed_dispatch(gmail: Gmail, call: Call, credentials: Mapping[str, str]) -> None:
    assert call.path == f"plugin/{gmail.actor.tenant_id}/dispatch/tool/invoke"
    assert call.headers == _confirmed_headers(gmail)
    assert call.payload["credentials"] == dict(credentials)
    assert call.payload["tool_parameters"] == APPROVED_PARAMETERS


def test_confirmed_native_run_reads_once_without_refresh(gmail: Gmail) -> None:
    reserved = gmail.reserved()
    drafts_before = gmail.draft_variables()
    frames: list[Mapping[str, object]] = []
    result = gmail.run(reserved, frames)

    _assert_completed_native_run(gmail, reserved, result)
    assert gmail.boundary.refresh_calls == []
    assert len(gmail.boundary.invoke_calls) == 1
    _assert_confirmed_dispatch(
        gmail, gmail.boundary.invoke_calls[0], {"access_token": ACCESS_TOKEN, "refresh_token": REFRESH_TOKEN}
    )
    assert gmail.boundary.count("decrypt") == 2
    assert gmail.consent(reserved.consent_id).refresh_count == 0
    # Metadata reads, native decryption and the dispatch all ran with no SQL transaction open.
    assert_outside_sql(gmail.boundary, "metadata", "declaration", "decrypt", "invoke")
    order = gmail.boundary.order()
    assert order.index("decrypt") < order.index("invoke")
    # Confirmed content is retained in the native Run, never copied into mutable draft variables.
    assert gmail.draft_variables() == drafts_before
    assert_no_secret(json.dumps(frames, default=str))


def test_confirmed_native_run_refreshes_once_then_reads(gmail: Gmail) -> None:
    with gmail.factory.begin() as session:
        row = session.get(BuiltinToolProvider, gmail.credential_id)
        assert row is not None
        # Due for refresh when the Tool node runs (native rule: within 60 seconds of expiry).
        row.expires_at = int(time()) + 45
    reserved = gmail.reserved()
    before = gmail.credential().encrypted_credentials
    result = gmail.run(reserved)

    _assert_completed_native_run(gmail, reserved, result)
    assert len(gmail.boundary.refresh_calls) == 1
    refresh = gmail.boundary.refresh_calls[0]
    assert refresh.path == f"plugin/{gmail.actor.tenant_id}/dispatch/oauth/refresh_credentials"
    assert refresh.headers == _confirmed_headers(gmail)
    # The exact tenant OAuth client the grant bound, natively decrypted.
    assert refresh.payload["system_credentials"] == {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET}
    assert refresh.payload["credentials"] == {"access_token": ACCESS_TOKEN, "refresh_token": REFRESH_TOKEN}
    assert len(gmail.boundary.invoke_calls) == 1
    _assert_confirmed_dispatch(gmail, gmail.boundary.invoke_calls[0], REFRESHED)
    order = gmail.boundary.order()
    assert order.index("refresh") < order.index("invoke")
    assert_outside_sql(gmail.boundary, "metadata", "decrypt", "refresh", "invoke")
    # The CAS persisted natively re-encrypted refreshed credentials, once.
    credential = gmail.credential()
    assert credential.encrypted_credentials != before
    stored = json.loads(credential.encrypted_credentials or "{}")
    assert {name: _REAL_DECRYPT(gmail.actor.tenant_id, value) for name, value in stored.items()} == REFRESHED
    consent = gmail.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count) == (1, 1)
    assert consent.derived_credential_revision is not None


@pytest.fixture
def no_live_restricted(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[str]]:
    """Failing spies at every ordinary live Tool/OAuth entry (the restricted default must reach none)."""
    from core.tools.tool_manager import ToolManager

    reached: list[str] = []

    def refuse(name: str) -> Callable[..., object]:
        def spy(*_args: object, **_kwargs: object) -> object:
            reached.append(name)
            raise AssertionError(f"live capability reached: {name}")

        return spy

    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", refuse("get_workflow_tool_runtime"))
    monkeypatch.setattr(OAuthHandler, "refresh_credentials", refuse("refresh_credentials"))
    yield reached
    assert reached == []


@pytest.mark.usefixtures("no_live_restricted")
def test_restricted_default_run_has_zero_decrypt_refresh_or_invoke(gmail: Gmail) -> None:
    """The same graph through the default (restricted) Builder run never reaches any real capability."""
    result = WorkflowServiceDifyPort().run_draft(
        gmail.app_id,
        gmail.actor,
        dict(gmail.inputs),
        lambda _event: None,
        session_id=gmail.session_id,
        test_input_id=gmail.test_input_id,
    )
    assert result.execution_refusal is not None
    assert result.dify_run_id == ""
    assert gmail.native_runs() == []
    for boundary in ("metadata", "verification", "declaration", "decrypt", "refresh", "invoke"):
        assert gmail.boundary.count(boundary) == 0, boundary
    assert gmail.count(DifyBuilderRealCallConsent) == 0


def test_ordinary_native_gmail_workflow_stays_ordinary(gmail: Gmail) -> None:
    """Without Builder consent the native Tool path is unchanged: no guard, headers, consent or sidecar."""
    from core.app.entities.app_invoke_entities import InvokeFrom
    from services.app_generate_service import AppGenerateService
    from services.dify_builder.run_mapping import run_id_from_stream_chunk, stream_chunk_as_mapping

    drafts_before = gmail.draft_variables()
    with gmail.factory() as session:
        account = session.get(Account, gmail.actor.account_id)
        native_app = session.get(App, gmail.app_id)
        assert account is not None
        assert native_app is not None
        response = AppGenerateService.generate(
            native_app,
            account,
            {"inputs": dict(gmail.inputs)},
            InvokeFrom.DEBUGGER,
            session=session,
            streaming=True,
            workflow_execution_mode="in_process",
        )
    native_id = ""
    try:
        for chunk in response:
            payload = stream_chunk_as_mapping(chunk)
            if payload:
                native_id = native_id or run_id_from_stream_chunk(payload)
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()
    runs = gmail.native_runs()
    assert [run.id for run in runs] == [native_id]
    assert runs[0].status == "succeeded"
    assert BODY in (runs[0].outputs or "")
    assert len(gmail.boundary.invoke_calls) == 1
    call = gmail.boundary.invoke_calls[0]
    # The ordinary dispatch carries no confirmed companion headers.
    assert call.headers == {"X-Plugin-ID": PLUGIN, "Content-Type": "application/json"}
    assert call.payload["credentials"] == {"access_token": ACCESS_TOKEN, "refresh_token": REFRESH_TOKEN}
    assert gmail.boundary.count("metadata") == 0
    assert gmail.count(DifyBuilderRealCallConsent) == 0
    with gmail.factory() as session:
        assert session.scalars(select(DifyBuilderExecutionRequest)).first() is None
    # The ordinary debugger keeps its native draft variables (the confirmed control's query is meaningful).
    assert gmail.draft_variables() > drafts_before


# -- denials, claims and races ---------------------------------------------------------------------


_CHANGE_STATE = {
    "graph": "failed",
    "input": "failed",
    "node_class": "failed",
    "node_version": "failed",
    "schema": "failed",
    "artifact": "failed",
    "permission": "failed",
    "credential": "invalidated",
    "client": "invalidated",
}


def _edit_tool(gmail: Gmail, edit: Callable[[dict[str, object]], None]) -> None:
    with gmail.factory.begin() as session:
        draft = session.get(Workflow, gmail.workflow_id)
        assert draft is not None
        graph = json.loads(draft.graph)
        edit(next(node["data"] for node in graph["nodes"] if node["id"] == TOOL_NODE))
        draft.graph = json.dumps(graph)


def _another_message(data: dict[str, object]) -> None:
    parameters = data["tool_parameters"]
    assert isinstance(parameters, dict)
    parameters["message_id"] = {"type": "constant", "value": "18cab_2"}


def _apply_change(gmail: Gmail, change: str, monkeypatch: pytest.MonkeyPatch) -> None:
    if change == "graph":
        _edit_tool(gmail, _another_message)
    elif change == "node_version":
        _edit_tool(gmail, lambda data: data.update(version="2"))
    elif change == "input":
        with gmail.factory.begin() as session:
            test_input = session.get(DifyBuilderTestInput, gmail.test_input_id)
            assert test_input is not None
            test_input.inputs = {"path": "changed after confirmation"}
    elif change == "node_class":

        class Replacement:
            @staticmethod
            def validate_node_data(_data: object) -> None:
                pytest.fail("unreviewed native class reached validation")

        def replaced(**_kwargs: object) -> type[Replacement]:
            return Replacement

        monkeypatch.setattr(node_factory, "resolve_workflow_node_class", replaced)
    elif change == "schema":
        gmail.boundary.declaration = _declaration(extra_parameter=True)
    elif change == "artifact":
        gmail.boundary.declaration = _declaration(unique_identifier=f"{PLUGIN}:9.9.10@{'f' * 64}")
    elif change == "credential":
        gmail.write_credential(gmail.rotated_ciphertext("ci-rotated-access-sentinel"))
    elif change == "client":
        with gmail.factory.begin() as session:
            client = session.get(ToolOAuthTenantClient, gmail.client_id)
            assert client is not None
            client.encrypted_oauth_params = json.dumps({"client_id": "ci-replaced-client", "client_secret": "x"})
    elif change == "permission":
        with gmail.factory.begin() as session:
            membership = session.scalar(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == gmail.actor.tenant_id,
                    TenantAccountJoin.account_id == gmail.actor.account_id,
                )
            )
            assert membership is not None
            membership.role = TenantAccountRole.NORMAL
    else:
        raise AssertionError(change)


@pytest.mark.parametrize("change", list(_CHANGE_STATE))
def test_changes_after_reservation_are_denied_without_effects(
    gmail: Gmail, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    """Any graph/input/class/version/schema/credential/client/artifact/permission change refuses before a spend."""
    reserved = gmail.reserved()
    _apply_change(gmail, change, monkeypatch)
    result = gmail.run(reserved)

    row = gmail.consent(reserved.consent_id)
    assert (row.state, row.claimed_at, row.refresh_count, row.business_count) == (_CHANGE_STATE[change], None, 0, 0)
    for boundary in ("decrypt", "refresh", "invoke"):
        assert gmail.boundary.count(boundary) == 0, boundary
    assert (
        result.verification is None
        or result.verification.execution_evidence is None
        or (result.verification.execution_evidence.safety_outcome != "confirmed_tool_completed")
    )
    for native in gmail.native_runs():
        assert all(node.status != "succeeded" for node in gmail.native_nodes(native.id) if node.node_id == TOOL_NODE)
    assert_no_secret(repr(result), gmail.builder_state_text())


def test_postgres_tool_claim_has_one_winner(
    native_claim_candidate: tuple[BuilderRealCallConsentService, ConfirmedToolExecutionContext, str, str],
    gmail: Gmail,
) -> None:
    service, context, run_id, node_execution_id = native_claim_candidate

    def claim() -> str:
        service.claim_tool(
            context=context, node_id=TOOL_NODE, native_run_id=run_id, native_node_execution_id=node_execution_id
        )
        return "claimed"

    assert sorted(str(result) for result in race(claim, claim)) == ["claimed", "consent_already_claimed"]
    row = gmail.consent(context.consent_id)
    assert (row.state, row.native_run_id, row.native_node_execution_id) == ("claimed", run_id, node_execution_id)
    # A fresh service (another process) can never reopen the committed claim.
    assert race(claim) == ["consent_already_claimed"]


def test_duplicate_native_launches_create_one_run(gmail: Gmail) -> None:
    reserved = gmail.reserved()
    results = race(
        in_request(gmail.app, lambda: gmail.run(reserved)), in_request(gmail.app, lambda: gmail.run(reserved))
    )
    runs = [result for result in results if isinstance(result, Run)]
    assert len(runs) == 2, results
    winners = [run for run in runs if run.execution_refusal is None]
    losers = [run for run in runs if run.execution_refusal is not None]
    assert len(winners) == 1
    assert len(losers) == 1
    assert losers[0].execution_refusal is not None
    assert losers[0].execution_refusal.reason_code in DUPLICATE_LAUNCH
    _assert_completed_native_run(gmail, reserved, winners[0])
    assert len(gmail.boundary.invoke_calls) == 1


def test_refresh_cas_conflict_keeps_the_rotation_and_blocks_business(gmail: Gmail) -> None:
    with gmail.factory.begin() as session:
        row = session.get(BuiltinToolProvider, gmail.credential_id)
        assert row is not None
        row.expires_at = int(time()) + 45
    reserved = gmail.reserved()
    rotated = gmail.rotated_ciphertext("ci-concurrent-rotation-sentinel")

    def rotate_during_refresh() -> None:
        # The native credential writer lands while the refresh transport is in flight.
        gmail.write_credential(rotated)

    gmail.boundary.on_refresh = rotate_during_refresh
    result = gmail.run(reserved)

    assert len(gmail.boundary.refresh_calls) == 1
    assert gmail.boundary.invoke_calls == []
    # The CAS never overwrites the concurrent rotation.
    assert gmail.credential().encrypted_credentials == rotated
    row = gmail.consent(reserved.consent_id)
    assert (row.state, row.reason_code, row.refresh_count, row.business_count, row.derived_credential_revision) == (
        "unknown",
        "refresh_conflict",
        1,
        0,
        None,
    )
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


def test_partial_stream_is_unknown(gmail: Gmail) -> None:
    reserved = gmail.reserved()
    gmail.boundary.invoke_fail_after = 2  # TEXT and VARIABLE arrive, then the transport is lost
    result = gmail.run(reserved)

    row = gmail.consent(reserved.consent_id)
    assert (row.state, row.outcome_state, row.reason_code, row.business_count) == (
        "unknown",
        "unknown",
        "stream_incomplete",
        1,
    )
    assert len(gmail.boundary.invoke_calls) == 1
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    assert_no_secret(repr(result), gmail.builder_state_text())


def test_native_success_with_text_only_result_is_unknown(gmail: Gmail) -> None:
    """The action's failure grammar is TEXT only: the native node succeeds, the action stays unknown."""
    reserved = gmail.reserved()
    gmail.boundary.invoke_messages = [_text(f"Failed to get message {NATIVE_SECRET}")]
    result = gmail.run(reserved)

    runs = gmail.native_runs()
    assert len(runs) == 1
    assert runs[0].status == "succeeded"
    row = gmail.consent(reserved.consent_id)
    assert (row.state, row.outcome_state, row.reason_code, row.business_count) == (
        "unknown",
        "unknown",
        "result_missing",
        1,
    )
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    assert_no_secret(repr(result), gmail.builder_state_text())


def _expires_at(gmail: Gmail, consent_id: str) -> datetime:
    return gmail.consent(consent_id).expires_at.replace(tzinfo=UTC)


def test_expiry_blocks_a_new_phase(gmail: Gmail, monkeypatch: pytest.MonkeyPatch) -> None:
    """The grant is claimed before expiry; expiry then passes before the business phase is spent."""
    reserved = gmail.reserved()
    expires_at = _expires_at(gmail, reserved.consent_id)
    original = DifyToolNodeRuntime.get_runtime

    def claim_then_expire(
        runtime: DifyToolNodeRuntime,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool: VariablePool | None,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle:
        handle = original(
            runtime,
            node_id=node_id,
            node_data=node_data,
            variable_pool=variable_pool,
            node_execution_id=node_execution_id,
        )
        gmail.clock["now"] = expires_at
        return handle

    monkeypatch.setattr(DifyToolNodeRuntime, "get_runtime", claim_then_expire)
    gmail.run(reserved)

    row = gmail.consent(reserved.consent_id)
    assert row.claimed_at is not None
    assert (row.state, row.refresh_count, row.business_count) == ("failed", 0, 0)
    assert gmail.boundary.invoke_calls == []


def test_completion_of_a_dispatched_phase_after_expiry_is_recorded(gmail: Gmail) -> None:
    reserved = gmail.reserved()
    expires_at = _expires_at(gmail, reserved.consent_id)

    def expire_in_flight() -> None:
        gmail.clock["now"] = expires_at + timedelta(seconds=1)

    gmail.boundary.on_invoke = expire_in_flight
    result = gmail.run(reserved)

    assert gmail.clock["now"] is not None
    assert gmail.clock["now"] > expires_at
    _assert_completed_native_run(gmail, reserved, result)
    receipt = gmail.service().get(actor=gmail.actor, session_id=gmail.session_id, consent_id=reserved.consent_id)
    assert (receipt.state, receipt.business_claimed, receipt.can_retry) == ("completed", True, False)


# -- crash boundaries (forked children killed mid-call) -------------------------------------------


def _crash_in_child(gmail: Gmail, reserved: ConsentReceipt, phase: Literal["refresh", "invoke"]) -> dict[str, object]:
    """Run the real port in a forked child that is killed (``os._exit``) at ``phase``; return its facts.

    Process death is the crash: no ``finally``, outcome callback, seal or settlement runs in the
    child. The parent only supervises a plain pipe with a deadline, then joins, terminates and
    finally kills the child, each bounded.
    """
    assert "fork" in multiprocessing.get_all_start_methods(), "crash containment needs fork (Linux CI)"
    ctx = multiprocessing.get_context("fork")
    receiver, sender = ctx.Pipe(duplex=False)
    gmail.boundary.crash_at, gmail.boundary.crash_channel = phase, sender

    def child_main(channel: Connection) -> None:
        facts: dict[str, object] = {}
        try:
            with gmail.app.test_request_context():
                # Drop the inherited pool without closing the parent's sockets.
                db.engine.dispose(close=False)
                reset_provider_cache()
                facts["returned"] = gmail.run(reserved).status
        except BaseException as error:
            facts["child_error"] = type(error).__name__
        channel.send(facts)
        channel.close()

    child = ctx.Process(target=child_main, args=(sender,), name=f"crash-at-{phase}", daemon=True)
    facts: dict[str, object] | None = None
    child_alive = False
    exitcode: int | None = None
    try:
        child.start()
        sender.close()
        if receiver.poll(_CHILD_RESULT_SECONDS):
            try:
                facts = receiver.recv()
            except EOFError:
                facts = None
    finally:
        gmail.boundary.crash_at, gmail.boundary.crash_channel = None, None
        sender.close()
        if child.pid is not None:
            child.join(timeout=_CHILD_JOIN_SECONDS)
            if child.is_alive():
                child.terminate()
                child.join(timeout=_CHILD_JOIN_SECONDS)
            if child.is_alive():
                child.kill()
                child.join(timeout=_CHILD_JOIN_SECONDS)
            child_alive = child.is_alive()
            exitcode = child.exitcode
            if not child_alive:
                child.close()
        receiver.close()
    assert not child_alive, "crash child survived terminate() and kill()"
    assert facts is not None, "crash child reported nothing within its deadline"
    assert facts.get("crashed_at") == phase, facts
    assert exitcode == _CRASH_EXIT, exitcode
    return facts


def _assert_crash_never_repeats(gmail: Gmail, reserved: ConsentReceipt) -> None:
    """Reconciliation settles the spent grant unknown once; nothing ever replays it."""
    assert reserved.execution_request_id is not None
    gmail.make_stale()
    assert gmail.lease() is None
    assert reconcile_interrupted_sessions() == 1
    row = gmail.consent(reserved.consent_id)
    assert (row.state, row.reason_code) == ("unknown", "launch_stranded")
    counters = (row.claimed_at, row.refresh_count, row.business_count, row.refresh_claimed_at, row.business_claimed_at)
    # A redelivered command, a fresh claim and further sweeps change nothing and reach no transport.
    replay = gmail.run(reserved)
    assert replay.execution_refusal is not None
    assert replay.execution_refusal.reason_code == "execution_already_launched"
    context = gmail.context(reserved.execution_request_id)
    with pytest.raises(BuilderExecutionPolicyError):
        gmail.service().claim_tool(
            context=context,
            node_id=TOOL_NODE,
            native_run_id=row.native_run_id or "",
            native_node_execution_id=row.native_node_execution_id or "",
        )
    reconcile_interrupted_sessions()
    gmail.service().reconcile_terminal_grants(limit=100, lease_held=session_lock.exists)
    again = gmail.consent(reserved.consent_id)
    assert again.state == "unknown"
    assert (
        again.claimed_at,
        again.refresh_count,
        again.business_count,
        again.refresh_claimed_at,
        again.business_claimed_at,
    ) == counters
    assert (gmail.boundary.count("refresh"), gmail.boundary.count("invoke")) == (0, 0)


def test_crash_after_refresh_claim_before_persistence_settles_unknown_once(gmail: Gmail) -> None:
    with gmail.factory.begin() as session:
        row = session.get(BuiltinToolProvider, gmail.credential_id)
        assert row is not None
        row.expires_at = int(time()) + 45
    reserved = gmail.reserved()
    assert reserved.execution_request_id is not None
    before = gmail.credential().encrypted_credentials
    facts = _crash_in_child(gmail, reserved, "refresh")
    assert (facts.get("refresh_calls"), facts.get("invoke_calls")) == (1, 0)

    row = gmail.consent(reserved.consent_id)
    # Durable at the crash: the claim and the spent refresh phase; nothing persisted after it.
    assert row.claimed_at is not None
    assert row.refresh_claimed_at is not None
    assert (row.state, row.refresh_count, row.business_count, row.derived_credential_revision) == (
        "claimed",
        1,
        0,
        None,
    )
    assert gmail.credential().encrypted_credentials == before
    request = gmail.request(reserved.execution_request_id)
    assert (request.state, request.native_run_id) == ("running", row.native_run_id)
    assert row.native_run_id in {run.id for run in gmail.native_runs()}
    _assert_crash_never_repeats(gmail, reserved)


def test_crash_after_business_claim_before_transport_settles_unknown_once(gmail: Gmail) -> None:
    reserved = gmail.reserved()
    assert reserved.execution_request_id is not None
    facts = _crash_in_child(gmail, reserved, "invoke")
    assert (facts.get("refresh_calls"), facts.get("invoke_calls")) == (0, 0)

    row = gmail.consent(reserved.consent_id)
    assert row.business_claimed_at is not None
    assert (row.state, row.refresh_count, row.business_count, row.outcome_state) == ("claimed", 0, 1, None)
    request = gmail.request(reserved.execution_request_id)
    assert (request.state, request.native_run_id) == ("running", row.native_run_id)
    _assert_crash_never_repeats(gmail, reserved)


# -- worker deliveries, settlement repair and durable receipts --------------------------------------


def _deliver(gmail: Gmail, delivery: Delivery) -> Callable[[], None]:
    def run() -> None:
        # Each Celery delivery runs the real task body (its FlaskTask app context, Redis Lua lease).
        with gmail.app.app_context():
            reset_provider_cache()
            advance_session(*delivery)

    return run


def test_same_token_worker_deliveries_activate_once(gmail: Gmail, deliveries: list[Delivery]) -> None:
    """Two concurrent deliveries of one reserved command: one activation, one native launch.

    The loser neither runs, releases nor settles; the bare dispatch token cannot delete the
    winner's lease; the sweeper skips the live lease; only the winner releases it.
    """
    receipt = gmail.execute(gmail.confirmed())
    assert receipt.command_id is not None
    assert receipt.execution_request_id is not None
    assert len(deliveries) == 1
    token = deliveries[0][3]
    assert gmail.lease() == token
    _state, reserved_version, _fc = gmail.head()
    drafts_before = gmail.draft_variables()
    in_transport, release = Event(), Event()
    held: dict[str, bool] = {}

    def hold_winner() -> None:
        in_transport.set()
        held["released"] = release.wait(timeout=_HOLD_SECONDS)

    gmail.boundary.on_invoke = hold_winner
    barrier = Barrier(2)
    outcomes: dict[str, str] = {}

    def delivery(name: str) -> None:
        try:
            barrier.wait(timeout=10)
            _deliver(gmail, deliveries[0])()
            outcomes[name] = "returned"
        except BaseException as error:
            outcomes[name] = f"error:{type(error).__name__}"

    threads = [Thread(target=delivery, args=(name,), name=f"delivery-{name}", daemon=True) for name in ("a", "b")]
    for thread in threads:
        thread.start()
    try:
        assert in_transport.wait(timeout=_HOLD_SECONDS), "no delivery reached the native transport"
        deadline = monotonic() + 30
        while all(thread.is_alive() for thread in threads) and monotonic() < deadline:
            sleep(0.05)
        finished = [thread for thread in threads if not thread.is_alive()]
        assert len(finished) == 1, "the losing delivery did not return while the winner was held"
        owner = gmail.lease()
        assert owner is not None
        assert owner.startswith(f"{token}:")
        # The bare dispatch token (web-process release) can no longer delete the active lease.
        session_lock.release(gmail.session_id, token)
        assert gmail.lease() == owner
        # The sweeper leaves a live lease alone: nothing is flagged, settled or committed.
        gmail.make_stale()
        assert reconcile_interrupted_sessions() == 0
        row = gmail.consent(receipt.consent_id)
        assert (row.state, row.business_count, row.outcome_state) == ("claimed", 1, None)
        assert gmail.request(receipt.execution_request_id).state == "running"
        assert gmail.head()[1] == reserved_version
        assert len(gmail.native_runs()) == 1
    finally:
        release.set()
        for thread in threads:
            thread.join(timeout=_JOIN_SECONDS)
    assert not any(thread.is_alive() for thread in threads)
    assert held.get("released") is True
    assert outcomes == {"a": "returned", "b": "returned"}
    # Only the winner released its own lease after its terminal commit.
    assert gmail.lease() is None
    state, version, fc = gmail.head()
    assert (state, version) == (str(PcState.BUILD_REVIEW), reserved_version + 1)
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert len(gmail.native_runs()) == 1
    assert len(gmail.boundary.invoke_calls) == 1
    assert gmail.consent(receipt.consent_id).state == "completed"
    assert_outside_sql(gmail.boundary, "decrypt", "invoke")
    assert gmail.draft_variables() == drafts_before
    assert_no_secret(gmail.builder_state_text())


def _broken_agent() -> DifyBuilderAgent:
    # Agent construction fails after the worker reloaded its reserved command (production override hook).
    raise RuntimeError("agent construction failed")


def test_agent_setup_failure_settles_the_grant_without_spend(gmail: Gmail, deliveries: list[Delivery]) -> None:
    set_dify_builder_agent_factory(_broken_agent)
    receipt = gmail.execute(gmail.confirmed())
    _state, reserved_version, _fc = gmail.head()
    _deliver(gmail, deliveries[0])()

    state, version, fc = gmail.head()
    assert (state, version) == (str(PcState.FAILED), reserved_version + 1)
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    row = gmail.consent(receipt.consent_id)
    assert (row.state, row.reason_code, row.claimed_at, row.refresh_count, row.business_count) == (
        "failed",
        "launch_not_claimed",
        None,
        0,
        0,
    )
    assert gmail.lease() is None
    assert gmail.native_runs() == []
    for boundary in ("decrypt", "refresh", "invoke"):
        assert gmail.boundary.count(boundary) == 0, boundary


def test_transient_settlement_failure_is_repaired_by_the_terminal_scan(
    gmail: Gmail, deliveries: list[Delivery], monkeypatch: pytest.MonkeyPatch
) -> None:
    # An unexecuted confirmation of the same session: never a settlement candidate.
    unexecuted = gmail.confirmed("unexecuted")
    receipt = gmail.execute(gmail.confirmed())
    set_dify_builder_agent_factory(_broken_agent)
    original = BuilderRealCallConsentService.settle_launch
    failures: list[str] = []

    def fail_once(service: BuilderRealCallConsentService, *, context: ConfirmedToolExecutionContext) -> ConsentReceipt:
        if not failures:
            failures.append(context.consent_id)
            raise RuntimeError("transient settlement write failure")
        return original(service, context=context)

    monkeypatch.setattr(BuilderRealCallConsentService, "settle_launch", fail_once)
    _deliver(gmail, deliveries[0])()
    assert failures == [receipt.consent_id]
    state, version, _fc = gmail.head()
    assert state == str(PcState.FAILED)
    assert gmail.consent(receipt.consent_id).state == "confirmed"

    # The authoritative bounded scan repairs it: no head mutation, no redispatch.
    gmail.make_stale()
    reconcile_interrupted_sessions()
    row = gmail.consent(receipt.consent_id)
    assert (row.state, row.reason_code, row.claimed_at, row.refresh_count, row.business_count) == (
        "failed",
        "launch_stranded",
        None,
        0,
        0,
    )
    assert gmail.head()[:2] == (state, version)
    assert len(deliveries) == 1
    untouched = gmail.consent(unexecuted.consent_id)
    assert (untouched.state, untouched.command_id) == ("confirmed", None)
    assert gmail.native_runs() == []


def _recover_and_reserve_fresh(gmail: Gmail) -> ConsentReceipt:
    """A recovery commit, then a new human prepare/confirm and a fresh coordinator reservation.

    The recovery head transition is committed through the same repository CAS owner the
    Runner's recovery branch uses: the working state returns to its waiting gate and the
    pending confirmed references are cleared (a recovered step never reuses a reservation).
    """
    _state, version, fc = gmail.head()
    fc.confirmed_consent_id, fc.confirmed_command_id = "", ""
    SqlDifyBuilderRepository(gmail.factory).compare_and_advance(
        gmail.session_id, version, PcState.BUILD_AWAIT_TESTDATA, fc, []
    )
    fresh = gmail.execute(gmail.confirmed("fresh"), key="execute-fresh")
    assert fresh.command_id is not None
    return fresh


def _stranded(gmail: Gmail, deliveries: list[Delivery]) -> ConsentReceipt:
    """A reserved command whose delivery never ran and whose dispatch lease expired."""
    stranded = gmail.execute(gmail.confirmed())
    assert len(deliveries) == 1
    session_lock.release(gmail.session_id, deliveries[0][3])
    assert gmail.lease() is None
    gmail.make_stale()
    return stranded


def test_terminal_repair_never_settles_a_fresh_live_reservation(gmail: Gmail, deliveries: list[Delivery]) -> None:
    """The per-ID terminal repair interleaved with recovery and a fresh reservation stays safe."""
    stranded = _stranded(gmail, deliveries)
    started: list[str] = []
    fresh: list[ConsentReceipt] = []

    def lease_held(session_id: str) -> bool:
        # The repair observed no lease; recovery and a fresh reservation commit before it settles.
        held = session_lock.exists(session_id)
        if session_id == gmail.session_id and not started:
            started.append(session_id)
            fresh.append(_recover_and_reserve_fresh(gmail))
        return held

    gmail.service().reconcile_terminal_grants(limit=100, lease_held=lease_held)
    assert len(fresh) == 1
    assert gmail.consent(stranded.consent_id).state == "failed"
    live = gmail.consent(fresh[0].consent_id)
    assert (live.state, live.command_id) == ("confirmed", fresh[0].command_id)
    assert gmail.lease() == deliveries[1][3]


def test_completed_grant_replays_and_receipts_stay_durable(gmail: Gmail) -> None:
    """Saved confirm/execute replays, status, actor/scope/body ownership and claim permanence after use."""
    prepared = gmail.prepare()
    decided = gmail.confirm(prepared)
    reserved, won = gmail.reserve(decided)
    assert won is True
    assert reserved.execution_request_id is not None
    _assert_completed_native_run(gmail, reserved, gmail.run(reserved))
    service = gmail.service()

    with gmail.factory.begin() as session:
        other = Account(name="Other editor", email=f"{uuid4()}@example.invalid")
        session.add(other)
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=gmail.actor.tenant_id, account_id=other.id, role=TenantAccountRole.EDITOR, current=True
            )
        )
        other_actor = Actor(account_id=other.id, tenant_id=gmail.actor.tenant_id)
    for call in (
        lambda: service.get(actor=other_actor, session_id=gmail.session_id, consent_id=reserved.consent_id),
        lambda: service.reserve_execution(
            actor=other_actor,
            session_id=gmail.session_id,
            consent_id=reserved.consent_id,
            scope_digest=reserved.scope_digest,
            at_version=decided.at_version,
            idempotency_key="execute-1",
        ),
    ):
        with pytest.raises(BuilderExecutionPolicyError, match="consent_not_found"):
            call()

    replay, replay_won = gmail.reserve(decided)
    assert replay_won is False
    assert (replay.state, replay.command_id, replay.execution_request_id) == (
        "completed",
        reserved.command_id,
        reserved.execution_request_id,
    )
    # A different key, scope or version never matches the saved execute body.
    for key, scope, version in (
        ("execute-other", decided.scope_digest, decided.at_version),
        ("execute-1", "0" * 64, decided.at_version),
        ("execute-1", decided.scope_digest, decided.at_version + 1),
    ):
        with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
            service.reserve_execution(
                actor=gmail.actor,
                session_id=gmail.session_id,
                consent_id=reserved.consent_id,
                scope_digest=scope,
                at_version=version,
                idempotency_key=key,
            )
    assert gmail.confirm(prepared) == decided
    with pytest.raises(BuilderExecutionPolicyError, match="consent_decision_conflict"):
        gmail.confirm(prepared, key="confirm-other")
    status = service.get(actor=gmail.actor, session_id=gmail.session_id, consent_id=reserved.consent_id)
    assert (status.state, status.business_claimed, status.can_retry) == ("completed", True, False)

    # Permanent: no claim, sweep or redelivery reopens or resets the spent grant.
    row = gmail.consent(reserved.consent_id)
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_tool(
            context=gmail.context(reserved.execution_request_id),
            node_id=TOOL_NODE,
            native_run_id=row.native_run_id or "",
            native_node_execution_id=row.native_node_execution_id or "",
        )
    gmail.make_stale()
    reconcile_interrupted_sessions()
    service.reconcile_terminal_grants(limit=100, lease_held=session_lock.exists)
    redelivered = gmail.run(reserved)
    assert redelivered.execution_refusal is not None
    assert redelivered.execution_refusal.reason_code == "execution_already_launched"
    after = gmail.consent(reserved.consent_id)
    assert (after.state, after.claimed_at, after.business_count, after.business_claimed_at) == (
        "completed",
        row.claimed_at,
        1,
        row.business_claimed_at,
    )
    assert gmail.count(DifyBuilderExecutionRequest) == 1
    assert len(gmail.boundary.invoke_calls) == 1


def test_held_lease_duplicates_never_enqueue_twice(gmail: Gmail, deliveries: list[Delivery]) -> None:
    other = gmail.confirmed("other")
    decided = gmail.confirmed()
    first = gmail.execute(decided)
    assert len(deliveries) == 1
    token = deliveries[0][3]

    # Matching duplicate while the lease is held: the current receipt, no reservation or enqueue.
    assert gmail.execute(decided) == first
    for key, at_version in (("execute-other", decided.at_version), ("execute-1", decided.at_version + 1)):
        with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
            gmail.service().replay_execution(
                actor=gmail.actor,
                session_id=gmail.session_id,
                consent_id=decided.consent_id,
                scope_digest=decided.scope_digest,
                at_version=at_version,
                idempotency_key=key,
            )
        with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
            wiring.build_service().execute_confirmed_tool(
                gmail.session_id,
                gmail.actor,
                consent_id=decided.consent_id,
                scope_digest=decided.scope_digest,
                at_version=at_version,
                idempotency_key=key,
            )
    # Another, never executed grant cannot ride the held lease.
    with pytest.raises(BusyError):
        gmail.execute(other, key="execute-other-grant")
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_found"):
        gmail.execute(decided.model_copy(update={"consent_id": str(uuid4())}))
    assert len(deliveries) == 1
    assert gmail.lease() == token
    assert gmail.count(DifyBuilderExecutionRequest) == 1
    assert gmail.consent(other.consent_id).command_id is None

    _deliver(gmail, deliveries[0])()
    assert gmail.lease() is None
    assert gmail.consent(first.consent_id).state == "completed"
    # A stale duplicate delivery of the finished command cannot activate, run or release.
    _deliver(gmail, deliveries[0])()
    assert len(gmail.native_runs()) == 1
    assert len(gmail.boundary.invoke_calls) == 1
    assert len(deliveries) == 1


def test_dispatch_coordinator_metadata_read_runs_outside_sql(gmail: Gmail, deliveries: list[Delivery]) -> None:
    """The web-process coordinator's external metadata reads must not hold a SQL transaction."""
    gmail.execute(gmail.confirmed())
    assert len(deliveries) == 1
    assert_outside_sql(gmail.boundary, "metadata", "verification")


def test_stale_recovery_sweep_never_settles_a_fresh_reservation(
    gmail: Gmail, deliveries: list[Delivery], monkeypatch: pytest.MonkeyPatch
) -> None:
    """KNOWN ROOT-OWNED DEFECT REGRESSION — expected to fail until ``reconcile_stranded`` is fixed.

    The stale-working sweep observes no lease, then recovery and a fresh human reservation
    commit (with a new live lease) before ``reconcile_stranded(session_id)`` selects every
    currently reserved grant of the session. The fresh live grant must not be settled.
    """
    stranded = _stranded(gmail, deliveries)
    original = session_lock.exists
    started: list[str] = []
    fresh: list[ConsentReceipt] = []

    def exists_then_interleave(session_id: str) -> bool:
        held = original(session_id)
        if session_id == gmail.session_id and not started:
            started.append(session_id)
            fresh.append(_recover_and_reserve_fresh(gmail))
        return held

    monkeypatch.setattr(session_lock, "exists", exists_then_interleave)
    reconcile_interrupted_sessions()
    monkeypatch.setattr(session_lock, "exists", original)

    assert len(fresh) == 1
    assert gmail.consent(stranded.consent_id).state == "failed"
    assert gmail.lease() == deliveries[1][3]
    live = gmail.consent(fresh[0].consent_id)
    assert (live.state, live.command_id, live.reason_code) == ("confirmed", fresh[0].command_id, None)
