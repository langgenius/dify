"""Bidirectional mapping between Email channel values and ORM records."""

from datetime import datetime

from pydantic import NaiveDatetime

from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import HumanInputEmailProvider

from .entities import EmailChannelConfiguration


def _timestamp(value: datetime) -> NaiveDatetime:
    return ensure_naive_utc(value)


def email_configuration_to_record(configuration: EmailChannelConfiguration) -> HumanInputEmailProvider:
    record = HumanInputEmailProvider(
        provider=configuration.provider,
        sender_email=str(configuration.sender_email),
        sender_name=configuration.sender_name,
        encrypted_credentials=configuration.encrypted_credentials,
        tenant_id=str(configuration.tenant_id),
        config_version=configuration.config_version,
        configured_by_account_id=(
            str(configuration.configured_by_account_id) if configuration.configured_by_account_id is not None else None
        ),
    )
    record.id = str(configuration.id)
    record.created_at = configuration.created_at
    record.updated_at = configuration.updated_at
    return record


def email_configuration_from_record(record: HumanInputEmailProvider) -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=EmailProviderId(record.id),
        tenant_id=TenantId(record.tenant_id),
        provider=record.provider,
        sender_email=NormalizedEmail(record.sender_email),
        sender_name=record.sender_name,
        encrypted_credentials=record.encrypted_credentials,
        configured_by_account_id=(
            AccountId(record.configured_by_account_id) if record.configured_by_account_id is not None else None
        ),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
        config_version=record.config_version,
    )
