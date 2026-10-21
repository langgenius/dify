import io
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.datastructures import FileStorage

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.service_api.dataset.rag_pipeline import rag_pipeline_workflow as workflow_module
from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import (
    DatasourceNodeRunApi,
    DatasourcePluginsApi,
    KnowledgebasePipelineFileUploadApi,
    PipelineRunApi,
)
from fields.service_api.rag_pipeline import DatasourceNodeRunPayload
from machinery.context import RequestContext
from services.knowledge.entities.pipeline_workflows import (
    DatasourceNodeRun,
    PipelineFileUpload,
    PipelineRun,
    PipelineUploadedFile,
)
from services.knowledge.rag_pipeline.application import PipelineConfigurationError, PipelineDatasetNotFoundError

DATASET_ID = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@dataclass
class RecordingPipelineWorkflows:
    calls: list[tuple[str, object]] = field(default_factory=list)
    fail_with_missing_dataset: bool = False
    datasource_events: tuple[str, ...] = ("data: complete\n\n",)
    pipeline_error: Exception | None = None

    def list_datasource_plugins(
        self, context: RequestContext, *, dataset_id: str, is_published: bool
    ) -> Sequence[Mapping[str, object]]:
        if self.fail_with_missing_dataset:
            raise PipelineDatasetNotFoundError()
        self.calls.append(("list", (context, dataset_id, is_published)))
        return (
            {
                "node_id": "node-1",
                "plugin_id": "plugin-1",
                "provider_name": "provider-1",
                "datasource_type": "website_crawl",
                "title": "Website",
                "user_input_variables": [],
                "credentials": [],
            },
        )

    def run_datasource_node(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Iterable[str]:
        self.calls.append(("node", (context, dataset_id, node_id, command)))
        return iter(self.datasource_events)

    def run_pipeline(
        self, context: RequestContext, *, dataset_id: str, command: PipelineRun
    ) -> Mapping[str, object] | Iterable[str]:
        if self.pipeline_error is not None:
            raise self.pipeline_error
        self.calls.append(("run", (context, dataset_id, command)))
        return {"batch": "batch-1"}

    def upload_file(self, context: RequestContext, *, upload: PipelineFileUpload) -> PipelineUploadedFile:
        self.calls.append(("upload", (context, upload)))
        return PipelineUploadedFile(
            id="file-1",
            name=upload.filename,
            size=len(upload.content),
            extension="txt",
            mime_type=upload.mimetype,
            created_by=context.account_id,
            created_at=datetime(2026, 10, 19, tzinfo=UTC),
        )


@dataclass(frozen=True)
class FakeKnowledgeServices:
    pipeline_workflows: RecordingPipelineWorkflows


@dataclass(frozen=True)
class FakeApplicationServices:
    knowledge: FakeKnowledgeServices


@pytest.fixture
def pipeline_workflows(monkeypatch: pytest.MonkeyPatch) -> RecordingPipelineWorkflows:
    workflows = RecordingPipelineWorkflows()
    services = FakeApplicationServices(knowledge=FakeKnowledgeServices(pipeline_workflows=workflows))
    monkeypatch.setattr(workflow_module, "application_services", lambda: services)
    return workflows


def test_datasource_node_payload_requires_all_business_inputs() -> None:
    with pytest.raises(ValidationError):
        DatasourceNodeRunPayload.model_validate({"inputs": {}})


def test_list_plugins_parses_query_and_serializes_response(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    context = _context()
    with app.test_request_context("/datasets/id/pipeline/datasource-plugins?is_published=false"):
        body, status = DatasourcePluginsApi().get(context, DATASET_ID)

    assert status == 200
    assert body[0]["node_id"] == "node-1"
    assert pipeline_workflows.calls == [("list", (context, str(DATASET_ID), False))]


def test_list_plugins_translates_domain_not_found(app: Flask, pipeline_workflows: RecordingPipelineWorkflows) -> None:
    pipeline_workflows.fail_with_missing_dataset = True
    with app.test_request_context("/datasets/id/pipeline/datasource-plugins"):
        with pytest.raises(NotFoundError, match="Dataset not found"):
            DatasourcePluginsApi().get(_context(), DATASET_ID)


def test_run_datasource_node_passes_validated_command(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    context = _context()
    with app.test_request_context(
        "/datasets/id/pipeline/datasource/nodes/node-1/run",
        method="POST",
        json={
            "inputs": {"url": "https://example.com"},
            "datasource_type": "website_crawl",
            "credential_id": "credential-1",
            "is_published": False,
        },
    ):
        response = DatasourceNodeRunApi().post(context, DATASET_ID, "node-1")
        response.get_data()

    call_name, call_values = pipeline_workflows.calls[0]
    command = call_values[3]  # type: ignore[index]
    assert call_name == "node"
    assert isinstance(command, DatasourceNodeRun)
    assert command.credential_id == "credential-1"


def test_run_datasource_node_preserves_error_event_as_http_200(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    pipeline_workflows.datasource_events = (
        'data: {"event":"datasource_error","error":"Workflow not initialized"}\n\n',
    )
    with app.test_request_context(
        "/datasets/id/pipeline/datasource/nodes/node-1/run",
        method="POST",
        json={
            "inputs": {},
            "datasource_type": "website_crawl",
            "is_published": False,
        },
    ):
        response = DatasourceNodeRunApi().post(_context(), DATASET_ID, "node-1")

    assert response.status_code == 200
    assert "datasource_error" in response.get_data(as_text=True)


def test_run_pipeline_passes_response_mode_without_web_objects(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    context = _context()
    with app.test_request_context(
        "/datasets/id/pipeline/run",
        method="POST",
        json={
            "inputs": {},
            "datasource_type": "local_file",
            "datasource_info_list": [],
            "start_node_id": "node-1",
            "is_published": True,
            "response_mode": "blocking",
        },
    ):
        response = PipelineRunApi().post(context, DATASET_ID)
        assert response.get_json() == {"batch": "batch-1"}

    call_name, call_values = pipeline_workflows.calls[0]
    command = call_values[2]  # type: ignore[index]
    assert call_name == "run"
    assert isinstance(command, PipelineRun)
    assert command.is_published is True
    assert command.streaming is False


@pytest.mark.parametrize(
    ("field", "value"),
    [("datasource_type", "private_datasource"), ("response_mode", "sync")],
)
def test_run_pipeline_rejects_invalid_runtime_enum_as_bad_request(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows, field: str, value: str
) -> None:
    payload: dict[str, object] = {
        "inputs": {},
        "datasource_type": "local_file",
        "datasource_info_list": [],
        "start_node_id": "node-1",
        "is_published": True,
        "response_mode": "blocking",
    }
    payload[field] = value
    with app.test_request_context("/datasets/id/pipeline/run", method="POST", json=payload):
        with pytest.raises(InvalidArgumentError):
            PipelineRunApi().post(_context(), DATASET_ID)

    assert pipeline_workflows.calls == []


def test_pipeline_configuration_error_returns_http_400(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    pipeline_workflows.pipeline_error = PipelineConfigurationError("Datasource type does not match the configured node")

    @app.errorhandler(InvalidArgumentError)
    def handle_invalid_argument(error: InvalidArgumentError):
        return error.data, error.code

    @app.post("/test/datasets/<uuid:dataset_id>/pipeline/run")
    def run_pipeline(dataset_id: UUID):
        return PipelineRunApi().post(_context(), dataset_id)

    response = app.test_client().post(
        f"/test/datasets/{DATASET_ID}/pipeline/run",
        json={
            "inputs": {},
            "datasource_type": "online_drive",
            "datasource_info_list": [{"id": "remote-file"}],
            "start_node_id": "node-1",
            "is_published": True,
            "response_mode": "blocking",
        },
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "Datasource type does not match the configured node",
        "status": 400,
    }


def test_upload_passes_detached_bytes_and_serializes_result(
    app: Flask, pipeline_workflows: RecordingPipelineWorkflows
) -> None:
    context = _context()
    file = FileStorage(stream=io.BytesIO(b"notes"), filename="notes.txt", content_type="text/plain")
    with app.test_request_context(
        "/datasets/pipeline/file-upload",
        method="POST",
        content_type="multipart/form-data",
        data={"file": file},
    ):
        body, status = KnowledgebasePipelineFileUploadApi().post(context)

    assert status == 201
    assert body == {
        "id": "file-1",
        "name": "notes.txt",
        "size": 5,
        "extension": "txt",
        "mime_type": "text/plain",
        "created_by": "account-1",
        "created_at": "2026-10-19T00:00:00+00:00",
    }
    call_name, call_values = pipeline_workflows.calls[0]
    upload = call_values[1]  # type: ignore[index]
    assert call_name == "upload"
    assert upload == PipelineFileUpload(filename="notes.txt", content=b"notes", mimetype="text/plain")
