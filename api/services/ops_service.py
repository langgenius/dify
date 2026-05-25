# Canonical implementation has moved to services.studio.ops_service
# This barrel is kept for backwards compatibility.
from services.studio.ops_service import OpsService, get_tracing_app_config, create_tracing_app_config, update_tracing_app_config, delete_tracing_app_config

__all__ = ["OpsService",
    "get_tracing_app_config",
    "create_tracing_app_config",
    "update_tracing_app_config",
    "delete_tracing_app_config"]
