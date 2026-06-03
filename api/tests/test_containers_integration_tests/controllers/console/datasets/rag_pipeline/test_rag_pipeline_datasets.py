"""Testcontainers integration tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, cast
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
)


class _WrappedCallable(Protocol):
    __wrapped__: Callable[..., object]


def unwrap(func: Callable[..., object]) -> Callable[..., object]:
    current: Callable[..., object] | _WrappedCallable = func
    while hasattr(current, "__wrapped__"):
        current = cast(_WrappedCallable, current).__wrapped__
    return cast(Callable[..., object], current)


class TestCreateRagPipelineDatasetApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def _valid_payload(self) -> dict[str, str]:
        return {"yaml_content": "name: test"}

    def test_post_success(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)
        import_info = {"dataset_id": "ds-1"}

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
            response, status = cast(tuple[dict[str, str], int], method(api, "tenant-1", user))

        assert status == 201
        assert response == import_info

    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)

    def test_post_dataset_name_duplicate(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)

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
                method(api, "tenant-1", user)

    def test_post_invalid_payload(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload: dict[str, str] = {}
        user = MagicMock(is_dataset_editor=True)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", user)


class TestCreateEmptyRagPipelineDatasetApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_post_success(self, app: Flask) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.DatasetService.create_empty_rag_pipeline_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.marshal",
                return_value={"id": "ds-1"},
            ),
        ):
            response, status = cast(tuple[dict[str, str], int], method(api, "tenant-1", user))

        assert status == 201
        assert response == {"id": "ds-1"}

    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)
