"""Unit tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import (
    CreateEmptyRagPipelineDatasetApi,
    CreateRagPipelineDatasetApi,
    RagPipelineDatasetImportPayload,
)
from models.account import Account, TenantAccountRole
from services.enterprise import rbac_service as enterprise_rbac_service
from services.entities.dsl_entities import ImportStatus
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_account


def _account(*, editor: bool) -> Account:
    return make_account(
        account_id=None,
        name="RAG Pipeline Tester",
        email="rag-pipeline@example.com",
        role=TenantAccountRole.EDITOR if editor else TenantAccountRole.NORMAL,
    )


class TestCreateRagPipelineDatasetApi:
    def _valid_payload(self) -> dict[str, str]:
        return {"yaml_content": "name: test"}

    def test_post_success(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = _account(editor=True)
        import_info = {
            "id": "import-1",
            "status": ImportStatus.COMPLETED,
            "dataset_id": "ds-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.return_value = import_info

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            response, status = method(api, RagPipelineDatasetImportPayload.model_validate(payload), "tenant-1", user)

        assert status == 201
        assert response == {
            "id": "import-1",
            "status": "completed",
            "dataset_id": "ds-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

    def test_post_success_syncs_creator_under_rbac(self, app: Flask) -> None:
        """RBAC: RAG-pipeline dataset create must keep the creator bound to their own dataset.

        Regression guard for the #42430 flip to automatic_include_workspace_members=False:
        this path bypasses DatasetService.create_empty_dataset (which syncs the creator
        internally), so the controller has to sync the creator explicitly or the creator
        gets 403 on their own dataset.
        """
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = _account(editor=True)
        import_info = {
            "id": "import-1",
            "status": ImportStatus.COMPLETED,
            "dataset_id": "ds-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.return_value = import_info

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            config_overrides_context(RBAC_ENABLED=True),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.enterprise_rbac_service.RBACService.DatasetAccess.replace_whitelist"
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"
            ) as sync_creator,
        ):
            response, status = method(api, RagPipelineDatasetImportPayload.model_validate(payload), "tenant-1", user)

        assert status == 201
        assert sync_creator.called, "RAG pipeline create must sync the creator's own access"
        sync_creator.assert_called_once_with(
            "tenant-1", user.id, enterprise_rbac_service.RBACResourceType.DATASET, "ds-1"
        )
        assert response["dataset_id"] == "ds-1"

    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = _account(editor=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(Forbidden):
                method(api, RagPipelineDatasetImportPayload.model_validate(payload), "tenant-1", user)

    def test_post_dataset_name_duplicate(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = _account(editor=True)

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api, RagPipelineDatasetImportPayload.model_validate(payload), "tenant-1", user)

    def test_post_invalid_payload(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload: dict[str, str] = {}
        user = _account(editor=True)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, RagPipelineDatasetImportPayload.model_validate(payload), "tenant-1", user)


class TestCreateEmptyRagPipelineDatasetApi:
    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = _account(editor=False)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)
