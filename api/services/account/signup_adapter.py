"""Deployment policy sampled only by actual self-signup account producers."""

from configs import dify_config
from enums import DeploymentEdition
from repositories.tokener_signup_canary_repository import CANARY_BILLING_URL, CANARY_STAGING_PLUGIN_PREFIX
from services.account.contracts import TokenerSignupEnrollment


def configured_signup_enrollment(email: str | None = None) -> TokenerSignupEnrollment | None:
    """Freeze Cloud's explicitly enabled signup decision; flag-off creates no intent."""
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.TOKENER_NEW_TENANT_COHORT_ENABLED:
        canary_email = dify_config.TOKENER_SIGNUP_VALIDATION_EMAIL.strip().casefold()
        if email and canary_email and email.strip().casefold() == canary_email:
            identifier = dify_config.TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER.strip()
            if not identifier.startswith(CANARY_STAGING_PLUGIN_PREFIX) or (
                dify_config.TOKENER_SIGNUP_VALIDATION_BILLING_API_URL != CANARY_BILLING_URL
            ):
                raise ValueError("The hosted routing canary is not fully configured.")
            return TokenerSignupEnrollment(identifier)
        return TokenerSignupEnrollment(dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip() or None)
    return None
