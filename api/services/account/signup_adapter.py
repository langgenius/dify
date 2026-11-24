"""Deployment policy sampled only by actual self-signup account producers."""

from configs import dify_config
from configs.feature import TokenerSignupBillingCandidate
from enums import DeploymentEdition
from repositories.tokener_signup_canary_repository import CANARY_BILLING_URL, CANARY_STAGING_PLUGIN_PREFIX
from services.account.contracts import TokenerSignupEnrollment


def configured_signup_enrollment(email: str | None = None) -> TokenerSignupEnrollment | None:
    """Freeze the Cloud signup pin; reject a mismatched staging route before creating an intent."""
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.TOKENER_NEW_TENANT_COHORT_ENABLED:
        default_identifier = dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip()
        configured = dify_config.TOKENER_SIGNUP_VALIDATION_BILLING_API_URL
        if configured == TokenerSignupBillingCandidate.SHARED_STAGING:
            if dify_config.get_agent_dev_staging_tokener_billing_url() is None:
                raise ValueError("The shared staging Tokener signup is not fully configured.")
            # The shared mode uses the same pin for all new signups, not an old email override.
            identifier = dify_config.TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER.strip()
            return TokenerSignupEnrollment(identifier)
        canary_email = dify_config.TOKENER_SIGNUP_VALIDATION_EMAIL.strip().casefold()
        if email and canary_email and email.strip().casefold() == canary_email:
            identifier = dify_config.TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER.strip()
            if not identifier.startswith(CANARY_STAGING_PLUGIN_PREFIX) or (
                dify_config.get_agent_dev_staging_tokener_billing_url() != CANARY_BILLING_URL
            ):
                raise ValueError("The hosted routing canary is not fully configured.")
            return TokenerSignupEnrollment(identifier)
        if default_identifier.startswith(CANARY_STAGING_PLUGIN_PREFIX):
            raise ValueError("A staging Tokener signup default requires explicit shared staging mode.")
        return TokenerSignupEnrollment(default_identifier or None)
    return None
