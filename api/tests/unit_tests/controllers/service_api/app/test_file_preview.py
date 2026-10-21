"""Unit tests for the Service API file-preview transport boundary."""

from inspect import unwrap
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import pytest
from flask import Response

from controllers.service_api.app.error import (
    FileAccessDeniedError,
    FileNotFoundError,
    NotWorkflowAppError,
)
from controllers.service_api.app.error import (
    WorkflowRunFileNotReferencedError as WorkflowRunFileNotReferencedHttpError,
)
from controllers.service_api.app.error import (
    WorkflowRunFileNotRetainedError as WorkflowRunFileNotRetainedHttpError,
)
from controllers.service_api.app.file_preview import (
    FilePreviewApi,
    FilePreviewQuery,
    WorkflowRunFileDownloadApi,
)
from models.model import App, AppMode, EndUser
from services.message_file_preview_service import (
    MessageFilePreview,
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewRecord,
)
from services.workflow_run_file_download_service import (
    WorkflowRunFileAccessDeniedError,
    WorkflowRunFileDownload,
    WorkflowRunFileNotFoundError,
    WorkflowRunFileNotReferencedError,
    WorkflowRunFileNotRetainedError,
    WorkflowRunFileRecord,
)


def _preview(
    *,
    mime_type: str | None = "image/jpeg",
    name: str = "test_file.jpg",
    extension: str = "jpg",
    size: int = 1024,
) -> MessageFilePreview:
    return MessageFilePreview(
        content=iter([b"file content"]),
        file=MessageFilePreviewRecord(
            key="storage/key/test_file.jpg",
            name=name,
            size=size,
            extension=extension,
            mime_type=mime_type,
        ),
    )


def _app() -> App:
    return App(id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.WORKFLOW)


def _get(
    *,
    api: FilePreviewApi,
    args: FilePreviewQuery,
    app_model: App,
    file_id: UUID,
) -> Response:
    return unwrap(api.get)(
        api,
        args=args,
        app_model=app_model,
        end_user=EndUser(id=str(uuid4()), app_id=app_model.id, tenant_id=app_model.tenant_id),
        file_id=file_id,
    )


class TestFilePreviewApi:
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_uses_authenticated_app_scope(self, mock_application_services: Mock) -> None:
        app_model = _app()
        file_id = uuid4()
        preview = _preview()
        service = mock_application_services.return_value.message_file_previews
        service.get_preview.return_value = preview

        response = _get(
            api=FilePreviewApi(),
            args=FilePreviewQuery(),
            app_model=app_model,
            file_id=file_id,
        )

        service.get_preview.assert_called_once_with(
            file_id=str(file_id),
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
        )
        assert response.response is preview.content
        assert response.mimetype == "image/jpeg"

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (MessageFilePreviewNotFoundError(), FileNotFoundError),
            (MessageFilePreviewAccessDeniedError(), FileAccessDeniedError),
        ],
    )
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_maps_expected_errors(
        self,
        mock_application_services: Mock,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        mock_application_services.return_value.message_file_previews.get_preview.side_effect = service_error

        with pytest.raises(http_error):
            _get(
                api=FilePreviewApi(),
                args=FilePreviewQuery(),
                app_model=_app(),
                file_id=uuid4(),
            )

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_does_not_mask_storage_errors(self, mock_application_services: Mock) -> None:
        mock_application_services.return_value.message_file_previews.get_preview.side_effect = OSError("storage down")

        with pytest.raises(OSError, match="storage down"):
            _get(
                api=FilePreviewApi(),
                args=FilePreviewQuery(),
                app_model=_app(),
                file_id=uuid4(),
            )

    @pytest.mark.parametrize(
        ("preview", "as_attachment"),
        [
            (_preview(), False),
            (_preview(name="报告 1.jpg"), True),
            (_preview(mime_type="text/html", name="unsafe.html", extension="html"), False),
            (_preview(mime_type="video/mp4", name="video.mp4", extension="mp4"), False),
            (_preview(size=0), False),
        ],
    )
    def test_build_file_response(self, preview: MessageFilePreview, as_attachment: bool) -> None:
        response = FilePreviewApi()._build_file_response(
            preview=preview,
            as_attachment=as_attachment,
        )

        assert response.direct_passthrough is True
        assert response.headers["Cache-Control"] == "public, max-age=3600"
        assert ("Content-Length" in response.headers) is (preview.file.size > 0)
        if as_attachment:
            assert response.headers["Content-Disposition"] == (
                "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A%201.jpg"
            )
            assert response.headers["Content-Type"] == "application/octet-stream"
        elif preview.file.mime_type == "text/html":
            assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''unsafe.html"
            assert response.headers["Content-Type"] == "application/octet-stream"
            assert response.headers["X-Content-Type-Options"] == "nosniff"
        else:
            assert response.mimetype == preview.file.mime_type
        if preview.file.mime_type == "video/mp4":
            assert response.headers["Accept-Ranges"] == "bytes"


def _workflow_download(*, name: str = "report.pdf", size: int = 13) -> WorkflowRunFileDownload:
    return WorkflowRunFileDownload(
        content=iter([b"" if size == 0 else b"workflow file"]),
        file=WorkflowRunFileRecord(
            key="tool_files/tenant/report.pdf",
            name=name,
            size=size,
            extension="pdf",
            mime_type="application/pdf",
        ),
    )


def _get_run_file(
    *,
    args: FilePreviewQuery,
    app_model: App,
    run_id: UUID,
    file_id: UUID,
) -> Response:
    api = WorkflowRunFileDownloadApi()
    return unwrap(api.get)(
        api,
        args=args,
        app_model=app_model,
        workflow_run_id=run_id,
        file_id=file_id,
    )


class TestWorkflowRunFileDownloadApi:
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_uses_authenticated_app_and_run_scope(self, mock_application_services: Mock) -> None:
        app_model = _app()
        run_id = uuid4()
        file_id = uuid4()
        download = _workflow_download()
        service = mock_application_services.return_value.workflow_run_file_downloads
        service.get_file.return_value = download

        response = _get_run_file(
            args=FilePreviewQuery(as_attachment=True),
            app_model=app_model,
            run_id=run_id,
            file_id=file_id,
        )

        service.get_file.assert_called_once_with(
            file_id=str(file_id),
            run_id=str(run_id),
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
        )
        assert response.response is download.content
        assert response.headers["Cache-Control"] == "private, no-store"
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''report.pdf"

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_handles_empty_attachment_without_filename_or_content_length(
        self, mock_application_services: Mock
    ) -> None:
        app_model = _app()
        service = mock_application_services.return_value.workflow_run_file_downloads
        service.get_file.return_value = _workflow_download(name="", size=0)

        response = _get_run_file(
            args=FilePreviewQuery(as_attachment=True),
            app_model=app_model,
            run_id=uuid4(),
            file_id=uuid4(),
        )

        assert response.response is not None
        assert "Content-Length" not in response.headers
        assert "Content-Disposition" not in response.headers
        assert response.headers["Cache-Control"] == "private, no-store"

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_rejects_non_workflow_app_modes(self, mock_application_services: Mock) -> None:
        app_model = _app()
        app_model.mode = AppMode.CHAT

        with pytest.raises(NotWorkflowAppError):
            _get_run_file(args=FilePreviewQuery(), app_model=app_model, run_id=uuid4(), file_id=uuid4())

        mock_application_services.assert_not_called()

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (WorkflowRunFileNotFoundError(), FileNotFoundError),
            (WorkflowRunFileNotReferencedError(), WorkflowRunFileNotReferencedHttpError),
            (WorkflowRunFileAccessDeniedError(), FileAccessDeniedError),
            (WorkflowRunFileNotRetainedError(), WorkflowRunFileNotRetainedHttpError),
        ],
    )
    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_maps_authorization_and_retention_errors(
        self,
        mock_application_services: Mock,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        mock_application_services.return_value.workflow_run_file_downloads.get_file.side_effect = service_error

        with pytest.raises(http_error):
            _get_run_file(args=FilePreviewQuery(), app_model=_app(), run_id=uuid4(), file_id=uuid4())

    @patch("controllers.service_api.app.file_preview.application_services")
    def test_get_does_not_mask_storage_errors(self, mock_application_services: Mock) -> None:
        mock_application_services.return_value.workflow_run_file_downloads.get_file.side_effect = OSError(
            "storage down"
        )

        with pytest.raises(OSError, match="storage down"):
            _get_run_file(args=FilePreviewQuery(), app_model=_app(), run_id=uuid4(), file_id=uuid4())
