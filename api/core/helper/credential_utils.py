"""
Credential utility functions for checking credential existence and policy compliance.
"""

from services.enterprise.plugin_manager_service import PluginCredentialType


def is_credential_exists(credential_id: str, credential_type: "PluginCredentialType") -> bool:
    """
    Check if the credential still exists in the database.

    :param credential_id: The credential ID to check
    :param credential_type: The type of credential (MODEL or TOOL)
    :return: True if credential exists, False otherwise
    """
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.provider import ProviderCredential, ProviderModelCredential
    from models.tools import BuiltinToolProvider

    with Session(db.engine) as session:
        if credential_type == PluginCredentialType.MODEL:
            # Check both pre-defined and custom model credentials using a single UNION query
            stmt = (
                select(ProviderCredential.id)
                .where(ProviderCredential.id == credential_id)
                .union(select(ProviderModelCredential.id).where(ProviderModelCredential.id == credential_id))
            )
            return session.scalar(stmt) is not None

        if credential_type == PluginCredentialType.TOOL:
            return (
                session.scalar(select(BuiltinToolProvider.id).where(BuiltinToolProvider.id == credential_id))
                is not None
            )

        return False


def check_credential_policy_compliance(
    credential_id: str, provider: str, credential_type: "PluginCredentialType", check_existence: bool = True
) -> None:
    """
    Check credential policy compliance for the given credential ID.

    :param credential_id: The credential ID to check
    :param provider: The provider name
    :param credential_type: The type of credential (MODEL or TOOL)
    :param check_existence: Whether to check if credential exists in database first
    :raises ValueError: If credential policy compliance check fails
    """
    from services.enterprise.plugin_manager_service import (
        CheckCredentialPolicyComplianceRequest,
        PluginManagerService,
    )
    from services.feature_service import FeatureService

    if not FeatureService.get_system_features().plugin_manager.enabled or not credential_id:
        return

    # Check if credential exists in database first (if requested)
    if check_existence:
        if not is_credential_exists(credential_id, credential_type):
            raise ValueError(f"Credential with id {credential_id} for provider {provider} not found.")

    # Check policy compliance
    PluginManagerService.check_credential_policy_compliance(
        CheckCredentialPolicyComplianceRequest(
            dify_credential_id=credential_id,
            provider=provider,
            credential_type=credential_type,
        )
    )
