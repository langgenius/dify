"""Deployment policy sampled only by actual self-signup account producers."""

from configs import dify_config
from services.account.contracts import TokenerSignupEnrollment
from services.system_feature_service import SystemFeatureService


def configured_signup_enrollment() -> TokenerSignupEnrollment | None:
    """Freeze Cloud's explicitly enabled signup decision; flag-off creates no intent."""
    if SystemFeatureService.is_tokener_signup_enrollment_enabled():
        return TokenerSignupEnrollment(dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip() or None)
    return None
