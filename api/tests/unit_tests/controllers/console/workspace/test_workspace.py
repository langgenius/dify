import inspect
import logging
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Unauthorized

import services
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.workspace.workspace import (
    CustomConfigWorkspaceApi,
    SwitchWorkspaceApi,
    TenantApi,
    TenantInfoResponse,
    TenantListApi,
    WebappLogoWorkspaceApi,
    WorkspaceInfoApi,
    WorkspaceListApi,
    WorkspaceLogoUploadResponse,
    WorkspacePermissionApi,
    WorkspacePermissionResponse,
)
from enums.cloud_plan import CloudPlan
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantCustomConfigDict, TenantStatus


def make_account(account_id: str = "u1") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def make_tenant(
    tenant_id: str = "t1",
    *,
    name: str | None = None,
    status: TenantStatus = TenantStatus.NORMAL,
    custom_config: TenantCustomConfigDict | None = None,
) -> Tenant:
    tenant = Tenant(name=name or f"Tenant {tenant_id}", status=status)
    tenant.id = tenant_id
    tenant.created_at = naive_utc_now()
    if custom_config is not None:
        tenant.custom_config_dict = custom_config
    return tenant


def make_membership(*, last_opened_at=None) -> MagicMock:
    membership = MagicMock()
    membership.last_opened_at = last_opened_at
    return membership


def make_account_with_tenant(tenant: Tenant) -> Account:
    account = make_account()
    account._current_tenant = tenant
    return account


class TestTenantListApi:
    def test_get_success_saas_path(self, app: Flask):
        api = TenantListApi()
        method = inspect.unwrap(api.get)

        tenant1 = make_tenant("t1", name="Tenant 1")
        tenant2 = make_tenant("t2", name="Tenant 2")
        last_opened_at = naive_utc_now()
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[
                    (tenant1, make_membership(last_opened_at=last_opened_at)),
                    (tenant2, make_membership()),
                ],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", True),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "CLOUD"),
            patch(
                "controllers.console.workspace.workspace.BillingService.get_plan_bulk",
                return_value={
                    "t1": {"plan": CloudPlan.TEAM, "expiration_date": 0},
                    "t2": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": 0},
                },
            ) as get_plan_bulk_mock,
            patch("controllers.console.workspace.workspace.FeatureService.get_features") as get_features_mock,
        ):
            result, status = method(api, "t1", user)

        assert status == 200
        assert len(result["workspaces"]) == 2
        assert result["workspaces"][0]["current"] is True
        assert result["workspaces"][0]["plan"] == CloudPlan.TEAM
        assert result["workspaces"][0]["last_opened_at"] == int(last_opened_at.timestamp())
        assert result["workspaces"][1]["plan"] == CloudPlan.PROFESSIONAL
        assert result["workspaces"][1]["last_opened_at"] is None
        get_plan_bulk_mock.assert_called_once_with(["t1", "t2"])
        get_features_mock.assert_not_called()

    def test_get_saas_path_partial_fallback_does_not_gate_plan_on_billing_enabled(self, app: Flask):
        """Bulk omits a tenant: resolve plan via subscription.plan only; billing.enabled is not used.

        billing.enabled is mocked False to prove the endpoint does not gate on it for this path
        (SaaS contract treats enabled as on; display follows subscription.plan).
        """
        api = TenantListApi()
        method = inspect.unwrap(api.get)

        tenant1 = make_tenant("t1", name="Tenant 1")
        tenant2 = make_tenant("t2", name="Tenant 2")

        features_t2 = MagicMock()
        features_t2.billing.enabled = False
        features_t2.billing.subscription.plan = CloudPlan.PROFESSIONAL
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[(tenant1, make_membership()), (tenant2, make_membership())],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", True),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "CLOUD"),
            patch(
                "controllers.console.workspace.workspace.BillingService.get_plan_bulk",
                return_value={"t1": {"plan": CloudPlan.TEAM, "expiration_date": 0}},
            ) as get_plan_bulk_mock,
            patch(
                "controllers.console.workspace.workspace.FeatureService.get_features",
                return_value=features_t2,
            ) as get_features_mock,
        ):
            result, status = method(api, "t1", user)

        assert status == 200
        assert result["workspaces"][0]["plan"] == CloudPlan.TEAM
        assert result["workspaces"][1]["plan"] == CloudPlan.PROFESSIONAL
        get_plan_bulk_mock.assert_called_once_with(["t1", "t2"])
        get_features_mock.assert_called_once_with("t2", exclude_vector_space=True)

    def test_get_saas_path_falls_back_to_legacy_feature_path_on_bulk_error(
        self, app: Flask, caplog: pytest.LogCaptureFixture
    ):
        """Test fallback to FeatureService when bulk billing returns empty result.

        BillingService.get_plan_bulk catches exceptions internally and returns empty dict,
        so we simulate the real failure mode by returning empty dict for non-empty input.
        """
        api = TenantListApi()
        method = inspect.unwrap(api.get)

        tenant1 = make_tenant("t1", name="Tenant 1")
        tenant2 = make_tenant("t2", name="Tenant 2")

        features = MagicMock()
        features.billing.enabled = False
        features.billing.subscription.plan = CloudPlan.TEAM
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            caplog.at_level(logging.WARNING, logger="controllers.console.workspace.workspace"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[(tenant1, make_membership()), (tenant2, make_membership())],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", True),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "CLOUD"),
            patch(
                "controllers.console.workspace.workspace.BillingService.get_plan_bulk",
                return_value={},  # Simulates real failure: empty result for non-empty input
            ) as get_plan_bulk_mock,
            patch(
                "controllers.console.workspace.workspace.FeatureService.get_features",
                return_value=features,
            ) as get_features_mock,
        ):
            result, status = method(api, "t2", user)

        assert status == 200
        assert result["workspaces"][0]["plan"] == CloudPlan.TEAM
        assert result["workspaces"][1]["plan"] == CloudPlan.TEAM
        get_plan_bulk_mock.assert_called_once_with(["t1", "t2"])
        assert get_features_mock.call_count == 2
        assert "get_plan_bulk returned empty result, falling back to legacy feature path" in caplog.messages

    def test_get_billing_disabled_community_path(self, app: Flask):
        api = TenantListApi()
        method = inspect.unwrap(api.get)

        tenant = make_tenant("t1", name="Tenant")

        features = MagicMock()
        features.billing.enabled = False
        features.billing.subscription.plan = CloudPlan.SANDBOX
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[(tenant, make_membership())],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "SELF_HOSTED"),
            patch(
                "controllers.console.workspace.workspace.FeatureService.get_features",
                return_value=features,
            ) as get_features_mock,
        ):
            result, status = method(api, "t1", user)

        assert status == 200
        assert result["workspaces"][0]["plan"] == CloudPlan.SANDBOX
        get_features_mock.assert_called_once_with("t1", exclude_vector_space=True)

    def test_get_enterprise_only_skips_feature_service(self, app: Flask):
        api = TenantListApi()
        method = inspect.unwrap(api.get)

        tenant1 = make_tenant("t1", name="Tenant 1")
        tenant2 = make_tenant("t2", name="Tenant 2")
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[(tenant1, make_membership()), (tenant2, make_membership())],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "SELF_HOSTED"),
            patch("controllers.console.workspace.workspace.FeatureService.get_features") as get_features_mock,
        ):
            result, status = method(api, "t2", user)

        assert status == 200
        assert result["workspaces"][0]["plan"] == CloudPlan.SANDBOX
        assert result["workspaces"][1]["plan"] == CloudPlan.SANDBOX
        assert result["workspaces"][0]["current"] is False
        assert result["workspaces"][1]["current"] is True
        get_features_mock.assert_not_called()

    def test_get_enterprise_only_with_empty_tenants(self, app: Flask):
        api = TenantListApi()
        method = inspect.unwrap(api.get)
        user = make_account()

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_workspaces_for_account",
                return_value=[],
            ),
            patch("controllers.console.workspace.workspace.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.workspace.dify_config.BILLING_ENABLED", False),
            patch("controllers.console.workspace.workspace.dify_config.EDITION", "SELF_HOSTED"),
            patch("controllers.console.workspace.workspace.FeatureService.get_features") as get_features_mock,
        ):
            result, status = method(api, None, user)

        assert status == 200
        assert result["workspaces"] == []
        get_features_mock.assert_not_called()


class TestWorkspaceListApi:
    def test_get_success(self, app: Flask):
        api = WorkspaceListApi()
        method = inspect.unwrap(api.get)

        tenant = make_tenant("t1", name="T")
        paginate_result = MagicMock(items=[tenant], has_next=False, total=1)

        with (
            app.test_request_context("/all-workspaces", query_string={"page": 1, "limit": 20}),
            patch("controllers.console.workspace.workspace.paginate_query", return_value=paginate_result),
        ):
            result, status = method(api)

        assert status == 200
        assert result["total"] == 1
        assert result["has_more"] is False

    def test_get_has_next_true(self, app: Flask):
        api = WorkspaceListApi()
        method = inspect.unwrap(api.get)

        tenant = make_tenant("t1", name="T")
        paginate_result = MagicMock(items=[tenant], has_next=True, total=10)

        with (
            app.test_request_context("/all-workspaces", query_string={"page": 1, "limit": 1}),
            patch("controllers.console.workspace.workspace.paginate_query", return_value=paginate_result),
        ):
            result, status = method(api)

        assert status == 200
        assert result["has_more"] is True


class TestTenantApi:
    def test_post_active_tenant(self, app: Flask):
        api = TenantApi()
        method = inspect.unwrap(api.post)

        tenant = make_tenant()
        user = make_account_with_tenant(tenant)

        with (
            app.test_request_context("/workspaces/current"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t1"}
            ),
        ):
            result, status = method(api, user)

        assert status == 200
        assert result["id"] == "t1"

    def test_post_archived_with_switch(self, app: Flask):
        api = TenantApi()
        method = inspect.unwrap(api.post)

        archived = make_tenant(status=TenantStatus.ARCHIVE)
        new_tenant = make_tenant("new")
        user = make_account_with_tenant(archived)

        with (
            app.test_request_context("/workspaces/current"),
            patch("controllers.console.workspace.workspace.TenantService.get_join_tenants", return_value=[new_tenant]),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "new"}
            ),
        ):
            result, status = method(api, user)

        assert result["id"] == "new"

    def test_post_archived_no_tenant(self, app: Flask):
        api = TenantApi()
        method = inspect.unwrap(api.post)

        user = make_account_with_tenant(make_tenant(status=TenantStatus.ARCHIVE))

        with (
            app.test_request_context("/workspaces/current"),
            patch("controllers.console.workspace.workspace.TenantService.get_join_tenants", return_value=[]),
        ):
            with pytest.raises(Unauthorized):
                method(api, user)

    def test_post_info_path(self, app: Flask, caplog: pytest.LogCaptureFixture):
        api = TenantApi()
        method = inspect.unwrap(api.post)

        tenant = make_tenant()
        user = make_account_with_tenant(tenant)

        with (
            app.test_request_context("/info"),
            caplog.at_level(logging.WARNING, logger="controllers.console.workspace.workspace"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info",
                return_value={"id": "t1"},
            ),
        ):
            result, status = method(api, user)

        assert "Deprecated URL /info was used." in caplog.messages
        assert status == 200


class TestTenantInfoResponse:
    def test_tenant_info_response_normalizes_enum_and_datetime(self):
        created_at = naive_utc_now()
        payload = TenantInfoResponse.model_validate(
            {
                "id": "t1",
                "status": TenantStatus.NORMAL,
                "plan": CloudPlan.TEAM,
                "created_at": created_at,
            }
        ).model_dump(mode="json")

        assert payload["status"] == "normal"
        assert payload["plan"] == "team"
        assert payload["created_at"] == int(created_at.timestamp())

    def test_tenant_info_response_has_typed_custom_config(self):
        payload = TenantInfoResponse.model_validate(
            {
                "id": "t1",
                "custom_config": {
                    "remove_webapp_brand": True,
                    "replace_webapp_logo": "logo-file-id",
                    "ignored": "value",
                },
            }
        ).model_dump(mode="json")

        assert payload["custom_config"] == {
            "remove_webapp_brand": True,
            "replace_webapp_logo": "logo-file-id",
        }


class TestSwitchWorkspaceApi:
    def test_switch_success(self, app: Flask):
        api = SwitchWorkspaceApi()
        method = inspect.unwrap(api.post)

        payload = {"tenant_id": "t2"}
        tenant = make_tenant("t2")
        user = make_account()

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch("controllers.console.workspace.workspace.db.session.get") as get_mock,
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t2"}
            ),
        ):
            get_mock.return_value = tenant
            result = method(api, user)

        assert result["result"] == "success"

    def test_switch_not_linked(self, app: Flask):
        api = SwitchWorkspaceApi()
        method = inspect.unwrap(api.post)

        payload = {"tenant_id": "bad"}
        user = make_account()

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant", side_effect=Exception),
        ):
            with pytest.raises(AccountNotLinkTenantError):
                method(api, user)

    def test_switch_tenant_not_found(self, app: Flask):
        api = SwitchWorkspaceApi()
        method = inspect.unwrap(api.post)

        payload = {"tenant_id": "missing"}
        user = make_account()

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch("controllers.console.workspace.workspace.db.session.get") as get_mock,
        ):
            get_mock.return_value = None

            with pytest.raises(ValueError):
                method(api, user)


class TestCustomConfigWorkspaceApi:
    def test_post_success(self, app: Flask):
        api = CustomConfigWorkspaceApi()
        method = inspect.unwrap(api.post)

        tenant = make_tenant(custom_config={})

        payload = {"remove_webapp_brand": True}

        with (
            app.test_request_context("/workspaces/custom-config", json=payload),
            patch("controllers.console.workspace.workspace.db.get_or_404", return_value=tenant),
            patch("controllers.console.workspace.workspace.db.session.commit"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t1"}
            ),
        ):
            result = method(api, "t1")

        assert result["result"] == "success"

    def test_logo_fallback(self, app: Flask):
        api = CustomConfigWorkspaceApi()
        method = inspect.unwrap(api.post)

        tenant = make_tenant(custom_config={"replace_webapp_logo": "old-logo"})

        payload = {"remove_webapp_brand": False}

        with (
            app.test_request_context("/workspaces/custom-config", json=payload),
            patch(
                "controllers.console.workspace.workspace.db.get_or_404",
                return_value=tenant,
            ),
            patch("controllers.console.workspace.workspace.db.session.commit"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info",
                return_value={"id": "t1"},
            ),
        ):
            result = method(api, "t1")

        assert tenant.custom_config_dict["replace_webapp_logo"] == "old-logo"
        assert result["result"] == "success"


class TestWebappLogoWorkspaceApi:
    def test_no_file(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)
        user = make_account()

        with app.test_request_context("/upload", data={}):
            with pytest.raises(NoFileUploadedError):
                method(api, user)

    def test_too_many_files(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        data = {
            "file": MagicMock(),
            "extra": MagicMock(),
        }
        user = make_account()

        with app.test_request_context("/upload", data=data):
            with pytest.raises(TooManyFilesError):
                method(api, user)

    def test_invalid_extension(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        file = MagicMock(filename="test.txt")
        user = make_account()

        with app.test_request_context("/upload", data={"file": file}):
            with pytest.raises(UnsupportedFileTypeError):
                method(api, user)

    def test_upload_success(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"data"),
            filename="logo.png",
            content_type="image/png",
        )

        upload = MagicMock(id="file1")
        user = make_account()

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.return_value = upload

            result, status = method(api, user)

        assert status == 201
        assert result == {"id": "file1"}
        assert WorkspaceLogoUploadResponse.model_validate(result).model_dump(mode="json") == {"id": "file1"}

    def test_filename_missing(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"data"),
            filename="",
            content_type="image/png",
        )
        user = make_account()

        with app.test_request_context(
            "/upload",
            data={"file": file},
            content_type="multipart/form-data",
        ):
            with pytest.raises(FilenameNotExistsError):
                method(api, user)

    def test_file_too_large(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"x"),
            filename="logo.png",
            content_type="image/png",
        )
        user = make_account()

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.side_effect = services.errors.file.FileTooLargeError("too big")

            with pytest.raises(FileTooLargeError):
                method(api, user)

    def test_service_unsupported_file(self, app: Flask):
        api = WebappLogoWorkspaceApi()
        method = inspect.unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"x"),
            filename="logo.png",
            content_type="image/png",
        )
        user = make_account()

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.side_effect = services.errors.file.UnsupportedFileTypeError()

            with pytest.raises(UnsupportedFileTypeError):
                method(api, user)


class TestWorkspaceInfoApi:
    def test_post_success(self, app: Flask):
        api = WorkspaceInfoApi()
        method = inspect.unwrap(api.post)

        tenant = make_tenant()

        payload = {"name": "New Name"}

        with (
            app.test_request_context("/workspaces/info", json=payload),
            patch("controllers.console.workspace.workspace.db.get_or_404", return_value=tenant),
            patch("controllers.console.workspace.workspace.db.session.commit"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info",
                return_value={"id": "t1", "name": "New Name"},
            ),
        ):
            result = method(api, "t1")

        assert result["result"] == "success"

    def test_no_current_tenant(self, app: Flask):
        api = WorkspaceInfoApi()
        method = inspect.unwrap(api.post)

        payload = {"name": "X"}

        with (
            app.test_request_context("/workspaces/info", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api, None)


class TestWorkspacePermissionApi:
    def test_get_success(self, app: Flask):
        api = WorkspacePermissionApi()
        method = inspect.unwrap(api.get)

        permission = MagicMock(
            workspace_id="t1",
            allow_member_invite=True,
            allow_owner_transfer=False,
        )

        with (
            app.test_request_context("/permission"),
            patch(
                "controllers.console.workspace.workspace.EnterpriseService.WorkspacePermissionService.get_permission",
                return_value=permission,
            ),
        ):
            result, status = method(api, "t1")

        assert status == 200
        expected = {
            "workspace_id": "t1",
            "allow_member_invite": True,
            "allow_owner_transfer": False,
        }
        assert result == expected
        assert WorkspacePermissionResponse.model_validate(result).model_dump(mode="json") == expected

    def test_no_current_tenant(self, app: Flask):
        api = WorkspacePermissionApi()
        method = inspect.unwrap(api.get)

        with app.test_request_context("/permission"):
            with pytest.raises(ValueError):
                method(api, None)
