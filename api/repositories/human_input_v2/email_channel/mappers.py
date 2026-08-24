"""Bidirectional mapping between Email channel values and ORM records."""

from datetime import datetime

from pydantic import NaiveDatetime

from core.human_input_v2.approval import EmailProviderConfiguration
from core.human_input_v2.email_channel import EmailChannelConfiguration
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import HumanInputEmailProvider, ResendEmailProviderEncryptedCredentials


def _timestamp(value: datetime) -> NaiveDatetime:
    return ensure_naive_utc(value)


def email_configuration_to_record(configuration: EmailChannelConfiguration) -> HumanInputEmailProvider:
    record = HumanInputEmailProvider(
        provider=configuration.provider,
        sender_email=str(configuration.sender_email),
        encrypted_credentials=ResendEmailProviderEncryptedCredentials(
            encrypted_api_key=configuration.protected_api_key
        ),
        tenant_id=str(configuration.tenant_id),
        config_version=configuration.config_version,
        sender_name=configuration.sender_name,
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
        protected_api_key=record.encrypted_credentials.encrypted_api_key,
        configured_by_account_id=(
            AccountId(record.configured_by_account_id) if record.configured_by_account_id is not None else None
        ),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
        config_version=record.config_version,
    )


def email_provider_to_record(provider: EmailProviderConfiguration) -> HumanInputEmailProvider:
    """Compatibility mapper for form delivery consumers during the ownership move."""

    credentials = ResendEmailProviderEncryptedCredentials.model_validate(
        provider.encrypted_credentials,
    )
    return email_configuration_to_record(
        EmailChannelConfiguration(
            id=provider.id,
            tenant_id=provider.tenant_id,
            provider=provider.provider,
            sender_email=provider.sender_email,
            sender_name=provider.sender_name,
            protected_api_key=credentials.encrypted_api_key,
            configured_by_account_id=provider.configured_by_account_id,
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )
    )


def email_provider_from_record(record: HumanInputEmailProvider) -> EmailProviderConfiguration:
    """Compatibility projection preserving the existing delivery-domain type."""

    configuration = email_configuration_from_record(record)
    return EmailProviderConfiguration(
        id=configuration.id,
        tenant_id=configuration.tenant_id,
        provider=configuration.provider,
        sender_email=configuration.sender_email,
        sender_name=configuration.sender_name,
        encrypted_credentials={
            "provider": configuration.provider.value,
            "encrypted_api_key": configuration.protected_api_key,
        },
        configured_by_account_id=configuration.configured_by_account_id,
        created_at=configuration.created_at,
        updated_at=configuration.updated_at,
    )
