"""Unit tests for inner_api app DSL import/export endpoints.

Tests Pydantic model validation and endpoint handler logic. Auth/setup decorators are tested separately
in test_auth_wraps.py; handler tests use inspect.unwrap() to bypass them.
"""

import inspect
from typing import Protocol, cast
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import UnprocessableEntity

from controllers.inner_api.app.dsl import (
    EnterpriseAppDSLExport,
    EnterpriseAppDSLImport,
    InnerAppDSLImportPayload,
)
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.model import AppMode
from services.app_dsl_service import AppDslService
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import Import, ImportStatus
from services.errors.app import AppDiscoveryNotFoundError, IsDraftWorkflowError, WorkflowNotFoundError
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.conftest import ControllerTestServices


class DocumentedView(Protocol):
    __apidoc__: dict[str, dict[str, dict[str, object]]]


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

    def test_valid_payload_all_fields(self) -> None:
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

    def test_valid_payload_optional_fields_omitted(self) -> None:
        data = {
            "yaml_content": "version: 0.6.0\n",
            "creator_email": "user@example.com",
        }
        payload = InnerAppDSLImportPayload.model_validate(data)
        assert payload.name is None
        assert payload.description is None

    def test_missing_yaml_content_fails(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            InnerAppDSLImportPayload.model_validate({"creator_email": "a@b.com"})
        assert "yaml_content" in str(exc_info.value)

    def test_missing_creator_email_fails(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            InnerAppDSLImportPayload.model_validate({"yaml_content": "test"})
        assert "creator_email" in str(exc_info.value)


@pytest.mark.usefixtures("app_query_services")
class TestEnterpriseAppDSLImport:
    """Exercise the composed import path with real account and membership reads."""

    @pytest.mark.parametrize(
        ("import_status", "http_status", "transaction"),
        [
            (ImportStatus.COMPLETED, 200, "commit"),
            (ImportStatus.PENDING, 202, "commit"),
            (ImportStatus.FAILED, 400, "rollback"),
        ],
    )
    def test_import_releases_lookup_connections_and_finishes_transaction(
        self,
        app: Flask,
        sqlite_session: Session,
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        import_status: ImportStatus,
        http_status: int,
        transaction: str,
    ) -> None:
        account = _persist_account(sqlite_session)
        account_id = account.id
        sqlite_session.close()
        connections: set[object] = set()
        transactions: list[str] = []

        def checkout(connection: object, *_args: object) -> None:
            connections.add(connection)

        def checkin(connection: object, *_args: object) -> None:
            connections.discard(connection)

        def committed(session: Session) -> None:
            if session.get_bind() is sqlite_engine:
                transactions.append("commit")

        def rolled_back(session: Session) -> None:
            if session.get_bind() is sqlite_engine:
                transactions.append("rollback")

        def import_app(service: AppDslService, *, account: Account, **kwargs: object) -> Import:
            assert not connections
            assert account.id == account_id
            assert account.current_tenant_id == "ws-123"
            assert kwargs["yaml_content"] == "version: 0.6.0\n"
            # Open a real write transaction to verify the adapter's completion policy.
            service._session.add(
                App(tenant_id="ws-123", name="imported", mode=AppMode.WORKFLOW, enable_site=False, enable_api=False)
            )
            service._session.flush()
            return Import(id="import-id", status=import_status, app_id="app-123", app_mode="workflow")

        monkeypatch.setattr(AppDslService, "import_app", import_app)
        listeners = [
            (sqlite_engine, "checkout", checkout),
            (sqlite_engine, "checkin", checkin),
            (Session, "after_commit", committed),
            (Session, "after_rollback", rolled_back),
        ]
        for target, name, callback in listeners:
            event.listen(target, name, callback)
        try:
            payload = InnerAppDSLImportPayload(yaml_content="version: 0.6.0\n", creator_email="user@example.com")
            with app.test_request_context(method="POST", json=payload.model_dump()):
                body, status = inspect.unwrap(EnterpriseAppDSLImport.post)(
                    EnterpriseAppDSLImport(), workspace_id="ws-123"
                )
            assert status == http_status
            assert body["status"] == import_status
            assert transactions == [transaction]
            assert not connections
        finally:
            for target, name, callback in listeners:
                event.remove(target, name, callback)

    @pytest.mark.parametrize("creator_email", ["missing@example.com", "banned@example.com", "USER@example.com"])
    def test_missing_or_inactive_creator_returns_404(
        self,
        app: Flask,
        sqlite_session: Session,
        creator_email: str,
    ) -> None:
        sqlite_session.add_all(
            [
                Account(name="Banned", email="banned@example.com", status=AccountStatus.BANNED),
                Account(name="Active", email="user@example.com", status=AccountStatus.ACTIVE),
            ]
        )
        sqlite_session.commit()
        payload = InnerAppDSLImportPayload(yaml_content="test", creator_email=creator_email)
        with app.test_request_context(method="POST", json=payload.model_dump()):
            body, status = inspect.unwrap(EnterpriseAppDSLImport.post)(EnterpriseAppDSLImport(), workspace_id="ws-123")
        assert status == 404
        assert body == {"message": f"account '{creator_email}' not found or inactive"}


class TestEnterpriseAppDSLExport:
    def test_export_documents_query_parameters(self) -> None:
        params = cast(DocumentedView, EnterpriseAppDSLExport.get).__apidoc__["params"]
        assert params["include_secret"]["in"] == "query"
        assert params["workflow_id"]["in"] == "query"
        assert params["workflow_id"]["format"] == "uuid"

    @pytest.mark.parametrize(
        ("query", "secret", "workflow_id"),
        [
            ("", False, None),
            ("?include_secret=TRUE", True, None),
            ("?include_secret=1", False, None),
            ("?workflow_id=F1FD7266-56FC-45C7-9D81-A72CD5A1B4F6", False, "f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6"),
        ],
    )
    def test_export_parses_options(
        self,
        app: Flask,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
        query: str,
        secret: bool,
        workflow_id: str | None,
    ) -> None:
        calls: list[tuple[str, AppExportOptions]] = []

        def export(app_id: str, options: AppExportOptions) -> str:
            calls.append((app_id, options))
            return "yaml-data"

        monkeypatch.setattr(app_query_services.apps.exports, "export_for_inner", export)
        with app.test_request_context(query):
            result = inspect.unwrap(EnterpriseAppDSLExport.get)(EnterpriseAppDSLExport(), app_id="app-id")
        assert result == ({"data": "yaml-data"}, 200)
        assert calls == [("app-id", AppExportOptions(include_secret=secret, workflow_id=workflow_id))]

    @pytest.mark.parametrize(
        ("error", "query", "expected"),
        [
            (AppDiscoveryNotFoundError(), "", ({"message": "app not found"}, 404)),
            (
                WorkflowNotFoundError("missing"),
                "?workflow_id=f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6",
                ({"code": "workflow_version_not_found", "message": "missing", "status": 404}, 404),
            ),
            (
                IsDraftWorkflowError("draft"),
                "?workflow_id=f1fd7266-56fc-45c7-9d81-a72cd5a1b4f6",
                ({"code": "workflow_version_not_published", "message": "draft", "status": 400}, 400),
            ),
        ],
    )
    def test_export_maps_domain_errors(
        self,
        app: Flask,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
        error: Exception,
        query: str,
        expected: tuple[dict[str, object], int],
    ) -> None:
        def export(*_args: object) -> str:
            raise error

        monkeypatch.setattr(app_query_services.apps.exports, "export_for_inner", export)
        with app.test_request_context(query):
            assert inspect.unwrap(EnterpriseAppDSLExport.get)(EnterpriseAppDSLExport(), app_id="app-id") == expected

    def test_invalid_workflow_id_is_rejected_before_service_lookup(self, app: Flask) -> None:
        with app.test_request_context("?workflow_id=invalid"):
            result = inspect.unwrap(EnterpriseAppDSLExport.get)(EnterpriseAppDSLExport(), app_id="app-id")
        assert result == (
            {"code": "invalid_workflow_id", "message": "workflow_id must be a valid UUID", "status": 400},
            400,
        )

    def test_default_draft_error_is_propagated(
        self,
        app: Flask,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def export(*_args: object) -> str:
            raise WorkflowNotFoundError("Missing draft workflow configuration")

        monkeypatch.setattr(app_query_services.apps.exports, "export_for_inner", export)
        with app.test_request_context(), pytest.raises(WorkflowNotFoundError, match="Missing draft"):
            inspect.unwrap(EnterpriseAppDSLExport.get)(EnterpriseAppDSLExport(), app_id="app-id")


class TestInnerAppAdmission:
    """Exercise admission and payload validation through the decorated entry point."""

    def test_invalid_body_is_rejected_before_the_handler_runs(self, app: Flask) -> None:
        api_instance = EnterpriseAppDSLImport()

        with (
            patch("controllers.console.wraps._is_setup_completed", return_value=True),
            config_overrides_context(INNER_API=True, INNER_API_KEY="inner-api-key"),
            app.test_request_context(
                method="POST",
                json={},
                headers={"X-Inner-Api-Key": "inner-api-key"},
            ),
            pytest.raises(UnprocessableEntity),
        ):
            api_instance.post(workspace_id="ws-123")

    def test_bad_key_is_rejected_before_body_validation(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
        with (
            config_overrides_context(INNER_API=True, INNER_API_KEY="inner-api-key"),
            app.test_request_context(method="POST", json={}, headers={"X-Inner-Api-Key": "wrong-key"}),
            pytest.raises(InnerApiUnauthorizedError),
        ):
            EnterpriseAppDSLImport().post(workspace_id="ws-123")

    def test_admitted_import_passes_stable_metadata(
        self,
        app: Flask,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        def import_as_creator(**kwargs: object) -> Import:
            calls.append(kwargs)
            return Import(id="import-id", status=ImportStatus.COMPLETED)

        monkeypatch.setattr(app_query_services.apps.imports, "import_as_creator", import_as_creator)
        monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
        monkeypatch.setattr("controllers.inner_api.app.dsl.get_request_id", lambda: "request-id")
        monkeypatch.setattr("controllers.inner_api.app.dsl.get_trace_id", lambda: "trace-id")
        with (
            config_overrides_context(INNER_API=True, INNER_API_KEY="inner-api-key"),
            app.test_request_context(
                method="POST",
                json={"yaml_content": "app: {}", "creator_email": "creator@example.com"},
                headers={"X-Inner-Api-Key": "inner-api-key"},
            ),
        ):
            body, status = EnterpriseAppDSLImport().post(workspace_id="ws-123")
        assert status == 200
        assert body["status"] == ImportStatus.COMPLETED
        assert calls[0]["request_id"] == "request-id"
        assert calls[0]["trace_id"] == "trace-id"
        assert calls[0]["workspace_id"] == "ws-123"
        assert calls[0]["creator_email"] == "creator@example.com"
