"""FastAPI dependency package for API v2 routes.

Contains DI helpers for infrastructure, sessions, setup guards, console auth,
and path-scoped app loading. Keep route-specific business behavior in routers
or services; this package owns reusable request context wiring.
"""

from api_fastapi.dependencies.apps import app_model_dependency, editable_app_model_dependency
from api_fastapi.dependencies.auth import (
    CurrentAccount,
    CurrentAccountDep,
    EditorAccountDep,
    get_current_account,
    require_editor,
)
from api_fastapi.dependencies.infra import (
    AsyncSessionDep,
    ExtensionHostDep,
    FastAPIInfraDep,
    RedisDep,
    SyncSessionDep,
    get_async_session,
    get_extension_host,
    get_fastapi_infra,
    get_redis,
    get_sync_session,
)
from api_fastapi.dependencies.setup import (
    AsyncSetupDep,
    SetupDep,
    require_setup,
    require_setup_async,
    require_setup_for_session,
    setup_required,
)

__all__ = [
    "AsyncSessionDep",
    "AsyncSetupDep",
    "CurrentAccount",
    "CurrentAccountDep",
    "EditorAccountDep",
    "ExtensionHostDep",
    "FastAPIInfraDep",
    "RedisDep",
    "SetupDep",
    "SyncSessionDep",
    "app_model_dependency",
    "editable_app_model_dependency",
    "get_async_session",
    "get_current_account",
    "get_extension_host",
    "get_fastapi_infra",
    "get_redis",
    "get_sync_session",
    "require_editor",
    "require_setup",
    "require_setup_async",
    "require_setup_for_session",
    "setup_required",
]
