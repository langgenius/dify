"""Observable contracts for the owner-bound IM Channel application service."""

from __future__ import annotations

import json
import re
from base64 import b64decode
from collections.abc import Callable
from dataclasses import dataclass, field, fields
from datetime import datetime
from typing import cast, override

import pytest
from sqlalchemy.orm import Session, sessionmaker
from yarl import URL

from configs import dify_config
from configs.deploy import IMEventTransportMode
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.entities import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
)
from core.human_input_v2.shared import AccountId, TenantId
from libs.key_providers.base import BaseKeyProvider
from models.human_input_v2 import IMEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelAlreadyConfiguredError,
    IMChannelId,
    IMChannelStatus,
    StaleIMChannelWriteError,
    WebhookId,
)
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
)
from services.human_input_v2.im_channel_service import (
    IMChannelService,
    IMChannelView,
    WorkspaceIMChannelService,
)
from services.human_input_v2.im_credential_codec import IMCredentialCodec


@dataclass(frozen=True)
class _CredentialCase:
    credentials: IMProviderCredentials
    app_identifier: str


_CASES = (
    _CredentialCase(
        FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        ),
        "feishu-app",
    ),
    _CredentialCase(
        LarkCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        ),
        "lark-app",
    ),
    _CredentialCase(
        SlackCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-client-secret",
            signing_secret="slack-signing-secret",
            bot_token="xoxb-slack-bot-token",
            app_token="xapp-slack-app-token",
        ),
        "slack-client",
    ),
    _CredentialCase(
        DingTalkCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        ),
        "ding-client",
    ),
    _CredentialCase(
        MSTeamsCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000001",
            client_id="00000000-0000-0000-0000-000000000002",
            client_secret="teams-secret",
        ),
        "00000000-0000-0000-0000-000000000002",
    ),
    _CredentialCase(
        WeComCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        ),
        "1001",
    ),
)
_SLACK = _CASES[2].credentials
_NOW = datetime(2026, 8, 31, 8, 30)


@dataclass
class _State:
    current: IMChannel | None = None
    writer_error: Exception | None = None
    events: list[str] = field(default_factory=list)
    last_written: IMChannel | None = None


class _Transaction:
    def __init__(self, state: _State) -> None:
        self._state = state

    def __enter__(self) -> _Transaction:
        assert self._state.events is not None
        self._state.events.append("transaction_begin")
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        del exc_type, traceback
        assert self._state.events is not None
        self._state.events.append("transaction_rollback" if exc is not None else "transaction_commit")
        return False


class _Session:
    def __init__(self, state: _State) -> None:
        self._state = state

    def __enter__(self) -> _Session:
        assert self._state.events is not None
        self._state.events.append("session_open")
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        del exc_type, exc, traceback
        assert self._state.events is not None
        self._state.events.append("session_close")
        return False

    def begin(self) -> _Transaction:
        return _Transaction(self._state)


class _SessionFactory:
    def __init__(self, state: _State) -> None:
        self._state = state
        self.calls = 0

    def __call__(self) -> _Session:
        self.calls += 1
        return _Session(self._state)


class _Reader:
    def __init__(self, state: _State) -> None:
        self._state = state

    def get(self) -> IMChannel | None:
        assert self._state.events is not None
        self._state.events.append("reader_get")
        return self._state.current


class _Writer:
    def __init__(self, state: _State) -> None:
        self._state = state

    def _raise_or_record(self, operation: str, channel: IMChannel | None = None) -> None:
        assert self._state.events is not None
        self._state.events.append(f"writer_{operation}")
        if self._state.writer_error is not None:
            raise self._state.writer_error
        self._state.last_written = channel

    def create(self, channel: IMChannel) -> IMChannel:
        self._raise_or_record("create", channel)
        self._state.current = channel
        return channel

    def update(self, channel: IMChannel, expected_config_version: int) -> IMChannel:
        del expected_config_version
        self._raise_or_record("update", channel)
        self._state.current = channel
        return channel

    def replace(
        self,
        current_channel_id: IMChannelId,
        expected_config_version: int,
        replacement: IMChannel,
    ) -> IMChannel:
        del current_channel_id, expected_config_version
        self._raise_or_record("replace", replacement)
        self._state.current = replacement
        return replacement

    def delete(self, channel_id: IMChannelId, expected_config_version: int) -> None:
        del channel_id, expected_config_version
        self._raise_or_record("delete")
        self._state.current = None


class _Cipher:
    def __init__(self, events: list[str], error: Exception | None = None) -> None:
        self.events = events
        self.error = error
        self.plaintexts: list[str] = []

    def encrypt(self, plaintext: str) -> bytes:
        self.events.append("encrypt")
        if self.error is not None:
            raise self.error
        self.plaintexts.append(plaintext)
        return b"opaque-ciphertext"

    def decrypt(self, ciphertext: bytes) -> str:
        del ciphertext
        raise AssertionError("management projection must not decrypt credentials")


class _TestService(IMChannelService):
    def __init__(
        self,
        state: _State,
        *,
        mode: IMEventTransportMode = IMEventTransportMode.WEBHOOK,
        cipher_error: Exception | None = None,
    ) -> None:
        self.state = state
        self.session_factory = _SessionFactory(state)
        assert state.events is not None
        self.cipher = _Cipher(state.events, cipher_error)
        super().__init__(self.session_factory, IMCredentialCodec(self.cipher), mode)  # type: ignore[arg-type]

    @override
    def _new_reader(self, session: Session) -> _Reader:
        del session
        assert self.state.events is not None
        self.state.events.append("new_reader")
        return _Reader(self.state)

    @override
    def _new_writer(self, session: Session) -> _Writer:
        del session
        assert self.state.events is not None
        self.state.events.append("new_writer")
        return _Writer(self.state)


class _Adapter:
    def __init__(
        self,
        events: list[str],
        result: CredentialTestSuccess | CredentialTestFailure | Exception,
        close_error: Exception | None = None,
    ) -> None:
        self._events = events
        self._result = result
        self._close_error = close_error

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        self._events.append("test_credentials")
        if isinstance(self._result, Exception):
            raise self._result
        return self._result

    def close(self) -> None:
        self._events.append("adapter_close")
        if self._close_error is not None:
            raise self._close_error


def _install_adapter(
    monkeypatch: pytest.MonkeyPatch,
    state: _State,
    *,
    provider: IMProvider = IMProvider.SLACK,
    provider_tenant_id: str | None = None,
    result: CredentialTestSuccess | CredentialTestFailure | Exception | None = None,
    build_error: Exception | None = None,
    close_error: Exception | None = None,
) -> None:
    from services.human_input_v2 import im_channel_service as service_module

    assert state.events is not None
    adapter_result = result or CredentialTestSuccess(provider, provider_tenant_id or f"{provider.value}-tenant")

    def build(credentials: IMProviderCredentials) -> _Adapter:
        state.events.append("build_adapter")
        if build_error is not None:
            raise build_error
        assert credentials.provider is provider
        return _Adapter(state.events, adapter_result, close_error)

    monkeypatch.setattr(service_module, "build_im_provider_adapter", build)


def _channel(
    *,
    provider: IMProvider = IMProvider.SLACK,
    channel_id: str = "channel-1",
    provider_tenant_id: str | None = None,
    webhook_id: str = "persisted-webhook-id",
    config_version: int = 3,
    status: IMChannelStatus = IMChannelStatus.CONNECTED,
    status_reason: str | None = None,
) -> IMChannel:
    return IMChannel(
        id=IMChannelId(channel_id),
        created_at=datetime(2026, 8, 30, 8),
        updated_at=datetime(2026, 8, 30, 9),
        provider=provider,
        provider_tenant_id=provider_tenant_id or f"{provider.value}-tenant",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="credential-secret-ciphertext"),
        app_identifier=f"{provider.value}-application",
        webhook_id=WebhookId(webhook_id),
        config_version=config_version,
        status=status,
        status_reason=status_reason,
    )


def test_available_provider_inventory_is_complete_and_stable() -> None:
    service = _TestService(_State())

    assert service.available_providers() == (
        IMProvider.SLACK,
        IMProvider.FEISHU,
        IMProvider.LARK,
        IMProvider.DING_TALK,
        IMProvider.MS_TEAMS,
        IMProvider.WE_COM,
    )


def test_candidate_test_uses_no_session_reader_writer_or_cipher(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _State()
    service = _TestService(state)
    _install_adapter(monkeypatch, state)

    assert service.test(_SLACK) is None

    assert service.session_factory.calls == 0
    assert state.events == ["build_adapter", "test_credentials", "adapter_close"]
    assert service.cipher.plaintexts == []


@pytest.mark.parametrize(
    ("failure_kind", "expected_kind", "expected_description"),
    [
        (
            CredentialTestFailureKind.AUTHENTICATION_REJECTED,
            ProviderFailureKind.INVALID_CREDENTIALS,
            "The submitted credentials are invalid.",
        ),
        (
            CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
            ProviderFailureKind.CONNECTION_FAILURE,
            "The provider connection could not be established.",
        ),
        (
            CredentialTestFailureKind.UNKNOWN,
            ProviderFailureKind.CONNECTION_FAILURE,
            "The provider connection could not be established.",
        ),
    ],
)
def test_classified_provider_failures_map_to_safe_stable_errors(
    monkeypatch: pytest.MonkeyPatch,
    failure_kind: CredentialTestFailureKind,
    expected_kind: ProviderFailureKind,
    expected_description: str,
) -> None:
    state = _State()
    service = _TestService(state)
    _install_adapter(
        monkeypatch,
        state,
        result=CredentialTestFailure(failure_kind, "provider-secret-diagnostic"),
    )

    with pytest.raises(ChannelProviderError) as captured:
        service.test(_SLACK)

    assert captured.value.kind is expected_kind
    assert captured.value.status_description == expected_description
    assert "provider-secret-diagnostic" not in repr(captured.value)
    assert state.events == ["build_adapter", "test_credentials", "adapter_close"]


@pytest.mark.parametrize("failure_point", ["build", "test", "close", "cipher"])
def test_unclassified_provider_adapter_and_cipher_failures_propagate_unchanged(
    monkeypatch: pytest.MonkeyPatch,
    failure_point: str,
) -> None:
    state = _State()
    error = LookupError(f"unclassified-{failure_point}-secret")
    service = _TestService(state, cipher_error=error if failure_point == "cipher" else None)
    _install_adapter(
        monkeypatch,
        state,
        build_error=error if failure_point == "build" else None,
        result=error if failure_point == "test" else None,
        close_error=error if failure_point == "close" else None,
    )

    operation: Callable[[], object] = (
        (lambda: service.create(_SLACK)) if failure_point == "cipher" else (lambda: service.test(_SLACK))
    )
    with pytest.raises(LookupError) as captured:
        operation()

    assert captured.value is error
    assert "transaction_begin" not in state.events


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.credentials.provider.value)
def test_create_prepares_and_persists_complete_channel_for_every_provider(
    monkeypatch: pytest.MonkeyPatch,
    case: _CredentialCase,
) -> None:
    state = _State()
    service = _TestService(state)
    _install_adapter(monkeypatch, state, provider=case.credentials.provider)
    calls = 0

    def now() -> datetime:
        nonlocal calls
        calls += 1
        return _NOW

    monkeypatch.setattr(service, "_now", now)

    view = service.create(case.credentials)

    persisted = state.last_written
    assert persisted is not None
    assert calls == 1
    assert persisted.provider is case.credentials.provider
    assert persisted.provider_tenant_id == f"{case.credentials.provider.value}-tenant"
    assert persisted.app_identifier == case.app_identifier
    assert persisted.config_version == 1
    assert persisted.status is IMChannelStatus.CONNECTED
    assert persisted.status_reason is None
    assert persisted.created_at == persisted.updated_at == _NOW
    assert len(persisted.webhook_id) == 32
    assert re.fullmatch(r"[A-Za-z0-9_-]{32}", persisted.webhook_id)
    assert json.loads(service.cipher.plaintexts[0]) == case.credentials.model_dump(mode="json")
    assert b64decode(persisted.encrypted_credentials.ciphertext) == b"opaque-ciphertext"
    assert view.id == persisted.id
    assert view.config_version == 1
    assert "credential-secret" not in repr(view)
    assert state.events is not None
    assert state.events.index("adapter_close") < state.events.index("encrypt")
    assert state.events.index("encrypt") < state.events.index("transaction_begin")
    assert state.events.index("writer_create") < state.events.index("transaction_commit")


def test_create_rejects_observed_current_before_provider_io(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _State(current=_channel())
    service = _TestService(state)
    _install_adapter(monkeypatch, state, build_error=AssertionError("provider must not be called"))

    with pytest.raises(ChannelAlreadyConfiguredError):
        service.create(_SLACK)

    assert "build_adapter" not in state.events
    assert "transaction_begin" not in state.events


def test_repository_create_conflict_remains_authoritative(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _State(writer_error=IMChannelAlreadyConfiguredError("owner-key-detail"))
    service = _TestService(state)
    _install_adapter(monkeypatch, state)

    with pytest.raises(ChannelAlreadyConfiguredError) as captured:
        service.create(_SLACK)

    assert "owner-key-detail" not in str(captured.value)
    assert "transaction_rollback" in state.events


def test_current_and_addressed_reads_return_only_credential_free_views() -> None:
    state = _State(
        current=_channel(
            status=IMChannelStatus.CONNECTION_FAILURE,
            status_reason="Safe provider connection state.",
        )
    )
    service = _TestService(state, mode=IMEventTransportMode.STREAM)

    current = service.get_current()
    addressed = service.get(IMChannelId("channel-1"))

    assert current == addressed
    assert current is not None
    assert current.status_reason == "Safe provider connection state."
    assert current.app_identifier == "slack-application"
    assert {field.name for field in fields(IMChannelView)} == {
        "id",
        "created_at",
        "updated_at",
        "provider",
        "status",
        "status_reason",
        "app_identifier",
        "webhook_url",
        "config_version",
    }
    rendered = repr(current)
    assert "credential-secret-ciphertext" not in rendered
    assert "persisted-webhook-id" not in rendered
    assert "owner_key" not in rendered
    assert "configured_by" not in rendered


def test_missing_current_and_addressed_id_mismatch_are_not_found() -> None:
    service = _TestService(_State())
    assert service.get_current() is None

    with pytest.raises(ChannelNotFoundError):
        service.get(IMChannelId("missing"))

    service.state.current = _channel(channel_id="current")
    with pytest.raises(ChannelNotFoundError):
        service.get(IMChannelId("another-owner-or-id"))


@pytest.mark.parametrize("provider", list(IMProvider))
@pytest.mark.parametrize("mode", list(IMEventTransportMode))
def test_projection_covers_both_modes_and_all_provider_capabilities(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
    mode: IMEventTransportMode,
) -> None:
    monkeypatch.setattr(dify_config, "TRIGGER_URL", "https://example.com/dify/base/?old=1#fragment")
    state = _State(current=_channel(provider=provider, webhook_id="unsafe/id ?#%"))
    service = _TestService(state, mode=mode)

    view = service.get_current()

    assert view is not None
    if mode is IMEventTransportMode.WEBHOOK and provider.supports_webhook():
        assert view.webhook_url == ("https://example.com/dify/base/callbacks/human-input/v2/im/unsafe%2Fid%20%3F%23%25")
    else:
        assert view.webhook_url is None
    assert service.cipher.plaintexts == []
    assert "build_adapter" not in state.events


def test_projection_uses_current_trigger_origin_without_persistence_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _State(current=_channel())
    service = _TestService(state)
    monkeypatch.setattr(dify_config, "TRIGGER_URL", "https://first.example/root")
    first = service.get_current()
    monkeypatch.setattr(dify_config, "TRIGGER_URL", "https://second.example/new-root/")
    second = service.get_current()

    assert first is not None
    assert second is not None
    assert first.webhook_url is not None
    assert second.webhook_url is not None
    assert URL(first.webhook_url).origin() == URL("https://first.example").origin()
    assert URL(second.webhook_url).origin() == URL("https://second.example").origin()
    assert first.id == second.id
    assert first.config_version == second.config_version == 3
    assert not any(event.startswith("writer_") for event in state.events or [])


@pytest.mark.parametrize("failure", ["wrong_id", "stale", "provider"])
def test_update_local_prechecks_avoid_provider_io(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    state = _State(current=_channel())
    service = _TestService(state)
    _install_adapter(monkeypatch, state, build_error=AssertionError("provider must not be called"))
    channel_id = IMChannelId("wrong") if failure == "wrong_id" else IMChannelId("channel-1")
    version = 2 if failure == "stale" else 3
    credentials = _CASES[0].credentials if failure == "provider" else _SLACK
    expected_error = {
        "wrong_id": ChannelNotFoundError,
        "stale": ProviderConfigurationUpdatedError,
        "provider": ReplacementRequiredError,
    }[failure]

    with pytest.raises(expected_error):
        service.update(channel_id, version, credentials)

    assert "build_adapter" not in state.events
    assert "transaction_begin" not in state.events


def test_update_rejects_changed_provider_tenant_without_mutation(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _State(current=_channel(provider_tenant_id="original-tenant"))
    service = _TestService(state)
    _install_adapter(monkeypatch, state, provider_tenant_id="replacement-tenant")

    with pytest.raises(ReplacementRequiredError):
        service.update(IMChannelId("channel-1"), 3, _SLACK)

    assert "test_credentials" in state.events
    assert "transaction_begin" not in state.events
    assert state.current is not None
    assert state.current.provider_tenant_id == "original-tenant"


def test_update_preserves_identity_and_advances_version_once(monkeypatch: pytest.MonkeyPatch) -> None:
    original = _channel(provider_tenant_id="slack-tenant")
    state = _State(current=original)
    service = _TestService(state)
    _install_adapter(monkeypatch, state, provider_tenant_id="slack-tenant")
    calls = 0

    def now() -> datetime:
        nonlocal calls
        calls += 1
        return _NOW

    monkeypatch.setattr(service, "_now", now)

    view = service.update(original.id, 3, _SLACK)

    updated = state.last_written
    assert updated is not None
    assert calls == 1
    assert updated.id == original.id
    assert updated.webhook_id == original.webhook_id
    assert updated.created_at == original.created_at
    assert updated.updated_at == _NOW
    assert updated.config_version == 4
    assert updated.status is IMChannelStatus.CONNECTED
    assert updated.status_reason is None
    assert view.id == original.id
    assert view.config_version == 4


@pytest.mark.parametrize("operation", ["update", "replace", "delete"])
def test_stale_repository_writes_map_without_retry(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    state = _State(current=_channel(), writer_error=StaleIMChannelWriteError("database-cas-detail"))
    service = _TestService(state)
    _install_adapter(monkeypatch, state)

    operations = {
        "update": lambda: service.update(IMChannelId("channel-1"), 3, _SLACK),
        "replace": lambda: service.replace(IMChannelId("channel-1"), 3, _SLACK),
        "delete": lambda: service.delete(IMChannelId("channel-1"), 3),
    }

    with pytest.raises(ProviderConfigurationUpdatedError) as captured:
        operations[operation]()

    assert "database-cas-detail" not in str(captured.value)
    assert (state.events or []).count(f"writer_{operation}") == 1
    assert "transaction_rollback" in state.events


def test_replacement_generates_new_identity_webhook_and_initial_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = _channel()
    state = _State(current=original)
    service = _TestService(state)
    _install_adapter(monkeypatch, state)
    monkeypatch.setattr(service, "_now", lambda: _NOW)
    monkeypatch.setattr(service, "_new_channel_id", lambda: IMChannelId("replacement-channel"))
    monkeypatch.setattr(service, "_new_webhook_id", lambda: WebhookId("replacement-webhook-id"))

    view = service.replace(original.id, original.config_version, _SLACK)

    replacement = state.last_written
    assert replacement is not None
    assert replacement.id == IMChannelId("replacement-channel")
    assert replacement.id != original.id
    assert replacement.webhook_id == WebhookId("replacement-webhook-id")
    assert replacement.webhook_id != original.webhook_id
    assert replacement.created_at == replacement.updated_at == _NOW
    assert replacement.config_version == 1
    assert view.id == replacement.id


@pytest.mark.parametrize("operation", ["replace", "delete"])
@pytest.mark.parametrize("failure", ["wrong_id", "stale"])
def test_replacement_and_delete_local_failures_avoid_provider_and_mutation(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    failure: str,
) -> None:
    state = _State(current=_channel())
    service = _TestService(state)
    _install_adapter(monkeypatch, state, build_error=AssertionError("provider must not be called"))
    channel_id = IMChannelId("wrong") if failure == "wrong_id" else IMChannelId("channel-1")
    version = 2 if failure == "stale" else 3
    expected_error = ChannelNotFoundError if failure == "wrong_id" else ProviderConfigurationUpdatedError

    operations = {
        "replace": lambda: service.replace(channel_id, version, _SLACK),
        "delete": lambda: service.delete(channel_id, version),
    }

    with pytest.raises(expected_error):
        operations[operation]()

    assert "build_adapter" not in state.events
    assert not any(event.startswith("writer_") for event in state.events or [])


def test_delete_performs_no_provider_work_and_returns_after_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _State(current=_channel())
    service = _TestService(state)
    _install_adapter(monkeypatch, state, build_error=AssertionError("provider must not be called"))

    deleted_id = service.delete(IMChannelId("channel-1"), 3)

    assert deleted_id == IMChannelId("channel-1")
    assert "build_adapter" not in state.events
    assert state.events is not None
    assert state.events.index("writer_delete") < state.events.index("transaction_commit")
    assert state.events[-2:] == ["transaction_commit", "session_close"]


@pytest.mark.parametrize("operation", ["create", "update", "replace", "delete"])
def test_unclassified_persistence_failures_propagate_and_roll_back(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    error = RuntimeError("sql-owner-key-credential-detail")
    state = _State(current=None if operation == "create" else _channel(), writer_error=error)
    service = _TestService(state)
    _install_adapter(monkeypatch, state)

    operations = {
        "create": lambda: service.create(_SLACK),
        "update": lambda: service.update(IMChannelId("channel-1"), 3, _SLACK),
        "replace": lambda: service.replace(IMChannelId("channel-1"), 3, _SLACK),
        "delete": lambda: service.delete(IMChannelId("channel-1"), 3),
    }

    with pytest.raises(RuntimeError) as captured:
        operations[operation]()

    assert captured.value is error
    assert "transaction_rollback" in state.events
    assert "transaction_commit" not in state.events


def test_workspace_service_binds_reader_writer_cipher_and_actor_to_trusted_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.human_input_v2 import im_channel_service as service_module

    tenant_id = TenantId("trusted-tenant")
    account_id = AccountId("trusted-account")
    state = _State()
    bindings: list[tuple[object, ...]] = []

    class BoundCipher(_Cipher):
        def __init__(self, key_provider: object, bound_tenant_id: str) -> None:
            bindings.append(("cipher", key_provider, bound_tenant_id))
            assert state.events is not None
            super().__init__(state.events)

    class BoundReader(_Reader):
        def __init__(self, session: object, bound_tenant_id: TenantId) -> None:
            bindings.append(("reader", session, bound_tenant_id))
            super().__init__(state)

    class BoundWriter(_Writer):
        def __init__(
            self,
            session: object,
            bound_tenant_id: TenantId,
            bound_account_id: AccountId,
        ) -> None:
            bindings.append(("writer", session, bound_tenant_id, bound_account_id))
            super().__init__(state)

    key_provider = object()
    monkeypatch.setattr(service_module, "TenantBoundCredentialCipher", BoundCipher)
    monkeypatch.setattr(service_module, "WorkspaceIMChannelReader", BoundReader)
    monkeypatch.setattr(service_module, "WorkspaceIMChannelWriter", BoundWriter)
    monkeypatch.setattr(dify_config, "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", IMEventTransportMode.STREAM)
    _install_adapter(monkeypatch, state)
    service = WorkspaceIMChannelService(
        cast(sessionmaker[Session], _SessionFactory(state)),
        tenant_id,
        account_id,
        cast(BaseKeyProvider, key_provider),
    )

    view = service.create(_SLACK)

    assert view.provider is IMProvider.SLACK
    assert bindings[0] == ("cipher", key_provider, "trusted-tenant")
    assert any(binding[0] == "reader" and binding[2] == tenant_id for binding in bindings)
    assert any(binding[0] == "writer" and binding[2:] == (tenant_id, account_id) for binding in bindings)
