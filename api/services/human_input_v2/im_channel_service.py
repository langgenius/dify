"""Owner-bound application service for Human Input IM Channel management."""

from __future__ import annotations

import secrets
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Never, override
from urllib.parse import quote

from pydantic import NaiveDatetime
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
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.shared import AccountId, TenantId
from libs.datetime_utils import naive_utc_now
from libs.key_providers.base import BaseKeyProvider
from libs.uuid_utils import uuidv7
from models.human_input_v2 import IMEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelAlreadyConfiguredError,
    IMChannelId,
    IMChannelReader,
    IMChannelStatus,
    IMChannelWriter,
    StaleIMChannelWriteError,
    WebhookId,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
)
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

_AVAILABLE_PROVIDERS = (
    IMProvider.SLACK,
    IMProvider.FEISHU,
    IMProvider.LARK,
    IMProvider.DING_TALK,
    IMProvider.MS_TEAMS,
    IMProvider.WE_COM,
)
_INITIAL_CONFIG_VERSION = 1
_INVALID_CREDENTIALS_DESCRIPTION = "The submitted credentials are invalid."
_CONNECTION_FAILURE_DESCRIPTION = "The provider connection could not be established."
_IM_CALLBACK_PATH = "/callbacks/human-input/v2/im"


def _generate_im_provider_webhook_url(webhook_id: WebhookId) -> str:
    """Build a Human Input callback URL from the current public Trigger base URL."""

    base_url = URL(dify_config.TRIGGER_URL)
    escaped_webhook_id = quote(str(webhook_id), safe="")
    callback_path = f"{base_url.raw_path.rstrip('/')}{_IM_CALLBACK_PATH}/{escaped_webhook_id}"
    return str(base_url.with_path(callback_path, encoded=True).with_query(None).with_fragment(None))


@dataclass(frozen=True, slots=True)
class _PreparedIMChannelConfiguration:
    """Private provider result used only while constructing a complete Channel.

    This is deliberately not a Domain contract: it combines provider I/O and
    credential-protection results that exist only inside this application use case.
    """

    provider: IMProvider
    provider_tenant_id: str
    encrypted_credentials: IMEncryptedCredentials
    app_identifier: str

    def __post_init__(self) -> None:
        provider_tenant_id = self.provider_tenant_id.strip()
        if not provider_tenant_id:
            raise ValueError("provider tenant id must not be blank")
        object.__setattr__(self, "provider_tenant_id", provider_tenant_id)


@dataclass(frozen=True, slots=True)
class IMChannelView:
    """Immutable credential-free projection returned to management callers.

    Persisted ``IMChannel`` values contain protected credentials and routing
    metadata, so only ``IMChannelService._to_view`` may expose their safe facts.
    """

    id: IMChannelId
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    provider: IMProvider
    status: IMChannelStatus
    status_reason: str | None
    app_identifier: str
    webhook_url: str | None
    config_version: int


class IMChannelService(ABC):
    """Shared IM Channel management implementation bound to one owner."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        credential_codec: IMCredentialCodec,
        event_transport_mode: IMEventTransportMode,
    ) -> None:
        self._session_factory = session_factory
        self._credential_codec = credential_codec
        self._event_transport_mode = event_transport_mode

    @abstractmethod
    def _new_reader(self, session: Session) -> IMChannelReader:
        """Bind a caller-owned Session to this service's owner."""
        ...

    @abstractmethod
    def _new_writer(self, session: Session) -> IMChannelWriter:
        """Bind writes and audit metadata to this service's owner context."""
        ...

    def available_providers(self) -> tuple[IMProvider, ...]:
        """Return provider discriminators accepted by complete credentials."""

        return _AVAILABLE_PROVIDERS

    def get_current(self) -> IMChannelView | None:
        """Read the current owner-bound Channel without Provider I/O."""

        current = self._read_current()
        return self._to_view(current) if current is not None else None

    def get(self, channel_id: IMChannelId) -> IMChannelView:
        """Read the addressed current Channel within the bound owner slot."""

        return self._to_view(self._load_addressed(channel_id))

    def test(self, credentials: IMProviderCredentials) -> None:
        """Validate only submitted credentials without persistence access."""

        self._test_credentials(credentials)

    def create(self, credentials: IMProviderCredentials) -> IMChannelView:
        """Validate and persist the first Channel after an owner-slot precheck."""

        if self._read_current() is not None:
            raise ChannelAlreadyConfiguredError("IM channel is already configured")

        prepared = self._prepare_configuration(credentials)
        now = self._now()
        channel = self._new_channel(prepared, now)
        try:
            persisted = self._write(lambda writer: writer.create(channel))
        except IMChannelAlreadyConfiguredError:
            raise ChannelAlreadyConfiguredError("IM channel is already configured") from None
        return self._to_view(persisted)

    def update(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
        credentials: IMProviderCredentials,
    ) -> IMChannelView:
        """Rotate credentials while preserving Channel and provider identity."""

        current = self._load_addressed(channel_id)
        self._require_current_version(current, expected_config_version)
        if credentials.provider is not current.provider:
            raise ReplacementRequiredError("IM provider replacement is required")

        prepared = self._prepare_configuration(credentials)
        if prepared.provider_tenant_id != current.provider_tenant_id:
            raise ReplacementRequiredError("IM provider tenant replacement is required")

        now = self._now()
        updated = IMChannel(
            id=current.id,
            created_at=current.created_at,
            updated_at=now,
            provider=prepared.provider,
            provider_tenant_id=prepared.provider_tenant_id,
            encrypted_credentials=prepared.encrypted_credentials,
            app_identifier=prepared.app_identifier,
            webhook_id=current.webhook_id,
            config_version=expected_config_version + 1,
            status=IMChannelStatus.CONNECTED,
            status_reason=None,
        )
        try:
            persisted = self._write(lambda writer: writer.update(updated, expected_config_version))
        except StaleIMChannelWriteError:
            raise ProviderConfigurationUpdatedError("IM configuration was updated") from None
        return self._to_view(persisted)

    def replace(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
        credentials: IMProviderCredentials,
    ) -> IMChannelView:
        """Replace the current provider installation under an explicit CAS guard."""

        current = self._load_addressed(channel_id)
        self._require_current_version(current, expected_config_version)
        prepared = self._prepare_configuration(credentials)
        now = self._now()
        replacement = self._new_channel(prepared, now)
        try:
            persisted = self._write(lambda writer: writer.replace(current.id, expected_config_version, replacement))
        except StaleIMChannelWriteError:
            raise ProviderConfigurationUpdatedError("IM configuration was updated") from None
        return self._to_view(persisted)

    def delete(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
    ) -> IMChannelId:
        """Delete the addressed Channel without Provider or dependent-domain work."""

        current = self._load_addressed(channel_id)
        self._require_current_version(current, expected_config_version)
        try:
            self._write(lambda writer: writer.delete(current.id, expected_config_version))
        except StaleIMChannelWriteError:
            raise ProviderConfigurationUpdatedError("IM configuration was updated") from None
        return current.id

    def _prepare_configuration(
        self,
        credentials: IMProviderCredentials,
    ) -> _PreparedIMChannelConfiguration:
        tested = self._test_credentials(credentials)
        provider_tenant_id = tested.provider_tenant_id.strip()
        if not provider_tenant_id:
            raise ValueError("provider tenant id must not be blank")
        app_identifier = self._app_identifier(credentials)
        encrypted_credentials = self._credential_codec.seal(credentials)
        return _PreparedIMChannelConfiguration(
            provider=tested.provider,
            provider_tenant_id=provider_tenant_id,
            encrypted_credentials=encrypted_credentials,
            app_identifier=app_identifier,
        )

    def _test_credentials(
        self,
        credentials: IMProviderCredentials,
    ) -> CredentialTestSuccess:
        adapter = build_im_provider_adapter(credentials)
        try:
            tested = adapter.test_credentials()
        finally:
            adapter.close()

        if isinstance(tested, CredentialTestFailure):
            self._raise_provider_failure(tested.kind)
        if tested.provider is not credentials.provider:
            raise AssertionError("provider adapter returned a mismatched provider")
        return tested

    @staticmethod
    def _raise_provider_failure(kind: CredentialTestFailureKind) -> Never:
        if kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED:
            raise ChannelProviderError(
                ProviderFailureKind.INVALID_CREDENTIALS,
                _INVALID_CREDENTIALS_DESCRIPTION,
            )
        raise ChannelProviderError(
            ProviderFailureKind.CONNECTION_FAILURE,
            _CONNECTION_FAILURE_DESCRIPTION,
        )

    @staticmethod
    def _app_identifier(credentials: IMProviderCredentials) -> str:
        if isinstance(credentials, (FeishuCredentials, LarkCredentials)):
            app_identifier = credentials.app_id
        elif isinstance(credentials, (SlackCredentials, DingTalkCredentials, MSTeamsCredentials)):
            app_identifier = credentials.client_id
        elif isinstance(credentials, WeComCredentials):
            app_identifier = credentials.agent_id
        else:
            raise TypeError("unsupported IM provider credentials")

        app_identifier = app_identifier.strip()
        if not app_identifier:
            raise ValueError("app identifier must not be blank")
        return app_identifier

    def _to_view(self, channel: IMChannel) -> IMChannelView:
        webhook_url = (
            _generate_im_provider_webhook_url(channel.webhook_id)
            if self._event_transport_mode is IMEventTransportMode.WEBHOOK and channel.provider.supports_webhook()
            else None
        )
        return IMChannelView(
            id=channel.id,
            created_at=channel.created_at,
            updated_at=channel.updated_at,
            provider=channel.provider,
            status=channel.status,
            status_reason=channel.status_reason,
            app_identifier=channel.app_identifier,
            webhook_url=webhook_url,
            config_version=channel.config_version,
        )

    def _read_current(self) -> IMChannel | None:
        with self._session_factory() as session:
            return self._new_reader(session).get()

    def _load_addressed(self, channel_id: IMChannelId) -> IMChannel:
        current = self._read_current()
        if current is None or current.id != channel_id:
            raise ChannelNotFoundError("IM channel was not found")
        return current

    @staticmethod
    def _require_current_version(channel: IMChannel, expected_config_version: int) -> None:
        if channel.config_version != expected_config_version:
            raise ProviderConfigurationUpdatedError("IM configuration was updated")

    def _write[T](self, mutation: Callable[[IMChannelWriter], T]) -> T:
        with self._session_factory() as session:
            with session.begin():
                persisted = mutation(self._new_writer(session))
            return persisted

    def _new_channel(
        self,
        prepared: _PreparedIMChannelConfiguration,
        now: NaiveDatetime,
    ) -> IMChannel:
        return IMChannel(
            id=self._new_channel_id(),
            created_at=now,
            updated_at=now,
            provider=prepared.provider,
            provider_tenant_id=prepared.provider_tenant_id,
            encrypted_credentials=prepared.encrypted_credentials,
            app_identifier=prepared.app_identifier,
            webhook_id=self._new_webhook_id(),
            config_version=_INITIAL_CONFIG_VERSION,
            status=IMChannelStatus.CONNECTED,
            status_reason=None,
        )

    @staticmethod
    def _now() -> NaiveDatetime:
        return naive_utc_now()

    @staticmethod
    def _new_channel_id() -> IMChannelId:
        return IMChannelId(str(uuidv7()))

    @staticmethod
    def _new_webhook_id() -> WebhookId:
        return WebhookId(secrets.token_urlsafe(24))


class WorkspaceIMChannelService(IMChannelService):
    """IM Channel management bound to one trusted Workspace and Account."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        tenant_id: TenantId,
        account_id: AccountId,
        key_provider: BaseKeyProvider,
    ) -> None:
        super().__init__(
            session_factory,
            IMCredentialCodec(TenantBoundCredentialCipher(key_provider, str(tenant_id))),
            dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE,
        )
        self._tenant_id = tenant_id
        self._account_id = account_id

    @override
    def _new_reader(self, session: Session) -> IMChannelReader:
        return WorkspaceIMChannelReader(session, self._tenant_id)

    @override
    def _new_writer(self, session: Session) -> IMChannelWriter:
        return WorkspaceIMChannelWriter(session, self._tenant_id, self._account_id)


__all__ = ["IMChannelService", "IMChannelView", "WorkspaceIMChannelService"]
