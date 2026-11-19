"""Hit-testing presentation behavior over real persistence boundaries."""

from collections.abc import Mapping, Sequence
from contextlib import nullcontext
from datetime import datetime
from unittest.mock import create_autospec
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document as RetrievalDocument
from core.tools.signature import verify_tool_file_signature
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from fields.hit_testing_fields import HitTestingRecord, HitTestingResponse
from graphon.file import helpers as file_helpers
from machinery.context import RequestContext
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from models.tools import ToolFile
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_query_repository import SEGMENT_FILE_LINK
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.entities.file_access import FileAccessScopeView
from services.knowledge.entities.external import ExternalRetrievalCandidate, ExternalRetrievalConfig
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.entities.segments import SegmentFileAccess
from services.knowledge.hit_testing import adapters
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.entities import HitTestingRequest

REF = DatasetRef("tenant", "dataset")
CONTEXT = RequestContext("request", None, "viewer", REF.tenant_id)


class _UnexpectedExternalRetrieval:
    def retrieve(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> list[ExternalRetrievalCandidate]:
        """Fail if an internal-dataset test crosses the external retrieval boundary."""
        del tenant_id, dataset_id, query, retrieval_model, metadata_filters
        raise AssertionError("internal dataset reached external retrieval")


def _document() -> Document:
    """Build one indexed document owned by the test dataset."""
    return Document(
        id="document",
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        indexing_status=IndexingStatus.COMPLETED,
    )


def _segment(segment_id: str, node_id: str, *, content: str) -> DocumentSegment:
    """Build one eligible segment with caller-selected indexed content."""
    segment = DocumentSegment(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        document_id="document",
        position=1,
        content=content,
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id=node_id,
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _upload(file_id: str, *, tenant_id: str = REF.tenant_id) -> UploadFile:
    """Build an account-owned upload under the requested tenant."""
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=file_id,
        name=f"{file_id}.png",
        extension="png",
        mime_type="image/png",
        size=1,
        created_by="admin",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    upload.id = file_id
    return upload


def _binding(file_id: str, *, segment_id: str = "safe-segment") -> SegmentAttachmentBinding:
    """Bind one upload to a segment in the complete owner chain."""
    return SegmentAttachmentBinding(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        document_id="document",
        segment_id=segment_id,
        attachment_id=file_id,
    )


def _tool_file(file_id: str) -> ToolFile:
    """Build a ToolFile owned by the end user in the active scope."""
    tool_file = ToolFile(
        user_id="viewer",
        tenant_id=REF.tenant_id,
        conversation_id=None,
        file_key=f"tools/{file_id}",
        mimetype="text/plain",
        name=f"{file_id}.txt",
        size=1,
    )
    tool_file.id = file_id
    return tool_file


def _hit(node_id: str, *, score: float, image: bool = False) -> RetrievalDocument:
    """Build one untrusted retrieval candidate for gateway revalidation."""
    return RetrievalDocument(
        page_content="retrieved",
        metadata={
            "document_id": "document",
            "doc_id": node_id,
            "score": score,
            "doc_type": DocType.IMAGE if image else None,
            "_retrieval_source_dataset_id": REF.dataset_id,
        },
    )


def _scope() -> FileAccessScope:
    """Build an end-user scope without pre-existing file grants."""
    return FileAccessScope(
        tenant_id=REF.tenant_id,
        user_id="viewer",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )


def _query_values(uri: str) -> dict[str, str]:
    """Return the first value for each query parameter in a generated link."""
    return {key: values[0] for key, values in parse_qs(urlsplit(uri).query).items()}


@pytest.fixture
def gateway_and_segments(
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[DatasetHitTestingGateway, SQLAlchemySegmentRepository]:
    """Wire the hit-testing gateway to real SQLite repositories."""
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id=REF.dataset_id, tenant_id=REF.tenant_id, name="Dataset", created_by="admin"))
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    gateway = DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(
            session_factory=sqlite_session_factory,
            revoke_keys_after_commit=lambda _session, _keys: None,
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        segments=segments,
        session_factory=sqlite_session_factory,
        external_retrieval=_UnexpectedExternalRetrieval(),
    )
    return gateway, segments


@pytest.mark.parametrize("end_user", [True, False], ids=["end-user-scope", "console-without-scope"])
def test_response_signs_only_authorized_embedded_file_links(
    gateway_and_segments: tuple[DatasetHitTestingGateway, SQLAlchemySegmentRepository],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    end_user: bool,
) -> None:
    """Refresh authorized links and strip stale signatures from inaccessible references."""
    gateway, _ = gateway_and_segments
    selected_upload_id = "00000000-0000-0000-0000-000000000101"
    ungranted_upload_id = "00000000-0000-0000-0000-000000000102"
    foreign_upload_id = "00000000-0000-0000-0000-000000000103"
    owned_tool_id = "00000000-0000-0000-0000-000000000201"
    missing_tool_id = "00000000-0000-0000-0000-000000000202"
    content = " ".join(
        [
            f"![image](/files/{selected_upload_id}/image-preview?timestamp=old&nonce=old&sign=old)",
            f"[file](/files/{selected_upload_id}/file-preview?timestamp=old&nonce=old&sign=old)",
            f"[ungranted](/files/{ungranted_upload_id}/file-preview?timestamp=old&nonce=old&sign=old)",
            f"[foreign](/files/{foreign_upload_id}/file-preview?timestamp=old&nonce=old&sign=old)",
            f"[tool](/files/tools/{owned_tool_id}.txt?timestamp=old&nonce=old&sign=old)",
            f"[missing-tool](/files/tools/{missing_tool_id}.txt?timestamp=old&nonce=old&sign=old)",
        ]
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(),
                _segment("safe-segment", "safe-node", content=content),
                _upload(selected_upload_id),
                _binding(selected_upload_id),
                _upload(ungranted_upload_id),
                _upload(foreign_upload_id, tenant_id="foreign"),
                _tool_file(owned_tool_id),
            ]
        )
    monkeypatch.setattr(
        RetrievalService,
        "retrieve",
        create_autospec(
            RetrievalService.retrieve,
            spec_set=True,
            return_value=[_hit("safe-node", score=0.9), _hit(selected_upload_id, score=0.8, image=True)],
        ),
    )

    scope_context = bind_file_access_scope(_scope()) if end_user else nullcontext()
    with scope_context:
        response = HitTestingResponse.model_validate(
            gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", None, None, None)).response
        )
        scope = get_current_file_access_scope()
        if end_user:
            assert scope is not None
            assert scope.granted_upload_file_ids == frozenset({selected_upload_id})
            assert scope.granted_retriever_segment_ids == frozenset({"safe-segment"})
        else:
            assert scope is None

    record = next(record for record in response.records if isinstance(record, HitTestingRecord))
    assert record.segment.content == content
    assert record.segment.sign_content is not None
    assert "sign=old" not in record.segment.sign_content
    links = {
        urlsplit(match.group()).path: match.group() for match in SEGMENT_FILE_LINK.finditer(record.segment.sign_content)
    }
    image_query = _query_values(links[f"/files/{selected_upload_id}/image-preview"])
    assert file_helpers.verify_image_signature(upload_file_id=selected_upload_id, **image_query)
    file_query = _query_values(links[f"/files/{selected_upload_id}/file-preview"])
    assert file_helpers.verify_file_signature(upload_file_id=selected_upload_id, **file_query)
    tool_query = _query_values(links[f"/files/tools/{owned_tool_id}.txt"])
    assert verify_tool_file_signature(owned_tool_id, **tool_query)
    ungranted_query = _query_values(links[f"/files/{ungranted_upload_id}/file-preview"])
    if end_user:
        assert ungranted_query == {}
    else:
        assert file_helpers.verify_file_signature(upload_file_id=ungranted_upload_id, **ungranted_query)
    assert _query_values(links[f"/files/{foreign_upload_id}/file-preview"]) == {}
    assert _query_values(links[f"/files/tools/{missing_tool_id}.txt"]) == {}


def test_content_access_and_signing_run_only_for_the_final_top_k_selection(
    gateway_and_segments: tuple[DatasetHitTestingGateway, SQLAlchemySegmentRepository],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Authorize and sign only records remaining after the final top-k selection."""
    gateway, segments = gateway_and_segments
    selected_content = "[selected](/files/00000000-0000-0000-0000-000000000401/file-preview)"
    excluded_content = "[excluded](/files/00000000-0000-0000-0000-000000000402/file-preview)"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(),
                _segment("selected-segment", "selected-node", content=selected_content),
                _segment("excluded-segment", "excluded-node", content=excluded_content),
            ]
        )
    monkeypatch.setattr(
        RetrievalService,
        "retrieve",
        create_autospec(
            RetrievalService.retrieve,
            spec_set=True,
            return_value=[_hit("excluded-node", score=0.8), _hit("selected-node", score=0.9)],
        ),
    )
    queried_segment_ids: list[tuple[str, ...]] = []
    signed_contents: list[str] = []
    load_access = segments.get_retrieval_content_file_access
    sign_content = adapters.sign_segment_text

    def capture_access(
        ref: DatasetRef, *, segment_ids: Sequence[str], scope: FileAccessScopeView | None
    ) -> Mapping[str, SegmentFileAccess]:
        queried_segment_ids.append(tuple(segment_ids))
        return load_access(ref, segment_ids=segment_ids, scope=scope)

    def capture_signing(
        content: str,
        *,
        allowed_uploads: set[str] | frozenset[str],
        allowed_tools: set[str] | frozenset[str],
    ) -> str:
        signed_contents.append(content)
        return sign_content(content, allowed_uploads=allowed_uploads, allowed_tools=allowed_tools)

    monkeypatch.setattr(segments, "get_retrieval_content_file_access", capture_access)
    monkeypatch.setattr(adapters, "sign_segment_text", capture_signing)
    model = {
        "search_method": "semantic_search",
        "reranking_enable": False,
        "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        "top_k": 1,
        "score_threshold_enabled": False,
    }

    with bind_file_access_scope(_scope()):
        response = HitTestingResponse.model_validate(
            gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", model, None, None)).response
        )
        scope = get_current_file_access_scope()
        assert scope is not None
        assert scope.granted_retriever_segment_ids == frozenset({"selected-segment"})

    records = [record for record in response.records if isinstance(record, HitTestingRecord)]
    assert [record.segment.id for record in records] == ["selected-segment"]
    assert queried_segment_ids == [("selected-segment",)]
    assert signed_contents == [selected_content]


def test_content_signing_failure_publishes_no_file_or_segment_grants(
    gateway_and_segments: tuple[DatasetHitTestingGateway, SQLAlchemySegmentRepository],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Leave execution grants unchanged when selected content cannot be signed."""
    gateway, _ = gateway_and_segments
    upload_id = "00000000-0000-0000-0000-000000000301"
    content = f"![image](/files/{upload_id}/image-preview)"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(),
                _segment("safe-segment", "safe-node", content=content),
                _upload(upload_id),
                _binding(upload_id),
            ]
        )
    monkeypatch.setattr(
        RetrievalService,
        "retrieve",
        create_autospec(
            RetrievalService.retrieve,
            spec_set=True,
            return_value=[_hit("safe-node", score=0.9), _hit(upload_id, score=0.8, image=True)],
        ),
    )

    def fail_signing(
        _content: str,
        *,
        allowed_uploads: set[str] | frozenset[str],
        allowed_tools: set[str] | frozenset[str],
    ) -> str:
        del allowed_uploads, allowed_tools
        raise RuntimeError("content signing failed")

    monkeypatch.setattr(adapters, "sign_segment_text", fail_signing)
    with bind_file_access_scope(_scope()):
        with pytest.raises(RuntimeError, match="content signing failed"):
            gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", None, None, None))
        scope = get_current_file_access_scope()
        assert scope is not None
        assert not scope.granted_upload_file_ids
        assert not scope.granted_retriever_segment_ids
