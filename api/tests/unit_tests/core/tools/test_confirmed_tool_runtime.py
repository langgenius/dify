"""Confirmed native credential resolution, refresh and final dispatch on real owner rows.

Drives the real ``ToolManager`` confirmed branch, ``ServiceConfirmedToolGuard``
and Task 4 ``BuilderRealCallConsentService`` over the shared SQLite consent
world. Spies replace only external boundaries: the plugin daemon (provider
declaration, OAuth refresh and tool invoke streams), the enterprise compliance
check and the tenant key used by token encryption. Installed metadata and the
qualification constants are SYNTHETIC test-only values (see the shared
fixture); they are not evidence of any installed or deployed artifact or of
daemon support for the proposed confirmed-dispatch headers. SQLite proves
transaction placement, not PostgreSQL locking (CI-owned).
"""

import json
import time
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field
from datetime import timedelta
from threading import Lock
from typing import Literal, Never
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

import contexts
import core.db.session_factory as session_factory_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.dify_builder.models import Actor
from core.dify_builder.real_call_consent import (
    ConfirmedToolBinding,
    ConfirmedToolGuard,
    CredentialReference,
    GmailReadParameters,
    InstalledToolBinding,
)
from core.entities import PluginCredentialType
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper import credential_utils, encrypter
from core.helper.provider_cache import ToolProviderCredentialsCache
from core.plugin.entities.oauth import OAuthSchema
from core.plugin.entities.plugin_daemon import (
    CredentialType,
    PluginOAuthCredentialsResponse,
    PluginToolProviderEntity,
)
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.impl.tool import PluginToolManager
from core.tools import tool_manager as tool_manager_module
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.plugin_tool.tool import PluginTool
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from models.dify_builder import DifyBuilderRealCallConsent
from models.tools import BuiltinToolProvider, ToolOAuthTenantClient
from services.dify_builder import real_call_metadata
from services.dify_builder.application import gmail_read_policy
from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
from services.tools.builtin_tools_manage_service import BuilderCredentialRuntime, BuiltinToolManageService
from tests.unit_tests.services.dify_builder.test_execution_policy_service import (
    owned as owned,  # noqa: PLC0414 - shared pytest fixture
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    APPROVED,
    CIPHERTEXT,
    PLUGIN,
    PROVIDER,
    SECRET_SENTINELS,
    SYNTHETIC_ARTIFACT,
    Owner,
    assert_public,
    claimed,
    get,
    shift_clock,
    synthetic_installed,
    update_credential,
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    consent_owner as consent_owner,  # noqa: PLC0414 - shared pytest fixture
)

NATIVE_SECRET = "native-error-secret-sentinel-91c"
REFRESHED = {"access_token": "refreshed-access-sentinel", "refresh_token": "refreshed-refresh-sentinel"}
CONFIRMED_HEADERS = {
    "X-Dify-Expected-Plugin-Identifier": SYNTHETIC_ARTIFACT,
    "X-Dify-Expected-Installation-ID": "synthetic-installation",
    "X-Dify-Confirmed-Dispatch": "v1",
}


def guard_for(owner: Owner, binding: ConfirmedToolBinding) -> ConfirmedToolGuard:
    # Imported lazily so each test fails on its own behavior before the owner exists.
    from services.dify_builder.real_call_consent_service import ServiceConfirmedToolGuard

    return ServiceConfirmedToolGuard(owner.service(), binding)


class TxWitness:
    """Open connection-level transactions on the owner engine, observed at external boundaries."""

    def __init__(self, engine: Engine) -> None:
        self.open = 0
        event.listen(engine, "begin", self._begin)
        event.listen(engine, "commit", self._end)
        event.listen(engine, "rollback", self._end)

    def _begin(self, _conn: object) -> None:
        self.open += 1

    def _end(self, _conn: object) -> None:
        self.open = max(0, self.open - 1)


def _entity(*, has_runtime_parameters: bool = False) -> ToolEntity:
    return ToolEntity(
        identity=ToolIdentity(
            author="langgenius", name="get_message", label=I18nObject(en_US="Get"), provider=PROVIDER
        ),
        parameters=[
            ToolParameter.get_simple_instance(name=name, llm_description=name, typ=typ, required=True)
            for name, typ in [
                ("message_id", ToolParameter.ToolParameterType.STRING),
                ("include_body", ToolParameter.ToolParameterType.BOOLEAN),
                ("include_attachments", ToolParameter.ToolParameterType.BOOLEAN),
            ]
        ],
        has_runtime_parameters=has_runtime_parameters,
    )


def _declaration(*, unique_identifier: str = SYNTHETIC_ARTIFACT, **entity: bool) -> PluginToolProviderEntity:
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
            tools=[_entity(**entity)],
        ),
    )


@dataclass(frozen=True)
class Call:
    """One plugin daemon request as the transport received it."""

    path: str
    headers: dict[str, str]
    payload: dict[str, object]


def _call(path: str, kwargs: dict[str, object]) -> Call:
    headers, data = kwargs["headers"], kwargs["data"]
    assert isinstance(headers, dict)
    assert isinstance(data, dict)
    payload = data["data"]
    assert isinstance(payload, dict)
    return Call(path=path, headers=dict(headers), payload=dict(payload))


@dataclass
class World:
    owner: Owner
    witness: TxWitness
    monkeypatch: pytest.MonkeyPatch
    declaration: PluginToolProviderEntity = field(default_factory=_declaration)
    now: float = field(default_factory=time.time)
    events: list[tuple[str, int]] = field(default_factory=list)
    decrypted: list[str] = field(default_factory=list)
    refresh_calls: list[Call] = field(default_factory=list)
    invoke_calls: list[Call] = field(default_factory=list)
    cache_deletes: list[dict[str, object]] = field(default_factory=list)
    on_compliance: Callable[[], None] | None = None
    on_refresh: Callable[[], None] | None = None
    on_cache_delete: Callable[[], None] | None = None
    refresh_error: Exception | None = None
    cache_error: Exception | None = None
    invoke_messages: list[ToolInvokeMessage] | None = None
    invoke_fail_after: int | None = None
    compliance_error: Exception | None = None

    def mark(self, name: str) -> None:
        self.events.append((name, self.witness.open))

    def row(self) -> BuiltinToolProvider:
        with self.owner.factory() as db:
            row = db.get(BuiltinToolProvider, self.owner.credential_id)
            assert row is not None
            return row

    def consent(self, consent_id: str) -> DifyBuilderRealCallConsent:
        return self.owner.consent_row(consent_id)


@pytest.fixture
def world(consent_owner: Owner, monkeypatch: pytest.MonkeyPatch) -> Iterator[World]:
    engine = consent_owner.factory.kw["bind"]
    state = World(consent_owner, TxWitness(engine), monkeypatch)
    # The witness is not vacuous: an open read session counts, and closing it ends the transaction.
    with consent_owner.factory() as db:
        db.execute(select(BuiltinToolProvider.id))
        assert state.witness.open == 1
    assert state.witness.open == 0
    # Native owners that open their own short session use the shared factory.
    monkeypatch.setattr(session_factory_module, "_session_maker", consent_owner.factory)
    # A fresh request-scoped provider cache, exactly as get_plugin_provider initializes it.
    contexts.plugin_tool_providers.set({})
    contexts.plugin_tool_providers_lock.set(Lock())
    monkeypatch.setattr(tool_manager_module.time, "time", lambda: state.now)

    def fetch_tool_provider(_self: PluginToolManager, tenant_id: str, provider: str) -> PluginToolProviderEntity:
        assert (tenant_id, provider) == (consent_owner.actor.tenant_id, PROVIDER)
        state.mark("daemon_declaration")
        return state.declaration.model_copy(deep=True)

    tenant_id = consent_owner.actor.tenant_id

    def compliance(*, credential_id: str, provider: str, credential_type: object, check_existence: bool) -> None:
        state.mark("compliance")
        assert (credential_id, provider, credential_type, check_existence) == (
            consent_owner.credential_id,
            PROVIDER,
            PluginCredentialType.TOOL,
            False,
        )
        if state.on_compliance is not None:
            state.on_compliance()
        if state.compliance_error is not None:
            raise state.compliance_error

    def decrypt_token(token_tenant_id: str, token: str) -> str:
        state.mark("decrypt")
        assert token_tenant_id == tenant_id
        state.decrypted.append(token)
        return f"plain({token})"

    def encrypt_token(token_tenant_id: str, value: str) -> str:
        state.mark("encrypt")
        assert token_tenant_id == tenant_id
        return f"cipher({value})"

    def refresh_stream(
        _self: OAuthHandler, method: str, path: str, _type: type, **kwargs: object
    ) -> Iterator[PluginOAuthCredentialsResponse]:
        state.mark("refresh_transport")
        assert method == "POST"
        state.refresh_calls.append(_call(path, kwargs))
        if state.on_refresh is not None:
            state.on_refresh()
        if state.refresh_error is not None:
            raise state.refresh_error
        return iter([PluginOAuthCredentialsResponse(credentials=REFRESHED, expires_at=int(state.now) + 3600)])

    def invoke_stream(
        _self: PluginToolManager, method: str, path: str, _type: type, **kwargs: object
    ) -> Generator[ToolInvokeMessage]:
        state.mark("invoke_transport")
        assert method == "POST"
        state.invoke_calls.append(_call(path, kwargs))

        def stream() -> Generator[ToolInvokeMessage]:
            messages = [
                ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="ok")
                ),
                ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.JSON,
                    message=ToolInvokeMessage.JsonMessage(
                        json_object={"message": {"id": APPROVED.message_id}, "message_id": APPROVED.message_id}
                    ),
                ),
            ]
            if state.invoke_messages is not None:
                messages = state.invoke_messages
            for index, message in enumerate(messages):
                state.mark("invoke_message")
                if state.invoke_fail_after == index:
                    raise RuntimeError(f"plugin daemon said {NATIVE_SECRET}")
                yield message

        return stream()

    def cache_delete(cache: ToolProviderCredentialsCache) -> None:
        state.mark("cache_delete")
        row = state.row()
        state.cache_deletes.append(
            {"key": cache.cache_key, "ciphertext": row.encrypted_credentials, "expires_at": row.expires_at}
        )
        if state.on_cache_delete is not None:
            state.on_cache_delete()
        if state.cache_error is not None:
            raise state.cache_error

    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", fetch_tool_provider)
    monkeypatch.setattr(credential_utils, "runtime_check_credential_policy_compliance", compliance)
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt_token)
    monkeypatch.setattr(encrypter, "encrypt_token", encrypt_token)
    monkeypatch.setattr(OAuthHandler, "_request_with_plugin_daemon_response_stream", refresh_stream)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", invoke_stream)
    monkeypatch.setattr(ToolProviderCredentialsCache, "delete", cache_delete)

    # The confirmed path bypasses the ordinary credential cache entirely.
    def forbid_cache_read(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("ordinary cache read")

    def forbid_cache_write(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("ordinary cache write")

    monkeypatch.setattr(ToolProviderCredentialsCache, "get", forbid_cache_read)
    monkeypatch.setattr(ToolProviderCredentialsCache, "set", forbid_cache_write)
    yield state
    contexts.plugin_tool_providers.set({})


@dataclass(frozen=True)
class _Spec:
    credential_id: str | None
    provider_type: ToolProviderType = ToolProviderType.BUILT_IN
    provider_id: str = PROVIDER
    tool_name: str = "get_message"
    tool_configurations: dict[str, object] = field(
        default_factory=lambda: {name: {"type": "constant", "value": value} for name, value in APPROVED}
    )


def build(
    world: World,
    guard: ConfirmedToolGuard,
    *,
    credential_id: str | None | Literal["bound"] = "bound",
    provider_type: ToolProviderType = ToolProviderType.BUILT_IN,
) -> PluginTool:
    owner = world.owner
    tool = ToolManager.get_workflow_tool_runtime(
        owner.actor.tenant_id,
        owner.app_id,
        "tool",
        _Spec(
            credential_id=owner.credential_id if credential_id == "bound" else credential_id,
            provider_type=provider_type,
        ),
        owner.actor.account_id,
        InvokeFrom.DEBUGGER,
        None,
        confirmed_guard=guard,
    )
    assert isinstance(tool, PluginTool)
    return tool


def run(tool: PluginTool) -> list[ToolInvokeMessage]:
    with Session() as session:
        return list(
            ToolEngine.generic_invoke(
                session=session,
                tool=tool,
                tool_parameters=APPROVED.model_dump(),
                user_id="owner",
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=0,
            )
        )


def make_refresh_due(world: World) -> None:
    """Bind a token that is fresh at confirmation and refresh-due when the Tool node runs."""
    expires_at = int(world.now) + 3600
    update_credential(world.owner, expires_at=expires_at)
    world.now = float(expires_at - 30)


def assert_outside_sql(world: World, *names: str) -> None:
    for name in names:
        observed = [open_count for event_name, open_count in world.events if event_name == name]
        assert observed, f"{name} never happened"
        assert set(observed) == {0}, f"{name} ran inside an open transaction"


def assert_no_secret_text(text: str) -> None:
    for sentinel in (*SECRET_SENTINELS, NATIVE_SECRET, *REFRESHED.values()):
        assert sentinel not in text


# --- success paths ----------------------------------------------------------------------------


def test_confirmed_runtime_decrypts_complies_and_dispatches_outside_sql(world: World) -> None:
    reserved, binding = claimed(world.owner)
    assert world.witness.open == 0
    tool = build(world, guard_for(world.owner, binding))
    messages = run(tool)

    assert [m.type for m in messages] == [ToolInvokeMessage.MessageType.TEXT, ToolInvokeMessage.MessageType.JSON]
    assert_outside_sql(world, "daemon_declaration", "compliance", "decrypt", "invoke_transport", "invoke_message")
    order = [name for name, _ in world.events]
    assert order.index("compliance") < order.index("decrypt") < order.index("invoke_transport")
    assert world.refresh_calls == []
    assert world.cache_deletes == []
    assert len(world.invoke_calls) == 1
    call = world.invoke_calls[0]
    assert call.path == f"plugin/{world.owner.actor.tenant_id}/dispatch/tool/invoke"
    assert call.headers == {"X-Plugin-ID": PLUGIN, "Content-Type": "application/json", **CONFIRMED_HEADERS}
    assert call.payload["credentials"] == {
        "access_token": "plain(enc-access-sentinel)",
        "refresh_token": "plain(enc-refresh-sentinel)",
    }
    assert call.payload["tool_parameters"] == APPROVED.model_dump()
    row = world.consent(reserved.consent_id)
    assert (row.refresh_count, row.business_count, row.state) == (0, 1, "claimed")
    # Candidate only; Task 6 seals it against native Run proof.
    assert (row.outcome_state, row.reason_code) == ("completed", "message_returned")
    assert_public(get(world.owner, reserved.consent_id), owner=world.owner)


def test_refresh_due_after_confirm_is_allowed_once(world: World) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    initial_revision = world.owner.full_reference_revision()

    def at_invalidation() -> None:
        # The CAS already committed: the refreshed ciphertext and derived revision are durable.
        consent = world.consent(reserved.consent_id)
        assert consent.derived_credential_revision == world.owner.full_reference_revision()
        assert world.invoke_calls == []

    world.on_cache_delete = at_invalidation
    tool = build(world, guard_for(world.owner, binding))
    run(tool)

    assert_outside_sql(world, "compliance", "decrypt", "refresh_transport", "cache_delete", "invoke_transport")
    order = [name for name, _ in world.events]
    assert order.index("refresh_transport") < order.index("cache_delete") < order.index("invoke_transport")
    assert len(world.refresh_calls) == 1
    refresh = world.refresh_calls[0]
    assert refresh.path == f"plugin/{world.owner.actor.tenant_id}/dispatch/oauth/refresh_credentials"
    assert refresh.headers == {"X-Plugin-ID": PLUGIN, "Content-Type": "application/json", **CONFIRMED_HEADERS}
    # The detached tenant client snapshot the grant bound, natively decrypted.
    assert refresh.payload["system_credentials"] == {
        "client_id": "enc-client-sentinel",
        "client_secret": "plain(enc-secret-sentinel)",
    }
    assert refresh.payload["credentials"] == {
        "access_token": "plain(enc-access-sentinel)",
        "refresh_token": "plain(enc-refresh-sentinel)",
    }
    row = world.row()
    assert json.loads(row.encrypted_credentials or "") == {
        "access_token": "cipher(refreshed-access-sentinel)",
        "refresh_token": "cipher(refreshed-refresh-sentinel)",
    }
    assert row.expires_at == int(world.now) + 3600
    assert world.cache_deletes == [
        {
            "key": (
                f"tool_credentials:tenant_id:{world.owner.actor.tenant_id}:provider:{PROVIDER}"
                f":credential_id:{world.owner.credential_id}"
            ),
            "ciphertext": row.encrypted_credentials,
            "expires_at": row.expires_at,
        }
    ]
    assert world.invoke_calls[0].payload["credentials"] == REFRESHED
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.state) == (1, 1, "claimed")
    assert consent.initial_credential_revision == initial_revision
    assert consent.derived_credential_revision == world.owner.full_reference_revision() != initial_revision
    assert_public(get(world.owner, reserved.consent_id), owner=world.owner)


# --- refresh conflicts and failures block the business phase ---------------------------------


def test_confirmed_refresh_cas_preserves_concurrent_rotation(world: World) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    rotated = '{"access_token":"enc-rotated-elsewhere"}'
    world.on_refresh = lambda: update_credential(world.owner, encrypted_credentials=rotated)

    with pytest.raises(BuilderExecutionPolicyError, match="refresh_conflict"):
        build(world, guard_for(world.owner, binding))

    assert world.row().encrypted_credentials == rotated
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count) == (1, 0)
    assert consent.state == "unknown"
    assert consent.derived_credential_revision is None
    assert world.invoke_calls == []
    # A conflict never claims ordinary cache invalidation success.
    assert world.cache_deletes == []


def test_refresh_client_changed_before_dispatch_denies(world: World) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    before = world.row()

    def swap_client() -> None:
        # Same credential ciphertext and timestamp; only the selected OAuth client changes.
        with world.owner.factory.begin() as db:
            client = db.get(ToolOAuthTenantClient, world.owner.client_id)
            assert client is not None
            client.encrypted_oauth_params = '{"client_id":"enc-other-client","client_secret":"enc-other-secret"}'

    world.on_compliance = swap_client
    with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_changed"):
        build(world, guard_for(world.owner, binding))

    assert world.refresh_calls == []
    assert world.invoke_calls == []
    after = world.row()
    assert (after.encrypted_credentials, after.expires_at) == (before.encrypted_credentials, before.expires_at)
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.state) == (0, 0, "failed")


def test_refresh_transport_error_is_sanitized_unknown_and_blocks_business(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    world.refresh_error = RuntimeError(f"token endpoint said {NATIVE_SECRET}")

    with pytest.raises(BuilderExecutionPolicyError, match="refresh_failed") as raised:
        build(world, guard_for(world.owner, binding))

    assert NATIVE_SECRET not in str(raised.value)
    assert world.invoke_calls == []
    assert world.cache_deletes == []
    assert world.row().encrypted_credentials == CIPHERTEXT
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.state) == (1, 0, "unknown")
    assert consent.reason_code == "refresh_uncertain"
    assert_no_secret_text(caplog.text)
    assert_no_secret_text(json.dumps(get(world.owner, reserved.consent_id).model_dump(mode="json")))


CACHE_SECRET = "cache-error-secret-sentinel-3b8"


def test_post_cas_cache_invalidation_failure_is_sanitized_durable_unknown(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    world.cache_error = RuntimeError(f"redis said {CACHE_SECRET}")

    with pytest.raises(BuilderExecutionPolicyError, match="credential_cache_unavailable") as raised:
        build(world, guard_for(world.owner, binding))

    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    assert CACHE_SECRET not in str(raised.value)
    assert CACHE_SECRET not in caplog.text
    # The invalidation ran once, outside SQL, after the CAS committed the refreshed row.
    assert_outside_sql(world, "refresh_transport", "cache_delete")
    assert len(world.refresh_calls) == 1
    assert len(world.cache_deletes) == 1
    refreshed = world.row()
    assert json.loads(refreshed.encrypted_credentials or "") == {
        "access_token": "cipher(refreshed-access-sentinel)",
        "refresh_token": "cipher(refreshed-refresh-sentinel)",
    }
    assert world.invoke_calls == []
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count) == (1, 0)
    assert consent.derived_credential_revision == world.owner.full_reference_revision()
    assert (consent.state, consent.outcome_state, consent.reason_code) == (
        "unknown",
        "unknown",
        "business_not_dispatched",
    )
    assert_no_secret_text(json.dumps(get(world.owner, reserved.consent_id).model_dump(mode="json")))

    # A fresh guard for the same claimed node cannot re-admit a snapshot of the closed grant.
    world.cache_error = None
    decrypted_before = list(world.decrypted)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_claimed"):
        build(world, guard_for(world.owner, binding))
    assert world.decrypted == decrypted_before
    assert world.invoke_calls == []
    assert len(world.refresh_calls) == 1
    after = world.consent(reserved.consent_id)
    assert (after.refresh_count, after.business_count, after.state, after.reason_code) == (
        1,
        0,
        "unknown",
        "business_not_dispatched",
    )


@pytest.mark.parametrize(
    "messages",
    [
        [ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="ok"))],
        [
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.VARIABLE,
                message=ToolInvokeMessage.VariableMessage(
                    variable_name="message_id", variable_value=APPROVED.message_id
                ),
            )
        ],
    ],
    ids=["text-only", "variable-only"],
)
def test_text_or_variable_alone_never_classifies_success(world: World, messages: list[ToolInvokeMessage]) -> None:
    reserved, binding = claimed(world.owner)
    world.invoke_messages = messages
    run(build(world, guard_for(world.owner, binding)))
    consent = world.consent(reserved.consent_id)
    assert (consent.business_count, consent.state, consent.outcome_state, consent.reason_code) == (
        1,
        "unknown",
        "unknown",
        "result_missing",
    )


def test_expired_between_refresh_and_business_denies_business(world: World) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    tool = build(world, guard_for(world.owner, binding))
    shift_clock(world.monkeypatch, timedelta(minutes=11))

    with pytest.raises(BuilderExecutionPolicyError, match="consent_expired"):
        run(tool)

    assert len(world.refresh_calls) == 1
    assert world.invoke_calls == []
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.state) == (1, 0, "failed")


def test_artifact_swapped_between_phases_denies_business(world: World) -> None:
    make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    tool = build(world, guard_for(world.owner, binding))

    def reinstalled(*, tenant_id: str, provider_id: str) -> InstalledToolBinding:
        assert provider_id == PROVIDER
        return synthetic_installed(tenant_id).model_copy(update={"installation_id": "synthetic-reinstallation"})

    world.monkeypatch.setattr(real_call_metadata, "resolve_installed_get_message", reinstalled)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_changed"):
        run(tool)

    assert len(world.refresh_calls) == 1
    assert world.invoke_calls == []
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.state) == (1, 0, "failed")


# --- refusals before any credential work -------------------------------------------------------


def _deny_compliance(world: World) -> None:
    world.compliance_error = ValueError(f"policy rejected {NATIVE_SECRET}")


def _hide_credential(world: World) -> None:
    update_credential(world.owner, user_id="another-member", visibility="only_me")


def _swap_declared_artifact(world: World) -> None:
    world.declaration = _declaration(unique_identifier=f"{PLUGIN}:9.9.8@{'0' * 64}")


def _dynamic_schema(world: World) -> None:
    world.declaration = _declaration(has_runtime_parameters=True)


@pytest.mark.parametrize(
    ("arrange", "reason", "credential_id", "provider_type"),
    [
        (_deny_compliance, "credential_policy_refused", "bound", ToolProviderType.BUILT_IN),
        (_hide_credential, "credential_reference_unavailable", "bound", ToolProviderType.BUILT_IN),
        (_swap_declared_artifact, "installed_tool_unavailable", "bound", ToolProviderType.BUILT_IN),
        (_dynamic_schema, "unsupported_tool_configuration", "bound", ToolProviderType.BUILT_IN),
        (None, "credential_required", None, ToolProviderType.BUILT_IN),
        (None, "unsupported_action", "bound", ToolProviderType.PLUGIN),
    ],
)
def test_denied_runtime_never_decrypts_or_dispatches(
    world: World,
    arrange: Callable[[World], None] | None,
    reason: str,
    credential_id: Literal["bound"] | None,
    provider_type: ToolProviderType,
    caplog: pytest.LogCaptureFixture,
) -> None:
    reserved, binding = claimed(world.owner)
    if arrange is not None:
        arrange(world)
    with pytest.raises(BuilderExecutionPolicyError, match=reason) as raised:
        build(world, guard_for(world.owner, binding), credential_id=credential_id, provider_type=provider_type)
    assert world.decrypted == []
    assert world.refresh_calls == []
    assert world.invoke_calls == []
    assert NATIVE_SECRET not in str(raised.value)
    assert NATIVE_SECRET not in caplog.text
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count) == (0, 0)


# --- selected detached snapshot admission (review I1) -------------------------------------------

SNAPSHOT_REFUSAL = "Builder execution policy refused: credential_snapshot_mismatch"
UNAPPROVED_CIPHERTEXT = '{"access_token":"enc-unapproved-access","refresh_token":"enc-unapproved-refresh"}'


def _transient(world: World, change: Callable[[], None], restore: Callable[[], None]) -> None:
    """Apply an unapproved change before native selection and restore the approved row right after it.

    Simulates a concurrent writer: the detached snapshot holds the unapproved state while every
    later current-state check (phase claims) would see the approved row again.
    """
    change()
    original = BuiltinToolManageService.load_builder_credential

    def select_then_restore(
        *, actor: Actor, provider_id: str, credential_id: str, verified_plugin: bool
    ) -> BuilderCredentialRuntime:
        selection = original(
            actor=actor, provider_id=provider_id, credential_id=credential_id, verified_plugin=verified_plugin
        )
        world.mark("selected")
        restore()
        return selection

    world.monkeypatch.setattr(BuiltinToolManageService, "load_builder_credential", staticmethod(select_then_restore))


def _swap_credential(world: World) -> None:
    _transient(
        world,
        lambda: update_credential(world.owner, encrypted_credentials=UNAPPROVED_CIPHERTEXT),
        lambda: update_credential(world.owner, encrypted_credentials=CIPHERTEXT),
    )


def _set_client(world: World, ciphertext: str) -> None:
    with world.owner.factory.begin() as db:
        client = db.get(ToolOAuthTenantClient, world.owner.client_id)
        assert client is not None
        client.encrypted_oauth_params = ciphertext


def _swap_client(world: World) -> None:
    with world.owner.factory() as db:
        client = db.get(ToolOAuthTenantClient, world.owner.client_id)
        assert client is not None
        approved = client.encrypted_oauth_params
    _transient(
        world,
        lambda: _set_client(world, '{"client_id":"enc-unapproved-client","client_secret":"enc-unapproved-secret"}'),
        lambda: _set_client(world, approved),
    )


def _swap_access(world: World) -> None:
    # Another member's all-team row: the acting member's effective access basis changes (owner -> all_team).
    owner_id = world.owner.actor.account_id
    _transient(
        world,
        lambda: update_credential(world.owner, user_id=str(uuid4())),
        lambda: update_credential(world.owner, user_id=owner_id),
    )


@pytest.mark.parametrize("refresh_due", [False, True], ids=["business", "refresh"])
@pytest.mark.parametrize(
    "swap", [_swap_credential, _swap_client, _swap_access], ids=["credential", "oauth-client", "actor-access"]
)
def test_transient_unapproved_snapshot_is_refused_before_any_credential_work(
    world: World, swap: Callable[[World], None], refresh_due: bool, caplog: pytest.LogCaptureFixture
) -> None:
    if refresh_due:
        make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    approved_row = world.row()
    swap(world)

    with pytest.raises(BuilderExecutionPolicyError, match="credential_snapshot_mismatch") as raised:
        build(world, guard_for(world.owner, binding))

    assert str(raised.value) == SNAPSHOT_REFUSAL
    assert "selected" in [name for name, _ in world.events]
    # Nothing after the selection ran: no compliance, decryption (credential or client), refresh or invoke.
    assert [name for name, _ in world.events if name in {"compliance", "decrypt", "refresh_transport"}] == []
    assert world.decrypted == []
    assert world.refresh_calls == []
    assert world.invoke_calls == []
    assert world.cache_deletes == []
    # The approved row is back and untouched by the boundary.
    after_row = world.row()
    assert (after_row.encrypted_credentials, after_row.expires_at, after_row.user_id) == (
        approved_row.encrypted_credentials,
        approved_row.expires_at,
        approved_row.user_id,
    )
    consent = world.consent(reserved.consent_id)
    assert (consent.refresh_count, consent.business_count, consent.outcome_state) == (0, 0, None)
    assert (consent.state, consent.reason_code) == ("failed", "credential_snapshot_mismatch")
    receipt = get(world.owner, reserved.consent_id)
    assert_public(receipt, owner=world.owner)
    assert_no_secret_text(caplog.text + json.dumps(receipt.model_dump(mode="json")))
    for unapproved in ("enc-unapproved-access", "enc-unapproved-client", "enc-unapproved-secret"):
        assert unapproved not in caplog.text

    # The failed grant cannot be re-admitted by a later, approved-looking selection.
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_claimed"):
        build(world, guard_for(world.owner, binding))
    assert world.decrypted == []
    assert world.invoke_calls == []


@pytest.mark.parametrize("credential_type", [CredentialType.API_KEY, CredentialType.UNAUTHORIZED])
def test_non_oauth_snapshot_is_refused_before_compliance_or_decryption(
    world: World, credential_type: CredentialType, caplog: pytest.LogCaptureFixture
) -> None:
    """A grant bound to a non-OAuth row (as the pre-fix admission persisted it) never reaches credential work.

    The admission policy is replaced only while the grant is prepared, confirmed, reserved and
    claimed, so the stored binding carries the API-key/unauthorized reference exactly as a grant
    persisted before OAuth-only admission would. The real native selection then refuses it.
    """
    update_credential(world.owner, credential_type=credential_type)
    original = gmail_read_policy.get_message_envelope

    def pre_fix_admission(
        *, installed: InstalledToolBinding, credential: CredentialReference, parameters: GmailReadParameters
    ) -> object:
        return original(
            installed=installed,
            credential=credential.model_copy(update={"credential_type": "oauth2"}),
            parameters=parameters,
        )

    world.monkeypatch.setattr(gmail_read_policy, "get_message_envelope", pre_fix_admission)
    reserved, binding = claimed(world.owner)
    world.monkeypatch.setattr(gmail_read_policy, "get_message_envelope", original)
    stored = json.loads(json.dumps(world.consent(reserved.consent_id).binding))
    assert stored["credential"]["credential_type"] == str(credential_type)

    with pytest.raises(BuilderExecutionPolicyError) as raised:
        build(world, guard_for(world.owner, binding))

    assert raised.value.reason_code == "credential_required"
    assert [name for name, _ in world.events if name in {"compliance", "decrypt", "refresh_transport"}] == []
    assert world.decrypted == []
    assert world.refresh_calls == []
    assert world.invoke_calls == []
    consent = world.consent(reserved.consent_id)
    assert (consent.state, consent.reason_code, consent.refresh_count, consent.business_count) == (
        "failed",
        "credential_required",
        0,
        0,
    )
    assert_no_secret_text(caplog.text)


def _approved_reference(world: World) -> CredentialReference:
    selection = BuiltinToolManageService.load_builder_credential(
        actor=world.owner.actor, provider_id=PROVIDER, credential_id=world.owner.credential_id, verified_plugin=False
    )
    return selection.snapshot.reference


def test_wrong_native_binding_cannot_admit_a_snapshot(world: World) -> None:
    reserved, binding = claimed(world.owner)
    reference = _approved_reference(world)
    for forged in (
        binding.model_copy(update={"native_node_execution_id": "replayed-node-execution"}),
        binding.model_copy(update={"node_id": "other-node"}),
    ):
        with pytest.raises(BuilderExecutionPolicyError) as raised:
            BuiltinToolManageService.validate_builder_credential_snapshot(binding=forged, reference=reference)
        assert raised.value.reason_code in {"execution_launch_mismatch", "unsupported_tool_node"}
    consent = world.consent(reserved.consent_id)
    assert (consent.state, consent.reason_code, consent.refresh_count, consent.business_count) == (
        "claimed",
        None,
        0,
        0,
    )
    # The approved snapshot is admitted for the exact claimed binding, without any write.
    BuiltinToolManageService.validate_builder_credential_snapshot(binding=binding, reference=reference)
    assert world.consent(reserved.consent_id).state == "claimed"


def test_spent_or_malformed_state_never_re_admits_and_is_not_rewritten(world: World) -> None:
    reserved, binding = claimed(world.owner)
    reference = _approved_reference(world)
    # Bypasses validation, as a model_copy/model_construct crossing the in-process boundary could.
    malformed = reference.model_copy(update={"revision": "not-a-digest"})
    with pytest.raises(BuilderExecutionPolicyError, match="credential_snapshot_mismatch"):
        BuiltinToolManageService.validate_builder_credential_snapshot(binding=binding, reference=malformed)
    assert world.consent(reserved.consent_id).state == "claimed"

    run(build(world, guard_for(world.owner, binding)))
    spent = world.consent(reserved.consent_id)
    assert (spent.state, spent.business_count, spent.outcome_state) == ("claimed", 1, "completed")
    # Replay after the business phase: refused conservatively, nothing rewritten.
    with pytest.raises(BuilderExecutionPolicyError, match="phase_already_claimed"):
        BuiltinToolManageService.validate_builder_credential_snapshot(binding=binding, reference=reference)
    replayed = world.consent(reserved.consent_id)
    assert (replayed.state, replayed.business_count, replayed.outcome_state, replayed.reason_code) == (
        "claimed",
        1,
        "completed",
        "message_returned",
    )
    assert len(world.invoke_calls) == 1


@pytest.mark.parametrize("refresh_due", [False, True], ids=["business", "refresh"])
def test_admitted_snapshot_is_the_one_used_outside_sql(world: World, refresh_due: bool) -> None:
    if refresh_due:
        make_refresh_due(world)
    reserved, binding = claimed(world.owner)
    admitted: list[CredentialReference] = []
    original = BuiltinToolManageService.validate_builder_credential_snapshot

    def record(*, binding: ConfirmedToolBinding, reference: CredentialReference) -> None:
        original(binding=binding, reference=reference)
        world.mark("snapshot_admitted")
        admitted.append(reference)

    world.monkeypatch.setattr(BuiltinToolManageService, "validate_builder_credential_snapshot", staticmethod(record))
    run(build(world, guard_for(world.owner, binding)))

    order = [name for name, _ in world.events]
    assert order.index("snapshot_admitted") < order.index("compliance") < order.index("decrypt")
    assert_outside_sql(world, "snapshot_admitted", "compliance", "decrypt", "invoke_transport")
    stored = world.consent(reserved.consent_id)
    assert len(admitted) == 1
    assert admitted[0].revision == stored.initial_credential_revision
    assert admitted[0].oauth_client_revision == stored.oauth_client_revision
    # The decrypted credentials of exactly that approved ciphertext reached the transport.
    expected = {"access_token": "plain(enc-access-sentinel)", "refresh_token": "plain(enc-refresh-sentinel)"}
    if refresh_due:
        assert_outside_sql(world, "refresh_transport")
        assert world.refresh_calls[0].payload["credentials"] == expected
        assert world.invoke_calls[0].payload["credentials"] == REFRESHED
    else:
        assert world.invoke_calls[0].payload["credentials"] == expected
    assert (stored.business_count, stored.refresh_count) == (1, 1 if refresh_due else 0)


def test_guard_for_another_tenant_is_refused_before_any_lookup(world: World) -> None:
    _, binding = claimed(world.owner)
    owner = world.owner
    with pytest.raises(BuilderExecutionPolicyError, match="execution_owner_mismatch"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id=PROVIDER,
            tool_name="get_message",
            tenant_id="00000000-0000-0000-0000-000000000000",
            user_id=owner.actor.account_id,
            credential_id=owner.credential_id,
            confirmed_guard=guard_for(owner, binding),
        )
    assert world.events == []


# --- business stream outcome ------------------------------------------------------------------


def test_native_error_secret_never_reaches_builder_reason_or_logs(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    reserved, binding = claimed(world.owner)
    world.invoke_fail_after = 1
    tool = build(world, guard_for(world.owner, binding))
    with pytest.raises(RuntimeError, match=NATIVE_SECRET):
        run(tool)

    consent = world.consent(reserved.consent_id)
    assert (consent.business_count, consent.state, consent.outcome_state) == (1, "unknown", "unknown")
    assert consent.reason_code == "stream_incomplete"
    assert_no_secret_text(caplog.text)
    assert_no_secret_text(json.dumps(get(world.owner, reserved.consent_id).model_dump(mode="json")))


def test_business_phase_is_one_shot_across_reiteration(world: World) -> None:
    reserved, binding = claimed(world.owner)
    tool = build(world, guard_for(world.owner, binding))
    run(tool)
    with pytest.raises(BuilderExecutionPolicyError, match="phase_already_claimed"):
        run(tool)
    assert len(world.invoke_calls) == 1
    consent = world.consent(reserved.consent_id)
    assert (consent.business_count, consent.outcome_state) == (1, "completed")


def test_widened_final_envelope_is_recorded_as_a_known_denial(world: World) -> None:
    reserved, binding = claimed(world.owner)
    tool = build(world, guard_for(world.owner, binding))
    tool.runtime.runtime_parameters["format"] = "raw"
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_tool_parameters"):
        run(tool)
    assert world.invoke_calls == []
    consent = world.consent(reserved.consent_id)
    assert (consent.business_count, consent.state, consent.reason_code) == (
        0,
        "failed",
        "unsupported_tool_parameters",
    )


def test_guard_state_and_receipts_never_hold_secrets(world: World) -> None:
    reserved, binding = claimed(world.owner)
    guard = guard_for(world.owner, binding)
    run(build(world, guard))
    assert_no_secret_text(repr(vars(guard)))
    with world.owner.factory() as db:
        row = db.scalar(select(DifyBuilderRealCallConsent).where(DifyBuilderRealCallConsent.id == reserved.consent_id))
        assert row is not None
        assert_no_secret_text(json.dumps([row.binding, row.disclosure, row.execute_receipt], default=str))
