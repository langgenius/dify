"""Tenant-scoped non-secret facts for saved dependency selection.

Never selects encrypted_config, resolves/decrypts credentials, reserves credits,
initializes missing Provider records or invokes a plugin. Alias handling and
runtime policy belong to the selection adapter, not SQL.
"""

import hashlib
import json

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from models.model import TenantCreditPool
from models.model_billing import TenantModelBillingProfile
from models.provider import (
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)
from models.tokener import TenantTokenerIntegration
from services.model_billing_dependency_inventory import DefaultModelSelector, ModelDependencyDocument
from services.model_billing_dependency_provenance import (
    ModelDependencyDefault,
    StoredDependencyPreference,
    StoredDependencyProvider,
    StoredModelDependencySelections,
)
from services.model_billing_migration_inventory import ManagedModelReadinessBinding


class ModelBillingDependencyRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def managed_target_binding(self, tenant_id: str) -> ManagedModelReadinessBinding | None:
        """Fingerprint only the tenant-owned managed ciphertext; never decrypt it.

        Unlike source-selection facts, target readiness must attest the exact
        previously provisioned credential. The ciphertext never leaves here.
        """
        with self._session_factory() as session:
            row = session.execute(
                select(
                    TenantTokenerIntegration.provider_credential_id,
                    TenantTokenerIntegration.plugin_unique_identifier,
                    ProviderCredential.encrypted_config,
                )
                .join(
                    ProviderCredential,
                    and_(
                        ProviderCredential.id == TenantTokenerIntegration.provider_credential_id,
                        ProviderCredential.tenant_id == TenantTokenerIntegration.tenant_id,
                        ProviderCredential.provider_name == "langgenius/tokener/tokener",
                    ),
                )
                .where(TenantTokenerIntegration.tenant_id == tenant_id)
            ).one_or_none()
            if (
                row is None
                or not row.provider_credential_id
                or not row.plugin_unique_identifier
                or not isinstance(row.encrypted_config, str)
            ):
                return None
            fingerprint = (
                "sha256:"
                + hashlib.sha256(
                    json.dumps(
                        {"encrypted_config": row.encrypted_config},
                        sort_keys=True,
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode()
                ).hexdigest()
            )
            return ManagedModelReadinessBinding(row.provider_credential_id, row.plugin_unique_identifier, fingerprint)

    def collect_model_dependency_documents(self, tenant_id: str) -> list[ModelDependencyDocument]:
        with self._session_factory() as session:
            return [
                ModelDependencyDocument(
                    tenant_id,
                    "tenant_default",
                    tenant_id,
                    item.id,
                    DefaultModelSelector(item.provider_name, item.model_type.value, item.model_name),
                )
                for item in session.scalars(select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == tenant_id))
            ]

    def stored_selection_snapshot(self, tenant_id: str) -> StoredModelDependencySelections:
        with self._session_factory() as session:
            providers = tuple(
                StoredDependencyProvider(
                    row.provider_name,
                    row.provider_type.value,
                    row.quota_type.value if row.quota_type else None,
                    row.quota_limit,
                    row.quota_used,
                )
                for row in session.execute(
                    select(
                        Provider.provider_name,
                        Provider.provider_type,
                        Provider.quota_type,
                        Provider.quota_limit,
                        Provider.quota_used,
                    ).where(Provider.tenant_id == tenant_id)
                )
            )
            preferences = tuple(
                StoredDependencyPreference(row.provider_name, row.preferred_provider_type.value)
                for row in session.execute(
                    select(
                        TenantPreferredModelProvider.provider_name,
                        TenantPreferredModelProvider.preferred_provider_type,
                    ).where(TenantPreferredModelProvider.tenant_id == tenant_id)
                )
            )
            # Runtime considers both configured model rows and unattached model
            # credentials as custom configuration presence; no key is selected.
            custom_providers = set(
                session.scalars(select(ProviderModel.provider_name).where(ProviderModel.tenant_id == tenant_id))
            )
            custom_providers.update(
                session.scalars(
                    select(ProviderModelCredential.provider_name).where(ProviderModelCredential.tenant_id == tenant_id)
                )
            )
            defaults = tuple(
                ModelDependencyDefault(row.model_type.value, row.provider_name, row.model_name)
                for row in session.execute(
                    select(
                        TenantDefaultModel.model_type,
                        TenantDefaultModel.provider_name,
                        TenantDefaultModel.model_name,
                    ).where(TenantDefaultModel.tenant_id == tenant_id)
                )
            )
            pools = tuple(
                (row.pool_type.value, row.quota_limit, row.quota_used)
                for row in session.execute(
                    select(
                        TenantCreditPool.pool_type,
                        TenantCreditPool.quota_limit,
                        TenantCreditPool.quota_used,
                    ).where(TenantCreditPool.tenant_id == tenant_id)
                )
            )
            source = session.scalar(
                select(TenantModelBillingProfile.model_billing_source).where(
                    TenantModelBillingProfile.tenant_id == tenant_id
                )
            )
        return StoredModelDependencySelections(
            providers, preferences, tuple(sorted(custom_providers)), defaults, pools, source
        )
