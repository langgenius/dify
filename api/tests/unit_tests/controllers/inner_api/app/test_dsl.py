"""Unit tests for inner_api app DSL import/export endpoints.

Tests Pydantic model validation, endpoint handler logic, and the
_get_active_account helper. Auth/setup decorators are tested separately
in test_auth_wraps.py; handler tests use inspect.unwrap() to bypass them.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.inner_api.app import dsl as dsl_module
from controllers.inner_api.app.dsl import (
    EnterpriseAppDSLExport,
    EnterpriseAppDSLImport,
    InnerAppDSLImportPayload,
    _get_active_account,
)
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.model import AppMode, IconType
from services.app_dsl_service import Import, ImportStatus
from services.errors.app import IsDraftWorkflowError, WorkflowNotFoundError


def _persist_app(session: Session) -> App:
    app = App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="DSL App",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


def _persist_account(session: Session, *, workspace_id: str = "ws-123") -> Account:
    account = Account(name="DSL Creator", email="user@example.com", status=AccountStatus.ACTIVE)
    tenant = Tenant(name="DSL Workspace")
    tenant.id = workspace_id
    session.add_all([account, tenant])
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.OWNER,
        )
    )
    session.commit()
    return account


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

    def test_returns_active_account(self, sqlite_session: Session):
        account = Account(name="Active", email="user@example.com", status=AccountStatus.ACTIVE)
        sqlite_session.add(account)
        sqlite_session.commit()

        with patch.object(dsl_module.db, "session", sqlite_session):
            result = _get_active_account("user@example.com")

        assert result is account

    def test_returns_none_for_inactive_account(self, sqlite_session: Session):
        account = Account(name="Banned", email="banned@example.com", status=AccountStatus.BANNED)
        sqlite_session.add(account)
        sqlite_session.commit()

        with patch.object(dsl_module.db, "session", sqlite_session):
            result = _get_active_account("banned@example.com")

        assert result is None

    def test_returns_none_for_nonexistent_email(self, sqlite_session: Session):
        with patch.object(dsl_module.db, "session", sqlite_session):
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
    def _mock_import_deps(self, sqlite_engine: Engine):
        """Bind the handler Session to SQLite and isolate the DSL service boundary."""
        self._transaction_events: list[str] = []

        def on_commit(session: Session) -> None:
            if session.get_bind() is sqlite_engine:
                self._transaction_events.append("commit")

        def on_rollback(session: Session) -> None:
            if session.get_bind() is sqlite_engine:
                self._transaction_events.append("rollback")

        event.listen(Session, "after_commit", on_commit)
        event.listen(Session, "after_rollback", on_rollback)
        with (
            patch.object(dsl_module, "db", SimpleNamespace(engine=sqlite_engine)),
            patch("controllers.inner_api.app.dsl.AppDslService") as mock_dsl_cls,
        ):
            self._mock_dsl = MagicMock()
            mock_dsl_cls.return_value = self._mock_dsl
            yield
        event.remove(Session, "after_commit", on_commit)
        event.remove(Session, "after_rollback", on_rollback)

    def _make_import_result(self, status: ImportStatus, **kwargs) -> Import:
        result = Import(
            id="import-id",
            status=status,
            app_id=kwargs.get("app_id", "app-123"),
            app_mode=kwargs.get("app_mode", "workflow"),
        )
        return result

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_success_returns_200(self, mock_get_account, api_instance, app: Flask, sqlite_session: Session):
        account = _persist_account(sqlite_session)
        self._transaction_events.clear()
        mock_get_account.return_value = account
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
        assert account.current_tenant_id == "ws-123"
        assert self._mock_dsl.import_app.call_args.kwargs["account"] is account
        assert self._transaction_events == ["commit"]

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_pending_returns_202(self, mock_get_account, api_instance, app: Flask, sqlite_session: Session):
        mock_get_account.return_value = _persist_account(sqlite_session)
        self._transaction_events.clear()
        self._mock_dsl.import_app.return_value = self._make_import_result(ImportStatus.PENDING)

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {"yaml_content": "test", "creator_email": "u@e.com"}
                body, status_code = unwrapped(api_instance, workspace_id="ws-123")

        assert status_code == 202
        assert body["status"] == "pending"
        assert self._transaction_events == ["commit"]

    @pytest.mark.usefixtures("_mock_import_deps")
    @patch("controllers.inner_api.app.dsl._get_active_account")
    def test_import_failed_returns_400(self, mock_get_account, api_instance, app: Flask, sqlite_session: Session):
        mock_get_account.return_value = _persist_account(sqlite_session)
        self._transaction_events.clear()
        self._mock_dsl.import_app.return_value = self._make_import_result(ImportStatus.FAILED)

        unwrapped = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.app.dsl.inner_api_ns") as mock_ns:
                mock_ns.payload = {"yaml_content": "test", "creator_email": "u@e.com"}
                body, status_code = unwrapped(api_instance, workspace_id="ws-123")

        assert status_code == 400
        assert body["status"] == "failed"
        assert self._transaction_events == ["rollback"]

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

    def test_export_documents_query_parameters(self):
        params = EnterpriseAppDSLExport.get.__apidoc__["params"]

        assert params["include_secret"]["in"] == "query"
        assert params["include_secret"]["type"] == "boolean"
        assert params["workflow_id"]["in"] == "query"
        assert params["workflow_id"]["type"] == "string"
        assert params["workflow_id"]["format"] == "uuid"

    @pytest.fixture
    def api_instance(self):
        return EnterpriseAppDSLExport()

    @pytest.fixture
    def scoped_db(self, sqlite_session_factory: sessionmaker[Session]):
        db_session = scoped_session(sqlite_session_factory)
        with patch.object(dsl_module, "db", SimpleNamespace(session=db_session)):
            yield db_session
        db_session.remove()

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_success_returns_200(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.return_value = "version: 0.6.0\nkind: app\n"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=false"):
            result = unwrapped(api_instance, app_id=app_model.id)

        body, status_code = result
        assert status_code == 200
        assert body["data"] == "version: 0.6.0\nkind: app\n"
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is False

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_with_secret(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.return_value = "yaml-data"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=true"):
            result = unwrapped(api_instance, app_id=app_model.id)

        body, status_code = result
        assert status_code == 200
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is True

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_selected_workflow_forwards_canonical_uuid(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.return_value = "yaml-data"
        workflow_id = "F1FD7266-56FC-45C7-9D81-A72CD5A1B4F6"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context(f"?workflow_id={workflow_id}"):
            body, status_code = unwrapped(api_instance, app_id=app_model.id)

        assert status_code == 200
        assert body["data"] == "yaml-data"
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is False
        assert call_kwargs["workflow_id"] == "f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6"

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_selected_workflow_with_secret(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.return_value = "yaml-data"
        workflow_id = "f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context(f"?include_secret=true&workflow_id={workflow_id}"):
            body, status_code = unwrapped(api_instance, app_id=app_model.id)

        assert status_code == 200
        assert body["data"] == "yaml-data"
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is True
        assert call_kwargs["workflow_id"] == workflow_id

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_rejects_invalid_selected_workflow_id(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        scoped_db,
    ):
        assert scoped_db() is not None
        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?workflow_id=not-a-uuid"):
            body, status_code = unwrapped(api_instance, app_id=str(uuid4()))

        assert status_code == 400
        assert body == {
            "code": "invalid_workflow_id",
            "message": "workflow_id must be a valid UUID",
            "status": 400,
        }
        mock_dsl_cls.export_dsl.assert_not_called()

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_selected_missing_workflow_returns_404(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.side_effect = WorkflowNotFoundError("selected workflow not found")
        workflow_id = "f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context(f"?workflow_id={workflow_id}"):
            body, status_code = unwrapped(api_instance, app_id=app_model.id)

        assert status_code == 404
        assert body == {
            "code": "workflow_version_not_found",
            "message": "selected workflow not found",
            "status": 404,
        }
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is False
        assert call_kwargs["workflow_id"] == workflow_id

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_selected_draft_workflow_returns_400(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.side_effect = IsDraftWorkflowError("selected workflow is a draft")
        workflow_id = "f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6"

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context(f"?workflow_id={workflow_id}"):
            body, status_code = unwrapped(api_instance, app_id=app_model.id)

        assert status_code == 400
        assert body == {
            "code": "workflow_version_not_published",
            "message": "selected workflow is a draft",
            "status": 400,
        }
        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is False
        assert call_kwargs["workflow_id"] == workflow_id

    @patch("controllers.inner_api.app.dsl.AppDslService")
    def test_export_without_selected_workflow_preserves_workflow_error(
        self,
        mock_dsl_cls,
        api_instance,
        app: Flask,
        sqlite_session: Session,
        scoped_db,
    ):
        app_model = _persist_app(sqlite_session)
        mock_dsl_cls.export_dsl.side_effect = WorkflowNotFoundError(
            "Missing draft workflow configuration, please check."
        )

        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context():
            with pytest.raises(WorkflowNotFoundError, match="Missing draft workflow configuration"):
                unwrapped(api_instance, app_id=app_model.id)

        call_kwargs = mock_dsl_cls.export_dsl.call_args.kwargs
        assert call_kwargs["app_model"].id == app_model.id
        assert call_kwargs["session"] is scoped_db()
        assert call_kwargs["include_secret"] is False
        assert "workflow_id" not in call_kwargs

    def test_export_app_not_found_returns_404(self, api_instance, app: Flask, scoped_db):
        assert scoped_db() is not None
        unwrapped = inspect.unwrap(api_instance.get)
        with app.test_request_context("?include_secret=false"):
            result = unwrapped(api_instance, app_id=str(uuid4()))

        body, status_code = result
        assert status_code == 404
        assert "app not found" in body["message"]
