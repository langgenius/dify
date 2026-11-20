"""Discover test channels without granting channel-management access."""

from collections.abc import Callable

from sqlalchemy.orm import Session

from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.shared import TenantId
from extensions.ext_mail import mail
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from services.feature_service import FeatureService


class HumanInputTestChannelService:
    """Project configured channel identifiers for an authenticated workspace member."""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._sessions = session_factory

    def list_channels(self, tenant_id: TenantId) -> tuple[DebugChannel, ...]:
        """Read the admitted workspace's test channels using the deployment's channel ownership.

        Enterprise uses its deployment IM channel and initialized global mail client;
        Cloud uses workspace IM and tenant Email, and Community uses workspace IM.
        Return identifiers only. No credentials are decrypted, providers contacted,
        or configuration changed; storage failures propagate to the caller.
        """
        centrally_managed = FeatureService.is_im_centrally_managed()
        with self._sessions() as session:
            im_channel = (
                DeploymentIMChannelReader(session).get()
                if centrally_managed
                else WorkspaceIMChannelReader(session, tenant_id).get()
            )
            email_available = (
                mail.is_inited()
                if centrally_managed
                else FeatureService.use_tenant_scoped_email_config()
                and SQLAlchemyEmailChannelRepository(session).load(tenant_id) is not None
            )
        channels: list[DebugChannel] = []
        if email_available:
            channels.append(DebugChannel.EMAIL)
        if im_channel is not None:
            channels.append(DebugChannel(im_channel.provider.value))
        return tuple(channels)
