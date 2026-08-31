"""Owner-bound SQLAlchemy persistence for one current IM Channel."""

from __future__ import annotations

from collections.abc import Mapping

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult, Result
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, TenantId
from models.human_input_v2 import HumanInputIMChannel

from .im_channel_repository import (
    IMChannel,
    IMChannelAlreadyConfiguredError,
    IMChannelId,
    StaleIMChannelWriteError,
    WebhookId,
)

_DEPLOYMENT_OWNER_KEY = "deployment"
_INITIAL_CONFIG_VERSION = 1
_OWNER_KEY_UNIQUE_CONSTRAINT = "human_input_im_channels_owner_key_uq"
_SQLITE_OWNER_KEY_UNIQUE_TARGET = "human_input_im_channels.owner_key"


def _workspace_owner_key(tenant_id: TenantId) -> str:
    return f"workspace:{tenant_id}"


def _channel_from_record(record: HumanInputIMChannel) -> IMChannel:
    return IMChannel(
        id=IMChannelId(record.id),
        created_at=record.created_at,
        updated_at=record.updated_at,
        provider=record.provider,
        provider_tenant_id=record.provider_tenant_id,
        encrypted_credentials=record.encrypted_credentials,
        app_identifier=record.app_identifier,
        webhook_id=WebhookId(record.webhook_id),
        config_version=record.config_version,
        status=record.status,
        status_reason=record.status_reason,
    )


def _channel_to_record(
    channel: IMChannel,
    *,
    owner_key: str,
    configured_by_account_id: AccountId | None,
) -> HumanInputIMChannel:
    record = HumanInputIMChannel(
        owner_key=owner_key,
        provider=channel.provider,
        provider_tenant_id=channel.provider_tenant_id,
        encrypted_credentials=channel.encrypted_credentials,
        app_identifier=channel.app_identifier,
        webhook_id=str(channel.webhook_id),
        status=channel.status,
        config_version=channel.config_version,
        configured_by_account_id=(str(configured_by_account_id) if configured_by_account_id is not None else None),
        status_reason=channel.status_reason,
    )
    record.id = str(channel.id)
    record.created_at = channel.created_at
    record.updated_at = channel.updated_at
    return record


def _channel_update_values(
    channel: IMChannel,
    *,
    configured_by_account_id: AccountId | None,
) -> Mapping[str, object]:
    return {
        "created_at": channel.created_at,
        "updated_at": channel.updated_at,
        "provider": channel.provider,
        "provider_tenant_id": channel.provider_tenant_id,
        "encrypted_credentials": channel.encrypted_credentials,
        "app_identifier": channel.app_identifier,
        "configured_by_account_id": (str(configured_by_account_id) if configured_by_account_id is not None else None),
        "webhook_id": str(channel.webhook_id),
        "status": channel.status,
        "status_reason": channel.status_reason,
        "config_version": channel.config_version,
    }


def _is_owner_key_unique_violation(error: IntegrityError) -> bool:
    message = str(error.orig).lower()
    return _OWNER_KEY_UNIQUE_CONSTRAINT in message or _SQLITE_OWNER_KEY_UNIQUE_TARGET in message


def _require_initial_version(channel: IMChannel) -> None:
    if channel.config_version != _INITIAL_CONFIG_VERSION:
        raise ValueError("initial IM Channel configuration version must be 1")


def _require_next_version(channel: IMChannel, expected_config_version: int) -> None:
    if channel.config_version != expected_config_version + 1:
        raise ValueError("updated IM Channel configuration version must increment by one")


def _require_replacement(current_channel_id: IMChannelId, replacement: IMChannel) -> None:
    if replacement.id == current_channel_id:
        raise ValueError("replacement IM Channel must use a different ID")
    _require_initial_version(replacement)


def _require_current_row(result: Result[tuple[object, ...]], message: str) -> None:
    if not isinstance(result, CursorResult):
        raise TypeError("conditional IM Channel DML did not return a cursor result")
    if result.rowcount != 1:
        raise StaleIMChannelWriteError(message)


class _OwnerBoundIMChannelReader:
    def __init__(self, session: Session, owner_key: str) -> None:
        self._session = session
        self._owner_key = owner_key

    def get(self) -> IMChannel | None:
        record = self._session.scalar(
            sa.select(HumanInputIMChannel)
            .where(HumanInputIMChannel.owner_key == self._owner_key)
            .execution_options(autoflush=False)
        )
        return _channel_from_record(record) if record is not None else None


class _OwnerBoundIMChannelWriter:
    def __init__(
        self,
        session: Session,
        owner_key: str,
        configured_by_account_id: AccountId | None,
    ) -> None:
        self._session = session
        self._owner_key = owner_key
        self._configured_by_account_id = configured_by_account_id

    def create(self, channel: IMChannel) -> IMChannel:
        _require_initial_version(channel)
        record = _channel_to_record(
            channel,
            owner_key=self._owner_key,
            configured_by_account_id=self._configured_by_account_id,
        )
        try:
            self._session.add(record)
            self._session.flush([record])
        except IntegrityError as error:
            if _is_owner_key_unique_violation(error):
                raise IMChannelAlreadyConfiguredError("IM Channel owner is already configured") from error
            raise
        return _channel_from_record(record)

    def update(
        self,
        channel: IMChannel,
        expected_config_version: int,
    ) -> IMChannel:
        _require_next_version(channel, expected_config_version)
        # Reject an update-shaped value for a replacement before mutation SQL;
        # the conditional UPDATE below remains the authoritative concurrency check.
        current_channel_id = self._session.scalar(
            sa.select(HumanInputIMChannel.id)
            .where(HumanInputIMChannel.owner_key == self._owner_key)
            .execution_options(autoflush=False)
        )
        if current_channel_id != str(channel.id):
            raise StaleIMChannelWriteError("IM Channel update did not match the current ID")
        result = self._session.execute(
            sa.update(HumanInputIMChannel)
            .where(
                HumanInputIMChannel.owner_key == self._owner_key,
                HumanInputIMChannel.id == str(channel.id),
                HumanInputIMChannel.config_version == expected_config_version,
            )
            .values(
                _channel_update_values(
                    channel,
                    configured_by_account_id=self._configured_by_account_id,
                )
            )
            .execution_options(autoflush=False)
        )
        _require_current_row(result, "IM Channel update did not match the current version")
        return channel

    def replace(
        self,
        current_channel_id: IMChannelId,
        expected_config_version: int,
        replacement: IMChannel,
    ) -> IMChannel:
        _require_replacement(current_channel_id, replacement)
        result = self._session.execute(
            sa.delete(HumanInputIMChannel)
            .where(
                HumanInputIMChannel.owner_key == self._owner_key,
                HumanInputIMChannel.id == str(current_channel_id),
                HumanInputIMChannel.config_version == expected_config_version,
            )
            .execution_options(autoflush=False)
        )
        _require_current_row(result, "IM Channel replacement did not match the current version")
        record = _channel_to_record(
            replacement,
            owner_key=self._owner_key,
            configured_by_account_id=self._configured_by_account_id,
        )
        self._session.add(record)
        self._session.flush([record])
        return _channel_from_record(record)

    def delete(
        self,
        channel_id: IMChannelId,
        expected_config_version: int,
    ) -> None:
        result = self._session.execute(
            sa.delete(HumanInputIMChannel)
            .where(
                HumanInputIMChannel.owner_key == self._owner_key,
                HumanInputIMChannel.id == str(channel_id),
                HumanInputIMChannel.config_version == expected_config_version,
            )
            .execution_options(autoflush=False)
        )
        _require_current_row(result, "IM Channel deletion did not match the current version")


class WorkspaceIMChannelReader(_OwnerBoundIMChannelReader):
    """Read the current IM Channel for one constructor-bound Dify Tenant."""

    def __init__(self, session: Session, tenant_id: TenantId) -> None:
        super().__init__(session, _workspace_owner_key(tenant_id))


class WorkspaceIMChannelWriter(_OwnerBoundIMChannelWriter):
    """Write the current IM Channel for one constructor-bound Dify Tenant."""

    def __init__(self, session: Session, tenant_id: TenantId, configured_by_account_id: AccountId) -> None:
        super().__init__(session, _workspace_owner_key(tenant_id), configured_by_account_id)


class DeploymentIMChannelReader(_OwnerBoundIMChannelReader):
    """Read the single deployment-owned IM Channel."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, _DEPLOYMENT_OWNER_KEY)


class DeploymentIMChannelWriter(_OwnerBoundIMChannelWriter):
    """Write the single deployment-owned IM Channel without actor metadata."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, _DEPLOYMENT_OWNER_KEY, None)


__all__ = [
    "DeploymentIMChannelReader",
    "DeploymentIMChannelWriter",
    "WorkspaceIMChannelReader",
    "WorkspaceIMChannelWriter",
]
