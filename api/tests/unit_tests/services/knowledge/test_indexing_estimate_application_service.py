from dataclasses import dataclass, field

import pytest

from core.entities.knowledge_entities import IndexingEstimate
from core.rag.entities.dataset_reference import DatasetRef, DocumentRef
from machinery.context import RequestContext
from services.entities.knowledge_entities.indexing_estimate import (
    EstimateCommand,
    ExistingDocumentsEstimateCommand,
    NewEstimateSource,
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.entities.knowledge_entities.records import DatasetRecord, DocumentRecord
from services.knowledge.application import (
    DatasetAccessDeniedError,
    EstimateDocumentAlreadyFinishedError,
    EstimateDocumentNotFoundError,
    IndexingEstimateApplicationService,
)


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _dataset() -> DatasetRecord:
    return DatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        maintainer_id="account-1",
        permission="only_me",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        embedding_model=None,
        embedding_model_provider=None,
    )


def _document(document_id: str = "document-1", *, status: str = "waiting") -> DocumentRecord:
    return DocumentRecord(
        id=document_id,
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        name=document_id,
        data_source_type="upload_file",
        data_source_info={"upload_file_id": f"file-{document_id}"},
        enabled=True,
        archived=False,
        indexing_status=status,
        batch="batch-1",
        doc_form="text_model",
        doc_language="English",
        dataset_process_rule_id="rule-1",
        need_summary=False,
        doc_metadata=None,
    )


@dataclass
class DatasetAccessStub:
    dataset: DatasetRecord = field(default_factory=_dataset)
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> DatasetRecord:
        assert context == _context()
        self.calls.append(dataset_id)
        if self.error is not None:
            raise self.error
        return self.dataset


@dataclass
class DocumentReaderStub:
    document: DocumentRecord | None = field(default_factory=_document)
    batch: tuple[DocumentRecord, ...] = ()

    def get_by_ref(self, document_ref: DocumentRef) -> DocumentRecord | None:
        assert document_ref.dataset == DatasetRef("workspace-1", "dataset-1")
        return self.document

    def list_by_batch(self, dataset_ref: DatasetRef, batch: str) -> tuple[DocumentRecord, ...]:
        assert dataset_ref == DatasetRef("workspace-1", "dataset-1")
        assert batch == "batch-1"
        return self.batch


@dataclass
class GatewayRecorder:
    calls: list[tuple[str, str, EstimateCommand]] = field(default_factory=list)

    def estimate(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        command: EstimateCommand,
    ) -> IndexingEstimate:
        self.calls.append((workspace_id, actor_id, command))
        return IndexingEstimate(total_segments=len(getattr(command, "sources", ())), preview=[])


def _service(
    *,
    access: DatasetAccessStub | None = None,
    documents: DocumentReaderStub | None = None,
    gateway: GatewayRecorder | None = None,
) -> tuple[IndexingEstimateApplicationService, GatewayRecorder]:
    recorder = gateway or GatewayRecorder()
    return (
        IndexingEstimateApplicationService(
            dataset_access=access or DatasetAccessStub(),
            documents=documents or DocumentReaderStub(),
            gateway=recorder,
        ),
        recorder,
    )


@pytest.mark.parametrize(
    "source",
    [
        UploadFileEstimateSource("file-1"),
        NotionEstimateSource("notion-workspace", "page-1", "page", "credential-1"),
        WebsiteEstimateSource("firecrawl", "job-1", "https://example.com"),
    ],
)
def test_estimate_new_sources_supports_each_explicit_variant(source: NewEstimateSource) -> None:
    service, gateway = _service()
    command = NewSourcesEstimateCommand(
        sources=(source,),
        process_rule={"mode": "automatic", "summary_index_setting": {"enable": None}},
    )

    service.estimate_new_sources(_context(), command)

    normalized = gateway.calls[0][2]
    assert isinstance(normalized, NewSourcesEstimateCommand)
    assert normalized.sources == (source,)
    assert normalized.process_rule == {"mode": "automatic", "rules": {}}


def test_estimate_new_sources_validates_optional_dataset_before_gateway_call() -> None:
    access = DatasetAccessStub()
    service, gateway = _service(access=access)

    service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(
            sources=(UploadFileEstimateSource("file-1"),),
            process_rule={"mode": "automatic"},
            dataset_id="dataset-1",
        ),
    )

    assert access.calls == ["dataset-1"]
    command = gateway.calls[0][2]
    assert isinstance(command, NewSourcesEstimateCommand)
    assert command.dataset_id == "dataset-1"


def test_estimate_new_sources_stops_when_dataset_access_is_denied() -> None:
    access = DatasetAccessStub(error=DatasetAccessDeniedError())
    service, gateway = _service(access=access)

    with pytest.raises(DatasetAccessDeniedError):
        service.estimate_new_sources(
            _context(),
            NewSourcesEstimateCommand(
                sources=(UploadFileEstimateSource("file-1"),),
                process_rule={"mode": "automatic"},
                dataset_id="dataset-1",
            ),
        )

    assert gateway.calls == []


def test_estimate_batch_sends_all_documents_in_one_gateway_call() -> None:
    documents = (_document("document-1"), _document("document-2"))
    service, gateway = _service(documents=DocumentReaderStub(batch=documents))

    service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    assert len(gateway.calls) == 1
    command = gateway.calls[0][2]
    assert isinstance(command, ExistingDocumentsEstimateCommand)
    assert command.documents == documents


def test_estimate_empty_batch_returns_zero_without_gateway_call() -> None:
    service, gateway = _service(documents=DocumentReaderStub(batch=()))

    result = service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    assert result == IndexingEstimate(total_segments=0, preview=[])
    assert gateway.calls == []


@pytest.mark.parametrize("status", ["completed", "error"])
def test_estimate_rejects_finished_document(status: str) -> None:
    service, gateway = _service(documents=DocumentReaderStub(document=_document(status=status)))

    with pytest.raises(EstimateDocumentAlreadyFinishedError):
        service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    assert gateway.calls == []


def test_estimate_rejects_missing_document() -> None:
    service, _ = _service(documents=DocumentReaderStub(document=None))

    with pytest.raises(EstimateDocumentNotFoundError):
        service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")


def test_estimate_single_document_calls_gateway_with_owned_document() -> None:
    document = _document()
    service, gateway = _service(documents=DocumentReaderStub(document=document))

    service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    assert len(gateway.calls) == 1
    command = gateway.calls[0][2]
    assert isinstance(command, ExistingDocumentsEstimateCommand)
    assert command.documents == (document,)
