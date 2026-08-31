"""Non-importable reference API for the IM Channel application service.

This artifact freezes the intended public and constructor surfaces before
production implementation. Production code belongs under
``api/services/human_input_v2/``.
"""

from __future__ import annotations

import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import override

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session, sessionmaker
from yarl import URL

from configs import dify_config
from core.human_input_v2.entities import IMEventTransportMode, IMProvider
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.entities import CredentialTestSuccess
from core.human_input_v2.shared import AccountId, TenantId
from libs.datetime_utils import naive_utc_now
from libs.key_providers.base import BaseKeyProvider
from libs.uuid_utils import uuidv7
from models.human_input_v2 import IMEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelReader,
    IMChannelStatus,
    IMChannelWriter,
    WebhookId,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    DeploymentIMChannelWriter,
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)
from services.human_input_v2.im_credential_codec import (
    BoundCredentialCipher,
    IMCredentialCodec,
)
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher


def _generate_im_provider_webhook_url(webhook_id: WebhookId) -> str:
    """Build the Human Input callback URL from the current public Trigger base URL."""

    return str(
        URL(dify_config.TRIGGER_URL)
        / "callbacks"
        / "human-input"
        / "v2"
        / "im"
        / str(webhook_id)
    )


@dataclass(frozen=True, slots=True)
class _PreparedIMChannelConfiguration:
    """Provider-confirmed configuration before Channel identity is assigned."""

    provider: IMProvider
    provider_tenant_id: str
    encrypted_credentials: IMEncryptedCredentials
    app_identifier: str


@dataclass(frozen=True, slots=True)
class IMChannelView:
    """Credential-free Channel projection returned to management callers."""

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
    """Shared Channel Management implementation bound to one owner."""

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
        """Bind the supplied caller-owned Session to this Service's owner."""
        ...

    @abstractmethod
    def _new_writer(self, session: Session) -> IMChannelWriter:
        """Bind writes and audit metadata to this Service's owner context."""
        ...

    def available_providers(self) -> tuple[IMProvider, ...]:
        """Return Provider discriminators accepted by complete credential commands."""
        ...

    def get_current(self) -> IMChannelView | None:
        """Read the current Channel for the constructor-bound owner without Provider I/O."""
        ...

    def get(self, channel_id: IMChannelId) -> IMChannelView:
        """Return the addressed current Channel or reject an ID outside the bound owner slot."""
        ...

    def test(self, credentials: IMProviderCredentials) -> None:
        """Validate only the submitted credentials without opening persistence state."""
        ...

    def create(self, credentials: IMProviderCredentials) -> IMChannelView:
        """Validate and persist the first Channel after an owner-slot precheck."""
        ...

    def update(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
        credentials: IMProviderCredentials,
    ) -> IMChannelView:
        """Rotate complete credentials while preserving Channel identity and Provider tenant."""
        ...

    def replace(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
        credentials: IMProviderCredentials,
    ) -> IMChannelView:
        """Replace the current Provider installation under an explicit version guard."""
        ...

    def delete(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
    ) -> IMChannelId:
        """Delete the addressed Channel under CAS without performing Provider cleanup."""
        ...

    def _prepare_configuration(
        self,
        credentials: IMProviderCredentials,
    ) -> _PreparedIMChannelConfiguration:
        """Authenticate, resolve Provider ownership, and seal credentials before a write transaction."""
        ...

    def _test_credentials(
        self,
        credentials: IMProviderCredentials,
    ) -> CredentialTestSuccess:
        """Own one Provider adapter lifetime and reduce its credential result to safe facts."""
        ...

    @staticmethod
    def _app_identifier(credentials: IMProviderCredentials) -> str:
        """Extract the Provider-specific application identifier safe for management views."""
        ...

    def _to_view(self, channel: IMChannel) -> IMChannelView:
        """Project one persisted Channel through the sole credential-free management boundary."""
        webhook_url = (
            _generate_im_provider_webhook_url(channel.webhook_id)
            if self._event_transport_mode is IMEventTransportMode.WEBHOOK
            and channel.provider.supports_webhook()
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

    @staticmethod
    def _now() -> NaiveDatetime:
        """Return the timestamp used to construct one complete Channel transition."""
        return naive_utc_now()

    @staticmethod
    def _new_channel_id() -> IMChannelId:
        """Generate one sortable Channel identity owned by the Service."""
        return IMChannelId(str(uuidv7()))

    @staticmethod
    def _new_webhook_id() -> WebhookId:
        """Generate the canonical 192-bit URL-safe Webhook identity."""
        return WebhookId(secrets.token_urlsafe(24))


class WorkspaceIMChannelService(IMChannelService):
    """Channel Management Service bound to one Workspace and Account."""

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


class DeploymentIMChannelService(IMChannelService):
    """Target API for a deployment-bound Service implemented by the later EE change."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        credential_cipher: BoundCredentialCipher,
    ) -> None:
        super().__init__(
            session_factory,
            IMCredentialCodec(credential_cipher),
            dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE,
        )

    @override
    def _new_reader(self, session: Session) -> IMChannelReader:
        return DeploymentIMChannelReader(session)

    @override
    def _new_writer(self, session: Session) -> IMChannelWriter:
        return DeploymentIMChannelWriter(session)
