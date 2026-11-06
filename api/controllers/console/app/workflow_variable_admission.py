"""Admission and error mapping for all Console draft-variable owners."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate, Literal

from controllers.common.errors import AccessDeniedError, InvalidArgumentError, NotFoundError
from controllers.common.rbac import DatasetByPipeline, PlainApp, RBACCheck
from controllers.console.app.error import AppNotFoundError, DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.datasets.error import PipelineNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from enums.account import TenantAccountRole
from machinery.context import RequestContext
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.base import NoPermissionError
from services.workflow.contracts import DraftWorkflowMissingError
from services.workflow.variable_contracts import (
    DraftVariableChangedError,
    DraftVariableNotFoundError,
    DraftVariableOwnerNotFoundError,
    InvalidDraftVariableError,
)


def console_variable_admission[T, **P, R](
    kind: Literal["app", "pipeline", "snippet"], *, permission: RBACPermission = RBACPermission.APP_VIEW_LAYOUT
):
    checks = (
        [RBACCheck(RBACPermission.DATASET_EDIT, DatasetByPipeline())]
        if kind == "pipeline"
        else [RBACCheck(permission, PlainApp())]
        if kind == "app"
        else []
    )

    def decorate(view: Callable[Concatenate[T, RequestContext, P], R]):
        @console_account_admission(
            allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
            rbac_checks=checks,
        )
        @wraps(view)
        def admitted(self: T, context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
            try:
                return view(self, context, *args, **kwargs)
            except DraftVariableOwnerNotFoundError as error:
                if error.kind == "app":
                    raise AppNotFoundError() from error
                if error.kind == "pipeline":
                    raise PipelineNotFoundError() from error
                raise NotFoundError(str(error)) from error
            except DraftWorkflowMissingError as error:
                raise DraftWorkflowNotExist() from error
            except (DraftVariableNotFoundError, WorkflowNotFoundError) as error:
                raise NotFoundError(str(error)) from error
            except (WorkflowHashNotEqualError, DraftVariableChangedError) as error:
                raise DraftWorkflowNotSync() from error
            except InvalidDraftVariableError as error:
                raise InvalidArgumentError(str(error)) from error
            except NoPermissionError as error:
                raise AccessDeniedError() from error

        return admitted

    return decorate
