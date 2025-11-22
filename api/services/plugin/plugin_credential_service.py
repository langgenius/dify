"""Service for managing plugin credentials during installation and uninstallation."""

import logging
from collections.abc import Sequence

from sqlalchemy import select

from extensions.ext_database import db
from models.provider import ProviderCredential, ProviderModelCredential
from models.provider_ids import GenericProviderID

logger = logging.getLogger(__name__)


class PluginCredentialInfo:
    """Information about a plugin credential."""

    def __init__(self, credential_id: str, credential_name: str, credential_type: str, provider_name: str):
        self.credential_id = credential_id
        self.credential_name = credential_name
        self.credential_type = credential_type  # "provider" or "model"
        self.provider_name = provider_name

    def to_dict(self) -> dict:
        return {
            "credential_id": self.credential_id,
            "credential_name": self.credential_name,
            "credential_type": self.credential_type,
            "provider_name": self.provider_name,
        }


class PluginCredentialService:
    """Service for managing plugin credentials."""

    @staticmethod
    def get_plugin_credentials(tenant_id: str, plugin_id: str) -> list[PluginCredentialInfo]:
        """
        Get all credentials associated with a plugin.

        Args:
            tenant_id: Tenant ID
            plugin_id: Plugin ID in format "organization/plugin_name"

        Returns:
            List of PluginCredentialInfo objects
        """
        logger.info(f"Getting credentials for plugin_id: {plugin_id}, tenant_id: {tenant_id}")
        credentials = []

        # Query provider credentials
        provider_credentials = db.session.scalars(
            select(ProviderCredential).where(
                ProviderCredential.tenant_id == tenant_id,
                ProviderCredential.provider_name.like(f"{plugin_id}/%"),
            )
        ).all()
        logger.info(f"Found {len(provider_credentials)} provider credentials")

        for cred in provider_credentials:
            credentials.append(
                PluginCredentialInfo(
                    credential_id=cred.id,
                    credential_name=cred.credential_name,
                    credential_type="provider",
                    provider_name=cred.provider_name,
                )
            )

        # Query provider model credentials
        model_credentials = db.session.scalars(
            select(ProviderModelCredential).where(
                ProviderModelCredential.tenant_id == tenant_id,
                ProviderModelCredential.provider_name.like(f"{plugin_id}/%"),
            )
        ).all()

        for cred in model_credentials:
            credentials.append(
                PluginCredentialInfo(
                    credential_id=cred.id,
                    credential_name=cred.credential_name,
                    credential_type="model",
                    provider_name=cred.provider_name,
                )
            )

        return credentials

    @staticmethod
    def delete_plugin_credentials(tenant_id: str, credential_ids: Sequence[str]) -> int:
        """
        Delete plugin credentials by IDs.

        Args:
            tenant_id: Tenant ID
            credential_ids: List of credential IDs to delete

        Returns:
            Number of credentials deleted
        """
        logger.info(f"Deleting credentials: {credential_ids} for tenant: {tenant_id}")
        deleted_count = 0

        for credential_id in credential_ids:
            # Try deleting from provider_credentials
            provider_cred = db.session.scalars(
                select(ProviderCredential).where(
                    ProviderCredential.id == credential_id, ProviderCredential.tenant_id == tenant_id
                )
            ).first()

            if provider_cred:
                db.session.delete(provider_cred)
                deleted_count += 1
                continue

            # Try deleting from provider_model_credentials
            model_cred = db.session.scalars(
                select(ProviderModelCredential).where(
                    ProviderModelCredential.id == credential_id, ProviderModelCredential.tenant_id == tenant_id
                )
            ).first()

            if model_cred:
                db.session.delete(model_cred)
                deleted_count += 1

        db.session.commit()
        logger.info(f"Deleted {deleted_count} plugin credentials for tenant {tenant_id}")
        return deleted_count

    @staticmethod
    def delete_all_plugin_credentials(tenant_id: str, plugin_id: str) -> int:
        """
        Delete all credentials associated with a plugin.

        Args:
            tenant_id: Tenant ID
            plugin_id: Plugin ID in format "organization/plugin_name"

        Returns:
            Number of credentials deleted
        """
        credentials = PluginCredentialService.get_plugin_credentials(tenant_id, plugin_id)
        credential_ids = [cred.credential_id for cred in credentials]
        return PluginCredentialService.delete_plugin_credentials(tenant_id, credential_ids)

