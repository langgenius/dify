from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from core.entities.knowledge_entities import IndexingEstimate
from core.rag.entities.extraction import ExtractSetting, UploadFileExtractionInput
from core.rag.extractor.entity.datasource_type import DatasourceType, NotionPageType
from machinery.context import RequestContext
from services.data_source.credential_gateway import DatasourceCredentialNotFoundError
from services.entities.knowledge_entities.indexing_estimate import (
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessDeniedError, DatasetAccessSnapshot
from services.knowledge.indexing.errors import IndexingInputSourceError, UnsupportedStoredSourceError
from services.knowledge.indexing.estimate import (
    DatasetEstimateRecord,
    EstimateDocumentAlreadyFinishedError,
    EstimateDocumentNotFoundError,
    EstimateDocumentRecord,
    EstimateSourceNotFoundError,
    IndexingEstimateApplicationService,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    StoredSource,
    UnsupportedEstimateSourceError,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _access_dataset() -> AccessibleDataset:
    return AccessibleDataset(
        id="dataset-1",
        workspace_id="workspace-1",
    )


def _estimate_dataset() -> DatasetEstimateRecord:
    return DatasetEstimateRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        indexing_technique="high_quality",
    )


def _document(
    document_id: str = "document-1",
    *,
    status: str = "waiting",
    process_rule_id: str | None = "rule-1",
) -> EstimateDocumentRecord:
    return EstimateDocumentRecord(
        id=document_id,
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        data_source_type="upload_file",
        data_source_info={"upload_file_id": f"file-{document_id}"},
        indexing_status=status,
        doc_form="text_model",
        doc_language="English",
        dataset_process_rule_id=process_rule_id,
    )


@dataclass
class DatasetAccessStub:
    dataset: AccessibleDataset = field(default_factory=_access_dataset)
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context == _context()
        self.calls.append(dataset_id)
        if self.error is not None:
            raise self.error
        return self.dataset

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        del context, snapshot
        raise AssertionError("Estimate access must use the selected dataset")


@dataclass
class DatasetReaderStub:
    dataset: DatasetEstimateRecord | None = field(default_factory=_estimate_dataset)

    def get_estimate_record(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord | None:
        assert dataset_ref == DatasetRef("workspace-1", "dataset-1")
        return self.dataset


@dataclass
class DocumentReaderStub:
    document: EstimateDocumentRecord | None = field(default_factory=_document)
    batch: tuple[EstimateDocumentRecord, ...] = ()

    def get_estimate_document(self, document_ref: DocumentRef) -> EstimateDocumentRecord | None:
        assert document_ref.dataset == DatasetRef("workspace-1", "dataset-1")
        return self.document

    def list_estimate_documents_by_batch(
        self, dataset_ref: DatasetRef, batch: str
    ) -> tuple[EstimateDocumentRecord, ...]:
        assert dataset_ref == DatasetRef("workspace-1", "dataset-1")
        assert batch == "batch-1"
        return self.batch


@dataclass
class FileSourceStub:
    calls: list[tuple[str, tuple[str, ...], str]] = field(default_factory=list)

    def resolve_selections(
        self, *, workspace_id: str, file_ids: Sequence[str], document_model: str
    ) -> dict[str, ExtractSetting]:
        self.calls.append((workspace_id, tuple(file_ids), document_model))
        return {
            file_id: ExtractSetting(
                datasource_type=DatasourceType.FILE,
                document_model=document_model,
                upload_file=UploadFileExtractionInput(
                    id=file_id, tenant_id=workspace_id, key=file_id, created_by="account-1"
                ),
            )
            for file_id in file_ids
        }


@dataclass
class NotionSourceStub:
    error: Exception | None = None
    calls: list[tuple[str, str, str, str, str, NotionPageType, str]] = field(default_factory=list)

    def resolve_selection(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        notion_workspace_id: str,
        page_id: str,
        page_type: NotionPageType,
        document_model: str,
    ) -> ExtractSetting:
        self.calls.append(
            (workspace_id, actor_id, credential_id, notion_workspace_id, page_id, page_type, document_model)
        )
        if self.error is not None:
            raise self.error
        return ExtractSetting(datasource_type=DatasourceType.NOTION, document_model=document_model)


@dataclass
class WebsiteSourceStub:
    calls: list[tuple[str, str, str, str, str, bool, str]] = field(default_factory=list)

    def resolve_selection(
        self,
        *,
        workspace_id: str,
        provider: str,
        job_id: str,
        url: str,
        mode: str,
        only_main_content: bool,
        document_model: str,
    ) -> ExtractSetting:
        self.calls.append((workspace_id, provider, job_id, url, mode, only_main_content, document_model))
        return ExtractSetting(datasource_type=DatasourceType.WEBSITE, document_model=document_model)


@dataclass
class StoredSourceStub:
    error: Exception | None = None
    calls: list[StoredSource] = field(default_factory=list)

    def resolve(self, source: StoredSource) -> ExtractSetting:
        self.calls.append(source)
        if self.error is not None:
            raise self.error
        return ExtractSetting(datasource_type=source.source_type, document_model=source.document_model)


@dataclass
class ProcessRuleReaderStub:
    process_rule: Mapping[str, object] | None = field(
        default_factory=lambda: {"mode": "custom", "rules": {"segmentation": dict[str, object]()}}
    )
    calls: list[tuple[DatasetRef, str]] = field(default_factory=list)

    def get_by_id(self, *, dataset_ref: DatasetRef, process_rule_id: str) -> Mapping[str, object] | None:
        self.calls.append((dataset_ref, process_rule_id))
        return self.process_rule


@dataclass(frozen=True)
class RunnerCall:
    tenant_id: str
    source_types: tuple[str, ...]
    process_rule: Mapping[str, object]
    doc_form: str | None
    doc_language: str
    dataset_id: str | None
    indexing_technique: str


@dataclass
class RunnerStub:
    selections: list[tuple[ExtractSetting, ...]] = field(default_factory=list)
    calls: list[RunnerCall] = field(default_factory=list)
    error: Exception | None = None

    def run(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: Mapping[str, object],
        doc_form: str | None = None,
        doc_language: str = "English",
        dataset_id: str | None = None,
        indexing_technique: str = "economy",
    ) -> IndexingEstimate:
        if self.error is not None:
            raise self.error
        self.selections.append(tuple(extract_settings))
        self.calls.append(
            RunnerCall(
                tenant_id=tenant_id,
                source_types=tuple(setting.datasource_type for setting in extract_settings),
                process_rule=tmp_processing_rule,
                doc_form=doc_form,
                doc_language=doc_language,
                dataset_id=dataset_id,
                indexing_technique=indexing_technique,
            )
        )
        return IndexingEstimate(total_segments=len(extract_settings), preview=[])


@dataclass
class ServiceFixture:
    service: IndexingEstimateApplicationService
    access: DatasetAccessStub
    files: FileSourceStub
    notion: NotionSourceStub
    websites: WebsiteSourceStub
    stored: StoredSourceStub
    rules: ProcessRuleReaderStub
    runner: RunnerStub


def _service(
    *,
    access: DatasetAccessStub | None = None,
    documents: DocumentReaderStub | None = None,
    datasets: DatasetReaderStub | None = None,
    notion: NotionSourceStub | None = None,
    stored: StoredSourceStub | None = None,
    rules: ProcessRuleReaderStub | None = None,
    runner: RunnerStub | None = None,
) -> ServiceFixture:
    access_stub = access or DatasetAccessStub()
    files_stub = FileSourceStub()
    notion_stub = notion or NotionSourceStub()
    websites_stub = WebsiteSourceStub()
    stored_stub = stored or StoredSourceStub()
    rules_stub = rules or ProcessRuleReaderStub()
    runner_stub = runner or RunnerStub()
    return ServiceFixture(
        service=IndexingEstimateApplicationService(
            dataset_access=access_stub,
            datasets=datasets or DatasetReaderStub(),
            documents=documents or DocumentReaderStub(),
            files=files_stub,
            notion=notion_stub,
            websites=websites_stub,
            stored_sources=stored_stub,
            process_rules=rules_stub,
            runner=runner_stub,
        ),
        access=access_stub,
        files=files_stub,
        notion=notion_stub,
        websites=websites_stub,
        stored=stored_stub,
        rules=rules_stub,
        runner=runner_stub,
    )


def test_estimate_new_sources_resolves_each_variant_and_normalizes_rule() -> None:
    fixture = _service()

    result = fixture.service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(
            sources=(
                UploadFileEstimateSource("file-1"),
                NotionEstimateSource("notion-workspace", "page-1", NotionPageType.PAGE, "credential-1"),
                WebsiteEstimateSource("firecrawl", "job-1", "https://example.com", only_main_content=True),
            ),
            process_rule={"mode": "automatic", "summary_index_setting": {"enable": None}},
            dataset_id="dataset-1",
        ),
    )

    assert result.total_segments == 3
    assert fixture.access.calls == ["dataset-1"]
    assert fixture.files.calls == [("workspace-1", ("file-1",), "text_model")]
    assert fixture.notion.calls == [
        (
            "workspace-1",
            "account-1",
            "credential-1",
            "notion-workspace",
            "page-1",
            NotionPageType.PAGE,
            "text_model",
        )
    ]
    assert fixture.websites.calls == [
        ("workspace-1", "firecrawl", "job-1", "https://example.com", "crawl", True, "text_model")
    ]
    assert fixture.runner.calls[0].process_rule == {"mode": "automatic", "rules": {}}
    assert fixture.runner.calls[0].dataset_id == "dataset-1"


def test_estimate_new_sources_stops_when_dataset_access_is_denied() -> None:
    fixture = _service(access=DatasetAccessStub(error=DatasetAccessDeniedError()))

    with pytest.raises(DatasetAccessDeniedError):
        fixture.service.estimate_new_sources(
            _context(),
            NewSourcesEstimateCommand(
                sources=(UploadFileEstimateSource("file-1"),),
                process_rule={"mode": "automatic"},
                dataset_id="dataset-1",
            ),
        )

    assert fixture.files.calls == []
    assert fixture.runner.calls == []


def test_estimate_new_notion_source_maps_actor_credential_failure_without_running() -> None:
    fixture = _service(notion=NotionSourceStub(error=DatasourceCredentialNotFoundError()))

    with pytest.raises(IndexingEstimateCredentialUnavailableError):
        fixture.service.estimate_new_sources(
            _context(),
            NewSourcesEstimateCommand(
                sources=(
                    NotionEstimateSource(
                        "notion-workspace",
                        "page-1",
                        NotionPageType.PAGE,
                        "private-credential",
                    ),
                ),
                process_rule={"mode": "automatic"},
            ),
        )

    assert fixture.runner.calls == []


def test_estimate_empty_new_sources_returns_zero_without_runner_call() -> None:
    fixture = _service()

    result = fixture.service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(sources=(), process_rule={"mode": "automatic"}),
    )

    assert result == IndexingEstimate(total_segments=0, preview=[])
    assert fixture.runner.calls == []


def test_estimate_batch_preserves_first_document_contract_and_loads_its_rule() -> None:
    documents = (_document("document-1"), _document("document-2"))
    fixture = _service(documents=DocumentReaderStub(batch=documents))

    fixture.service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    assert [source.document_ref.document_id for source in fixture.stored.calls] == ["document-1"]
    assert fixture.rules.calls == [(DatasetRef("workspace-1", "dataset-1"), "rule-1")]
    assert fixture.runner.calls[0].indexing_technique == "high_quality"


def test_estimate_uses_automatic_rule_when_document_has_no_saved_rule() -> None:
    fixture = _service(documents=DocumentReaderStub(document=_document(process_rule_id=None)))

    fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    assert fixture.rules.calls == []
    assert fixture.runner.calls[0].process_rule == {"mode": "automatic", "rules": {}}


def test_estimate_rejects_missing_saved_process_rule() -> None:
    fixture = _service(rules=ProcessRuleReaderStub(process_rule=None))

    with pytest.raises(EstimateSourceNotFoundError, match="rule-1"):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    assert fixture.runner.calls == []


def test_estimate_empty_batch_raises_not_found_without_runner_call() -> None:
    fixture = _service(documents=DocumentReaderStub(batch=()))

    with pytest.raises(EstimateDocumentNotFoundError):
        fixture.service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    assert fixture.runner.calls == []


@pytest.mark.parametrize("status", ["completed", "error"])
def test_estimate_rejects_finished_document(status: str) -> None:
    fixture = _service(documents=DocumentReaderStub(document=_document(status=status)))

    with pytest.raises(EstimateDocumentAlreadyFinishedError):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    assert fixture.runner.calls == []


def test_estimate_rejects_missing_document() -> None:
    fixture = _service(documents=DocumentReaderStub(document=None))

    with pytest.raises(EstimateDocumentNotFoundError):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")


@pytest.mark.parametrize(
    ("source_error", "expected_error"),
    [
        (DatasourceCredentialNotFoundError(), IndexingEstimateCredentialUnavailableError),
        (IndexingInputSourceError("missing source"), EstimateSourceNotFoundError),
        (UnsupportedStoredSourceError("unknown"), UnsupportedEstimateSourceError),
        (RuntimeError("failed"), IndexingEstimateExecutionError),
    ],
)
def test_estimate_translates_source_boundary_errors(source_error: Exception, expected_error: type[Exception]) -> None:
    fixture = _service(stored=StoredSourceStub(error=source_error))

    with pytest.raises(expected_error):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")


def test_multi_file_estimate_reads_once_and_preserves_selection_order() -> None:
    fixture = _service()
    fixture.service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(
            sources=(
                UploadFileEstimateSource("file-2"),
                UploadFileEstimateSource("file-1"),
                UploadFileEstimateSource("file-2"),
            ),
            process_rule={"mode": "automatic"},
        ),
    )
    assert fixture.files.calls == [("workspace-1", ("file-2", "file-1"), "text_model")]
    settings = fixture.runner.selections[0]
    assert [setting.upload_file.id for setting in settings if setting.upload_file is not None] == [
        "file-2",
        "file-1",
        "file-2",
    ]
