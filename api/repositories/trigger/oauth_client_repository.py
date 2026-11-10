"""Bounded database operations for workspace trigger OAuth clients."""

import sqlite3
from typing import override

from psycopg2.errors import UniqueViolation
from pymysql.err import IntegrityError as MySQLIntegrityError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.provider_ids import TriggerProviderID
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient
from services.trigger.oauth_client_service import (
    TriggerOAuthClientChangedError,
    TriggerOAuthClientSnapshot,
    TriggerOAuthClientStore,
    TriggerOAuthTenantClientRecord,
)


def _is_custom_client_conflict(error: IntegrityError) -> bool:
    """Identify only the tenant/provider uniqueness constraint, not other write failures."""
    original = error.orig
    constraint = "unique_trigger_oauth_tenant_client"
    if isinstance(original, UniqueViolation):
        return original.diag.constraint_name == constraint
    if isinstance(original, MySQLIntegrityError):
        if len(original.args) != 2 or original.args[0] != 1062 or not isinstance(original.args[1], str):
            return False
        key = original.args[1].rsplit(" for key ", 1)[-1]
        return key in (
            f"'{constraint}'",
            f"'trigger_oauth_tenant_clients.{constraint}'",
            f"`{constraint}`",
            f"`trigger_oauth_tenant_clients.{constraint}`",
        )
    if isinstance(original, sqlite3.IntegrityError):
        return original.sqlite_errorcode == sqlite3.SQLITE_CONSTRAINT_UNIQUE and str(original) == (
            "UNIQUE constraint failed: trigger_oauth_tenant_clients.tenant_id, "
            "trigger_oauth_tenant_clients.plugin_id, trigger_oauth_tenant_clients.provider"
        )
    return False


class TriggerOAuthClientRepository(TriggerOAuthClientStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthClientSnapshot:
        with self._session_factory() as session:
            custom = self._find_custom(session=session, tenant_id=tenant_id, provider_id=provider_id)
            encrypted_system_oauth_params = session.scalar(
                select(TriggerOAuthSystemClient.encrypted_oauth_params).where(
                    TriggerOAuthSystemClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthSystemClient.provider == provider_id.provider_name,
                )
            )
            return TriggerOAuthClientSnapshot(
                custom=TriggerOAuthTenantClientRecord(
                    id=custom.id,
                    encrypted_oauth_params=custom.encrypted_oauth_params,
                    enabled=custom.enabled,
                )
                if custom is not None
                else None,
                encrypted_system_oauth_params=encrypted_system_oauth_params,
            )

    @override
    def save(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        encrypted_oauth_params: str,
        enabled: bool | None,
        expected: TriggerOAuthTenantClientRecord | None,
    ) -> None:
        """Create for a None snapshot, otherwise save only the unchanged read client.

        None enabled preserves the stored value, or defaults to True on create.
        """
        if expected is None:
            try:
                with self._session_factory.begin() as session:
                    session.add(
                        TriggerOAuthTenantClient(
                            tenant_id=tenant_id,
                            plugin_id=provider_id.plugin_id,
                            provider=provider_id.provider_name,
                            encrypted_oauth_params=encrypted_oauth_params,
                            enabled=True if enabled is None else enabled,
                        )
                    )
            except IntegrityError as error:
                if not _is_custom_client_conflict(error):
                    raise
                raise TriggerOAuthClientChangedError(
                    f"OAuth client configuration for trigger provider {provider_id} changed. Reload and retry."
                ) from error
            return

        with self._session_factory.begin() as session:
            custom = session.scalar(
                select(TriggerOAuthTenantClient)
                .where(
                    TriggerOAuthTenantClient.id == expected.id,
                    TriggerOAuthTenantClient.tenant_id == tenant_id,
                    TriggerOAuthTenantClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthTenantClient.provider == provider_id.provider_name,
                )
                .with_for_update()
            )
            # Compare exact strings in Python: MySQL text collations can otherwise
            # consider different ciphertexts equal. The lock ends before returning.
            if (
                custom is None
                or custom.encrypted_oauth_params != expected.encrypted_oauth_params
                or custom.enabled != expected.enabled
            ):
                raise TriggerOAuthClientChangedError(
                    f"OAuth client configuration for trigger provider {provider_id} changed. Reload and retry."
                )
            custom.encrypted_oauth_params = encrypted_oauth_params
            if enabled is not None:
                custom.enabled = enabled

    @override
    def delete(self, *, tenant_id: str, provider_id: TriggerProviderID) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                delete(TriggerOAuthTenantClient).where(
                    TriggerOAuthTenantClient.tenant_id == tenant_id,
                    TriggerOAuthTenantClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthTenantClient.provider == provider_id.provider_name,
                )
            )

    @staticmethod
    def _find_custom(
        *, session: Session, tenant_id: str, provider_id: TriggerProviderID
    ) -> TriggerOAuthTenantClient | None:
        return session.scalar(
            select(TriggerOAuthTenantClient).where(
                TriggerOAuthTenantClient.tenant_id == tenant_id,
                TriggerOAuthTenantClient.plugin_id == provider_id.plugin_id,
                TriggerOAuthTenantClient.provider == provider_id.provider_name,
            )
        )
