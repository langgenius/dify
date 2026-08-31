# Reference production placement:
# - existing cross-capability primitives: api/core/human_input_v2/
# - Channel persistence values and ports: api/repositories/human_input_v2/im_channel_repository.py
# - SQLAlchemy adapters and private mapping helpers:
#   api/repositories/human_input_v2/sqlalchemy_im_channel_repository.py

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import NewType, Protocol

from pydantic import NaiveDatetime


WebhookId = NewType("WebhookId", str)
IMChannelId = NewType("IMChannelId", str)


# Reuse the existing canonical IMEncryptedCredentials Pydantic model.
# Reuse the existing core IMProvider enum instead of declaring another one.


class IMChannelStatus(StrEnum):
    """Credential-safe status persisted with one Channel configuration."""

    CONNECTED = "connected"
    INVALID_CREDENTIALS = "invalid_credentials"
    CONNECTION_FAILURE = "connection_failure"


@dataclass(frozen=True, slots=True)
class IMChannel:
    """Owner-free value mapped to one current IM Channel row."""

    id: IMChannelId
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    provider: IMProvider
    provider_tenant_id: str
    encrypted_credentials: IMEncryptedCredentials = field(repr=False)
    app_identifier: str
    webhook_id: WebhookId
    config_version: int
    status: IMChannelStatus
    status_reason: str | None = None


class IMChannelAlreadyConfiguredError(Exception):
    """The constructor-bound owner key already has a current Channel."""


class StaleIMChannelWriteError(Exception):
    """The current Channel ID or numeric configuration version changed."""


class IMChannelReader(Protocol):
    """Read the current Channel for one owner-bound persistence slot."""

    def get(self) -> IMChannel | None:
        """Return the current Channel for the bound owner, if configured."""
        ...


class IMChannelWriter(Protocol):
    """Channel writes for one owner and caller-owned SQLAlchemy Session.

    Concrete constructors bind the owner key and configuring actor. Operation
    methods persist already constructed Channel values and perform no business
    orchestration, Provider I/O, or credential transformation.
    """

    def create(self, channel: IMChannel) -> IMChannel:
        """Insert the first Channel for the bound owner."""
        ...

    def update(
        self,
        channel: IMChannel,
        expected_config_version: int,
    ) -> IMChannel:
        """Persist the same Channel ID under owner, ID, and version CAS."""
        ...

    def replace(
        self,
        current_channel_id: IMChannelId,
        expected_config_version: int,
        replacement: IMChannel,
    ) -> IMChannel:
        """Replace the current row with a new Channel ID in the same owner slot."""
        ...

    def delete(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
    ) -> None:
        """Delete the current row under owner, ID, and version CAS."""
        ...


__all__ = [
    "IMChannel",
    "IMChannelAlreadyConfiguredError",
    "IMChannelId",
    "IMChannelReader",
    "IMChannelStatus",
    "IMChannelWriter",
    "StaleIMChannelWriteError",
    "WebhookId",
]
