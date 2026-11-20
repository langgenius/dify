"""Deployment policy sampled only by actual self-signup account producers."""

from configs import dify_config
from enums import DeploymentEdition
from services.account.contracts import TokenerSignupEnrollment


def configured_signup_enrollment() -> TokenerSignupEnrollment | None:
    """Freeze Cloud's explicitly enabled signup decision; flag-off creates no intent."""
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.TOKENER_NEW_TENANT_COHORT_ENABLED:
        return TokenerSignupEnrollment(dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip() or None)
    return None
