"""Transactional SQLAlchemy repository for one workspace Email configuration."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from typing import override

from pydantic import NaiveDatetime
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.shared import TenantId
from models.account import Tenant
from models.human_input_v2 import HumanInputEmailProvider

from .entities import EmailChannelConfiguration, EmailConfigurationSnapshot
from .mappers import email_configuration_from_record, email_configuration_to_record
from .ports import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelPersistenceError,
    EmailChannelRepository,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)


class SQLAlchemyEmailChannelRepository(EmailChannelRepository):
    """Own Email row locking, conflicts, CAS, and ORM lifetime."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    @override
    def load(self, tenant_id: TenantId) -> EmailChannelConfiguration | None:
        try:
            with self._session_maker() as session:
                record = session.scalar(
                    select(HumanInputEmailProvider).where(HumanInputEmailProvider.tenant_id == str(tenant_id))
                )
                return email_configuration_from_record(record) if record is not None else None
        except SQLAlchemyError as error:
            raise EmailChannelPersistenceError("failed to load Email channel configuration") from error

    @override
    def create(self, configuration: EmailChannelConfiguration) -> CreateEmailConfigurationResult:
        try:
            with self._session_maker() as session, session.begin():
                owner = session.get(Tenant, str(configuration.tenant_id), with_for_update=True)
                if owner is None:
                    raise ValueError("workspace owner does not exist")
                existing = session.scalar(
                    select(HumanInputEmailProvider.id)
                    .where(HumanInputEmailProvider.tenant_id == str(configuration.tenant_id))
                    .limit(1)
                )
                if existing is not None:
                    return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CONFLICT, None)
                record = email_configuration_to_record(configuration)
                session.add(record)
                session.flush()
                return CreateEmailConfigurationResult(
                    CreateEmailConfigurationStatus.CREATED,
                    email_configuration_from_record(record),
                )
        except IntegrityError:
            return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CONFLICT, None)
        except SQLAlchemyError as error:
            raise EmailChannelPersistenceError("failed to create Email channel configuration") from error

    @override
    def update(
        self,
        configuration: EmailChannelConfiguration,
        *,
        expected: EmailConfigurationSnapshot,
        now: NaiveDatetime,
    ) -> UpdateEmailConfigurationResult:
        try:
            with self._session_maker() as session, session.begin():
                record = session.scalar(
                    select(HumanInputEmailProvider)
                    .where(
                        HumanInputEmailProvider.id == str(expected.configuration_id),
                        HumanInputEmailProvider.tenant_id == str(configuration.tenant_id),
                        HumanInputEmailProvider.config_version == expected.config_version,
                    )
                    .with_for_update()
                )
                if record is None:
                    return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.STALE, None)
                current_configuration = email_configuration_from_record(record)
                current_updated_at = current_configuration.updated_at
                next_value = max(now, current_updated_at + timedelta(microseconds=1))
                updated = replace(
                    configuration,
                    created_at=current_configuration.created_at,
                    config_version=current_configuration.config_version + 1,
                    updated_at=next_value,
                )
                mapped = email_configuration_to_record(updated)
                record.provider = mapped.provider
                record.sender_email = mapped.sender_email
                record.sender_name = mapped.sender_name
                record.encrypted_credentials = mapped.encrypted_credentials
                record.configured_by_account_id = mapped.configured_by_account_id
                record.config_version = mapped.config_version
                record.updated_at = mapped.updated_at
                session.flush()
                return UpdateEmailConfigurationResult(
                    UpdateEmailConfigurationStatus.UPDATED,
                    email_configuration_from_record(record),
                )
        except SQLAlchemyError as error:
            raise EmailChannelPersistenceError("failed to update Email channel configuration") from error

    @override
    def delete(
        self,
        tenant_id: TenantId,
        *,
        expected: EmailConfigurationSnapshot,
    ) -> DeleteEmailConfigurationResult:
        try:
            with self._session_maker() as session, session.begin():
                record = session.scalar(
                    select(HumanInputEmailProvider)
                    .where(HumanInputEmailProvider.tenant_id == str(tenant_id))
                    .with_for_update()
                )
                if record is None:
                    return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.NOT_CONFIGURED)
                if record.id != str(expected.configuration_id) or record.config_version != expected.config_version:
                    return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.STALE)
                session.delete(record)
        except SQLAlchemyError as error:
            raise EmailChannelPersistenceError("failed to delete Email channel configuration") from error
        return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.DELETED)
