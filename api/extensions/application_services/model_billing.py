"""Native signup-profile composition, shared by API and worker model reads."""

from core.db.session_factory import session_factory
from repositories.model_billing_profile_repository import ModelBillingProfileRepository
from services.model_billing_profile_service import ModelBillingProfileService


def build_model_billing_profiles() -> ModelBillingProfileService:
    """Bind the normal session owner; no Flask request or legacy fallback is needed."""
    return ModelBillingProfileService(profiles=ModelBillingProfileRepository(sessions=session_factory.create_session))
