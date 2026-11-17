from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from inspect import unwrap
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from flask_restx import Resource
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console import console_ns, flask_admission, wraps
from controllers.console.error import AccountNotLinkTenantError, NotInitValidateError, NotSetupError
from controllers.console.notification import NotificationApi
from controllers.console.workspace import workspace as controller
from controllers.console.workspace.error import AccountNotInitializedError, CurrentWorkspaceArchivedError
from controllers.console.workspace.workspace import WorkspacePermissionApi
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from libs import login as login_adapter
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus
from services.entities.feature_entities import FeatureModel
from services.errors import file as file_errors
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError, WorkspaceNotLinkedError
from services.workspace.contracts import (
    WorkspaceCustomConfig,
    WorkspaceCustomConfigChanges,
    WorkspacePage,
    WorkspacePermission,
    WorkspaceSnapshot,
    WorkspaceSummary,
)
from services.workspace.provisioning_service import WorkspaceProvisioningService
from services.workspace.service import WorkspaceQueryService, WorkspaceService
from tests.helpers.unit.account_domain import AccountDomain

"""Workspace admission composes existing checks before controller execution."""


class TestWorkspaceAdmissionCases:
    @staticmethod
    def test_admin_key_admits_without_account_login(app: Flask, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, ADMIN_API_KEY="admin")

        class Handler:
            @flask_admission.console_admin_admission
            def get(self, *, page: int) -> int:
                return page

        with app.test_request_context(headers={"Authorization": "Bearer admin"}):
            assert Handler().get(page=2) == 2
        with app.test_request_context(), pytest.raises(Unauthorized):
            Handler().get(page=2)

    @staticmethod
    @pytest.mark.parametrize(
        ("edition", "enabled", "allowed"),
        [
            (DeploymentEdition.CLOUD, True, True),
            (DeploymentEdition.CLOUD, False, False),
            (DeploymentEdition.COMMUNITY, False, True),
        ],
    )
    def test_custom_brand_billing_admission(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        edition: DeploymentEdition,
        enabled: bool,
        allowed: bool,
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=edition)
        monkeypatch.setattr(flask_admission, "setup_required", lambda view: view)
        monkeypatch.setattr(flask_admission, "login_required", lambda view: view)
        monkeypatch.setattr(flask_admission, "account_initialization_required", lambda view: view)
        account = Account(name="User", email="user@example.com")
        identity = AccountWithTenant(account, "workspace")
        monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
        features = Mock(return_value=FeatureModel(can_replace_logo=enabled))
        monkeypatch.setattr(wraps.FeatureService, "get_features", features)
        reached = []

        class Handler:
            @flask_admission.console_account_admission(billing_resource="workspace_custom")
            def post(self, context: RequestContext) -> RequestContext:
                reached.append(context)
                return context

        with app.test_request_context():
            if allowed:
                context = Handler().post()
                assert isinstance(context, RequestContext)
                assert context.active_workspace_id == "workspace"
            else:
                with pytest.raises(Forbidden):
                    Handler().post()
        assert bool(reached) is allowed
        assert features.call_count == int(edition == DeploymentEdition.CLOUD)

    @staticmethod
    @pytest.mark.parametrize("controller_type", [WorkspacePermissionApi, NotificationApi])
    @pytest.mark.parametrize(
        ("setup_complete", "init_password", "status", "error"),
        [
            (False, "", None, NotSetupError),
            (False, "initial-password", None, NotInitValidateError),
            (True, "", None, Unauthorized),
            (True, "", AccountStatus.UNINITIALIZED, AccountNotInitializedError),
            (True, "", AccountStatus.ACTIVE, NotFound),
        ],
    )
    def test_account_admission_checks_identity_before_edition(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        controller_type: type[WorkspacePermissionApi] | type[NotificationApi],
        setup_complete: bool,
        init_password: str,
        status: AccountStatus | None,
        error: type[Exception],
    ) -> None:
        config_overrides(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD=init_password, LOGIN_DISABLED=False
        )
        monkeypatch.setattr(wraps, "_is_setup_completed", lambda: setup_complete)
        account = Account(name="User", email="user@example.com", status=status or AccountStatus.ACTIVE)
        identity = Mock(return_value=account, side_effect=Unauthorized() if status is None else None)
        monkeypatch.setattr(login_adapter, "_resolve_current_user", identity)
        monkeypatch.setattr(login_adapter, "check_csrf_token", Mock())
        monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))

        with app.test_request_context(), pytest.raises(error):
            controller_type().get()

        assert identity.call_count == int(setup_complete)


"""Controller contracts: parsing, delegation, serialization and HTTP errors."""


CONTEXT = RequestContext("request-1", "trace-1", "account-1", "workspace-1")
NOW = datetime(2026, 1, 1)


@pytest.mark.parametrize(
    ("scenario", "expected_status"),
    [
        ("success", 200),
        ("missing_csrf", 401),
        ("anonymous", 401),
        ("banned", 401),
        ("creation_disabled", 400),
        ("workspace_limit", 400),
        ("invalid_name", 422),
    ],
)
def test_cloud_workspace_activation_accepts_workspace_less_accounts_with_csrf(
    account_domain: AccountDomain,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    redis_transport: tuple[RedisClientWrapper, Mock],
    scenario: str,
    expected_status: int,
) -> None:
    from controllers.console import bp as console_bp
    from controllers.console.workspace import account as account_controller
    from dify_app import DifyApp
    from extensions import ext_login
    from services.account.adapters import AccountIdentityGateway
    from services.account.login_adapters import RedisAccountSessionGateway
    from services.account_profile_service import AccountProfileService
    from services.workspace.contracts import WorkspaceCreation
    from services.workspace.provisioning_service import WorkspaceProvisioningEffects

    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        SECRET_KEY="workspace-activation-test-key-with-32-bytes",
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://console.example.com",
        COOKIE_DOMAIN="",
        LOGIN_DISABLED=False,
    )
    account = account_domain.accounts.create_account(
        "consumer@example.com", "Consumer", "en-US", status="banned" if scenario == "banned" else "uninitialized"
    )
    account_domain.policy.is_workspace_creation_allowed.return_value = scenario != "creation_disabled"
    account_domain.policy.has_workspace_capacity.return_value = scenario != "workspace_limit"
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("workspace", "My workspace", "key", 123, 0, {})
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)
    services = SimpleNamespace(
        workspaces=SimpleNamespace(
            provisioning=account_domain.provisioning,
            queries=create_autospec(WorkspaceQueryService, instance=True),
        ),
        accounts=SimpleNamespace(profile=AccountProfileService(accounts=account_domain.repository)),
    )
    services.workspaces.queries.list_for_account.return_value = ()
    monkeypatch.setattr(controller, "application_services", lambda: services)
    monkeypatch.setattr(account_controller, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    redis, _ = redis_transport
    identity = AccountIdentityGateway(accounts=account_domain.repository, redis=redis)
    app = DifyApp("workspace-activation")
    app.register_blueprint(console_bp)
    ext_login.init_app(app)
    ext_login.bind_account_loader(app, identity.load_user)
    monkeypatch.setattr(ext_login.session_factory, "create_session", account_domain.repository._session_factory)
    tokens = RedisAccountSessionGateway(redis=redis).issue(account.id)
    client = app.test_client()
    if scenario != "anonymous":
        client.set_cookie("__Host-access_token", tokens.access_token, domain="console.example.com", secure=True)
    client.set_cookie("__Host-csrf_token", tokens.csrf_token, domain="console.example.com", secure=True)
    headers: dict[str, str] = {} if scenario == "missing_csrf" else {"X-CSRF-Token": tokens.csrf_token}
    if scenario == "success":
        profile = client.get("/console/api/account/profile", base_url="https://console.example.com", headers=headers)
        assert profile.status_code == 200
        profile_data = profile.get_json()
        assert isinstance(profile_data, dict)
        assert profile_data["first_workspace_created_at"] is None
        assert profile_data["has_owned_tenant"] is False
        assert profile_data["has_tenant"] is False
    response = client.post(
        "/console/api/workspaces/activate",
        base_url="https://console.example.com",
        json={"name": "  " if scenario == "invalid_name" else "My workspace"},
        headers=headers,
    )
    assert response.status_code == expected_status
    if scenario == "success":
        activation_data = response.get_json()
        assert isinstance(activation_data, dict)
        assert activation_data["workspace_id"] == "workspace"
        assert activation_data["first_workspace_created_at"] is not None
        repeated = client.post(
            "/console/api/workspaces/activate",
            base_url="https://console.example.com",
            json={"name": "Ignored retry"},
            headers=headers,
        )
        assert repeated.get_json() == activation_data
        effects.created.assert_called_once()
        profile = client.get("/console/api/account/profile", base_url="https://console.example.com", headers=headers)
        profile_data = profile.get_json()
        assert isinstance(profile_data, dict)
        assert profile_data["first_workspace_created_at"] == activation_data["first_workspace_created_at"]
        assert profile_data["has_owned_tenant"] is True
        assert profile_data["has_tenant"] is True
        admitted = client.get("/console/api/workspaces", base_url="https://console.example.com", headers=headers)
        assert admitted.status_code == 200
    else:
        effects.prepare.assert_not_called()
    persisted = account_domain.repository.get(account.id)
    assert persisted is not None
    if scenario == "success":
        assert persisted.status == AccountStatus.ACTIVE
        assert persisted.initialized_at is not None
        assert persisted.initialized_at == persisted.first_workspace_created_at
    else:
        assert persisted.status == (AccountStatus.BANNED if scenario == "banned" else AccountStatus.UNINITIALIZED)
        assert persisted.initialized_at is None
        assert persisted.first_workspace_created_at is None


@dataclass
class WorkspaceMocks:
    management: Mock
    queries: Mock
    provisioning: Mock


@dataclass
class Services:
    workspaces: WorkspaceMocks


class TestWorkspaceCases:
    @staticmethod
    @pytest.fixture
    def workspaces(monkeypatch: pytest.MonkeyPatch) -> WorkspaceMocks:
        services = WorkspaceMocks(
            management=create_autospec(WorkspaceService, instance=True),
            queries=create_autospec(WorkspaceQueryService, instance=True),
            provisioning=create_autospec(WorkspaceProvisioningService, instance=True),
        )
        monkeypatch.setattr(controller, "application_services", lambda: Services(services))
        return services

    @staticmethod
    def test_workspace_list_serialization(workspaces: WorkspaceMocks) -> None:
        workspaces.queries.list_for_account.return_value = (
            WorkspaceSummary("workspace-1", "Test", "team", "normal", NOW, None, True),
        )
        body, status = unwrap(controller.TenantListApi.get)(controller.TenantListApi(), CONTEXT)
        assert status == HTTPStatus.OK
        assert body["workspaces"] == [
            {
                "id": "workspace-1",
                "name": "Test",
                "plan": "team",
                "status": "normal",
                "created_at": int(NOW.timestamp()),
                "last_opened_at": None,
                "current": True,
            }
        ]
        workspaces.queries.list_for_account.assert_called_once_with(CONTEXT)

    @staticmethod
    def test_admin_pagination(app: Flask, workspaces: WorkspaceMocks) -> None:
        workspaces.management.list_all.return_value = WorkspacePage(
            (WorkspaceSnapshot("w1", "Test", "archive", NOW),), 5, 2, 2, True
        )
        with app.test_request_context("/all-workspaces?page=2&limit=2"):
            body, status = unwrap(controller.WorkspaceListApi.get)(controller.WorkspaceListApi())
        assert status == 200
        assert body == {
            "data": [{"id": "w1", "name": "Test", "status": "archive", "created_at": int(NOW.timestamp())}],
            "total": 5,
            "page": 2,
            "limit": 2,
            "has_more": True,
        }
        workspaces.management.list_all.assert_called_once_with(page=2, limit=2)

    @staticmethod
    def test_summary(workspaces: WorkspaceMocks) -> None:
        workspaces.management.current_summary.return_value = {
            "id": "w1",
            "name": "Test",
            "role": "owner",
            "plan": CloudPlan.TEAM,
            "credits": -1,
        }
        body, status = unwrap(controller.CurrentWorkspaceSummaryApi.get)(
            controller.CurrentWorkspaceSummaryApi(), CONTEXT
        )
        assert status == 200
        assert body["credits"] == -1
        workspaces.management.current_summary.assert_called_once_with(CONTEXT)

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "http_error"),
        [(WorkspaceArchivedError(), CurrentWorkspaceArchivedError), (WorkspaceNotFoundError(), NotFound)],
    )
    def test_summary_errors(workspaces: WorkspaceMocks, error: Exception, http_error: type[Exception]) -> None:
        workspaces.management.current_summary.side_effect = error
        with pytest.raises(http_error):
            unwrap(controller.CurrentWorkspaceSummaryApi.get)(controller.CurrentWorkspaceSummaryApi(), CONTEXT)

    @staticmethod
    def test_switch_and_rename(app: Flask, workspaces: WorkspaceMocks) -> None:
        workspaces.management.switch.return_value = {"id": "target", "name": "Switched"}
        workspaces.management.rename.return_value = {"id": "workspace-1", "name": "Renamed"}
        with app.test_request_context(json={"tenant_id": "target"}):
            body = unwrap(controller.SwitchWorkspaceApi.post)(controller.SwitchWorkspaceApi(), CONTEXT)
        assert body["new_tenant"]["id"] == "target"
        workspaces.management.switch.assert_called_once_with(CONTEXT, "target")
        with app.test_request_context(json={"name": "Renamed"}):
            body = unwrap(controller.WorkspaceInfoApi.post)(controller.WorkspaceInfoApi(), CONTEXT)
        assert body["tenant"]["name"] == "Renamed"
        workspaces.management.rename.assert_called_once_with(CONTEXT, "Renamed")

    @staticmethod
    def test_switch_not_linked(app: Flask, workspaces: WorkspaceMocks) -> None:
        workspaces.management.switch.side_effect = WorkspaceNotLinkedError()
        with app.test_request_context(json={"tenant_id": "target"}), pytest.raises(AccountNotLinkTenantError):
            unwrap(controller.SwitchWorkspaceApi.post)(controller.SwitchWorkspaceApi(), CONTEXT)

    @staticmethod
    def test_config_response_and_partial_update(app: Flask, workspaces: WorkspaceMocks) -> None:
        workspaces.management.custom_config.return_value = WorkspaceCustomConfig(True, "https://files/logo")
        assert unwrap(controller.CustomConfigWorkspaceApi.get)(controller.CustomConfigWorkspaceApi(), CONTEXT) == {
            "remove_webapp_brand": True,
            "replace_webapp_logo": "https://files/logo",
        }
        workspaces.management.update_custom_config.return_value = {"id": "workspace-1"}
        with app.test_request_context(json={"remove_webapp_brand": False}):
            body = unwrap(controller.CustomConfigWorkspaceApi.post)(controller.CustomConfigWorkspaceApi(), CONTEXT)
        assert body["result"] == "success"
        workspaces.management.update_custom_config.assert_called_once_with(
            CONTEXT, WorkspaceCustomConfigChanges(False, None)
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("resource", "method", "payload", "service_method"),
        [
            pytest.param(
                controller.CustomConfigWorkspaceApi,
                controller.CustomConfigWorkspaceApi.get,
                {},
                lambda management: management.custom_config,
                id="custom_config",
            ),
            pytest.param(
                controller.CustomConfigWorkspaceApi,
                controller.CustomConfigWorkspaceApi.post,
                {},
                lambda management: management.update_custom_config,
                id="update_custom_config",
            ),
            pytest.param(
                controller.WorkspaceInfoApi,
                controller.WorkspaceInfoApi.post,
                {"name": "New"},
                lambda management: management.rename,
                id="rename",
            ),
        ],
    )
    def test_missing_workspace(
        app: Flask,
        workspaces: WorkspaceMocks,
        resource: type[Resource],
        method: Callable[..., object],
        payload: dict[str, object],
        service_method: Callable[[Mock], Mock],
    ) -> None:
        service_method(workspaces.management).side_effect = WorkspaceNotFoundError()
        with app.test_request_context(json=payload), pytest.raises(NotFound):
            unwrap(method)(resource(), CONTEXT)

    @staticmethod
    @pytest.mark.parametrize(
        ("files", "error"),
        [
            ({}, NoFileUploadedError),
            ({"file": (BytesIO(b"x"), "a.png"), "extra": (BytesIO(b"x"), "b.png")}, TooManyFilesError),
            ({"file": (BytesIO(b"x"), "")}, FilenameNotExistsError),
        ],
    )
    def test_upload_form_errors(
        app: Flask, workspaces: WorkspaceMocks, files: dict[str, tuple[BytesIO, str]], error: type[Exception]
    ) -> None:
        with app.test_request_context(method="POST", data=files), pytest.raises(error):
            unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)
        workspaces.management.upload_logo.assert_not_called()

    @staticmethod
    def test_upload(app: Flask, workspaces: WorkspaceMocks) -> None:
        workspaces.management.upload_logo.return_value = "upload-1"
        with app.test_request_context(method="POST", data={"file": (BytesIO(b"image"), "logo.PNG")}):
            result = unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)
        assert result == ({"id": "upload-1"}, HTTPStatus.CREATED)
        workspaces.management.upload_logo.assert_called_once_with(
            CONTEXT, filename="logo.PNG", content=b"image", mimetype="image/png"
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "http_error"),
        [
            (file_errors.FileTooLargeError(), FileTooLargeError),
            (file_errors.UnsupportedFileTypeError(), UnsupportedFileTypeError),
        ],
    )
    def test_upload_service_errors(
        app: Flask, workspaces: WorkspaceMocks, error: Exception, http_error: type[Exception]
    ) -> None:
        workspaces.management.upload_logo.side_effect = error
        with (
            app.test_request_context(method="POST", data={"file": (BytesIO(b"x"), "logo.png")}),
            pytest.raises(http_error),
        ):
            unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)

    @staticmethod
    def test_permissions(workspaces: WorkspaceMocks) -> None:
        workspaces.management.permission.return_value = WorkspacePermission("workspace-1", True, False)
        body, status = unwrap(controller.WorkspacePermissionApi.get)(controller.WorkspacePermissionApi(), CONTEXT)
        assert status == 200
        assert body == {"workspace_id": "workspace-1", "allow_member_invite": True, "allow_owner_transfer": False}
        workspaces.management.permission.assert_called_once_with(CONTEXT)

    @staticmethod
    def test_removed_current_workspace_routes_stay_unregistered() -> None:
        urls = {url for resource in console_ns.resources for url in resource.urls}
        assert "/workspaces/current" not in urls
        assert "/workspaces/current/tool-provider" not in urls
