from werkzeug.exceptions import Unauthorized

from controllers.fastopenapi import console_router
from libs.login import current_account_with_tenant, current_user, login_required
from services.feature_service import FeatureModel, FeatureService, SystemFeatureModel

from .wraps import account_initialization_required, cloud_utm_record, setup_required


@console_router.get(
    "/features",
    response_model=FeatureModel,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_utm_record
def get_features() -> FeatureModel:
    """Get feature configuration for current tenant."""
    _, current_tenant_id = current_account_with_tenant()
    return FeatureService.get_features(current_tenant_id)


@console_router.get(
    "/system-features",
    response_model=SystemFeatureModel,
    tags=["console"],
)
def get_system_features() -> SystemFeatureModel:
    """Get system-wide feature configuration.

    This endpoint is unauthenticated by design, as it provides system features
    data required for dashboard initialization.

    Authentication would create circular dependency (can't login without dashboard loading).

    Only non-sensitive configuration data should be returned by this endpoint.
    """
    # NOTE(QuantumGhost): ideally we should access `current_user.is_authenticated`
    # without a try-catch. However, due to the implementation of user loader (the `load_user_from_request`
    # in api/extensions/ext_login.py), accessing `current_user.is_authenticated` will
    # raise `Unauthorized` exception if authentication token is not provided.
    try:
        is_authenticated = current_user.is_authenticated
    except Unauthorized:
        is_authenticated = False
    return FeatureService.get_system_features(is_authenticated=is_authenticated)
