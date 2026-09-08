from collections.abc import Sequence
from dataclasses import dataclass
from unittest.mock import Mock, create_autospec

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
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.indexing.errors import IndexingInputSourceError, UnsupportedStoredSourceError
from services.knowledge.indexing.estimate import (
    DatasetEstimateRecord,
    EstimateDatasetReader,
    EstimateDocumentAlreadyFinishedError,
    EstimateDocumentNotFoundError,
    EstimateDocumentReader,
    EstimateDocumentRecord,
    EstimateSourceNotFoundError,
    IndexingEstimateApplicationService,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateRunner,
    NotionEstimateSourceResolver,
    ProcessRuleReader,
    StoredEstimateSourceResolver,
    StoredSource,
    UnsupportedEstimateSourceError,
    UploadEstimateSourceResolver,
    WebsiteEstimateSourceResolver,
)
from services.knowledge.resource_scope import DatasetRef


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


def _files(*, workspace_id: str, file_ids: Sequence[str], document_model: str) -> dict[str, ExtractSetting]:
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
class ServiceFixture:
    service: IndexingEstimateApplicationService
    access: Mock
    datasets: Mock
    documents: Mock
    files: Mock
    notion: Mock
    websites: Mock
    stored: Mock
    rules: Mock
    runner: Mock


@pytest.fixture
def fixture() -> ServiceFixture:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = _access_dataset()
    access.check_access.side_effect = AssertionError("Estimate access must use the selected dataset")
    datasets = create_autospec(EstimateDatasetReader, instance=True, spec_set=True)
    datasets.get_estimate_record.return_value = _estimate_dataset()
    documents = create_autospec(EstimateDocumentReader, instance=True, spec_set=True)
    documents.get_estimate_document.return_value = _document()
    documents.list_estimate_documents_by_batch.return_value = ()
    files = create_autospec(UploadEstimateSourceResolver, instance=True, spec_set=True)
    files.resolve_selections.side_effect = _files
    notion = create_autospec(NotionEstimateSourceResolver, instance=True, spec_set=True)
    notion.resolve_selection.return_value = ExtractSetting(datasource_type=DatasourceType.NOTION)
    websites = create_autospec(WebsiteEstimateSourceResolver, instance=True, spec_set=True)
    websites.resolve_selection.return_value = ExtractSetting(datasource_type=DatasourceType.WEBSITE)
    stored = create_autospec(StoredEstimateSourceResolver, instance=True, spec_set=True)
    stored.resolve.side_effect = lambda source: ExtractSetting(
        datasource_type=source.source_type, document_model=source.document_model
    )
    rules = create_autospec(ProcessRuleReader, instance=True, spec_set=True)
    rules.get_by_id.return_value = {"mode": "custom", "rules": {"segmentation": dict[str, object]()}}
    runner = create_autospec(IndexingEstimateRunner, instance=True, spec_set=True)
    runner.run.side_effect = lambda **kwargs: IndexingEstimate(
        total_segments=len(kwargs["extract_settings"]), preview=[]
    )
    service = IndexingEstimateApplicationService(
        dataset_access=access,
        datasets=datasets,
        documents=documents,
        files=files,
        notion=notion,
        websites=websites,
        stored_sources=stored,
        process_rules=rules,
        runner=runner,
    )
    return ServiceFixture(service, access, datasets, documents, files, notion, websites, stored, rules, runner)


def test_estimate_new_sources_resolves_each_variant_and_normalizes_rule(fixture: ServiceFixture) -> None:

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
    fixture.access.require_accessible.assert_called_once_with(_context(), "dataset-1")
    fixture.files.resolve_selections.assert_called_once_with(
        workspace_id="workspace-1",
        file_ids=("file-1",),
        document_model="text_model",
    )
    fixture.notion.resolve_selection.assert_called_once_with(
        workspace_id="workspace-1",
        actor_id="account-1",
        credential_id="credential-1",
        notion_workspace_id="notion-workspace",
        page_id="page-1",
        page_type=NotionPageType.PAGE,
        document_model="text_model",
    )
    fixture.websites.resolve_selection.assert_called_once_with(
        workspace_id="workspace-1",
        provider="firecrawl",
        job_id="job-1",
        url="https://example.com",
        mode="crawl",
        only_main_content=True,
        document_model="text_model",
    )
    assert fixture.runner.run.call_args.kwargs["tmp_processing_rule"] == {"mode": "automatic", "rules": {}}
    assert fixture.runner.run.call_args.kwargs["dataset_id"] == "dataset-1"


@pytest.mark.parametrize("dataset_id", [None, ""])
@pytest.mark.parametrize(
    "source",
    [
        NotionEstimateSource("notion-workspace", "page-1", NotionPageType.PAGE, "credential-1"),
        WebsiteEstimateSource("firecrawl", "job-1", "https://example.com"),
    ],
    ids=["notion", "website"],
)
def test_estimate_new_dataset_accepts_missing_or_empty_dataset_id(
    fixture: ServiceFixture,
    dataset_id: str | None,
    source: NotionEstimateSource | WebsiteEstimateSource,
) -> None:
    result = fixture.service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(
            sources=(source,),
            process_rule={"mode": "automatic"},
            dataset_id=dataset_id,
        ),
    )

    assert result.total_segments == 1
    fixture.access.require_accessible.assert_not_called()
    assert fixture.runner.run.call_args.kwargs["dataset_id"] is None


def test_estimate_new_sources_stops_when_dataset_access_is_denied(fixture: ServiceFixture) -> None:
    fixture.access.require_accessible.side_effect = DatasetAccessDeniedError()

    with pytest.raises(DatasetAccessDeniedError):
        fixture.service.estimate_new_sources(
            _context(),
            NewSourcesEstimateCommand(
                sources=(UploadFileEstimateSource("file-1"),),
                process_rule={"mode": "automatic"},
                dataset_id="dataset-1",
            ),
        )

    fixture.files.resolve_selections.assert_not_called()
    fixture.runner.run.assert_not_called()


def test_estimate_new_notion_source_maps_actor_credential_failure_without_running(fixture: ServiceFixture) -> None:
    fixture.notion.resolve_selection.side_effect = DatasourceCredentialNotFoundError()

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

    fixture.runner.run.assert_not_called()


def test_estimate_empty_new_sources_returns_zero_without_runner_call(fixture: ServiceFixture) -> None:

    result = fixture.service.estimate_new_sources(
        _context(),
        NewSourcesEstimateCommand(sources=(), process_rule={"mode": "automatic"}),
    )

    assert result == IndexingEstimate(total_segments=0, preview=[])
    fixture.runner.run.assert_not_called()


def test_estimate_batch_preserves_first_document_contract_and_loads_its_rule(fixture: ServiceFixture) -> None:
    documents = (_document("document-1"), _document("document-2"))
    fixture.documents.list_estimate_documents_by_batch.return_value = documents

    fixture.service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    fixture.stored.resolve.assert_called_once_with(StoredSource.from_document(documents[0]))
    fixture.rules.get_by_id.assert_called_once_with(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        process_rule_id="rule-1",
    )
    fixture.documents.list_estimate_documents_by_batch.assert_called_once_with(
        DatasetRef("workspace-1", "dataset-1"),
        "batch-1",
    )
    assert fixture.runner.run.call_args.kwargs["indexing_technique"] == "high_quality"


def test_estimate_uses_automatic_rule_when_document_has_no_saved_rule(fixture: ServiceFixture) -> None:
    fixture.documents.get_estimate_document.return_value = _document(process_rule_id=None)

    fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    fixture.datasets.get_estimate_record.assert_called_once_with(DatasetRef("workspace-1", "dataset-1"))
    fixture.documents.get_estimate_document.assert_called_once_with(
        DatasetRef("workspace-1", "dataset-1").document("document-1")
    )
    fixture.rules.get_by_id.assert_not_called()
    assert fixture.runner.run.call_args.kwargs["tmp_processing_rule"] == {"mode": "automatic", "rules": {}}


def test_estimate_rejects_missing_saved_process_rule(fixture: ServiceFixture) -> None:
    fixture.rules.get_by_id.return_value = None

    with pytest.raises(EstimateSourceNotFoundError, match="rule-1"):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    fixture.runner.run.assert_not_called()


def test_estimate_empty_batch_raises_not_found_without_runner_call(fixture: ServiceFixture) -> None:

    with pytest.raises(EstimateDocumentNotFoundError):
        fixture.service.estimate_batch(_context(), dataset_id="dataset-1", batch="batch-1")

    fixture.runner.run.assert_not_called()


@pytest.mark.parametrize("status", ["completed", "error"])
def test_estimate_rejects_finished_document(fixture: ServiceFixture, status: str) -> None:
    fixture.documents.get_estimate_document.return_value = _document(status=status)

    with pytest.raises(EstimateDocumentAlreadyFinishedError):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")

    fixture.runner.run.assert_not_called()


def test_estimate_rejects_missing_document(fixture: ServiceFixture) -> None:
    fixture.documents.get_estimate_document.return_value = None

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
def test_estimate_translates_source_boundary_errors(
    fixture: ServiceFixture, source_error: Exception, expected_error: type[Exception]
) -> None:
    fixture.stored.resolve.side_effect = source_error

    with pytest.raises(expected_error):
        fixture.service.estimate_document(_context(), dataset_id="dataset-1", document_id="document-1")


def test_multi_file_estimate_reads_once_and_preserves_selection_order(fixture: ServiceFixture) -> None:
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
    fixture.files.resolve_selections.assert_called_once_with(
        workspace_id="workspace-1",
        file_ids=("file-2", "file-1"),
        document_model="text_model",
    )
    settings = fixture.runner.run.call_args.kwargs["extract_settings"]
    assert [setting.upload_file.id for setting in settings if setting.upload_file is not None] == [
        "file-2",
        "file-1",
        "file-2",
    ]
