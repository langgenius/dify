"""Unit tests for rag_pipeline_import controller endpoints."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from inspect import getclosurevars, unwrap
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline import rag_pipeline_import as module
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import (
    IncludeSecretQuery,
    RagPipelineExportApi,
    RagPipelineImportApi,
    RagPipelineImportCheckDependenciesApi,
    RagPipelineImportConfirmApi,
    RagPipelineImportPayload,
    _require_dataset_dsl_access,
)
from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
from core.rbac import RBACResourceScope
from models import Tenant
from models.account import Account
from models.dataset import Pipeline
from models.engine import db
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineImportInfo


def _account() -> Account:
    account = Account(name="RAG Import Tester", email="rag-import@example.com")
    account.id = "account-1"
    return account


def _account_with_tenant(tenant_id: str = "tenant-1") -> Account:
    account = _account()
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


def _has_rbac_scene(decorator: Callable[..., object]) -> bool:
    return "scene" in getclosurevars(decorator).nonlocals


def _rbac_gate(method: Callable[..., object]) -> Callable[..., object]:
    return cast(Callable[..., object], unwrap(method, stop=_has_rbac_scene))


@pytest.fixture
def app() -> Iterator[Flask]:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)

    with app.app_context():
        yield app


class TestRagPipelineImportApi:
    def _payload(self, mode: str = "create") -> dict[str, str]:
        return {
            "mode": mode,
            "yaml_content": "content",
            "name": "Test",
        }

    def test_post_success_200(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, RagPipelineImportPayload(mode="create"), user)

        assert status == 200
        assert response == {
            "id": "import-1",
            "status": "completed",
            "pipeline_id": "pipeline-1",
            "dataset_id": "dataset-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

    def test_post_uses_import_export_dsl_workspace_permission(self) -> None:
        gate = _rbac_gate(RagPipelineImportApi().post)
        permissions = getclosurevars(gate).nonlocals

        assert permissions["resource_type"] == module.RBACResourceScope.DATASET
        assert permissions["scene"] == module.RBACPermission.DATASET_IMPORT_EXPORT_DSL
        assert permissions["resource_required"] is False

    def test_post_update_requires_target_dataset_dsl_access(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.get_pipeline_dataset_id.return_value = "dataset-1"
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=self._payload()),
            patch.object(type(console_ns), "payload", self._payload()),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import._require_dataset_dsl_access"
            ) as require_access,
        ):
            response, status = method(api, RagPipelineImportPayload(mode="create", pipeline_id="pipeline-1"), user)

        assert status == 200
        assert response["pipeline_id"] == "pipeline-1"
        service.get_pipeline_dataset_id.assert_called_once_with(pipeline_id="pipeline-1", account=user)
        require_access.assert_called_once_with(account=user, dataset_id="dataset-1")

    def test_post_failed_400(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.FAILED,
            current_dsl_version="0.1.0",
            imported_dsl_version="",
            error="bad dsl",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, RagPipelineImportPayload(mode="create"), user)

        assert status == 400
        assert response["status"] == "failed"
        assert response["error"] == "bad dsl"
        assert response["pipeline_id"] is None
        assert response["dataset_id"] is None

    def test_post_pending_202(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.PENDING,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.2.0",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, RagPipelineImportPayload(mode="create"), user)

        assert status == 202
        assert response["status"] == "pending"
        assert response["pipeline_id"] == "pipeline-1"
        assert response["dataset_id"] == "dataset-1"


class TestRagPipelineImportConfirmApi:
    def test_confirm_success(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.get_pending_pipeline_id.return_value = None
        service.confirm_import.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user, "import-1")

        assert status == 200
        assert response["status"] == "completed"
        assert response["pipeline_id"] == "pipeline-1"

    def test_confirm_update_requires_target_dataset_dsl_access(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.get_pending_pipeline_id.return_value = "pipeline-1"
        service.get_pipeline_dataset_id.return_value = "dataset-1"
        service.confirm_import.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import._require_dataset_dsl_access"
            ) as require_access,
        ):
            response, status = method(api, user, "import-1")

        assert status == 200
        assert response["pipeline_id"] == "pipeline-1"
        service.get_pending_pipeline_id.assert_called_once_with(import_id="import-1", account=user)
        service.get_pipeline_dataset_id.assert_called_once_with(pipeline_id="pipeline-1", account=user)
        require_access.assert_called_once_with(account=user, dataset_id="dataset-1")

    def test_confirm_failed(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = _account_with_tenant()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.FAILED,
            current_dsl_version="0.1.0",
            imported_dsl_version="",
            error="missing dependency",
        )

        service = MagicMock()
        service.get_pending_pipeline_id.return_value = None
        service.confirm_import.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user, "import-1")

        assert status == 400
        assert response["status"] == "failed"
        assert response["error"] == "missing dependency"


class TestRagPipelineImportCheckDependenciesApi:
    def test_get_success(self, app: Flask) -> None:
        api = RagPipelineImportCheckDependenciesApi()
        method = unwrap(api.get)

        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")
        result = CheckDependenciesResult()

        service = MagicMock()
        service.check_dependencies.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {"leaked_dependencies": []}

    def test_get_uses_dataset_readonly_permission(self) -> None:
        gate = _rbac_gate(RagPipelineImportCheckDependenciesApi().get)
        permissions = getclosurevars(gate).nonlocals

        assert permissions["resource_type"] == module.RBACResourceScope.DATASET
        assert permissions["scene"] == module.RBACPermission.DATASET_READONLY
        assert permissions["resource_required"] is True

    def test_get_serializes_leaked_dependencies(self, app: Flask) -> None:
        api = RagPipelineImportCheckDependenciesApi()
        method = unwrap(api.get)

        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")
        dependency = PluginDependency(
            type=PluginDependencyType.Marketplace,
            value=PluginDependency.Marketplace(
                marketplace_plugin_unique_identifier="langgenius/example:0.1.0",
                version="0.1.0",
            ),
            current_identifier="langgenius/example:0.0.1",
        )
        service = MagicMock()
        service.check_dependencies.return_value = CheckDependenciesResult(leaked_dependencies=[dependency])

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {
            "leaked_dependencies": [
                {
                    "type": "marketplace",
                    "value": {
                        "marketplace_plugin_unique_identifier": "langgenius/example:0.1.0",
                        "version": "0.1.0",
                    },
                    "current_identifier": "langgenius/example:0.0.1",
                }
            ]
        }


class TestRagPipelineExportApi:
    def test_get_uses_import_export_dsl_resource_permission(self) -> None:
        gate = _rbac_gate(RagPipelineExportApi().get)
        permissions = getclosurevars(gate).nonlocals

        assert permissions["resource_type"] == module.RBACResourceScope.DATASET
        assert permissions["scene"] == module.RBACPermission.DATASET_IMPORT_EXPORT_DSL
        assert permissions["resource_required"] is True

    def test_get_with_include_secret(self, app: Flask) -> None:
        api = RagPipelineExportApi()
        method = unwrap(api.get)

        pipeline = Pipeline(tenant_id="tenant-id", name="Test Pipeline")
        service = MagicMock()
        service.export_rag_pipeline_dsl.return_value = "yaml: data"

        with (
            app.test_request_context("/?include_secret=true"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, IncludeSecretQuery(), pipeline)

        assert status == 200
        assert response == {"data": "yaml: data"}


class TestRequireDatasetDslAccess:
    def test_enforces_rbac_with_dataset_id(self) -> None:
        account = _account_with_tenant()

        with patch("controllers.console.datasets.rag_pipeline.rag_pipeline_import.enforce_rbac_access") as enforce:
            _require_dataset_dsl_access(account=account, dataset_id="dataset-1")

        enforce.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="account-1",
            resource_type=RBACResourceScope.DATASET,
            scene=module.RBACPermission.DATASET_IMPORT_EXPORT_DSL,
            path_args={"dataset_id": "dataset-1"},
        )
