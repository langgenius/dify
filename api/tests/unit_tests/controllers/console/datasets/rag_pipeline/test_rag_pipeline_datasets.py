"""Unit tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from inspect import getclosurevars, unwrap
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
from controllers.console.wraps import RBACPermission, RBACResourceScope
from models.account import Account, TenantAccountRole
from services.entities.dsl_entities import ImportStatus


def _account(*, editor: bool) -> Account:
    account = Account(name="RAG Pipeline Tester", email="rag-pipeline@example.com")
    account.role = TenantAccountRole.EDITOR if editor else TenantAccountRole.NORMAL
    return account


class TestCreateRagPipelineDatasetApi:
    def _valid_payload(self) -> dict[str, str]:
        return {"yaml_content": "name: test"}

    def test_post_requires_dataset_create_management_permission(self) -> None:
        route = CreateRagPipelineDatasetApi.post
        legacy_gate = unwrap(route, stop=lambda decorator: "edit_permission_required" in decorator.__code__.co_qualname)
        rbac_gate = unwrap(route, stop=lambda decorator: "scene" in getclosurevars(decorator).nonlocals)

        assert "edit_permission_required" in legacy_gate.__code__.co_qualname
        permissions = getclosurevars(rbac_gate).nonlocals
        assert permissions["resource_type"] == RBACResourceScope.DATASET
        assert permissions["scene"] == RBACPermission.DATASET_CREATE_AND_MANAGEMENT
        assert permissions["resource_required"] is False

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
