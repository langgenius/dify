from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import core.callback_handler.index_tool_callback_handler as callback_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document
from models.dataset import ChildChunk, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import DataSourceType, DocumentCreatedFrom


class _DatabaseBinding:
    engine: Engine

    def __init__(self, engine: Engine) -> None:
        self.engine = engine


@pytest.fixture
def mock_queue_manager(mocker: MockerFixture):
    return mocker.Mock()


@pytest.fixture
def handler(mock_queue_manager, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(callback_module, "db", _DatabaseBinding(sqlite_engine))
    return DatasetIndexToolCallbackHandler(
        queue_manager=mock_queue_manager,
        app_id=str(uuid4()),
        message_id=str(uuid4()),
        user_id=str(uuid4()),
        invoke_from=InvokeFrom.DEBUGGER,
    )


def _dataset_document(*, doc_form: IndexStructureType) -> DatasetDocument:
    return DatasetDocument(
        tenant_id=str(uuid4()),
        dataset_id=str(uuid4()),
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid4()),
        doc_form=doc_form,
    )


def _segment(document: DatasetDocument, *, index_node_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=document.created_by,
        index_node_id=index_node_id,
        hit_count=0,
    )


class TestOnQuery:
    @pytest.mark.parametrize("sqlite_session", [(DatasetQuery,)], indirect=True)
    @pytest.mark.parametrize(
        ("invoke_from", "expected_role"),
        [
            (InvokeFrom.EXPLORE, "account"),
            (InvokeFrom.DEBUGGER, "account"),
            (InvokeFrom.WEB_APP, "end_user"),
        ],
    )
    def test_on_query_success_roles(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session: Session,
        mock_queue_manager,
        invoke_from: InvokeFrom,
        expected_role: str,
    ) -> None:
        monkeypatch.setattr(callback_module, "db", _DatabaseBinding(sqlite_engine))
        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id=str(uuid4()),
            message_id=str(uuid4()),
            user_id=str(uuid4()),
            invoke_from=invoke_from,
        )

        handler.on_query("test query", str(uuid4()), sqlite_session)

        assert not sqlite_session.in_transaction()
        sqlite_session.expire_all()
        dataset_query = sqlite_session.scalar(select(DatasetQuery))
        assert dataset_query is not None
        assert dataset_query.created_by_role == expected_role

    @pytest.mark.parametrize("sqlite_session", [(DatasetQuery,)], indirect=True)
    def test_on_query_none_values_roll_back_independent_transaction(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session: Session,
        mock_queue_manager,
    ) -> None:
        monkeypatch.setattr(callback_module, "db", _DatabaseBinding(sqlite_engine))
        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id=None,
            message_id=None,
            user_id=None,
            invoke_from=None,
        )

        with pytest.raises(IntegrityError):
            handler.on_query(None, None, sqlite_session)  # type: ignore[arg-type]

        assert sqlite_session.scalar(select(DatasetQuery)) is None


class TestOnToolEnd:
    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_on_tool_end_no_metadata(self, handler: DatasetIndexToolCallbackHandler, sqlite_session: Session) -> None:
        document = Document.model_construct(page_content="content", metadata=None, provider="dify")

        handler.on_tool_end([document], sqlite_session)

        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(DatasetDocument,)], indirect=True)
    def test_on_tool_end_dataset_document_not_found(
        self, handler: DatasetIndexToolCallbackHandler, sqlite_session: Session
    ) -> None:
        document = Document(
            page_content="content",
            metadata={"document_id": str(uuid4()), "doc_id": "node-1"},
        )

        handler.on_tool_end([document], sqlite_session)

        assert sqlite_session.scalar(select(DatasetDocument)) is None

    @pytest.mark.parametrize("sqlite_session", [(DatasetDocument, ChildChunk, DocumentSegment)], indirect=True)
    def test_on_tool_end_parent_child_index_with_child(
        self, handler: DatasetIndexToolCallbackHandler, sqlite_session: Session
    ) -> None:
        dataset_document = _dataset_document(doc_form=IndexStructureType.PARENT_CHILD_INDEX)
        sqlite_session.add(dataset_document)
        sqlite_session.flush()
        segment = _segment(dataset_document, index_node_id="parent-node")
        sqlite_session.add(segment)
        sqlite_session.flush()
        child = ChildChunk(
            tenant_id=dataset_document.tenant_id,
            dataset_id=dataset_document.dataset_id,
            document_id=dataset_document.id,
            segment_id=segment.id,
            position=1,
            content="child",
            word_count=1,
            created_by=dataset_document.created_by,
            index_node_id="child-node",
        )
        sqlite_session.add(child)
        sqlite_session.commit()
        document = Document(
            page_content="content",
            metadata={"document_id": dataset_document.id, "doc_id": child.index_node_id},
        )

        handler.on_tool_end([document], sqlite_session)

        sqlite_session.expire_all()
        assert sqlite_session.get(DocumentSegment, segment.id).hit_count == 1  # type: ignore[union-attr]

    @pytest.mark.parametrize("sqlite_session", [(DatasetDocument, DocumentSegment)], indirect=True)
    def test_on_tool_end_non_parent_child_index(
        self, handler: DatasetIndexToolCallbackHandler, sqlite_session: Session
    ) -> None:
        dataset_document = _dataset_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)
        sqlite_session.add(dataset_document)
        sqlite_session.flush()
        segment = _segment(dataset_document, index_node_id="node-1")
        sqlite_session.add(segment)
        sqlite_session.commit()
        document = Document(
            page_content="content",
            metadata={
                "document_id": dataset_document.id,
                "doc_id": segment.index_node_id,
                "dataset_id": dataset_document.dataset_id,
            },
        )

        handler.on_tool_end([document], sqlite_session)

        sqlite_session.expire_all()
        assert sqlite_session.get(DocumentSegment, segment.id).hit_count == 1  # type: ignore[union-attr]

    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_on_tool_end_empty_documents(
        self, handler: DatasetIndexToolCallbackHandler, sqlite_session: Session
    ) -> None:
        handler.on_tool_end([], sqlite_session)
        assert not sqlite_session.in_transaction()


class TestReturnRetrieverResourceInfo:
    def test_publish_called(self, handler: DatasetIndexToolCallbackHandler, mock_queue_manager, mocker: MockerFixture):
        mock_event = mocker.patch("core.callback_handler.index_tool_callback_handler.QueueRetrieverResourcesEvent")
        resources = [mocker.Mock()]

        handler.return_retriever_resource_info(resources)

        mock_queue_manager.publish.assert_called_once()
