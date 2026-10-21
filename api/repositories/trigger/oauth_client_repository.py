"""Bounded database operations for workspace trigger OAuth clients."""

from typing import cast, override

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.provider_ids import TriggerProviderID
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient
from services.trigger.oauth_client_service import (
    TriggerOAuthClientChangedError,
    TriggerOAuthClientSnapshot,
    TriggerOAuthClientStore,
    TriggerOAuthTenantClientRecord,
)


class TriggerOAuthClientRepository(TriggerOAuthClientStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthClientSnapshot:
        with self._session_factory() as session:
            custom = self._find_custom(session=session, tenant_id=tenant_id, provider_id=provider_id)
            system_configured = (
                session.scalar(
                    select(TriggerOAuthSystemClient.id).where(
                        TriggerOAuthSystemClient.plugin_id == provider_id.plugin_id,
                        TriggerOAuthSystemClient.provider == provider_id.provider_name,
                    )
                )
                is not None
            )
            return TriggerOAuthClientSnapshot(
                custom=TriggerOAuthTenantClientRecord(
                    id=custom.id,
                    encrypted_oauth_params=custom.encrypted_oauth_params,
                    enabled=custom.enabled,
                )
                if custom is not None
                else None,
                system_configured=system_configured,
            )

    @override
    def save(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        encrypted_oauth_params: str,
        enabled: bool | None,
        existing_client_id: str | None,
    ) -> None:
        """Save the read client, or create when existing_client_id is None.

        A missing read client is a conflict, never a reason to recreate it.
        None enabled preserves the stored value, or defaults to True on create.
        """
        with self._session_factory.begin() as session:
            if existing_client_id is None:
                session.add(
                    TriggerOAuthTenantClient(
                        tenant_id=tenant_id,
                        plugin_id=provider_id.plugin_id,
                        provider=provider_id.provider_name,
                        encrypted_oauth_params=encrypted_oauth_params,
                        enabled=True if enabled is None else enabled,
                    )
                )
                return

            statement = (
                update(TriggerOAuthTenantClient)
                .where(
                    TriggerOAuthTenantClient.id == existing_client_id,
                    TriggerOAuthTenantClient.tenant_id == tenant_id,
                    TriggerOAuthTenantClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthTenantClient.provider == provider_id.provider_name,
                )
                .values(encrypted_oauth_params=encrypted_oauth_params)
            )
            if enabled is not None:
                statement = statement.values(enabled=enabled)
            result = session.execute(statement)
            if cast(CursorResult[object], result).rowcount == 0:
                raise TriggerOAuthClientChangedError(
                    f"OAuth client configuration for trigger provider {provider_id} changed. Reload and retry."
                )

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
