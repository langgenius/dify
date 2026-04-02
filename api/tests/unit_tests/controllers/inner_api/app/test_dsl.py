"""Unit tests for inner_api app DSL import/export endpoints.

Tests Pydantic model validation, endpoint handler logic, and the
_get_active_account helper. Auth/setup decorators are tested separately
in test_auth_wraps.py; handler tests use inspect.unwrap() to bypass them.
"""

import inspect
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.inner_api.app.dsl import (
    EnterpriseAppDSLExport,
    EnterpriseAppDSLImport,
    InnerAppDSLImportPayload,
    _get_active_account,
)
from services.app_dsl_service import ImportStatus


class TestInnerAppDSLImportPayload:
    """Test InnerAppDSLImportPayload Pydantic model validation."""

    def test_valid_payload_all_fields(self):
        data = {
            "yaml_content": "version: 0.6.0\nkind: app\n",
            "creator_email": "user@example.com",
            "name": "My App",
            "description": "A test app",
        }
        payload = InnerAppDSLImportPayload.model_validate(data)
        assert payload.yaml_content == data["yaml_content"]
        assert payload.creator_email == "user@example.com"
        assert payload.name == "My App"
        assert payload.description == "A test app"

    def test_valid_payload_optional_fields_omitted(self):
        data = {
            "yaml_content": "version: 0.6.0\n",
            "creator_email": "user@example.com",
        }
        payload = InnerAppDSLImportPayload.model_validate(data)
        assert payload.name is None
        assert payload.description is None

    def test_missing_yaml_content_fails(self):
        with pytest.raises(ValidationError) as exc_info:
            InnerAppDSLImportPayload.model_validate({"creator_email": "a@b.com"})
        assert "yaml_content" in str(exc_info.value)

    def test_missing_creator_email_fails(self):
        with pytest.raises(ValidationError) as exc_info:
            InnerAppDSLImportPayload.model_validate({"yaml_content": "test"})
        assert "creator_email" in str(exc_info.value)


class TestGetActiveAccount:
    """Test the _get_active_account helper function."""

    @patch("controllers.inner_api.app.dsl.db")
    def test_returns_active_account(self, mock_db):
        mock_account = MagicMock()
        mock_account.status = "active"
        mock_db.session.scalar.return_value = mock_account

        result = _get_active_account("user@example.com")

        assert result is mock_account
        mock_db.session.scalar.assert_called_once()

    @patch("controllers.inner_api.app.dsl.db")
    def test_returns_none_for_inactive_account(self, mock_db):
        mock_account = MagicMock()
        mock_account.status = "banned"
        mock_db.session.scalar.return_value = mock_account

        result = _get_active_account("banned@example.com")

        assert result is None

    @patch("controllers.inner_api.app.dsl.db")
    def test_returns_none_for_nonexistent_email(self, mock_db):
        mock_db.session.scalar.return_value = None

        result = _get_active_account("missing@example.com")

        assert result is None


class TestEnterpriseAppDSLImport:
    """Test EnterpriseAppDSLImport endpoint handler logic.

    Uses inspect.unwrap() to bypass auth/setup decorators.
    """

    @pytest.fixture
    def api_instance(self):
        return EnterpriseAppDSLImport()

    @pytest.fixture
    def _mock_import_deps(self):
        """Patch db, Session, and AppDslService for import handler tests."""
        with (
            patch("controllers.inner_api.app.dsl.db"),
            patch("controllers.inner_api.app.dsl.Session") as mock_session,
            patch("controllers.inner_api.app.dsl.AppDslService") as mock_dsl_cls,
        ):
            mock_session.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_session.return_value.__exit__ = MagicMock(return_value=False)
            self._mock_dsl = MagicMock()
            mock_dsl_cls.return_value = self._mock_dsl
            yield

    def _make_import_result(self, status: ImportStatus, **kwargs) -> "Import":
        from services.app_dsl_service import Import

        result = Import(
            id="import-id",
            status=status,
            app_id=kwargs.get("app_id", "app-123"),
            app_mode=kwargs.get("app_mode", "workflow"),
        )
        return result

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_success_returns_200(self, mock_get_account, api_instance, app: Flask):
        mock_account = MagicMock()
        mock_get_account.return_value = mock_account
        self._mock_dsl.import_app.return_value = self._make_import_result(ImportStatus.COMPLETED)

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {
                    "yaml_content": "version: 0.6.0\n",
                    "creator_email": "user@example.com",
                }
                result = unwrapped(api_instance, workspace_id="ws-123")

        body, status_code = result
        assert status_code == 200
        assert body["status"] == "completed"
        mock_account.set_tenant_id.assert_called_once_with("ws-123")

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_pending_returns_202(self, mock_get_account, api_instance, app: Flask):
        mock_get_account.return_value = MagicMock()
        self._mock_dsl.import_app.return_value = self._make_import_result(ImportStatus.PENDING)

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {"yaml_content": "test", "creator_email": "u@e.com"}
                body, status_code = unwrapped(api_instance, workspace_id="ws-123")

        assert status_code == 202
        assert body["status"] == "pending"

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_failed_returns_400(self, mock_get_account, api_instance, app: Flask):
        mock_get_account.return_value = MagicMock()
        self._mock_dsl.import_app.return_value = self._make_import_result(ImportStatus.FAILED)

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {"yaml_content": "test", "creator_email": "u@e.com"}
                body, status_code = unwrapped(api_instance, workspace_id="ws-123")

        assert status_code == 400
        assert body["status"] == "failed"

    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_account_not_found_returns_404(self, mock_get_account, api_instance, app: Flask):
        mock_get_account.return_value = None

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {"yaml_content": "test", "creator_email": "missing@e.com"}
                result = unwrapped(api_instance, workspace_id="ws-123")

        body, status_code = result
        assert status_code == 404
        assert "missing@e.com" in body["message"]


class TestEnterpriseAppDSLExport:
    """Test EnterpriseAppDSLExport endpoint handler logic.

    Uses inspect.unwrap() to bypass auth/setup decorators.
    """

    @pytest.fixture
    def api_instance(self):
        return EnterpriseAppDSLExport()

    @patch("controllers.inner_api.app.dsl.AppDslService")
    @patch("controllers.inner_api.app.dsl.db")
    def test_export_success_returns_200(self, mock_db, mock_dsl_cls, api_instance, app: Flask):
        mock_app = MagicMock()
        mock_db.session.get.return_value = mock_app
        mock_dsl_cls.export_dsl.return_value = "version: 0.6.0\nkind: app\n"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=false"):
            result = unwrapped(api_instance, app_id="app-123")

        body, status_code = result
        assert status_code == 200
        assert body["data"] == "version: 0.6.0\nkind: app\n"
        mock_dsl_cls.export_dsl.assert_called_once_with(app_model=mock_app, include_secret=False)

    @patch("controllers.inner_api.app.dsl.AppDslService")
    @patch("controllers.inner_api.app.dsl.db")
    def test_export_with_secret(self, mock_db, mock_dsl_cls, api_instance, app: Flask):
        mock_app = MagicMock()
        mock_db.session.get.return_value = mock_app
        mock_dsl_cls.export_dsl.return_value = "yaml-data"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=true"):
            result = unwrapped(api_instance, app_id="app-123")

        body, status_code = result
        assert status_code == 200
        mock_dsl_cls.export_dsl.assert_called_once_with(app_model=mock_app, include_secret=True)

    @patch("controllers.inner_api.app.dsl.db")
    def test_export_app_not_found_returns_404(self, mock_db, api_instance, app: Flask):
        mock_db.session.get.return_value = None

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=false"):
            result = unwrapped(api_instance, app_id="nonexistent")

        body, status_code = result
        assert status_code == 404
        assert "app not found" in body["message"]
