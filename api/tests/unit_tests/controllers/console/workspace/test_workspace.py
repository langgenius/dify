from datetime import datetime
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
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
    TenantListApi,
    WebappLogoWorkspaceApi,
    WorkspaceInfoApi,
    WorkspaceListApi,
    WorkspacePermissionApi,
)
from enums.cloud_plan import CloudPlan
from models.account import TenantStatus


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestTenantListApi:
    def test_get_success(self, app):
        api = TenantListApi()
        method = unwrap(api.get)

        tenant1 = MagicMock(
            id="t1",
            name="Tenant 1",
            status="active",
            created_at=datetime.utcnow(),
        )
        tenant2 = MagicMock(
            id="t2",
            name="Tenant 2",
            status="active",
            created_at=datetime.utcnow(),
        )

        features = MagicMock()
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.SANDBOX

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_join_tenants",
                return_value=[tenant1, tenant2],
            ),
            patch("controllers.console.workspace.workspace.FeatureService.get_features", return_value=features),
        ):
            result, status = method(api)

        assert status == 200
        assert len(result["workspaces"]) == 2
        assert result["workspaces"][0]["current"] is True

    def test_get_billing_disabled(self, app):
        api = TenantListApi()
        method = unwrap(api.get)

        tenant = MagicMock(
            id="t1",
            name="Tenant",
            status="active",
            created_at=datetime.utcnow(),
        )

        features = MagicMock()
        features.billing.enabled = False

        with (
            app.test_request_context("/workspaces"),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
            patch(
                "controllers.console.workspace.workspace.TenantService.get_join_tenants",
                return_value=[tenant],
            ),
            patch(
                "controllers.console.workspace.workspace.FeatureService.get_features",
                return_value=features,
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert result["workspaces"][0]["plan"] == CloudPlan.SANDBOX


class TestWorkspaceListApi:
    def test_get_success(self, app):
        api = WorkspaceListApi()
        method = unwrap(api.get)

        tenant = MagicMock(id="t1", name="T", status="active", created_at=datetime.utcnow())

        paginate_result = MagicMock(
            items=[tenant],
            has_next=False,
            total=1,
        )

        with (
            app.test_request_context("/all-workspaces", query_string={"page": 1, "limit": 20}),
            patch("controllers.console.workspace.workspace.db.paginate", return_value=paginate_result),
        ):
            result, status = method(api)

        assert status == 200
        assert result["total"] == 1
        assert result["has_more"] is False

    def test_get_has_next_true(self, app):
        api = WorkspaceListApi()
        method = unwrap(api.get)

        tenant = MagicMock(
            id="t1",
            name="T",
            status="active",
            created_at=datetime.utcnow(),
        )

        paginate_result = MagicMock(
            items=[tenant],
            has_next=True,
            total=10,
        )

        with (
            app.test_request_context("/all-workspaces", query_string={"page": 1, "limit": 1}),
            patch(
                "controllers.console.workspace.workspace.db.paginate",
                return_value=paginate_result,
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert result["has_more"] is True


class TestTenantApi:
    def test_post_active_tenant(self, app):
        api = TenantApi()
        method = unwrap(api.post)

        tenant = MagicMock(status="active")

        user = MagicMock(current_tenant=tenant)

        with (
            app.test_request_context("/workspaces/current"),
            patch("controllers.console.workspace.workspace.current_account_with_tenant", return_value=(user, "t1")),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t1"}
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert result["id"] == "t1"

    def test_post_archived_with_switch(self, app):
        api = TenantApi()
        method = unwrap(api.post)

        archived = MagicMock(status=TenantStatus.ARCHIVE)
        new_tenant = MagicMock(status="active")

        user = MagicMock(current_tenant=archived)

        with (
            app.test_request_context("/workspaces/current"),
            patch("controllers.console.workspace.workspace.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.workspace.TenantService.get_join_tenants", return_value=[new_tenant]),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "new"}
            ),
        ):
            result, status = method(api)

        assert result["id"] == "new"

    def test_post_archived_no_tenant(self, app):
        api = TenantApi()
        method = unwrap(api.post)

        user = MagicMock(current_tenant=MagicMock(status=TenantStatus.ARCHIVE))

        with (
            app.test_request_context("/workspaces/current"),
            patch("controllers.console.workspace.workspace.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.workspace.TenantService.get_join_tenants", return_value=[]),
        ):
            with pytest.raises(Unauthorized):
                method(api)

    def test_post_info_path(self, app):
        api = TenantApi()
        method = unwrap(api.post)

        tenant = MagicMock(status="active")
        user = MagicMock(current_tenant=tenant)

        with (
            app.test_request_context("/info"),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(user, "t1"),
            ),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info",
                return_value={"id": "t1"},
            ),
            patch("controllers.console.workspace.workspace.logger.warning") as warn_mock,
        ):
            result, status = method(api)

        warn_mock.assert_called_once()
        assert status == 200


class TestSwitchWorkspaceApi:
    def test_switch_success(self, app):
        api = SwitchWorkspaceApi()
        method = unwrap(api.post)

        payload = {"tenant_id": "t2"}
        tenant = MagicMock(id="t2")

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch("controllers.console.workspace.workspace.db.session.query") as query_mock,
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t2"}
            ),
        ):
            query_mock.return_value.get.return_value = tenant
            result = method(api)

        assert result["result"] == "success"

    def test_switch_not_linked(self, app):
        api = SwitchWorkspaceApi()
        method = unwrap(api.post)

        payload = {"tenant_id": "bad"}

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant", side_effect=Exception),
        ):
            with pytest.raises(AccountNotLinkTenantError):
                method(api)

    def test_switch_tenant_not_found(self, app):
        api = SwitchWorkspaceApi()
        method = unwrap(api.post)

        payload = {"tenant_id": "missing"}

        with (
            app.test_request_context("/workspaces/switch", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
            patch("controllers.console.workspace.workspace.TenantService.switch_tenant"),
            patch("controllers.console.workspace.workspace.db.session.query") as query_mock,
        ):
            query_mock.return_value.get.return_value = None

            with pytest.raises(ValueError):
                method(api)


class TestCustomConfigWorkspaceApi:
    def test_post_success(self, app):
        api = CustomConfigWorkspaceApi()
        method = unwrap(api.post)

        tenant = MagicMock(custom_config_dict={})

        payload = {"remove_webapp_brand": True}

        with (
            app.test_request_context("/workspaces/custom-config", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch("controllers.console.workspace.workspace.db.get_or_404", return_value=tenant),
            patch("controllers.console.workspace.workspace.db.session.commit"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info", return_value={"id": "t1"}
            ),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_logo_fallback(self, app):
        api = CustomConfigWorkspaceApi()
        method = unwrap(api.post)

        tenant = MagicMock(custom_config_dict={"replace_webapp_logo": "old-logo"})

        payload = {"remove_webapp_brand": False}

        with (
            app.test_request_context("/workspaces/custom-config", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
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
            result = method(api)

        assert tenant.custom_config_dict["replace_webapp_logo"] == "old-logo"
        assert result["result"] == "success"


class TestWebappLogoWorkspaceApi:
    def test_no_file(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/upload", data={}),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
        ):
            with pytest.raises(NoFileUploadedError):
                method(api)

    def test_too_many_files(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        data = {
            "file": MagicMock(),
            "extra": MagicMock(),
        }

        with (
            app.test_request_context("/upload", data=data),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
        ):
            with pytest.raises(TooManyFilesError):
                method(api)

    def test_invalid_extension(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        file = MagicMock(filename="test.txt")

        with (
            app.test_request_context("/upload", data={"file": file}),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
        ):
            with pytest.raises(UnsupportedFileTypeError):
                method(api)

    def test_upload_success(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"data"),
            filename="logo.png",
            content_type="image/png",
        )

        upload = MagicMock(id="file1")

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.return_value = upload

            result, status = method(api)

        assert status == 201
        assert result["id"] == "file1"

    def test_filename_missing(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"data"),
            filename="",
            content_type="image/png",
        )

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
        ):
            with pytest.raises(FilenameNotExistsError):
                method(api)

    def test_file_too_large(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"x"),
            filename="logo.png",
            content_type="image/png",
        )

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.side_effect = services.errors.file.FileTooLargeError("too big")

            with pytest.raises(FileTooLargeError):
                method(api)

    def test_service_unsupported_file(self, app):
        api = WebappLogoWorkspaceApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=BytesIO(b"x"),
            filename="logo.png",
            content_type="image/png",
        )

        with (
            app.test_request_context(
                "/upload",
                data={"file": file},
                content_type="multipart/form-data",
            ),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), "t1"),
            ),
            patch("controllers.console.workspace.workspace.FileService") as fs,
            patch("controllers.console.workspace.workspace.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            fs.return_value.upload_file.side_effect = services.errors.file.UnsupportedFileTypeError()

            with pytest.raises(UnsupportedFileTypeError):
                method(api)


class TestWorkspaceInfoApi:
    def test_post_success(self, app):
        api = WorkspaceInfoApi()
        method = unwrap(api.post)

        tenant = MagicMock()

        payload = {"name": "New Name"}

        with (
            app.test_request_context("/workspaces/info", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch("controllers.console.workspace.workspace.db.get_or_404", return_value=tenant),
            patch("controllers.console.workspace.workspace.db.session.commit"),
            patch(
                "controllers.console.workspace.workspace.WorkspaceService.get_tenant_info",
                return_value={"name": "New Name"},
            ),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_no_current_tenant(self, app):
        api = WorkspaceInfoApi()
        method = unwrap(api.post)

        payload = {"name": "X"}

        with (
            app.test_request_context("/workspaces/info", json=payload),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), None),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestWorkspacePermissionApi:
    def test_get_success(self, app):
        api = WorkspacePermissionApi()
        method = unwrap(api.get)

        permission = MagicMock(
            workspace_id="t1",
            allow_member_invite=True,
            allow_owner_transfer=False,
        )

        with (
            app.test_request_context("/permission"),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch(
                "controllers.console.workspace.workspace.EnterpriseService.WorkspacePermissionService.get_permission",
                return_value=permission,
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert result["workspace_id"] == "t1"

    def test_no_current_tenant(self, app):
        api = WorkspacePermissionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/permission"),
            patch(
                "controllers.console.workspace.workspace.current_account_with_tenant",
                return_value=(MagicMock(), None),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)
