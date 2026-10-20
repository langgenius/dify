"""Unit tests for rag_pipeline_import controller endpoints."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.common.schema import JsonResponseWithStatus
from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import (
    IncludeSecretQuery,
    RagPipelineExportApi,
    RagPipelineImportApi,
    RagPipelineImportCheckDependenciesApi,
    RagPipelineImportConfirmApi,
    RagPipelineImportPayload,
)
from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
from models.account import Account
from models.dataset import Pipeline
from models.engine import db
from services.enterprise import rbac_service
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineImportInfo
from tests.unit_tests.model_factories import make_account, make_tenant


def _account() -> Account:
    return make_account(name="RAG Import Tester", email="rag-import@example.com")


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
        user = _account()
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

    def test_post_failed_400(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = _account()
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
        user = _account()
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

        user = _account()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
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

    def test_confirm_failed(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = _account()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.FAILED,
            current_dsl_version="0.1.0",
            imported_dsl_version="",
            error="missing dependency",
        )

        service = MagicMock()
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


@pytest.mark.parametrize("confirm", [False, True])
@pytest.mark.parametrize(
    ("import_status", "created", "dataset_id", "rbac_enabled", "commit_fails", "expected_calls"),
    [
        (ImportStatus.COMPLETED, True, "dataset-1", True, False, 1),
        (ImportStatus.COMPLETED_WITH_WARNINGS, True, "dataset-1", True, False, 1),
        (ImportStatus.COMPLETED, False, "dataset-1", True, False, 0),
        (ImportStatus.PENDING, True, "dataset-1", True, False, 0),
        (ImportStatus.FAILED, True, "dataset-1", True, False, 0),
        (ImportStatus.COMPLETED, True, None, True, False, 0),
        (ImportStatus.COMPLETED, True, "dataset-1", False, False, 0),
        (ImportStatus.COMPLETED, True, "dataset-1", True, True, 0),
    ],
)
def test_creator_binding_only_after_successful_new_dataset_commit(
    app: Flask,
    config_overrides: Callable[..., None],
    confirm: bool,
    import_status: ImportStatus,
    created: bool,
    dataset_id: str | None,
    rbac_enabled: bool,
    commit_fails: bool,
    expected_calls: int,
) -> None:
    config_overrides(RBAC_ENABLED=rbac_enabled)
    user = make_account(account_id="creator-1", tenant=make_tenant(tenant_id="tenant-1"))
    result = RagPipelineImportInfo.model_validate(
        {
            "id": "import-1",
            "status": import_status,
            "dataset_id": dataset_id,
            "dataset_created": created,
        }
    )
    service = MagicMock()
    service.import_rag_pipeline.return_value = result
    service.confirm_import.return_value = result
    events: list[str] = []
    session = Session(db.engine, expire_on_commit=False)
    commit = session.commit
    close = session.close

    def commit_session() -> None:
        if commit_fails:
            raise RuntimeError("commit failed")
        commit()
        events.append("commit")

    def close_session() -> None:
        close()
        events.append("close")

    def sync_binding(*_args: object, **_kwargs: object) -> list[object]:
        events.append("sync")
        return []

    with (
        app.test_request_context("/"),
        patch("controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session", return_value=session),
        patch(
            "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService", return_value=service
        ),
        patch.object(session, "commit", side_effect=commit_session),
        patch.object(session, "close", side_effect=close_session),
        patch.object(
            rbac_service.RBACService.AccessPolicies,
            "sync_creator_access_policy_member_bindings",
            side_effect=sync_binding,
        ) as sync,
        patch.object(rbac_service.RBACService.DatasetAccess, "replace_whitelist") as replace,
    ):

        def invoke() -> JsonResponseWithStatus:
            if confirm:
                api = RagPipelineImportConfirmApi()
                return unwrap(api.post)(api, user, "import-1")
            api = RagPipelineImportApi()
            return unwrap(api.post)(api, RagPipelineImportPayload(mode="yaml-content"), user)

        if commit_fails:
            with pytest.raises(RuntimeError, match="commit failed"):
                invoke()
        else:
            response, _ = invoke()
            assert "dataset_created" not in response
        assert sync.call_count == expected_calls
        if expected_calls:
            assert events == ["commit", "close", "sync"]
            sync.assert_called_once_with(
                "tenant-1",
                "creator-1",
                resource_type=rbac_service.RBACResourceType.DATASET,
                resource_id="dataset-1",
            )
        replace.assert_not_called()
