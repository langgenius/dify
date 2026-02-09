import io
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

import controllers.console  # noqa: F401
from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import (
    KnowledgebasePipelineFileUploadApi,
)


def test_file_upload_response_serializes_created_at_to_unix_timestamp() -> None:
    app = Flask(__name__)
    created_at = datetime(2026, 2, 9, 0, 0, tzinfo=UTC)
    upload_file = SimpleNamespace(
        id="file-1",
        name="test.txt",
        size=3,
        extension="txt",
        mime_type="text/plain",
        created_by="account-1",
        created_at=created_at,
    )

    class _FakeFileService:
        def __init__(self, _engine) -> None:
            pass

        def upload_file(self, **_kwargs):
            return upload_file

    with app.test_request_context(
        method="POST",
        data={"file": (io.BytesIO(b"abc"), "test.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        with (
            patch(
                "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user",
                SimpleNamespace(id="account-1"),
            ),
            patch(
                "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.FileService",
                _FakeFileService,
            ),
            patch(
                "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db",
                SimpleNamespace(engine=object()),
            ),
        ):
            response, status_code = KnowledgebasePipelineFileUploadApi().post(tenant_id="tenant-1")

    assert status_code == 201
    assert response["created_at"] == int(created_at.timestamp())
