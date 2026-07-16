from __future__ import annotations

import json
from collections.abc import Callable, Generator
from inspect import unwrap
from unittest.mock import patch
from uuid import uuid4

import pytest
import yaml
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi._models import AppDslExportQuery, AppDslImportPayload
from controllers.openapi.app_dsl import (
    AppDslCheckDependenciesApi,
    AppDslExportApi,
    AppDslImportApi,
    AppDslImportConfirmApi,
)
from models import Account, App
from models.model import AppModelConfig
from services.account_service import AccountService, TenantService
from services.app_dsl_service import CURRENT_DSL_VERSION
from services.app_service import AppService, CreateAppParams
from services.entities.dsl_entities import ImportStatus
from tests.test_containers_integration_tests.controllers.openapi.conftest import auth_for
from tests.test_containers_integration_tests.helpers import generate_valid_password


def _workflow_yaml(*, version: str = CURRENT_DSL_VERSION, name: str = "My App") -> str:
    return yaml.safe_dump(
        {
            "version": version,
            "kind": "app",
            "app": {"name": name, "mode": "workflow"},
            "workflow": {"graph": {"nodes": []}, "features": {}},
        },
        allow_unicode=True,
    )


@pytest.fixture
def external_deps() -> Generator[dict[str, object], None, None]:
    """Stub the heavy collaborators an import/export touches (model runtime,
    workflow sync, dependency analysis, enterprise hooks) while leaving the DSL
    service and DB writes real."""
    with (
        patch("services.app_dsl_service.WorkflowService") as mock_workflow_service,
        patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dependencies_service,
        patch("services.app_dsl_service.app_was_created") as mock_app_was_created,
        patch("services.app_service.ModelManager.for_tenant") as mock_model_manager,
        patch("services.app_service.FeatureService") as mock_feature_service,
        patch("services.app_service.EnterpriseService") as mock_enterprise_service,
    ):
        mock_workflow_service.return_value.get_draft_workflow.return_value = None
        mock_workflow_service.return_value.sync_draft_workflow.return_value = None
        mock_dependencies_service.generate_latest_dependencies.return_value = []  # type: ignore[assignment]
        mock_dependencies_service.get_leaked_dependencies.return_value = []  # type: ignore[assignment]
        mock_dependencies_service.generate_dependencies.return_value = []  # type: ignore[assignment]
        mock_app_was_created.send.return_value = None

        mock_model_instance = mock_model_manager.return_value
        mock_model_instance.get_default_model_instance.return_value = None
        mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

        mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
        mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
        mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

        yield {"workflow_service": mock_workflow_service}


def _app_and_account(db_session: Session, *, mode: str = "chat") -> tuple[App, Account]:
    fake = Faker()
    with patch("services.account_service.FeatureService") as mock_account_feature_service:
        mock_account_feature_service.get_system_features.return_value.is_allow_register = True
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session,
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company(), session=db_session)
        tenant = account.current_tenant
        assert tenant is not None
        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode=mode,  # type: ignore[arg-type]
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            api_rph=100,
            api_rpm=10,
        )
        app_model = AppService().create_app(tenant.id, app_args, account, session=db_session)
    return app_model, account


class TestDslImport:
    def test_invalid_dsl_maps_to_400_and_persists_nothing(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None

        api = AppDslImportApi()
        body = AppDslImportPayload(mode="yaml-content", yaml_content="[]")  # not a mapping
        with app.test_request_context(f"/openapi/v1/workspaces/{tenant.id}/apps/imports", method="POST"):
            result, code = unwrap(api.post)(api, workspace_id=tenant.id, auth_data=auth_for(account), body=body)

        assert code == 400
        assert result.status == ImportStatus.FAILED
        # A failed import must not leave an app behind.
        assert db_session_with_containers.query(App).filter(App.tenant_id == tenant.id).count() == 0

    def test_major_version_mismatch_maps_to_202_pending(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None

        api = AppDslImportApi()
        body = AppDslImportPayload(mode="yaml-content", yaml_content=_workflow_yaml(version="99.0.0"))
        with app.test_request_context(f"/openapi/v1/workspaces/{tenant.id}/apps/imports", method="POST"):
            result, code = unwrap(api.post)(api, workspace_id=tenant.id, auth_data=auth_for(account), body=body)

        assert code == 202
        assert result.status == ImportStatus.PENDING
        assert result.id  # a pending import id the caller can confirm with

    def test_valid_dsl_maps_to_200_completed(
        self,
        app: Flask,
        db_session_with_containers: Session,
        make_account: Callable[..., Account],
        external_deps: dict[str, object],
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None

        api = AppDslImportApi()
        body = AppDslImportPayload(mode="yaml-content", yaml_content=_workflow_yaml(name="Imported"))
        with app.test_request_context(f"/openapi/v1/workspaces/{tenant.id}/apps/imports", method="POST"):
            result, code = unwrap(api.post)(api, workspace_id=tenant.id, auth_data=auth_for(account), body=body)

        assert code == 200
        assert result.status in (ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS)
        assert result.app_id is not None


class TestDslImportConfirm:
    def test_unknown_pending_import_maps_to_400(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """An expired/unknown import id has no Redis pending data → FAILED → 400."""
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None
        import_id = str(uuid4())

        api = AppDslImportConfirmApi()
        with app.test_request_context(
            f"/openapi/v1/workspaces/{tenant.id}/apps/imports/{import_id}:confirm", method="POST"
        ):
            result, code = unwrap(api.post)(
                api, workspace_id=tenant.id, import_id=import_id, auth_data=auth_for(account)
            )

        assert code == 400
        assert result.status == ImportStatus.FAILED


class TestDslExport:
    def test_export_returns_dsl_yaml(
        self, app: Flask, db_session_with_containers: Session, external_deps: dict[str, object]
    ) -> None:
        app_model, account = _app_and_account(db_session_with_containers, mode="chat")
        model_config = AppModelConfig(
            app_id=app_model.id,
            provider="openai",
            model_id="gpt-3.5-turbo",
            model=json.dumps({"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}}),
            pre_prompt="You are a helpful assistant.",
            prompt_type="simple",  # type: ignore[arg-type]
            created_by=account.id,
            updated_by=account.id,
        )
        model_config.id = str(uuid4())
        app_model.app_model_config_id = model_config.id
        db_session_with_containers.add(model_config)
        db_session_with_containers.commit()

        api = AppDslExportApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}/dsl"):
            response, code = unwrap(api.get)(
                api, app_id=app_model.id, auth_data=auth_for(account, app_model=app_model), query=AppDslExportQuery()
            )

        assert code == 200
        parsed = yaml.safe_load(response.data)
        assert parsed["kind"] == "app"
        assert parsed["app"]["name"] == app_model.name

    def test_export_workflow_app_without_draft_maps_to_404(
        self, app: Flask, db_session_with_containers: Session, external_deps: dict[str, object]
    ) -> None:
        """A workflow app with no draft workflow can't be exported → the service
        raises WorkflowNotFoundError, which the controller maps to 404."""
        app_model, account = _app_and_account(db_session_with_containers, mode="workflow")

        api = AppDslExportApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}/dsl"):
            result, code = unwrap(api.get)(
                api, app_id=app_model.id, auth_data=auth_for(account, app_model=app_model), query=AppDslExportQuery()
            )

        assert code == 404
        assert isinstance(result, str)


class TestDslCheckDependencies:
    def test_check_dependencies_returns_result(
        self, app: Flask, db_session_with_containers: Session, external_deps: dict[str, object]
    ) -> None:
        app_model, account = _app_and_account(db_session_with_containers, mode="chat")

        api = AppDslCheckDependenciesApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}/dependencies:check"):
            result, code = unwrap(api.get)(api, app_id=app_model.id, auth_data=auth_for(account, app_model=app_model))

        assert code == 200
        assert result.leaked_dependencies == []
