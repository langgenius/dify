"""Indexing-estimate application service and its consumer-owned ports."""

from collections.abc import Mapping, Sequence
from typing import NamedTuple, Never, Protocol

from core.entities.knowledge_entities import IndexingEstimate
from core.rag.entities.extraction import ExtractSetting
from core.rag.extractor.entity.datasource_type import NotionPageType
from machinery.context import RequestContext
from services.data_source.credential_gateway import DatasourceCredentialError
from services.entities.knowledge_entities.indexing_estimate import (
    NewEstimateSource,
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
    normalize_process_rule,
)
from services.knowledge.dataset_access import DatasetAccess, DatasetNotFoundError
from services.knowledge.indexing.errors import (
    IndexingInputSourceError,
    SourceCredentialUnavailableError,
    UnsupportedStoredSourceError,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef


class DatasetEstimateRecord(NamedTuple):
    """Dataset state required to estimate stored documents."""

    id: str
    workspace_id: str
    indexing_technique: str | None


class EstimateDocumentRecord(NamedTuple):
    """Document state required by the stored-document estimate use case."""

    id: str
    workspace_id: str
    dataset_id: str
    data_source_type: str
    data_source_info: Mapping[str, object] | None
    indexing_status: str
    doc_form: str
    doc_language: str | None
    dataset_process_rule_id: str | None

    @property
    def ref(self) -> DocumentRef:
        return DatasetRef(self.workspace_id, self.dataset_id).document(self.id)


class StoredSource(NamedTuple):
    """A persisted extraction source bound to its owning document."""

    document_ref: DocumentRef
    source_type: str
    source_info: Mapping[str, object] | None
    document_model: str

    @classmethod
    def from_document(cls, document: EstimateDocumentRecord) -> "StoredSource":
        return cls(
            document_ref=document.ref,
            source_type=document.data_source_type,
            source_info=document.data_source_info,
            document_model=document.doc_form,
        )


class EstimateDocumentReader(Protocol):
    def get_estimate_document(self, document_ref: DocumentRef) -> EstimateDocumentRecord | None: ...

    def list_estimate_documents_by_batch(
        self, dataset_ref: DatasetRef, batch: str
    ) -> tuple[EstimateDocumentRecord, ...]: ...


class EstimateDatasetReader(Protocol):
    def get_estimate_record(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord | None: ...


class UploadEstimateSourceResolver(Protocol):
    def resolve_selections(
        self, *, workspace_id: str, file_ids: Sequence[str], document_model: str
    ) -> Mapping[str, ExtractSetting]: ...


class NotionEstimateSourceResolver(Protocol):
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
    ) -> ExtractSetting: ...


class WebsiteEstimateSourceResolver(Protocol):
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
    ) -> ExtractSetting: ...


class StoredEstimateSourceResolver(Protocol):
    def resolve(self, source: StoredSource) -> ExtractSetting: ...


class ProcessRuleReader(Protocol):
    def get_by_id(self, *, dataset_ref: DatasetRef, process_rule_id: str) -> Mapping[str, object] | None: ...


class IndexingEstimateRunner(Protocol):
    def run(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: Mapping[str, object],
        doc_form: str | None = None,
        doc_language: str = "English",
        dataset_id: str | None = None,
        indexing_technique: str = "economy",
    ) -> IndexingEstimate: ...


class IndexingEstimateApplicationError(Exception):
    """Base class for framework-neutral estimate failures."""


class EstimateSourceNotFoundError(IndexingEstimateApplicationError):
    def __init__(self, source_id: str) -> None:
        super().__init__(f"Estimate source not found: {source_id}")


class UnsupportedEstimateSourceError(IndexingEstimateApplicationError):
    def __init__(self, source_type: str) -> None:
        super().__init__(f"Data source type not supported: {source_type}")


class IndexingEstimateCredentialUnavailableError(IndexingEstimateApplicationError):
    """Raised when a datasource credential required by an estimate is unavailable."""


class IndexingEstimateProviderUnavailableError(IndexingEstimateApplicationError):
    """Raised when a configured model or plugin provider is unavailable."""


class IndexingEstimateExecutionError(IndexingEstimateApplicationError):
    """Raised when the estimate processor cannot complete an estimate."""


class EstimateDocumentNotFoundError(IndexingEstimateApplicationError):
    def __init__(self) -> None:
        super().__init__("Document not found")


class EstimateDocumentAlreadyFinishedError(IndexingEstimateApplicationError):
    def __init__(self) -> None:
        super().__init__("Document already finished")


class IndexingEstimateApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        datasets: EstimateDatasetReader,
        documents: EstimateDocumentReader,
        files: UploadEstimateSourceResolver,
        notion: NotionEstimateSourceResolver,
        websites: WebsiteEstimateSourceResolver,
        stored_sources: StoredEstimateSourceResolver,
        process_rules: ProcessRuleReader,
        runner: IndexingEstimateRunner,
    ) -> None:
        self._dataset_access = dataset_access
        self._datasets = datasets
        self._documents = documents
        self._files = files
        self._notion = notion
        self._websites = websites
        self._stored_sources = stored_sources
        self._process_rules = process_rules
        self._runner = runner

    def estimate_new_sources(
        self,
        context: RequestContext,
        command: NewSourcesEstimateCommand,
    ) -> IndexingEstimate:
        dataset_id = command.dataset_id or None
        if dataset_id is not None:
            dataset = self._dataset_access.require_accessible(context, dataset_id)
            dataset_id = dataset.id
        process_rule = normalize_process_rule(command.process_rule)

        try:
            file_settings = self._files.resolve_selections(
                workspace_id=context.active_workspace_id,
                file_ids=tuple(
                    dict.fromkeys(
                        source.file_id for source in command.sources if isinstance(source, UploadFileEstimateSource)
                    )
                ),
                document_model=command.doc_form,
            )
            extract_settings = [
                file_settings[source.file_id]
                if isinstance(source, UploadFileEstimateSource)
                else self._resolve_new_source(context, source, document_model=command.doc_form)
                for source in command.sources
            ]
            if not extract_settings:
                return IndexingEstimate(total_segments=0, preview=[])
            return self._runner.run(
                tenant_id=context.active_workspace_id,
                extract_settings=extract_settings,
                tmp_processing_rule=process_rule,
                doc_form=command.doc_form,
                doc_language=command.doc_language,
                dataset_id=dataset_id,
                indexing_technique=command.indexing_technique,
            )
        except Exception as error:
            self._translate_error(error)

    def estimate_document(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
    ) -> IndexingEstimate:
        accessible = self._dataset_access.require_accessible(context, dataset_id)
        dataset_ref = DatasetRef(accessible.workspace_id, accessible.id)
        dataset = self._require_estimate_dataset(dataset_ref)
        document = self._documents.get_estimate_document(dataset_ref.document(document_id))
        if document is None:
            raise EstimateDocumentNotFoundError()
        return self._estimate_document(context, dataset, document)

    def estimate_batch(self, context: RequestContext, *, dataset_id: str, batch: str) -> IndexingEstimate:
        accessible = self._dataset_access.require_accessible(context, dataset_id)
        dataset_ref = DatasetRef(accessible.workspace_id, accessible.id)
        dataset = self._require_estimate_dataset(dataset_ref)
        documents = self._documents.list_estimate_documents_by_batch(dataset_ref, batch)
        if not documents:
            raise EstimateDocumentNotFoundError()
        # A batch preview uses its first document, as the existing API does.
        return self._estimate_document(context, dataset, documents[0])

    def _estimate_document(
        self,
        context: RequestContext,
        dataset: DatasetEstimateRecord,
        document: EstimateDocumentRecord,
    ) -> IndexingEstimate:
        if document.indexing_status in {"completed", "error"}:
            raise EstimateDocumentAlreadyFinishedError()
        try:
            extract_setting = self._stored_sources.resolve(StoredSource.from_document(document))
            process_rule = self._load_process_rule(dataset, document)
            return self._runner.run(
                tenant_id=context.active_workspace_id,
                extract_settings=[extract_setting],
                tmp_processing_rule=process_rule,
                doc_form=document.doc_form,
                doc_language=document.doc_language or "English",
                dataset_id=dataset.id,
                indexing_technique=dataset.indexing_technique or "economy",
            )
        except Exception as error:
            self._translate_error(error)

    def _resolve_new_source(
        self, context: RequestContext, source: NewEstimateSource, *, document_model: str
    ) -> ExtractSetting:
        if isinstance(source, NotionEstimateSource):
            return self._notion.resolve_selection(
                workspace_id=context.active_workspace_id,
                actor_id=context.account_id,
                credential_id=source.credential_id,
                notion_workspace_id=source.workspace_id,
                page_id=source.page_id,
                page_type=source.page_type,
                document_model=document_model,
            )
        if isinstance(source, WebsiteEstimateSource):
            return self._websites.resolve_selection(
                workspace_id=context.active_workspace_id,
                provider=source.provider,
                job_id=source.job_id,
                url=source.url,
                mode=source.mode,
                only_main_content=source.only_main_content,
                document_model=document_model,
            )
        source_type = getattr(source, "source_type", type(source).__name__)
        raise UnsupportedEstimateSourceError(str(source_type))

    def _load_process_rule(
        self,
        dataset: DatasetEstimateRecord,
        document: EstimateDocumentRecord,
    ) -> Mapping[str, object]:
        process_rule_id = document.dataset_process_rule_id
        if not process_rule_id:
            return {"mode": "automatic", "rules": {}}
        process_rule = self._process_rules.get_by_id(
            dataset_ref=DatasetRef(dataset.workspace_id, dataset.id),
            process_rule_id=process_rule_id,
        )
        if process_rule is None:
            raise EstimateSourceNotFoundError(process_rule_id)
        return process_rule

    @staticmethod
    def _translate_error(error: Exception) -> Never:
        if isinstance(error, IndexingEstimateApplicationError):
            raise error
        if isinstance(error, UnsupportedStoredSourceError):
            raise UnsupportedEstimateSourceError(error.source_type) from error
        if isinstance(error, (DatasourceCredentialError, SourceCredentialUnavailableError)):
            raise IndexingEstimateCredentialUnavailableError(str(error)) from error
        if isinstance(error, IndexingInputSourceError):
            raise EstimateSourceNotFoundError(str(error)) from error
        raise IndexingEstimateExecutionError(str(error)) from error

    def _require_estimate_dataset(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord:
        dataset = self._datasets.get_estimate_record(dataset_ref)
        if dataset is None:
            raise DatasetNotFoundError()
        return dataset
