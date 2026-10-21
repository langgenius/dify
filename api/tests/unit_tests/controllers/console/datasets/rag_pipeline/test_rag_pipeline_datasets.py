"""Unit tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from dataclasses import dataclass, field
from inspect import unwrap

import pytest
from flask import Flask

import services
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline import rag_pipeline_datasets as module
from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import (
    CreateEmptyRagPipelineDatasetApi,
    CreateRagPipelineDatasetApi,
    RagPipelineDatasetImportPayload,
)
from machinery.context import RequestContext
from services.entities.dsl_entities import ImportStatus


@dataclass
class _PipelineWorkflows:
    result: dict[str, object]
    calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    error: Exception | None = None

    def import_dataset(self, context: RequestContext, *, yaml_content: str) -> dict[str, object]:
        self.calls.append((context, yaml_content))
        if self.error is not None:
            raise self.error
        return self.result


@dataclass
class _Datasets:
    result: dict[str, object]
    calls: list[tuple[RequestContext, dict[str, object]]] = field(default_factory=list)
    error: Exception | None = None

    def create_rag_pipeline_dataset(
        self,
        context: RequestContext,
        *,
        values: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append((context, values))
        if self.error is not None:
            raise self.error
        return self.result


@dataclass(frozen=True)
class _KnowledgeServices:
    pipeline_workflows: _PipelineWorkflows
    datasets: _Datasets


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "tenant-1")


def _import_result() -> dict[str, object]:
    return {
        "id": "import-1",
        "status": ImportStatus.COMPLETED,
        "dataset_id": "dataset-1",
        "pipeline_id": "pipeline-1",
        "current_dsl_version": "0.1.0",
        "imported_dsl_version": "0.1.0",
        "error": "",
    }


def _dataset_result() -> dict[str, object]:
    return {
        "id": "dataset-1",
        "name": "",
        "description": "",
        "provider": "vendor",
        "permission": "only_me",
        "data_source_type": None,
        "indexing_technique": "economy",
        "app_count": 0,
        "document_count": 0,
        "word_count": 0,
        "created_by": "account-1",
        "author_name": None,
        "created_at": 1,
        "updated_by": None,
        "updated_at": 1,
        "embedding_model": None,
        "embedding_model_provider": None,
        "retrieval_model_dict": {
            "search_method": "keyword_search",
            "reranking_enable": False,
            "top_k": 4,
            "score_threshold_enabled": False,
        },
        "tags": [],
        "doc_form": None,
        "external_retrieval_model": None,
        "doc_metadata": [],
        "built_in_field_enabled": False,
        "pipeline_id": "pipeline-1",
        "runtime_mode": "rag_pipeline",
        "chunk_structure": None,
        "is_published": False,
        "total_documents": 0,
        "total_available_documents": 0,
        "enable_api": False,
        "is_multimodal": False,
    }


def _services(
    *,
    workflows: _PipelineWorkflows | None = None,
    datasets: _Datasets | None = None,
) -> _ApplicationServices:
    return _ApplicationServices(
        _KnowledgeServices(
            pipeline_workflows=workflows or _PipelineWorkflows(_import_result()),
            datasets=datasets or _Datasets(_dataset_result()),
        )
    )


class TestCreateRagPipelineDatasetApi:
    def test_post_calls_application_service(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflows = _PipelineWorkflows(_import_result())
        monkeypatch.setattr(module, "application_services", lambda: _services(workflows=workflows))
        context = _context()

        with app.test_request_context("/"):
            response, status = unwrap(CreateRagPipelineDatasetApi.post)(
                CreateRagPipelineDatasetApi(),
                RagPipelineDatasetImportPayload(yaml_content="name: test"),
                context,
            )

        assert status == 201
        assert response == {
            "id": "import-1",
            "status": "completed",
            "dataset_id": "dataset-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }
        assert workflows.calls == [(context, "name: test")]

    def test_post_maps_duplicate_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        workflows = _PipelineWorkflows(
            _import_result(),
            error=services.errors.dataset.DatasetNameDuplicateError(),
        )
        monkeypatch.setattr(module, "application_services", lambda: _services(workflows=workflows))

        with pytest.raises(DatasetNameDuplicateError):
            unwrap(CreateRagPipelineDatasetApi.post)(
                CreateRagPipelineDatasetApi(),
                RagPipelineDatasetImportPayload(yaml_content="name: duplicate"),
                _context(),
            )


class TestCreateEmptyRagPipelineDatasetApi:
    def test_post_calls_dataset_application_service(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        datasets = _Datasets(_dataset_result())
        monkeypatch.setattr(module, "application_services", lambda: _services(datasets=datasets))
        context = _context()

        with app.test_request_context("/"):
            response, status = unwrap(CreateEmptyRagPipelineDatasetApi.post)(
                CreateEmptyRagPipelineDatasetApi(),
                context,
            )

        assert status == 201
        assert response["id"] == "dataset-1"
        assert response["runtime_mode"] == "rag_pipeline"
        assert datasets.calls == [
            (
                context,
                {
                    "name": "",
                    "description": "",
                    "icon_info": {
                        "icon": "📙",
                        "icon_background": "#FFF4ED",
                        "icon_type": "emoji",
                        "icon_url": None,
                    },
                    "permission": "only_me",
                    "partial_member_list": None,
                },
            )
        ]

    def test_post_maps_duplicate_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        datasets = _Datasets(
            _dataset_result(),
            error=services.errors.dataset.DatasetNameDuplicateError(),
        )
        monkeypatch.setattr(module, "application_services", lambda: _services(datasets=datasets))

        with pytest.raises(DatasetNameDuplicateError):
            unwrap(CreateEmptyRagPipelineDatasetApi.post)(CreateEmptyRagPipelineDatasetApi(), _context())
