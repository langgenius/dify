from datetime import UTC, datetime
from types import SimpleNamespace
from typing import override
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.orm import Session

from core.entities.knowledge_entities import PreviewDetail
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import AttachmentDocument, Document
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile


def _persist_upload(session: Session, *, upload_id: str, name: str) -> UploadFile:
    upload = UploadFile(
        tenant_id=str(uuid4()),
        storage_type=StorageType.LOCAL,
        key=f"uploads/{name}",
        name=name,
        size=4,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime.now(UTC),
        used=True,
    )
    upload.id = upload_id
    session.add(upload)
    return upload


class _ForwardingBaseIndexProcessor(BaseIndexProcessor):
    @override
    def extract(self, extract_setting, *, session, **kwargs):
        return super().extract(extract_setting, session=session, **kwargs)

    @override
    def transform(self, documents, current_user=None, *, session, **kwargs):
        return super().transform(documents, current_user=current_user, session=session, **kwargs)

    @override
    def generate_summary_preview(self, tenant_id, preview_texts, summary_index_setting, doc_language=None, *, session):
        return super().generate_summary_preview(
            tenant_id=tenant_id,
            preview_texts=preview_texts,
            summary_index_setting=summary_index_setting,
            doc_language=doc_language,
            session=session,
        )

    @override
    def load(
        self,
        dataset,
        documents,
        multimodal_documents=None,
        with_keywords=True,
        *,
        session,
        **kwargs,
    ):
        return super().load(
            dataset=dataset,
            documents=documents,
            multimodal_documents=multimodal_documents,
            with_keywords=with_keywords,
            session=session,
            **kwargs,
        )

    @override
    def clean(self, dataset, node_ids, with_keywords=True, *, session, **kwargs):
        return super().clean(dataset=dataset, node_ids=node_ids, with_keywords=with_keywords, session=session, **kwargs)

    @override
    def index(self, dataset, document, chunks, session):
        return super().index(dataset=dataset, document=document, chunks=chunks, session=session)

    @override
    def format_preview(self, chunks):
        return super().format_preview(chunks)


class TestBaseIndexProcessor:
    @pytest.fixture
    def processor(self) -> _ForwardingBaseIndexProcessor:
        return _ForwardingBaseIndexProcessor()

    def test_abstract_methods_raise_not_implemented(
        self, processor: _ForwardingBaseIndexProcessor, unbound_session: Session
    ) -> None:
        with pytest.raises(NotImplementedError):
            processor.extract(Mock(), session=unbound_session)
        with pytest.raises(NotImplementedError):
            processor.transform([], session=unbound_session)
        with pytest.raises(NotImplementedError):
            processor.generate_summary_preview(
                "tenant", [PreviewDetail(content="c")], {"enable": False}, session=unbound_session
            )
        with pytest.raises(NotImplementedError):
            processor.load(Mock(), [], session=unbound_session)
        with pytest.raises(NotImplementedError):
            processor.clean(Mock(), None, session=unbound_session)
        with pytest.raises(NotImplementedError):
            processor.index(Mock(), Mock(), {}, unbound_session)
        with pytest.raises(NotImplementedError):
            processor.format_preview([])

    def test_get_splitter_validates_custom_length(self, processor: _ForwardingBaseIndexProcessor) -> None:
        with patch(
            "core.rag.index_processor.index_processor_base.dify_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH", 1000
        ):
            with pytest.raises(ValueError, match="between 50 and 1000"):
                processor._get_splitter("custom", 49, 0, "", None)
            with pytest.raises(ValueError, match="between 50 and 1000"):
                processor._get_splitter("custom", 1001, 0, "", None)

    def test_get_splitter_custom_mode_uses_fixed_splitter(self, processor: _ForwardingBaseIndexProcessor) -> None:
        fixed_splitter = Mock()
        with patch(
            "core.rag.index_processor.index_processor_base.FixedRecursiveCharacterTextSplitter.from_encoder",
            return_value=fixed_splitter,
        ) as mock_fixed:
            splitter = processor._get_splitter("hierarchical", 120, 10, "\\n\\n", None)

        assert splitter is fixed_splitter
        assert mock_fixed.call_args.kwargs["fixed_separator"] == "\n\n"
        assert mock_fixed.call_args.kwargs["chunk_size"] == 120

    def test_get_splitter_automatic_mode_uses_enhance_splitter(self, processor: _ForwardingBaseIndexProcessor) -> None:
        auto_splitter = Mock()
        with patch(
            "core.rag.index_processor.index_processor_base.EnhanceRecursiveCharacterTextSplitter.from_encoder",
            return_value=auto_splitter,
        ) as mock_enhance:
            splitter = processor._get_splitter("automatic", 0, 0, "", None)

        assert splitter is auto_splitter
        assert "chunk_size" in mock_enhance.call_args.kwargs

    def test_extract_markdown_images(self, processor: _ForwardingBaseIndexProcessor) -> None:
        markdown = "text ![a](https://a/img.png) and ![b](/files/123/file-preview)"
        images = processor._extract_markdown_images(markdown)
        assert images == ["https://a/img.png", "/files/123/file-preview"]

    def test_get_content_files_without_images_returns_empty(
        self, processor: _ForwardingBaseIndexProcessor, unbound_session: Session
    ) -> None:
        document = Document(page_content="no image markdown", metadata={"document_id": "doc-1", "dataset_id": "ds-1"})
        assert processor._get_content_files(document, session=unbound_session) == []

    def test_get_content_files_handles_all_sources_and_duplicates(
        self, processor: _ForwardingBaseIndexProcessor, sqlite_session: Session
    ) -> None:
        document = Document(page_content="ignored", metadata={"document_id": "doc-1", "dataset_id": "ds-1"})
        images = [
            "/files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/image-preview",
            "/files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/image-preview",
            "/files/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/file-preview",
            "/files/tools/cccccccc-cccc-cccc-cccc-cccccccccccc.png",
            "https://example.com/remote.png?x=1",
        ]
        _persist_upload(sqlite_session, upload_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name="a.png")
        _persist_upload(sqlite_session, upload_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name="b.png")
        tool_upload = _persist_upload(sqlite_session, upload_id=str(uuid4()), name="tool.png")
        remote_upload = _persist_upload(sqlite_session, upload_id=str(uuid4()), name="remote.png")
        sqlite_session.commit()
        current_user = Mock()

        with (
            patch.object(processor, "_extract_markdown_images", return_value=images),
            patch.object(processor, "_download_tool_file", return_value=tool_upload.id) as mock_tool_download,
            patch.object(processor, "_download_image", return_value=remote_upload.id) as mock_image_download,
        ):
            files = processor._get_content_files(document, current_user=current_user, session=sqlite_session)

        assert len(files) == 5
        assert all(isinstance(file, AttachmentDocument) for file in files)
        assert files[0].metadata["doc_type"] == DocType.IMAGE
        assert files[0].metadata["document_id"] == "doc-1"
        assert files[0].metadata["dataset_id"] == "ds-1"
        assert files[0].metadata["doc_id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        assert files[1].metadata["doc_id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        mock_tool_download.assert_called_once_with(
            "cccccccc-cccc-cccc-cccc-cccccccccccc",
            current_user,
            session=sqlite_session,
        )
        mock_image_download.assert_called_once()

    def test_get_content_files_skips_tool_and_remote_download_without_user(
        self, processor: _ForwardingBaseIndexProcessor, unbound_session: Session
    ) -> None:
        document = Document(page_content="ignored", metadata={"document_id": "doc-1", "dataset_id": "ds-1"})
        images = ["/files/tools/cccccccc-cccc-cccc-cccc-cccccccccccc.png", "https://example.com/remote.png"]

        with patch.object(processor, "_extract_markdown_images", return_value=images):
            files = processor._get_content_files(document, current_user=None, session=unbound_session)

        assert files == []

    def test_get_content_files_ignores_missing_upload_records(
        self, processor: _ForwardingBaseIndexProcessor, sqlite_session: Session
    ) -> None:
        document = Document(page_content="ignored", metadata={"document_id": "doc-1", "dataset_id": "ds-1"})
        images = ["/files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/image-preview"]
        with (
            patch.object(processor, "_extract_markdown_images", return_value=images),
        ):
            files = processor._get_content_files(document, session=sqlite_session)

        assert files == []

    def test_download_image_success_with_filename_from_content_disposition(
        self, processor: _ForwardingBaseIndexProcessor
    ) -> None:
        response = Mock()
        response.headers = {
            "Content-Length": "4",
            "content-disposition": "attachment; filename=test-image.png",
            "content-type": "image/png",
        }
        response.raise_for_status.return_value = None
        response.iter_bytes.return_value = [b"data"]
        upload_result = SimpleNamespace(id="upload-id")

        mock_db = Mock()
        mock_db.engine = Mock()

        with (
            patch("core.rag.index_processor.index_processor_base.remote_fetcher.make_request", return_value=response),
            patch("core.rag.index_processor.index_processor_base.db", mock_db),
            patch("services.file_service.FileService") as mock_file_service,
        ):
            mock_file_service.return_value.upload_file.return_value = upload_result
            upload_id = processor._download_image("https://example.com/test.png", current_user=Mock())

        assert upload_id == "upload-id"
        mock_file_service.return_value.upload_file.assert_called_once()

    def test_download_image_validates_size_and_empty_content(self, processor: _ForwardingBaseIndexProcessor) -> None:
        too_large = Mock()
        too_large.headers = {"Content-Length": str(3 * 1024 * 1024), "content-type": "image/png"}
        too_large.raise_for_status.return_value = None

        with patch("core.rag.index_processor.index_processor_base.remote_fetcher.make_request", return_value=too_large):
            assert processor._download_image("https://example.com/too-large.png", current_user=Mock()) is None

        empty = Mock()
        empty.headers = {"Content-Length": "0", "content-type": "image/png"}
        empty.raise_for_status.return_value = None
        empty.iter_bytes.return_value = []

        with patch("core.rag.index_processor.index_processor_base.remote_fetcher.make_request", return_value=empty):
            assert processor._download_image("https://example.com/empty.png", current_user=Mock()) is None

    def test_download_image_limits_stream_size(self, processor: _ForwardingBaseIndexProcessor) -> None:
        response = Mock()
        response.headers = {"content-type": "image/png"}
        response.raise_for_status.return_value = None
        response.iter_bytes.return_value = [b"a" * (3 * 1024 * 1024)]

        with patch("core.rag.index_processor.index_processor_base.remote_fetcher.make_request", return_value=response):
            assert processor._download_image("https://example.com/big-stream.png", current_user=Mock()) is None

    def test_download_image_handles_timeout_request_and_unexpected_errors(
        self, processor: _ForwardingBaseIndexProcessor
    ) -> None:
        request = httpx.Request("GET", "https://example.com/image.png")

        with patch(
            "core.rag.index_processor.index_processor_base.remote_fetcher.make_request",
            side_effect=httpx.TimeoutException("timeout"),
        ):
            assert processor._download_image("https://example.com/image.png", current_user=Mock()) is None

        with patch(
            "core.rag.index_processor.index_processor_base.remote_fetcher.make_request",
            side_effect=httpx.RequestError("bad request", request=request),
        ):
            assert processor._download_image("https://example.com/image.png", current_user=Mock()) is None

        with patch(
            "core.rag.index_processor.index_processor_base.remote_fetcher.make_request",
            side_effect=RuntimeError("unexpected"),
        ):
            assert processor._download_image("https://example.com/image.png", current_user=Mock()) is None

    def test_download_tool_file_returns_none_when_not_found(
        self, processor: _ForwardingBaseIndexProcessor, sqlite_session: Session
    ) -> None:
        assert processor._download_tool_file(str(uuid4()), current_user=Mock(), session=sqlite_session) is None

    def test_download_tool_file_uploads_file_when_found(
        self, processor: _ForwardingBaseIndexProcessor, sqlite_session: Session
    ) -> None:
        tool_file = ToolFile(
            user_id=str(uuid4()),
            tenant_id=str(uuid4()),
            conversation_id=None,
            file_key="k1",
            mimetype="image/png",
            name="tool.png",
            size=4,
        )
        sqlite_session.add(tool_file)
        sqlite_session.commit()
        mock_db = Mock()
        mock_db.engine = Mock()
        upload_result = SimpleNamespace(id="upload-id")

        with (
            patch("core.rag.index_processor.index_processor_base.db", mock_db),
            patch("core.rag.index_processor.index_processor_base.storage.load_once", return_value=b"blob") as mock_load,
            patch("services.file_service.FileService") as mock_file_service,
        ):
            mock_file_service.return_value.upload_file.return_value = upload_result
            result = processor._download_tool_file(tool_file.id, current_user=Mock(), session=sqlite_session)

        assert result == "upload-id"
        mock_load.assert_called_once_with("k1")
        mock_file_service.return_value.upload_file.assert_called_once()
