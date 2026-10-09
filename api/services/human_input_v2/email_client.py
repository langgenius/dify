"""Compose a mail client shared by a tenant's Human Input delivery service."""

from collections.abc import Callable
from functools import cached_property
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import encrypter
from core.human_input_v2.shared.values import TenantId
from enums import DeploymentEdition
from extensions.ext_mail import mail
from models.human_input_v2 import HumanInputEmailProvider
from repositories.human_input_v2.email_channel.entities import EmailChannelConfiguration, ResendCandidate
from repositories.human_input_v2.email_channel.mappers import email_configuration_from_record
from services.human_input_v2.resend_channel import ResendProviderGateway


class EmailClient(Protocol):
    def send(self, *, to: str, subject: str, html: str) -> None: ...


class _ResendEmailClient:
    def __init__(self, tenant_id: TenantId, configuration: EmailChannelConfiguration) -> None:
        self._tenant_id = tenant_id
        self._configuration = configuration
        self._gateway = ResendProviderGateway()

    @cached_property
    def _candidate(self) -> ResendCandidate:
        # Resolve credentials once, outside the configuration read transaction,
        # and only if this execution actually sends an email.
        return ResendCandidate(
            sender_email=self._configuration.sender_email,
            sender_name=self._configuration.sender_name,
            api_key=encrypter.decrypt_token(str(self._tenant_id), self._configuration.protected_api_key),
        )

    def send(self, *, to: str, subject: str, html: str) -> None:
        self._gateway.send_message(self._candidate, to=to, subject=subject, html=html)


def build_email_client(*, tenant_id: TenantId, session_factory: Callable[[], Session]) -> EmailClient | None:
    # TODO(QuantumGhost): use repository for configuration loading.
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return mail if mail.is_inited() else None
    with session_factory() as session:
        record = session.scalar(
            sa.select(HumanInputEmailProvider).where(HumanInputEmailProvider.tenant_id == tenant_id)
        )
        if record is None:
            return None
        configuration = email_configuration_from_record(record)
    return _ResendEmailClient(tenant_id, configuration)
