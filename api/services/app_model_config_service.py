# Canonical implementation has moved to services.studio.app_model_config_service
# This barrel is kept for backwards compatibility.
from services.studio.app_model_config_service import AppModelConfigService, validate_configuration

__all__ = ["AppModelConfigService",
    "validate_configuration"]
