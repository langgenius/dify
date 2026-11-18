"""Atomic tenant-owned managed credential binding for native signup bootstrap.

Only the integration's stored credential ID proves ownership. A user-editable
credential label never authorizes adoption. Credential insertion and its trusted
integration reference commit together; normal provider activation runs afterward.
"""

import json
from collections.abc import Callable, Mapping

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from enums.model_billing import TenantTokenerIntegrationStatus
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.provider import Provider, ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration


class TokenerBootstrapRepository:
    def __init__(self, *, sessions: Callable[[], Session]) -> None:
        self._sessions = sessions

    @staticmethod
    def _bound(session: Session, tenant_id: str, provider: str) -> str | None:
        return session.scalar(
            select(ProviderCredential.id)
            .join(TenantTokenerIntegration, TenantTokenerIntegration.provider_credential_id == ProviderCredential.id)
            .where(
                TenantTokenerIntegration.tenant_id == tenant_id,
                ProviderCredential.tenant_id == tenant_id,
                ProviderCredential.provider_name == provider,
                ProviderCredential.encrypted_config != "",
            )
        )

    def bound_credential(self, tenant_id: str, provider: str) -> tuple[str | None, bool]:
        """Read only this integration's own credential ID and normal active-provider state."""
        with self._sessions() as session:
            credential_id = self._bound(session, tenant_id, provider)
            if credential_id is None:
                return None, False
            active = session.scalar(
                select(Provider.id).where(
                    Provider.tenant_id == tenant_id,
                    Provider.provider_name == provider,
                    Provider.provider_type == ProviderType.CUSTOM,
                    Provider.credential_id == credential_id,
                    Provider.is_valid.is_(True),
                )
            )
            return credential_id, active is not None

    def bind_encrypted_credential(
        self, tenant_id: str, provider: str, credential_name: str, encrypted: Mapping[str, JsonValue]
    ) -> str:
        """Commit validated encrypted data with its integration reference, or roll back both.

        Preconditions: a normal plugin schema owner has validated/encrypted the
        input outside this transaction; no plaintext key is passed here. The
        native profile/integration must belong to this tenant. A tenant row lock
        serializes duplicate workers; replay reuses the stored binding.
        """
        encoded = json.dumps(encrypted)
        with self._sessions() as session, session.begin():
            tenant = session.get(Tenant, tenant_id, with_for_update=True)
            integration = session.scalar(
                select(TenantTokenerIntegration)
                .where(TenantTokenerIntegration.tenant_id == tenant_id)
                .with_for_update()
            )
            profile = session.get(TenantModelBillingProfile, tenant_id)
            if tenant is None or integration is None or profile is None or profile.model_billing_source != "tokener":
                raise ValueError("native bootstrap binding is unavailable")
            bound = self._bound(session, tenant_id, provider)
            if bound is not None:
                return bound
            # Preserve any user credential with the same editable label.
            names = set(
                session.scalars(
                    select(ProviderCredential.credential_name).where(
                        ProviderCredential.tenant_id == tenant_id,
                        ProviderCredential.provider_name == provider,
                        ProviderCredential.credential_name.startswith(credential_name, autoescape=True),
                    )
                )
            )
            name = credential_name
            suffix = 0
            while name in names:
                suffix += 1
                name = f"{credential_name}:{suffix}"
            credential = ProviderCredential(
                tenant_id=tenant_id,
                provider_name=provider,
                credential_name=name,
                encrypted_config=encoded,
            )
            session.add(credential)
            session.flush()
            integration.provider_credential_id = credential.id
            integration.status = TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER
            return credential.id
