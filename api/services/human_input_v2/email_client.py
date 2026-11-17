"""Compose a mail client shared by a tenant's Human Input delivery service."""

from collections.abc import Callable
from functools import cached_property
from typing import Protocol

from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import TenantId
from extensions.ext_mail import mail
from repositories.human_input_v2.email_channel.entities import EmailChannelConfiguration, ResendCandidate
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from services.feature_service import FeatureService
from services.human_input_v2.email_credential_codec import load_email_credentials
from services.human_input_v2.resend_channel import ResendProviderGateway


class EmailClient(Protocol):
    def send(self, *, to: str, subject: str, html: str) -> None: ...


class _ResendEmailClient:
    def __init__(self, configuration: EmailChannelConfiguration) -> None:
        self._configuration = configuration
        self._gateway = ResendProviderGateway()

    @cached_property
    def _candidate(self) -> ResendCandidate:
        # Resolve credentials once, outside the configuration read transaction,
        # and only if this execution actually sends an email.
        return ResendCandidate(
            sender_email=self._configuration.sender_email,
            sender_name=self._configuration.sender_name,
            credentials=load_email_credentials(
                self._configuration.tenant_id, self._configuration.encrypted_credentials
            ),
        )

    def send(self, *, to: str, subject: str, html: str) -> None:
        self._gateway.send_message(self._candidate, to=to, subject=subject, html=html)


def build_email_client(*, tenant_id: TenantId, session_factory: Callable[[], Session]) -> EmailClient | None:
    if not FeatureService.use_tenant_scoped_email_config():
        return mail if mail.is_inited() else None
    with session_factory() as session:
        configuration = SQLAlchemyEmailChannelRepository(session).load(tenant_id)
        if configuration is None:
            return None
    return _ResendEmailClient(configuration)
