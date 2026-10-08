from controllers.common.rbac import RBACCheck

"""Keep the existing workflow role, RBAC and app-mode admission policy."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from inspect import unwrap
from unittest.mock import create_autospec
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import PlainApp
from controllers.console import flask_admission
from controllers.console.app import workflow, workflow_admission
from controllers.console.app.error import AppNotFoundError, DraftWorkflowNotSync
from controllers.console.wraps import RBACPermission
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.workflow_contracts import WorkflowAgentBindingStore
from services.app.console_service import ConsoleAppService
from services.entities.app_entities import AppReference
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.console_service import ConsoleWorkflowService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

APP_ID = UUID("11111111-1111-1111-1111-111111111111")


@dataclass
class Apps:
    console: ConsoleAppService


@dataclass
class Services:
    apps: Apps
    console_workflows: ConsoleWorkflowService[WorkflowAgentBindingStore]


def admission(method: Callable[..., object]) -> Callable[..., object]:
    return unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


@pytest.mark.parametrize(
    ("method", "permission"),
    [
        (workflow.DraftWorkflowApi.get, RBACPermission.APP_VIEW_LAYOUT),
        (workflow.DraftWorkflowApi.post, RBACPermission.APP_VIEW_LAYOUT),
        (workflow.PublishedWorkflowApi.post, RBACPermission.APP_RELEASE_AND_VERSION),
        (workflow.DraftWorkflowRestoreApi.post, RBACPermission.APP_RELEASE_AND_VERSION),
        (workflow.WorkflowByIdApi.patch, RBACPermission.APP_EDIT),
        (workflow.WorkflowByIdApi.delete, RBACPermission.APP_EDIT),
        (workflow.DraftWorkflowRunApi.post, RBACPermission.APP_TEST_AND_RUN),
        (workflow.DraftWorkflowTriggerRunApi.post, RBACPermission.APP_TEST_AND_RUN),
        (workflow.WorkflowDraftHumanInputFormPreviewApi.post, RBACPermission.APP_VIEW_LAYOUT),
        (workflow.WorkflowDraftHumanInputFormRunApi.post, RBACPermission.APP_TEST_AND_RUN),
        (workflow.DraftWorkflowNodeLastRunApi.get, RBACPermission.APP_VIEW_LAYOUT),
    ],
)
def test_rbac_checks_keep_admitted_tenant_and_app(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], permission: RBACPermission
) -> None:
    account = make_account(role=TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "tenant"))
    calls = []

    def deny(*, tenant_id: str, account_id: str, checks: Sequence[RBACCheck], path_args: dict[str, object]) -> None:
        calls.append(True)
        assert (tenant_id, account_id) == ("tenant", account.id)
        assert checks[0].scene == permission
        assert isinstance(checks[0].locator, PlainApp)
        assert path_args["app_id"] == APP_ID
        raise Forbidden()

    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", deny)
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(method)(None, app_id=APP_ID)
    assert calls == [True]


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
@pytest.mark.parametrize(
    "method",
    [
        workflow.DraftWorkflowApi.get,
        workflow.DraftWorkflowRunApi.post,
        workflow.PublishedWorkflowApi.post,
        workflow.WorkflowByIdApi.delete,
    ],
)
def test_readonly_role_is_rejected_before_use_case(
    app: Flask, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole, method: Callable[..., object]
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(make_account(role=role), "tenant")
    )
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(method)(None, app_id=APP_ID)


@pytest.mark.parametrize("mode", ["workflow", "advanced-chat", "chat"])
def test_context_is_stable_and_app_mode_is_checked(app: Flask, monkeypatch: pytest.MonkeyPatch, mode: str) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    account = make_account(role=TenantAccountRole.EDITOR)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "tenant"))
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    apps = create_autospec(ConsoleAppService, instance=True)
    use_cases = create_autospec(ConsoleWorkflowService, instance=True)
    apps.get_reference.return_value = AppReference(str(APP_ID), "App", mode, None)
    use_cases.published.return_value = None
    services = Services(Apps(apps), use_cases)
    monkeypatch.setattr(workflow_admission, "application_services", lambda: services)
    monkeypatch.setattr(workflow, "application_services", lambda: services)
    with app.test_request_context(headers={"X-Trace-Id": "trace"}):
        if mode == "chat":
            with pytest.raises(AppNotFoundError):
                admission(workflow.PublishedWorkflowApi.get)(None, app_id=APP_ID)
            use_cases.published.assert_not_called()
        else:
            assert admission(workflow.PublishedWorkflowApi.get)(None, app_id=APP_ID) is None
            context, app_id = use_cases.published.call_args.args
            assert context == RequestContext("request", "trace", account.id, "tenant")
            assert app_id == str(APP_ID)


def test_revision_conflict_is_translated_to_existing_409(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(make_account(role=TenantAccountRole.EDITOR), "tenant"),
    )
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    apps = create_autospec(ConsoleAppService, instance=True)
    use_cases = create_autospec(ConsoleWorkflowService, instance=True)
    apps.get_reference.return_value = AppReference(str(APP_ID), "App", "workflow", None)
    use_cases.publish.side_effect = WorkflowHashNotEqualError()
    services = Services(Apps(apps), use_cases)
    monkeypatch.setattr(workflow_admission, "application_services", lambda: services)
    monkeypatch.setattr(workflow, "application_services", lambda: services)
    with app.test_request_context(json={}), pytest.raises(DraftWorkflowNotSync) as error:
        admission(workflow.PublishedWorkflowApi.post)(None, app_id=APP_ID)
    assert error.value.code == 409
