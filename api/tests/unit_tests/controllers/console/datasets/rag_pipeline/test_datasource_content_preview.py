from dataclasses import dataclass, field
from inspect import unwrap
from unittest.mock import patch
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import RBAC_CHECKS_ATTR, DatasetByPipeline
from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.datasource_content_preview import (
    DataSourceContentPreviewApi,
    DatasourceContentPreviewPayload,
)
from core.rbac import RBACPermission
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccessDeniedError
from services.knowledge.entities.pipeline_workflows import DatasourceNodeRun
from services.knowledge.rag_pipeline.application import PipelineConfigurationError


@dataclass
class _RecordingPipelineWorkflows:
    result: dict[str, object]
    calls: list[tuple[RequestContext, str, str, DatasourceNodeRun]] = field(default_factory=list)
    error: Exception | None = None

    def preview_console_datasource_node(
        self,
        context: RequestContext,
        *,
        pipeline_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> dict[str, object]:
        self.calls.append((context, pipeline_id, node_id, command))
        if self.error is not None:
            raise self.error
        return self.result


@dataclass(frozen=True)
class _KnowledgeServices:
    pipeline_workflows: _RecordingPipelineWorkflows


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


def _context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "account-1", "tenant-id")


_PIPELINE_ID = UUID("00000000-0000-0000-0000-000000000001")


class TestDataSourceContentPreviewApi:
    def _valid_payload(self) -> dict[str, object]:
        return {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": "cred-1",
        }

    def test_route_declares_pipeline_dataset_read_permission(self) -> None:
        checks = DataSourceContentPreviewApi.post.__dict__[RBAC_CHECKS_ATTR]

        assert len(checks) == 1
        assert checks[0].scene is RBACPermission.DATASET_READONLY
        assert isinstance(checks[0].locator, DatasetByPipeline)

    def test_post_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = self._valid_payload()

        node_id = "node-1"
        context = _context()

        preview_result: dict[str, object] = {"content": "preview data"}

        workflows = _RecordingPipelineWorkflows(preview_result)
        monkeypatch.setitem(
            method.__globals__,
            "application_services",
            lambda: _ApplicationServices(_KnowledgeServices(workflows)),
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            req_data = DatasourceContentPreviewPayload.model_validate(payload)
            response, status = method(api, req_data, context, _PIPELINE_ID, node_id)

        assert len(workflows.calls) == 1
        called_context, pipeline_id, called_node_id, command = workflows.calls[0]
        assert (called_context, pipeline_id, called_node_id) == (context, str(_PIPELINE_ID), node_id)
        assert command == DatasourceNodeRun(
            inputs={"query": "hello"},
            datasource_type="notion",
            is_published=True,
            credential_id="cred-1",
        )
        assert status == 200
        assert response == preview_result

    def test_post_invalid_payload(self, app: Flask) -> None:
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            # datasource_type missing
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError, match=r"datasource_type\n\s+Field required"):
                method(api, DatasourceContentPreviewPayload.model_validate(payload), _context(), _PIPELINE_ID, "node-1")

    def test_post_without_credential_id(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": None,
        }

        workflows = _RecordingPipelineWorkflows({"ok": True})
        monkeypatch.setitem(
            method.__globals__,
            "application_services",
            lambda: _ApplicationServices(_KnowledgeServices(workflows)),
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            req_data = DatasourceContentPreviewPayload.model_validate(payload)
            response, status = method(api, req_data, _context(), _PIPELINE_ID, "node-1")

        assert len(workflows.calls) == 1
        assert status == 200
        assert response == {"ok": True}

    def test_post_maps_actor_credential_rejection_to_invalid_argument(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)
        payload = self._valid_payload()
        workflows = _RecordingPipelineWorkflows(
            {}, error=PipelineConfigurationError("Datasource credential is not available to this actor")
        )
        monkeypatch.setitem(
            method.__globals__,
            "application_services",
            lambda: _ApplicationServices(_KnowledgeServices(workflows)),
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            pytest.raises(InvalidArgumentError, match="not available"),
        ):
            method(
                api,
                DatasourceContentPreviewPayload.model_validate(payload),
                _context(),
                _PIPELINE_ID,
                "node-1",
            )

    def test_post_maps_dataset_visibility_rejection_to_forbidden(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)
        payload = self._valid_payload()
        workflows = _RecordingPipelineWorkflows({}, error=DatasetAccessDeniedError())
        monkeypatch.setitem(
            method.__globals__,
            "application_services",
            lambda: _ApplicationServices(_KnowledgeServices(workflows)),
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            pytest.raises(Forbidden, match="permission"),
        ):
            method(
                api,
                DatasourceContentPreviewPayload.model_validate(payload),
                _context(),
                _PIPELINE_ID,
                "node-1",
            )
