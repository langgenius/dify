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

Test-created concurrency never runs in the pytest process. Each concurrent scenario (the held claim
race, duplicate launches, concurrent worker deliveries) and each crash runs in a forked, killable
test host (``run_in_host`` / ``_crash_in_child``): the real port, task bodies, native pipeline,
PostgreSQL and Redis run there on host-owned connections, every host ends with ``os._exit`` (which
ends all of its threads), and the parent, holding no SQL, reads the host's one bounded report frame
without blocking under an absolute deadline, then joins, terminates and kills, and asserts the host
is dead before the test returns — that is, before
any fixture restores its patches and before the shared database/Redis cleanup. Boundary
observations of a host are the host's own records, reported over the pipe. Every case's
connections also carry server-side SQL deadlines.

``test_stale_recovery_sweep_never_settles_a_fresh_reservation`` is a regression for a known,
root-owned defect in ``reconcile_stranded`` and is expected to fail until that owner is fixed.
"""

import json
import multiprocessing
import os
import signal
import struct
import traceback
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from multiprocessing.connection import Connection
from pathlib import Path
from select import select as wait_readable
from threading import Barrier, Event, Lock, Thread, get_ident
from time import monotonic, sleep, time
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import TypeAdapter
from sqlalchemy import Engine, event, func, select, text, update
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry, PoolProxiedConnection

import contexts
from configs import dify_config
from core.dify_builder import gmail_read_policy
from core.dify_builder.errors import BusyError, NotFoundError
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
from core.helper.provider_cache import ToolProviderCredentialsCache
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
_CHILD_RESULT_SECONDS = 180
_CHILD_JOIN_SECONDS = 10
_CRASH_EXIT = 86
# Server-side deadlines on every connection this module's cases check out (see ``SqlDeadlines``):
# no SQL statement, lock wait or abandoned transaction can block a worker past them.
_SQL_DEADLINES = (
    "SET statement_timeout = 30000",
    "SET lock_timeout = 20000",
    "SET idle_in_transaction_session_timeout = 90000",
)
# Inside a test host: one shared join deadline per thread group (above every SQL deadline and the
# 60 s holds). Threads still alive after it are reported, then ended by the host's ``os._exit``.
_WORK_SECONDS = 120
_RACE_START_SECONDS = 10
# The parent's ABSOLUTE deadline for a host's complete report transfer (readiness, header and every
# payload byte); with join/terminate/kill (3 x 10 s) it stays below pytest's 360 s per-case timeout,
# so the host is always dead before the test returns.
_HOST_RESULT_SECONDS = 200
_HOST_JOIN_SECONDS = 10
# A host report is one frame on a raw pipe: an 8-byte big-endian length, then that many bytes of
# UTF-8 JSON. The parent accepts at most this many payload bytes.
_REPORT_HEADER = struct.Struct("!Q")
_HOST_REPORT_BYTES = 8 * 1024 * 1024
_REPORT_CHUNK = 65_536
# Bounded text a host may report for one exception, and for one Builder Run representation.
_HOST_TEXT_LIMIT = 20_000
_RUN_TEXT_LIMIT = 200_000


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

    def forget_inherited(self) -> None:
        """In a forked test host: drop the parent's records; those connections are not this process's."""
        with self._lock:
            self._open.clear()

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
    # Called at the ordinary credential-cache invalidation, which then raises ``cache_error`` if set
    # instead of deleting the entry.
    on_cache_delete: Callable[[], None] | None = None
    cache_error: Exception | None = None
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

    def checkpoint(self) -> tuple[int, int, int, int]:
        """Record lengths at a test host's start; a forked host inherits the parent's earlier records."""
        with self.lock:
            return len(self.events), len(self.refresh_calls), len(self.invoke_calls), len(self.model_calls)

    def facts_since(self, point: tuple[int, int, int, int]) -> dict[str, object]:
        """Only what THIS process recorded after ``point``, as plain data for the host's pipe."""
        events, refreshes, invokes, models = point
        with self.lock:
            return {
                "pid": os.getpid(),
                "events": [[name, list(origins)] for name, origins in self.events[events:]],
                "refresh_calls": [_call_facts(call) for call in self.refresh_calls[refreshes:]],
                "invoke_calls": [_call_facts(call) for call in self.invoke_calls[invokes:]],
                "model_calls": len(self.model_calls) - models,
            }

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


def _call_facts(call: Call) -> dict[str, object]:
    return {"path": call.path, "headers": dict(call.headers), "payload": dict(call.payload)}


class Observed:
    """Boundary crossings a test host recorded in its own process, rebuilt from its pipe report.

    Never the parent's pre-fork copy: ``Boundary.facts_since`` slices off everything inherited.
    """

    def __init__(self, facts: object) -> None:
        assert isinstance(facts, dict)
        self.pid = int(facts["pid"])
        self.events: list[tuple[str, tuple[str, ...]]] = [
            (str(name), tuple(str(origin) for origin in origins)) for name, origins in facts["events"]
        ]
        self.refresh_calls = [_rebuilt_call(item) for item in facts["refresh_calls"]]
        self.invoke_calls = [_rebuilt_call(item) for item in facts["invoke_calls"]]
        self.model_calls = int(facts["model_calls"])

    def count(self, name: str) -> int:
        return sum(1 for event_name, _ in self.events if event_name == name)

    def order(self) -> list[str]:
        return [name for name, _ in self.events]


def _rebuilt_call(item: object) -> Call:
    assert isinstance(item, dict)
    headers, payload = item["headers"], item["payload"]
    assert isinstance(headers, dict)
    assert isinstance(payload, dict)
    return Call(path=str(item["path"]), headers={str(k): str(v) for k, v in headers.items()}, payload=dict(payload))


@dataclass(frozen=True)
class RunFacts:
    """The Builder-visible facts of one port result, in-process or reported by a test host."""

    dify_run_id: str
    refusal: str | None
    safety_outcome: str | None
    terminal_outputs: bool
    text: str

    @classmethod
    def of(cls, run: Run) -> "RunFacts":
        evidence = run.verification.execution_evidence if run.verification is not None else None
        return cls(
            dify_run_id=run.dify_run_id,
            refusal=run.execution_refusal.reason_code if run.execution_refusal is not None else None,
            safety_outcome=evidence.safety_outcome if evidence is not None else None,
            terminal_outputs=run.verification is not None and run.verification.terminal_outputs is not None,
            text=repr(run),
        )

    def report(self) -> dict[str, object]:
        """Plain data for a host's pipe; a representation too large to send whole is marked, not cut silently."""
        return {
            "dify_run_id": self.dify_run_id,
            "refusal": self.refusal,
            "safety_outcome": self.safety_outcome,
            "terminal_outputs": self.terminal_outputs,
            "text": self.text[:_RUN_TEXT_LIMIT],
            "text_truncated": len(self.text) > _RUN_TEXT_LIMIT,
        }

    @classmethod
    def reported(cls, item: object) -> "RunFacts":
        assert isinstance(item, dict), item
        # Secret/content absence is checked on the whole representation only.
        assert item["text_truncated"] is False, "a host Run representation exceeded the report bound"
        refusal, outcome = item["refusal"], item["safety_outcome"]
        return cls(
            dify_run_id=str(item["dify_run_id"]),
            refusal=None if refusal is None else str(refusal),
            safety_outcome=None if outcome is None else str(outcome),
            terminal_outputs=item["terminal_outputs"] is True,
            text=str(item["text"]),
        )


def assert_outside_sql(boundary: Boundary | Observed, *names: str) -> None:
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


# -- bounded, failure-safe concurrency containment -----------------------------------------------


class SqlDeadlines:
    """Apply ``_SQL_DEADLINES`` to every connection checked out of the shared engine during a case.

    Session-level settings, committed at checkout so a later rollback cannot drop them. ``close``
    removes the listener and disposes the pool, so later cases and the per-test cleanup get fresh
    connections without these settings.
    """

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self._listener: Callable[[DBAPIConnection, ConnectionPoolEntry, PoolProxiedConnection], None] = self._apply
        event.listen(engine, "checkout", self._listener)

    @staticmethod
    def _apply(dbapi_connection: DBAPIConnection, _record: ConnectionPoolEntry, _proxy: PoolProxiedConnection) -> None:
        cursor = dbapi_connection.cursor()
        try:
            for statement in _SQL_DEADLINES:
                cursor.execute(statement)
        finally:
            cursor.close()
        dbapi_connection.commit()

    def close(self) -> None:
        event.remove(self.engine, "checkout", self._listener)
        self.engine.dispose()


# The pytest process. Test-created threads may only start in a forked test host (another pid).
_PYTEST_PID = os.getpid()


def _require_host(what: str) -> None:
    assert os.getpid() != _PYTEST_PID, f"{what} must run inside a killable test host, never in pytest"


def _supervise(threads: list[Thread], *, seconds: float = _WORK_SECONDS) -> list[str]:
    """Join every started thread within one shared deadline; return the ones still alive.

    Host-only: a thread still alive here is reported and then ended with its host's ``os._exit``.
    """
    _require_host("thread supervision")
    deadline = monotonic() + seconds
    for thread in threads:
        if thread.ident is not None:
            thread.join(timeout=max(0.0, deadline - monotonic()))
    return [thread.name for thread in threads if thread.is_alive()]


def _write_report_frame(fd: int, report: dict[str, object]) -> None:
    """Host side: one length-prefixed UTF-8 JSON frame, written completely (blocking) to ``fd``.

    A report that cannot be encoded is replaced by a host error frame instead of being dropped.
    """
    try:
        payload = json.dumps(report).encode("utf-8")
    except (TypeError, ValueError) as error:
        payload = json.dumps({"host_error": f"unencodable host report: {type(error).__name__}"}).encode("utf-8")
    remaining = memoryview(_REPORT_HEADER.pack(len(payload)) + payload)
    while remaining:
        remaining = remaining[os.write(fd, remaining) :]


ReportStatus = Literal["complete", "timeout", "incomplete", "closed", "oversize", "malformed"]


def _read_report_frame(fd: int, deadline: float) -> tuple[ReportStatus, dict[str, object] | None]:
    """Parent side: read one frame under an ABSOLUTE ``deadline``, without any blocking read.

    The descriptor is non-blocking and every wait is a ``select`` bounded by the time left, so
    readiness, the header and every payload byte together finish by ``deadline``. The frame is
    bounded by ``_HOST_REPORT_BYTES``. Statuses: ``complete``; ``timeout`` (nothing arrived);
    ``incomplete`` (a partial frame by the deadline or before end of file); ``closed`` (end of
    file before any byte); ``oversize`` (an advertised or received frame beyond the bound);
    ``malformed`` (a complete frame that is not a JSON object).
    """
    os.set_blocking(fd, False)
    buffer = bytearray()
    while True:
        if len(buffer) >= _REPORT_HEADER.size:
            (length,) = _REPORT_HEADER.unpack_from(buffer)
            if length > _HOST_REPORT_BYTES:
                return "oversize", None
            end = _REPORT_HEADER.size + length
            if len(buffer) >= end:
                try:
                    decoded = json.loads(bytes(buffer[_REPORT_HEADER.size : end]).decode("utf-8"))
                except ValueError:
                    return "malformed", None
                return ("complete", decoded) if isinstance(decoded, dict) else ("malformed", None)
        remaining = deadline - monotonic()
        if remaining <= 0:
            return ("incomplete" if buffer else "timeout"), None
        nothing: list[int] = []
        readable, _, _ = wait_readable([fd], nothing, nothing, remaining)
        if not readable:
            continue
        try:
            chunk = os.read(fd, _REPORT_CHUNK)
        except BlockingIOError:
            continue
        if not chunk:
            return ("incomplete" if buffer else "closed"), None
        buffer += chunk


@dataclass(frozen=True)
class HostTransfer:
    """What the parent established about one host: the report transfer and the host's confirmed end."""

    status: ReportStatus
    report: dict[str, object] | None
    exitcode: int | None
    elapsed: float


def _supervise_host(target: Callable[[int], None], *, name: str, seconds: float = _HOST_RESULT_SECONDS) -> HostTransfer:
    """Fork ``target(write_fd)`` as a killable host; read its one report frame; always reap it.

    The parent runs no SQL and starts no thread here. It reads under the absolute ``seconds``
    deadline (``_read_report_frame``), then in ``finally`` joins, terminates and kills (each bounded
    by ``_HOST_JOIN_SECONDS``), closes both pipe ends and asserts the host is dead, whatever the
    transfer status. The host always ends with ``os._exit``, which ends every thread it started.
    """
    assert os.getpid() == _PYTEST_PID, "test hosts are started by pytest only"
    assert "fork" in multiprocessing.get_all_start_methods(), "test-host containment needs fork (Linux CI)"
    ctx = multiprocessing.get_context("fork")
    read_fd, write_fd = os.pipe()

    def host_main() -> None:
        try:
            os.close(read_fd)
            target(write_fd)
        finally:
            os._exit(0)  # ends this host and every thread it started, finished or not

    host = ctx.Process(target=host_main, name=f"test-host-{name}", daemon=True)
    started = monotonic()
    status: ReportStatus = "timeout"
    report: dict[str, object] | None = None
    host_alive = False
    exitcode: int | None = None
    write_open = True
    try:
        host.start()
        os.close(write_fd)  # only the host may write; its exit then reads as end of file
        write_open = False
        status, report = _read_report_frame(read_fd, started + seconds)
    finally:
        if write_open:
            os.close(write_fd)
        if host.pid is not None:
            host.join(timeout=_HOST_JOIN_SECONDS)
            if host.is_alive():
                host.terminate()
                host.join(timeout=_HOST_JOIN_SECONDS)
            if host.is_alive():
                host.kill()
                host.join(timeout=_HOST_JOIN_SECONDS)
            host_alive = host.is_alive()
            exitcode = host.exitcode
            if not host_alive:
                host.close()
        os.close(read_fd)
    assert not host_alive, f"test host {name} survived terminate() and kill()"
    return HostTransfer(status=status, report=report, exitcode=exitcode, elapsed=monotonic() - started)


def run_in_host(gmail: "Gmail", scenario: Callable[[], dict[str, object]], *, name: str) -> dict[str, object]:
    """Run ``scenario`` in a forked, killable test host and return its bounded, truthful report.

    The host drops the inherited SQL pool without closing the parent's sockets, uses a fresh
    request context (its own scoped session and connections), runs the real scenario, writes
    one bounded JSON frame of plain data plus only its own boundary records, then ``os._exit``s,
    which ends every thread it started. The parent closes its scoped session before forking,
    holds no SQL while it reads the complete frame under an absolute deadline
    (``_supervise_host``), then joins, terminates and kills (each bounded) and asserts the host is
    dead before returning, so before any fixture restores its patches and before the shared
    database/Redis cleanup. Host exceptions come back as bounded text and fail the case here.
    """
    db.session.close()  # the parent holds no transaction or connection across the fork or supervision
    point = gmail.boundary.checkpoint()

    def host_main(write_fd: int) -> None:
        report: dict[str, object] = {}
        try:
            with gmail.app.test_request_context():
                db.engine.dispose(close=False)
                gmail.boundary.witness.forget_inherited()
                reset_provider_cache()
                report["result"] = scenario()
        except BaseException as error:
            report["host_error"] = f"{type(error).__name__}: {error}"[:_HOST_TEXT_LIMIT]
            report["host_traceback"] = traceback.format_exc()[-_HOST_TEXT_LIMIT:]
        finally:
            report["observed"] = gmail.boundary.facts_since(point)
            _write_report_frame(write_fd, report)

    transfer = _supervise_host(host_main, name=name)
    assert transfer.status == "complete", (
        f"test host {name}: report transfer {transfer.status} within {_HOST_RESULT_SECONDS} s "
        f"(exit {transfer.exitcode})"
    )
    report = transfer.report
    assert report is not None
    assert "host_error" not in report, f"{report['host_error']}\n{report.get('host_traceback', '')}"
    assert transfer.exitcode == 0, transfer.exitcode
    observed = Observed(report["observed"])
    assert observed.pid != _PYTEST_PID
    assert observed.model_calls == 0, "a Builder model was resolved in the test host"
    result = report["result"]
    assert isinstance(result, dict)
    return {**result, "observed": observed}


def contained_race(*calls: Callable[[], object]) -> list[object]:
    """The inherited ``race`` semantics, host-only and bounded (supersedes it in this module).

    All calls start together behind a bounded barrier; a ``BuilderExecutionPolicyError`` becomes
    its reason code, any other exception is re-raised after every worker was joined. The join and
    the liveness assertion run in ``finally`` under one shared deadline; blocking SQL inside the
    calls is bounded by ``SqlDeadlines``, and the host's exit ends anything left.
    """
    _require_host("a concurrent race")
    barrier = Barrier(len(calls))
    results: list[object] = [None] * len(calls)
    errors: list[BaseException] = []

    def run(index: int, call: Callable[[], object]) -> None:
        try:
            barrier.wait(timeout=_RACE_START_SECONDS)
            results[index] = call()
        except BuilderExecutionPolicyError as error:
            results[index] = error.reason_code
        except BaseException as error:
            errors.append(error)

    threads = [
        Thread(target=run, args=(index, call), name=f"contained-race-{index}", daemon=True)
        for index, call in enumerate(calls)
    ]
    try:
        for thread in threads:
            thread.start()
    finally:
        alive = _supervise(threads)
        assert not alive, f"race workers outlived their {_WORK_SECONDS} s deadline: {alive}"
    if errors:
        raise errors[0]
    return results


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

    def other_editor(self) -> Actor:
        """Another authorized editor of the same workspace (not the session's owner)."""
        with self.factory.begin() as session:
            other = Account(name="Other editor", email=f"{uuid4()}@example.invalid")
            session.add(other)
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=self.actor.tenant_id, account_id=other.id, role=TenantAccountRole.EDITOR, current=True
                )
            )
            return Actor(account_id=other.id, tenant_id=self.actor.tenant_id)

    def credential_cache(self) -> ToolProviderCredentialsCache:
        """The ordinary (Redis) credential cache entry the native refresh owner invalidates."""
        return ToolProviderCredentialsCache(
            tenant_id=self.actor.tenant_id, provider=PROVIDER, credential_id=self.credential_id
        )

    def make_refresh_due(self) -> None:
        """Due for refresh when the Tool node runs (native rule: within 60 seconds of expiry)."""
        with self.factory.begin() as session:
            row = session.get(BuiltinToolProvider, self.credential_id)
            assert row is not None
            row.expires_at = int(time()) + 45

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
def sql_deadlines(flask_app_with_containers: Flask) -> Iterator[SqlDeadlines]:
    """Bounded SQL for the whole case: set up before the native owner, removed after it, also on failure."""
    with flask_app_with_containers.app_context():
        deadlines = SqlDeadlines(db.engine)
    try:
        yield deadlines
    finally:
        deadlines.close()


@pytest.fixture
def gmail(
    sql_deadlines: SqlDeadlines,
    native_owner: tuple[sessionmaker[Session], Actor, App, Workflow, str, str],
    flask_app_with_containers: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Gmail]:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    # The deadlines bound exactly the engine every native owner and worker of this case uses.
    assert sql_deadlines.engine is factory.kw["bind"]
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

    original_cache_delete = ToolProviderCredentialsCache.delete

    def cache_delete(cache: ToolProviderCredentialsCache) -> None:
        # The ordinary credential-cache invalidation (a Redis delete): observed, or failed on demand.
        boundary.mark("cache_delete")
        if boundary.on_cache_delete is not None:
            boundary.on_cache_delete()
        if boundary.cache_error is not None:
            raise boundary.cache_error
        original_cache_delete(cache)

    monkeypatch.setattr(real_call_metadata, "resolve_installed_get_message", installed)
    monkeypatch.setattr(PluginService, "is_plugin_verified", verified)
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", fetch_tool_provider)
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt_token)
    monkeypatch.setattr(OAuthHandler, "_request_with_plugin_daemon_response_stream", refresh_stream)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", invoke_stream)
    monkeypatch.setattr(LlmBuilderAgent, "_model", no_model)
    monkeypatch.setattr(real_call_consent_service, "_utcnow", utcnow)
    monkeypatch.setattr(ToolProviderCredentialsCache, "delete", cache_delete)
    try:
        yield world
        assert boundary.model_calls == []
    finally:
        boundary.witness.close()
        set_dify_builder_agent_factory(None)
        reset_provider_cache()


ClaimBody = Callable[[BuilderRealCallConsentService, ConfirmedToolExecutionContext, str, str], dict[str, object]]


@dataclass(frozen=True)
class HeldNativeClaim:
    """A real prepared/confirmed/reserved grant whose native worker can be held at its Tool ``get_runtime``."""

    gmail: "Gmail"
    reserved: ConsentReceipt

    def spend_while_held(self, body: ClaimBody) -> dict[str, object]:
        """Run ``body`` with (service, context, actual Run ID, actual node execution ID) while held.

        The held native worker and ``body`` run in one killable test host (``run_in_host``); the
        host is dead before this returns, whatever happened inside it.
        """
        return run_in_host(
            self.gmail, lambda: _held_claim_host(self.gmail, self.reserved, body), name="held-native-claim"
        )


@pytest.fixture
def native_claim_candidate(gmail: Gmail) -> HeldNativeClaim:
    """The brief's held-claim candidate, as a host-contained scenario.

    In the test host the real port runs in a thread. At entry to the native Tool runtime's
    ``get_runtime`` callback (before the original method claims anything) the actual allocated
    native Run ID and node execution ID are captured and the worker waits on a bounded event; the
    sidecar context is reloaded by request ID through ``TypeAdapter(BuilderExecutionContextValue)``
    and handed to the test's body with the service and those IDs. The host then always releases
    and joins the worker. The body spends the grant with those actual IDs, so the held worker's
    later claim is refused and it reaches no transport.
    """
    return HeldNativeClaim(gmail=gmail, reserved=gmail.reserved())


def _held_claim_host(gmail: "Gmail", reserved: ConsentReceipt, body: ClaimBody) -> dict[str, object]:
    _require_host("the held native claim")
    assert reserved.execution_request_id is not None
    request_id = reserved.execution_request_id
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

    outcome: dict[str, object] = {}

    def launch() -> None:
        try:
            outcome["run"] = RunFacts.of(in_request(gmail.app, lambda: gmail.run(reserved))()).report()
        except BaseException as error:
            outcome["error"] = f"{type(error).__name__}: {error}"[:_HOST_TEXT_LIMIT]

    facts: dict[str, object] = {}
    worker = Thread(target=launch, name="held-native-confirmed-run", daemon=True)
    # Patched in this host's memory only; the host exits instead of restoring anything.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(DifyToolNodeRuntime, "get_runtime", held)
        try:
            worker.start()
            facts["reached"] = reached.wait(timeout=_HOLD_SECONDS)
            if facts["reached"]:
                run_id, node_execution_id = captured["run"], captured["node"]
                facts["captured"] = [run_id, node_execution_id]
                # The Run ID the native launch claim already bound to this sidecar, while held.
                request = gmail.request(request_id)
                facts["held_request"] = [request.state, request.native_run_id]
                context = gmail.context(request_id)
                facts["context"] = [context.consent_id, context.command_id]
                facts["body"] = body(gmail.service(), context, run_id, node_execution_id)
        finally:
            # Every exit of the scenario: release, bounded join; the host's exit ends anything left.
            release.set()
            facts["alive"] = _supervise([worker])
    facts["released"] = captured.get("released")
    facts["held_outcome"] = outcome
    return facts


# -- one confirmed native Run --------------------------------------------------------------------


def _assert_completed_native_run(gmail: Gmail, reserved: ConsentReceipt, run: Run | RunFacts) -> None:
    """One native Run with ordered Start → Tool → End rows bound to the consent and sealed completed."""
    assert reserved.execution_request_id is not None
    result = run if isinstance(run, RunFacts) else RunFacts.of(run)
    row = gmail.consent(reserved.consent_id)
    request = gmail.request(reserved.execution_request_id)
    runs = gmail.native_runs()
    assert [native_run.id for native_run in runs] == [result.dify_run_id]
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
    assert result.safety_outcome == "confirmed_tool_completed"
    assert result.terminal_outputs is False
    # Content stays in the authorized native Run/node rows only.
    assert BODY in (native.outputs or "")
    assert BODY in (tool.outputs or "")
    assert_no_secret(result.text, gmail.builder_state_text())


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
    gmail.make_refresh_due()
    reserved = gmail.reserved()
    before = gmail.credential().encrypted_credentials
    # A real stale ordinary-cache entry the native refresh owner must remove after its CAS commits.
    cache = gmail.credential_cache()
    cache.set({"access_token": "ci-stale-cached-token"})
    assert cache.get() is not None
    at_invalidation: dict[str, object] = {}

    def observe_invalidation() -> None:
        row = gmail.consent(reserved.consent_id)
        at_invalidation["derived"] = row.derived_credential_revision
        at_invalidation["invoke_calls"] = len(gmail.boundary.invoke_calls)

    gmail.boundary.on_cache_delete = observe_invalidation
    result = gmail.run(reserved)

    _assert_completed_native_run(gmail, reserved, result)
    # Invalidation ran once, after the CAS committed and before the business dispatch, outside SQL.
    assert gmail.boundary.count("cache_delete") == 1
    assert at_invalidation["derived"] is not None
    assert at_invalidation["invoke_calls"] == 0
    assert cache.get() is None
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
    assert order.index("refresh") < order.index("cache_delete") < order.index("invoke")
    assert_outside_sql(gmail.boundary, "metadata", "decrypt", "refresh", "cache_delete", "invoke")
    # The CAS persisted natively re-encrypted refreshed credentials, once.
    credential = gmail.credential()
    assert credential.encrypted_credentials != before
    stored = json.loads(credential.encrypted_credentials or "{}")
    assert {name: _REAL_DECRYPT(gmail.actor.tenant_id, value) for name, value in stored.items()} == REFRESHED
    consent = gmail.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count) == (1, 1)
    assert consent.derived_credential_revision is not None


def test_cache_invalidation_failure_after_refresh_cas_stays_unknown_without_business(gmail: Gmail) -> None:
    """The refreshed credential is committed, then the ordinary cache cannot be invalidated.

    Only the Redis invalidation fails (after the real CAS); the native refresh owner must close the
    spent grant unknown before any business dispatch, keep the committed refresh, and never repeat
    either phase on reconciliation or redelivery.
    """
    gmail.make_refresh_due()
    reserved = gmail.reserved()
    assert reserved.execution_request_id is not None
    before = gmail.credential().encrypted_credentials
    cache = gmail.credential_cache()
    stale = {"access_token": "ci-stale-cached-token"}
    cache.set(stale)
    gmail.boundary.cache_error = ConnectionError(f"redis unavailable: {NATIVE_SECRET}")
    result = gmail.run(reserved)

    assert len(gmail.boundary.refresh_calls) == 1
    assert gmail.boundary.invoke_calls == []
    assert gmail.boundary.count("cache_delete") == 1
    order = gmail.boundary.order()
    assert order.index("refresh") < order.index("cache_delete")
    assert_outside_sql(gmail.boundary, "decrypt", "refresh", "cache_delete")
    # The real CAS committed the natively re-encrypted refresh before the cache fault; it stays durable.
    credential = gmail.credential()
    assert credential.encrypted_credentials != before
    stored = json.loads(credential.encrypted_credentials or "{}")
    assert {name: _REAL_DECRYPT(gmail.actor.tenant_id, value) for name, value in stored.items()} == REFRESHED
    assert cache.get() == stale
    row = gmail.consent(reserved.consent_id)
    assert row.derived_credential_revision is not None
    assert row.business_claimed_at is None
    assert (row.state, row.outcome_state, row.reason_code, row.refresh_count, row.business_count) == (
        "unknown",
        "unknown",
        "business_not_dispatched",
        1,
        0,
    )
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    assert_no_secret(repr(result), gmail.builder_state_text())

    # Neither reconciliation nor a redelivered command repeats the refresh or reaches the business phase.
    gmail.boundary.cache_error = None
    gmail.make_stale()
    reconcile_interrupted_sessions()
    gmail.service().reconcile_terminal_grants(limit=100, lease_held=session_lock.exists)
    redelivered = gmail.run(reserved)
    assert redelivered.execution_refusal is not None
    assert redelivered.execution_refusal.reason_code == "execution_already_launched"
    after = gmail.consent(reserved.consent_id)
    assert (after.state, after.reason_code, after.refresh_count, after.business_count) == (
        "unknown",
        "business_not_dispatched",
        1,
        0,
    )
    assert (len(gmail.boundary.refresh_calls), len(gmail.boundary.invoke_calls)) == (1, 0)
    assert gmail.boundary.count("cache_delete") == 1
    assert gmail.credential().encrypted_credentials == credential.encrypted_credentials
    assert_no_secret(repr(redelivered), gmail.builder_state_text())


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


def test_published_native_gmail_workflow_runs_the_published_graph(gmail: Gmail) -> None:
    """An actually published Gmail workflow runs through the native published path, without Builder consent.

    The real publish owner (``WorkflowService.publish_workflow``) creates the published version from
    the draft; the draft then changes. The invocation mirrors the Service API's blocking run of that
    published version (app-scoped end user, ``SERVICE_API``, ``workflow_id``, ``streaming=False``),
    which ``AppGenerateService`` resolves through ``get_published_workflow_by_id``. The app's
    current-version pointer is deliberately left alone: the shared native owner verifies it.
    """
    from core.app.entities.app_invoke_entities import InvokeFrom
    from extensions.ext_application_services import application_services
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from services.app_generate_service import AppGenerateService
    from services.workflow_service import WorkflowService

    with gmail.factory.begin() as session:
        native_app = session.get(App, gmail.app_id)
        assert native_app is not None
        current_version = native_app.workflow_id
        # The Service API refuses an app whose API service is disabled.
        native_app.enable_api = True
    with gmail.factory.begin() as session:
        account = session.get(Account, gmail.actor.account_id)
        native_app = session.get(App, gmail.app_id)
        assert account is not None
        assert native_app is not None
        published = WorkflowService().publish_workflow(
            session=session, app_model=native_app, account=account, marked_name="ci-published-gmail"
        )
        published_id, published_graph, published_version = published.id, published.graph, published.version
    assert published_version != Workflow.VERSION_DRAFT
    # The draft moves on after publication; the published run must not see it.
    _edit_tool(gmail, _another_message)
    with gmail.factory() as session:
        draft = session.get(Workflow, gmail.workflow_id)
        assert draft is not None
        assert json.loads(draft.graph) != json.loads(published_graph)

    end_user = application_services().app_scoped_end_users.commands.get_or_create_end_user(
        gmail.actor.tenant_id, gmail.app_id, "ci-published-caller"
    )
    drafts_before = gmail.draft_variables()
    with gmail.factory() as session:
        native_app = session.get(App, gmail.app_id)
        assert native_app is not None
        response = AppGenerateService.generate(
            session=session,
            app_model=native_app,
            user=end_user,
            args={"inputs": dict(gmail.inputs), "workflow_id": published_id},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
    assert isinstance(response, Mapping)
    data = response.get("data")
    reported = data.get("id") if isinstance(data, Mapping) else response.get("workflow_run_id")

    runs = gmail.native_runs()
    assert len(runs) == 1
    native = runs[0]
    assert reported == native.id
    assert (native.workflow_id, native.triggered_from, native.created_by_role, native.created_by) == (
        published_id,
        WorkflowRunTriggeredFrom.APP_RUN,
        CreatorUserRole.END_USER,
        end_user.id,
    )
    assert json.loads(native.graph or "{}") == json.loads(published_graph)
    assert native.status == "succeeded"
    assert BODY in (native.outputs or "")
    nodes = gmail.native_nodes(native.id)
    assert [(node.node_id, node.status) for node in nodes] == [
        ("start", "succeeded"),
        (TOOL_NODE, "succeeded"),
        ("end", "succeeded"),
    ]
    # One ordinary dispatch of the published literal (not the later draft's), no companion headers.
    assert len(gmail.boundary.invoke_calls) == 1
    call = gmail.boundary.invoke_calls[0]
    assert call.headers == {"X-Plugin-ID": PLUGIN, "Content-Type": "application/json"}
    assert call.payload["tool_parameters"] == APPROVED_PARAMETERS
    assert call.payload["credentials"] == {"access_token": ACCESS_TOKEN, "refresh_token": REFRESH_TOKEN}
    assert gmail.boundary.refresh_calls == []
    # No Builder consent, sidecar, metadata read or draft-variable write on the published path.
    assert gmail.boundary.count("metadata") == 0
    assert gmail.count(DifyBuilderRealCallConsent) == 0
    with gmail.factory() as session:
        assert session.scalars(select(DifyBuilderExecutionRequest)).first() is None
        app_after = session.get(App, gmail.app_id)
        assert app_after is not None
        assert app_after.workflow_id == current_version
    assert gmail.draft_variables() == drafts_before


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


def test_postgres_tool_claim_has_one_winner(native_claim_candidate: HeldNativeClaim, gmail: Gmail) -> None:
    def spend(
        service: BuilderRealCallConsentService,
        context: ConfirmedToolExecutionContext,
        run_id: str,
        node_execution_id: str,
    ) -> dict[str, object]:
        # Runs in the test host while the actual native worker is held at get_runtime.
        def claim() -> str:
            service.claim_tool(
                context=context, node_id=TOOL_NODE, native_run_id=run_id, native_node_execution_id=node_execution_id
            )
            return "claimed"

        def fresh_claim() -> str:
            BuilderRealCallConsentService(gmail.factory).claim_tool(
                context=context, node_id=TOOL_NODE, native_run_id=run_id, native_node_execution_id=node_execution_id
            )
            return "claimed"

        race = sorted(str(result) for result in contained_race(claim, claim))
        row = gmail.consent(context.consent_id)
        bound = [row.state, row.native_run_id, row.native_node_execution_id]
        # A newly constructed service instance on another thread (same host process; process-restart
        # coverage stays with the Task 4 module) cannot reopen the committed claim.
        fresh = [str(result) for result in contained_race(fresh_claim)]
        return {"race": race, "bound": bound, "fresh": fresh}

    reserved = native_claim_candidate.reserved
    facts = native_claim_candidate.spend_while_held(spend)
    assert facts["reached"] is True, "native worker never reached the Tool get_runtime callback"
    captured = facts["captured"]
    assert isinstance(captured, list)
    run_id, node_execution_id = str(captured[0]), str(captured[1])
    assert run_id
    assert node_execution_id
    assert facts["held_request"] == ["running", run_id]
    assert facts["context"] == [reserved.consent_id, reserved.command_id]
    assert facts["body"] == {
        "race": ["claimed", "consent_already_claimed"],
        "bound": ["claimed", run_id, node_execution_id],
        "fresh": ["consent_already_claimed"],
    }
    assert facts["alive"] == []
    assert facts["released"] == "yes"
    held_outcome = facts["held_outcome"]
    assert isinstance(held_outcome, dict)
    assert "error" not in held_outcome, held_outcome
    assert "run" in held_outcome
    # The held worker's own claim was refused: the host recorded no decrypt, refresh or dispatch.
    observed = facts["observed"]
    assert isinstance(observed, Observed)
    assert [observed.count(name) for name in ("decrypt", "refresh", "invoke")] == [0, 0, 0]
    # After the host's death: exactly the one native Run whose actual IDs were spent.
    assert {native.id for native in gmail.native_runs()} == {run_id}
    row = gmail.consent(reserved.consent_id)
    assert (row.native_run_id, row.native_node_execution_id, row.refresh_count, row.business_count) == (
        run_id,
        node_execution_id,
        0,
        0,
    )


def test_duplicate_native_launches_create_one_run(gmail: Gmail) -> None:
    reserved = gmail.reserved()

    def launches() -> dict[str, object]:
        results = contained_race(
            in_request(gmail.app, lambda: gmail.run(reserved)), in_request(gmail.app, lambda: gmail.run(reserved))
        )
        return {
            "results": [RunFacts.of(result).report() if isinstance(result, Run) else str(result) for result in results]
        }

    facts = run_in_host(gmail, launches, name="duplicate-native-launches")
    results = facts["results"]
    assert isinstance(results, list)
    runs = [RunFacts.reported(item) for item in results if isinstance(item, dict)]
    assert len(runs) == 2, results
    winners = [run for run in runs if run.refusal is None]
    losers = [run for run in runs if run.refusal is not None]
    assert len(winners) == 1
    assert len(losers) == 1
    assert losers[0].refusal in DUPLICATE_LAUNCH
    _assert_completed_native_run(gmail, reserved, winners[0])
    observed = facts["observed"]
    assert isinstance(observed, Observed)
    assert len(observed.invoke_calls) == 1


_STALLED_REPORT: dict[str, ReportStatus] = {"silent": "timeout", "partial_frame": "incomplete", "oversize": "oversize"}


def _stalled_host(kind: str) -> Callable[[int], None]:
    """A host that never completes its report and never exits by itself."""

    def target(write_fd: int) -> None:
        if kind == "partial_frame":
            # A header advertising more payload than ever arrives: the case a blocking recv cannot leave.
            os.write(write_fd, _REPORT_HEADER.pack(1_000) + b'{"partial')
        elif kind == "oversize":
            os.write(write_fd, _REPORT_HEADER.pack(_HOST_REPORT_BYTES + 1))
        sleep(3_600)

    return target


@pytest.mark.parametrize("kind", list(_STALLED_REPORT))
def test_host_report_transfer_is_bounded_and_the_host_reaped(kind: str) -> None:
    """The real supervisor cannot be held past its transfer deadline by a stalled host report.

    Silent, partial-frame and oversized reports each end the read with their status, then the
    supervisor's own bounded join/terminate/kill reaps the host and confirms its death.
    """
    seconds = 5.0
    transfer = _supervise_host(_stalled_host(kind), name=f"stalled-report-{kind}", seconds=seconds)
    assert transfer.status == _STALLED_REPORT[kind]
    assert transfer.report is None
    # It never exited by itself: the supervisor terminated (or killed) it and confirmed its death.
    assert transfer.exitcode in (-signal.SIGTERM, -signal.SIGKILL), transfer.exitcode
    assert transfer.elapsed < seconds + 3 * _HOST_JOIN_SECONDS + 5, transfer.elapsed


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
    db.session.close()  # the parent holds no transaction or connection across the fork or supervision
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
    request_id = receipt.execution_request_id
    _state, reserved_version, _fc = gmail.head()
    drafts_before = gmail.draft_variables()

    def concurrent_deliveries() -> dict[str, object]:
        # The test host: both real task bodies run here, concurrently, on host-owned connections.
        _require_host("concurrent worker deliveries")
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
                barrier.wait(timeout=_RACE_START_SECONDS)
                _deliver(gmail, deliveries[0])()
                outcomes[name] = "returned"
            except BaseException as error:
                outcomes[name] = f"error:{type(error).__name__}: {error}"[:_HOST_TEXT_LIMIT]

        threads = [Thread(target=delivery, args=(name,), name=f"delivery-{name}", daemon=True) for name in ("a", "b")]
        facts: dict[str, object] = {}
        try:
            for thread in threads:
                thread.start()
            facts["in_transport"] = in_transport.wait(timeout=_HOLD_SECONDS)
            if facts["in_transport"]:
                deadline = monotonic() + 30
                while all(thread.is_alive() for thread in threads) and monotonic() < deadline:
                    sleep(0.05)
                facts["returned_while_held"] = sum(1 for thread in threads if not thread.is_alive())
                owner = gmail.lease()
                facts["owner"] = owner
                # The bare dispatch token (web-process release) must not delete the active lease.
                session_lock.release(gmail.session_id, token)
                facts["owner_after_bare_release"] = gmail.lease()
                # The sweeper must leave a live lease alone: nothing flagged, settled or committed.
                gmail.make_stale()
                facts["sweep_flagged"] = reconcile_interrupted_sessions()
                row = gmail.consent(receipt.consent_id)
                facts["held_consent"] = [row.state, row.business_count, row.outcome_state]
                facts["held_request_state"] = gmail.request(request_id).state
                facts["held_version"] = gmail.head()[1]
                facts["held_native_runs"] = len(gmail.native_runs())
        finally:
            # Every exit of the scenario: release the held winner, one bounded join for both.
            release.set()
            facts["alive"] = _supervise(threads)
        facts["released"] = held.get("released")
        facts["outcomes"] = dict(outcomes)
        return facts

    facts = run_in_host(gmail, concurrent_deliveries, name="same-token-deliveries")
    assert facts["in_transport"] is True, "no delivery reached the native transport"
    assert facts["returned_while_held"] == 1, "the losing delivery did not return while the winner was held"
    owner = facts["owner"]
    assert isinstance(owner, str)
    assert owner.startswith(f"{token}:")
    assert facts["owner_after_bare_release"] == owner
    assert facts["sweep_flagged"] == 0
    assert facts["held_consent"] == ["claimed", 1, None]
    assert facts["held_request_state"] == "running"
    assert facts["held_version"] == reserved_version
    assert facts["held_native_runs"] == 1
    assert facts["alive"] == []
    assert facts["released"] is True
    assert facts["outcomes"] == {"a": "returned", "b": "returned"}
    # After the host's death: only the winner released its own lease after its terminal commit.
    assert gmail.lease() is None
    state, version, fc = gmail.head()
    assert (state, version) == (str(PcState.BUILD_REVIEW), reserved_version + 1)
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert len(gmail.native_runs()) == 1
    assert gmail.consent(receipt.consent_id).state == "completed"
    observed = facts["observed"]
    assert isinstance(observed, Observed)
    assert len(observed.invoke_calls) == 1
    assert_outside_sql(observed, "decrypt", "invoke")
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
    other_actor = gmail.other_editor()
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


def test_held_lease_replay_refuses_another_actor_and_a_changed_scope(gmail: Gmail, deliveries: list[Delivery]) -> None:
    """While the reserved command's dispatch lease is held, the replay branch keeps actor and scope ownership.

    Another authorized editor of the workspace and a changed ``scope_digest`` are refused by the real
    coordinator and by the replay owner itself; nothing is reserved, enqueued, launched or settled.
    """
    decided = gmail.confirmed()
    first = gmail.execute(decided)
    assert first.command_id is not None
    assert len(deliveries) == 1
    token = deliveries[0][3]
    head_before = gmail.head()[:2]
    other_actor = gmail.other_editor()
    changed_scope = "0" * 64
    assert changed_scope != decided.scope_digest

    # Another editor: the coordinator refuses the session it does not own; the replay owner the consent.
    with pytest.raises(NotFoundError):
        wiring.build_service().execute_confirmed_tool(
            gmail.session_id,
            other_actor,
            consent_id=decided.consent_id,
            scope_digest=decided.scope_digest,
            at_version=decided.at_version,
            idempotency_key="execute-1",
        )
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_found"):
        gmail.service().replay_execution(
            actor=other_actor,
            session_id=gmail.session_id,
            consent_id=decided.consent_id,
            scope_digest=decided.scope_digest,
            at_version=decided.at_version,
            idempotency_key="execute-1",
        )
    # The owner with a changed scope (same key): the held-lease replay refuses the different body.
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        wiring.build_service().execute_confirmed_tool(
            gmail.session_id,
            gmail.actor,
            consent_id=decided.consent_id,
            scope_digest=changed_scope,
            at_version=decided.at_version,
            idempotency_key="execute-1",
        )
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        gmail.service().replay_execution(
            actor=gmail.actor,
            session_id=gmail.session_id,
            consent_id=decided.consent_id,
            scope_digest=changed_scope,
            at_version=decided.at_version,
            idempotency_key="execute-1",
        )

    assert gmail.lease() == token
    assert gmail.head()[:2] == head_before
    assert len(deliveries) == 1
    assert gmail.count(DifyBuilderExecutionRequest) == 1
    assert gmail.count(DifyBuilderRealCallConsent) == 1
    row = gmail.consent(decided.consent_id)
    assert (row.state, row.command_id, row.execution_request_id, row.claimed_at, row.reason_code) == (
        "confirmed",
        first.command_id,
        first.execution_request_id,
        None,
        None,
    )
    assert gmail.native_runs() == []
    for boundary in ("decrypt", "refresh", "invoke"):
        assert gmail.boundary.count(boundary) == 0, boundary


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
