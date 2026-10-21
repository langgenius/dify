"""KnowledgeFS creation must preserve legacy roles and Enterprise RBAC admission."""

from collections.abc import Callable
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import flask_admission, wraps
from controllers.console.knowledge_fs import resources
from core.rbac.entities import RBACPermission
from enums import DeploymentEdition
from libs import login
from libs.login import AccountWithTenant
from models.account import TenantAccountRole
from models.knowledge_fs import KnowledgeFSControlSpaceState
from services.enterprise.rbac_service import RBACService
from services.knowledge_fs.product_application_service import KnowledgeFSProductApplicationService
from services.knowledge_fs.product_dto import KnowledgeFSSpaceCreateResponse
from tests.unit_tests.model_factories import make_account


@pytest.mark.parametrize(
    ("role", "rbac_enabled", "rbac_allowed", "allowed"),
    [
        (TenantAccountRole.NORMAL, False, True, False),
        (None, False, True, False),
        (TenantAccountRole.OWNER, False, True, True),
        (TenantAccountRole.ADMIN, False, True, True),
        (TenantAccountRole.EDITOR, False, True, True),
        (TenantAccountRole.DATASET_OPERATOR, False, True, True),
        (TenantAccountRole.NORMAL, True, True, True),
        (TenantAccountRole.ADMIN, True, False, False),
    ],
)
def test_create_space_enforces_admission_before_provisioning(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    role: TenantAccountRole | None,
    rbac_enabled: bool,
    rbac_allowed: bool,
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, RBAC_ENABLED=rbac_enabled, LOGIN_DISABLED=False)
    account = make_account(role=role)
    identity = AccountWithTenant(account, "workspace")
    monkeypatch.setattr(login, "_resolve_current_user", lambda: account)
    monkeypatch.setattr(login, "check_csrf_token", Mock())
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(resources, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "check_knowledge_rate_limit", Mock())
    check_access = Mock(return_value=rbac_allowed)
    monkeypatch.setattr(RBACService.CheckAccess, "check", check_access)
    application = create_autospec(KnowledgeFSProductApplicationService, instance=True, spec_set=True)
    application.create_space.return_value = KnowledgeFSSpaceCreateResponse(
        control_space_id="space",
        state=KnowledgeFSControlSpaceState.PROVISIONING,
        operation_id="operation",
        model_setup_required=True,
    )
    monkeypatch.setattr(resources, "_console_services", lambda: SimpleNamespace(application=application))

    with app.test_request_context("/knowledge-fs/spaces", method="POST", json={"name": "Test", "slug": "test"}):
        if allowed:
            result, status = resources.KnowledgeFSSpacesApi().post()
            assert status == HTTPStatus.ACCEPTED
            assert result["control_space_id"] == "space"
        else:
            with pytest.raises(Forbidden):
                resources.KnowledgeFSSpacesApi().post()

    if allowed:
        application.create_space.assert_called_once()
        assert application.create_space.call_args.kwargs["tenant_id"] == "workspace"
        assert application.create_space.call_args.kwargs["account_id"] == account.id
    else:
        application.create_space.assert_not_called()
    if rbac_enabled:
        check_access.assert_called_once_with(
            "workspace",
            account.id,
            scene=RBACPermission.DATASET_CREATE_AND_MANAGEMENT.value,
            resource_type=None,
            resource_id=None,
        )
    else:
        check_access.assert_not_called()
