"""Console workflow admission and domain-to-HTTP error translation."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.common.errors import AccessDeniedError, NotFoundError
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.console.app.error import AppNotFoundError, DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.model import AppMode
from services.app.console_service import ConsoleAppNotFoundError
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.base import NoPermissionError
from services.workflow.contracts import DraftWorkflowMissingError

_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


def console_workflow_admission[T, **P, R](
    *,
    permission: RBACPermission,
    modes: tuple[AppMode, ...] = (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW),
    require_editor: bool = True,
):
    def decorator(view: Callable[Concatenate[T, RequestContext, P], R]):
        @console_account_admission(
            allowed_roles=_EDIT_ROLES if require_editor else None,
            rbac_checks=[RBACCheck(permission, PlainApp())],
        )
        @wraps(view)
        def admitted(self: T, context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
            app_id = kwargs.get("app_id")
            if app_id is None:
                raise ValueError("missing app_id in path parameters")
            try:
                app = application_services().apps.console.get_reference(context, str(app_id))
                if app.mode not in modes:
                    raise AppNotFoundError(f"App mode is not in the supported list: {set(modes)}")
                return view(self, context, *args, **kwargs)
            except ConsoleAppNotFoundError as error:
                raise AppNotFoundError() from error
            except DraftWorkflowMissingError as error:
                raise DraftWorkflowNotExist() from error
            except WorkflowHashNotEqualError as error:
                raise DraftWorkflowNotSync() from error
            except WorkflowNotFoundError as error:
                raise NotFoundError(str(error)) from error
            except NoPermissionError as error:
                raise AccessDeniedError() from error

        return admitted

    return decorator
