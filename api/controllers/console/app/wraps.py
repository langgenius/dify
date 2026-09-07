"""Controller decorators for console app resources.

`get_app_model` still supports legacy handlers backed by Flask-SQLAlchemy's
scoped session. Preview handlers compose `get_previewable_app_model` under
`controllers.common.session.with_session`; preview admission finishes before
the request Session loads the accepted App.
"""

from collections.abc import Callable
from functools import wraps
from typing import cast, overload

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.session import with_session
from controllers.common.wraps import RBACPermission, RBACResourceScope, _extract_resource_id, enforce_rbac_access
from controllers.console.app.error import AppNotFoundError
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models import App, AppMode
from models.agent import Agent, AgentScope
from services.app_service import AppService

__all__ = [
    "agent_manage_required_for_agent_app",
    "enforce_agent_manage_or_app_scene",
    "get_app_model",
    "get_previewable_app_model",
    "with_session",
]


def _load_app_model(session: Session, app_id: str) -> App | None:
    """Load the tenant-scoped app row with the request session owned by `with_session`."""
    _, current_tenant_id = current_account_with_tenant()
    app_model = session.scalar(
        select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
    )
    return app_model


def _load_app_model_from_scoped_session(app_id: str) -> App | None:
    """Load the app row for legacy handlers that have not adopted request session injection yet."""
    _, current_tenant_id = current_account_with_tenant()
    app_model = db.session.scalar(
        select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
    )
    return app_model


def _load_previewable_app_model(session: Session, app_id: str) -> App | None:
    """Load a normal App after preview admission completes outside the request Session."""
    if not application_services().recommended_app_queries.is_previewable(app_id):
        return None
    return AppService.get_normal_app_by_id(app_id, session)


def _agent_app_binding(app_id: str) -> Agent | None:
    app_model = _load_app_model_from_scoped_session(app_id)
    if app_model is None:
        return None
    return app_model.agent_app_binding_with_session(session=db.session(), include_archived=True)


def _reject_hidden_agent_backing_app(path_args: dict[str, object]) -> None:
    raw_app_id = path_args.get("app_id") or path_args.get("resource_id")
    if raw_app_id is None:
        return
    binding = _agent_app_binding(str(raw_app_id))
    if binding is not None and binding.scope == AgentScope.WORKFLOW_ONLY:
        raise AppNotFoundError()


def enforce_agent_manage_or_app_scene(
    *,
    tenant_id: str,
    account_id: str,
    scene: RBACPermission,
    path_args: dict[str, object],
) -> None:
    # Must run before the RBAC_ENABLED check below: a hidden workflow-only
    # backing App has to stay unreachable regardless of RBAC_ENABLED.
    _reject_hidden_agent_backing_app(path_args)

    if not dify_config.RBAC_ENABLED:
        return

    binding = _agent_app_binding(_extract_resource_id(RBACResourceScope.APP, tenant_id, path_args))

    if binding is not None:
        if binding.scope == AgentScope.WORKFLOW_ONLY:
            raise AppNotFoundError()
        try:
            enforce_rbac_access(
                tenant_id=tenant_id,
                account_id=account_id,
                resource_type=RBACResourceScope.WORKSPACE,
                scene=RBACPermission.AGENT_MANAGE,
                resource_required=False,
            )
            return
        except Forbidden:
            pass  # not an agent.manage holder — fall through to the normal scene check

    enforce_rbac_access(
        tenant_id=tenant_id,
        account_id=account_id,
        resource_type=RBACResourceScope.APP,
        scene=scene,
        path_args=path_args,
    )


@overload
def agent_manage_required_for_agent_app[**P, R](view: Callable[P, R]) -> Callable[P, R]: ...


@overload
def agent_manage_required_for_agent_app[**P, R](
    view: None = None, *, scene: RBACPermission | None = None
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def agent_manage_required_for_agent_app[**P, R](
    view: Callable[P, R] | None = None, *, scene: RBACPermission | None = None
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    # Must sit above get_app_model in the decorator stack — get_app_model
    # deletes app_id from kwargs, and this decorator needs it.
    # TODO: this is a workaround, remove this after ACL for agent app is available
    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            if scene is not None:
                if not dify_config.RBAC_ENABLED:
                    _reject_hidden_agent_backing_app(kwargs)
                    return view_func(*args, **kwargs)
                current_user, current_tenant_id = current_account_with_tenant()
                enforce_agent_manage_or_app_scene(
                    tenant_id=current_tenant_id,
                    account_id=current_user.id,
                    scene=scene,
                    path_args=kwargs,
                )
                return view_func(*args, **kwargs)

            raw_app_id = kwargs.get("app_id") or kwargs.get("resource_id")
            if raw_app_id is not None:
                binding = _agent_app_binding(str(raw_app_id))
                if binding is not None:
                    if binding.scope == AgentScope.WORKFLOW_ONLY:
                        raise AppNotFoundError()
                    if dify_config.RBAC_ENABLED:
                        current_user, current_tenant_id = current_account_with_tenant()
                        enforce_rbac_access(
                            tenant_id=current_tenant_id,
                            account_id=current_user.id,
                            resource_type=RBACResourceScope.WORKSPACE,
                            scene=RBACPermission.AGENT_MANAGE,
                            resource_required=False,
                        )
            return view_func(*args, **kwargs)

        return decorated

    if view is None:
        return decorator
    return decorator(view)


def _get_injected_session(args: tuple[object, ...]) -> Session | None:
    """Return the request session inserted by `with_session`, if this handler has been migrated."""
    if len(args) < 2:
        return None

    candidate = args[1]
    if isinstance(candidate, Session):
        return candidate

    if hasattr(candidate, "scalar") and hasattr(candidate, "commit") and hasattr(candidate, "rollback"):
        return cast(Session, candidate)

    return None


@overload
def get_app_model[**P, R](
    view: Callable[P, R],
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R]: ...


@overload
def get_app_model[**P, R](
    view: None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def get_app_model[**P, R](
    view: Callable[P, R] | None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Inject the App model for handlers that receive an `app_id` path parameter.

    New handlers may compose `@with_session` above this decorator so the app row
    is loaded through the same request-scoped session used by the controller.
    Existing handlers continue to work through `db.session` until migrated.
    """

    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("app_id"):
                raise ValueError("missing app_id in path parameters")

            app_id = kwargs.get("app_id")
            app_id = str(app_id)

            del kwargs["app_id"]

            session = _get_injected_session(args)
            if session is None:
                app_model = _load_app_model_from_scoped_session(app_id)
            else:
                app_model = _load_app_model(session, app_id)

            if not app_model:
                raise AppNotFoundError()

            app_mode = AppMode.value_of(app_model.mode)

            if mode is not None:
                if isinstance(mode, list):
                    modes = mode
                else:
                    modes = [mode]

                if app_mode not in modes:
                    mode_values = {m.value for m in modes}
                    raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")

            kwargs["app_model"] = app_model

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


@overload
def get_previewable_app_model[**P, R](
    view: Callable[P, R],
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R]: ...


@overload
def get_previewable_app_model[**P, R](
    view: None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def get_previewable_app_model[**P, R](
    view: Callable[P, R] | None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Inject an App authorized for read-only template preview.

    Preview reads accept either an explicit TrialApp registration or membership
    in the recommended catalog. This does not grant trial execution, which is
    separately protected by TrialAppResource's feature, registration, and quota
    checks.
    """

    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("app_id"):
                raise ValueError("missing app_id in path parameters")

            app_id = kwargs.get("app_id")
            app_id = str(app_id)

            del kwargs["app_id"]

            session = _get_injected_session(args)
            if session is None:
                raise RuntimeError("get_previewable_app_model requires @with_session")
            app_model = _load_previewable_app_model(session, app_id)

            if not app_model:
                raise AppNotFoundError()

            app_mode = AppMode.value_of(app_model.mode)

            if mode is not None:
                if isinstance(mode, list):
                    modes = mode
                else:
                    modes = [mode]

                if app_mode not in modes:
                    mode_values = {m.value for m in modes}
                    raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")

            kwargs["app_model"] = app_model

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
