"""Framework-neutral application services for knowledge use cases."""

from typing import Protocol

from core.entities.knowledge_entities import IndexingEstimate
from core.rag.entities.dataset_reference import DatasetRef, DocumentRef
from machinery.context import RequestContext
from services.entities.knowledge_entities.indexing_estimate import (
    EstimateCommand,
    ExistingDocumentsEstimateCommand,
    NewSourcesEstimateCommand,
    normalize_process_rule,
)
from services.entities.knowledge_entities.records import DatasetAccessSnapshot, DatasetRecord, DocumentRecord

_OWNER_ROLE = "owner"
_ONLY_ME = "only_me"
_ALL_TEAM_MEMBERS = "all_team_members"
_PARTIAL_MEMBERS = "partial_members"


class DatasetAccessReader(Protocol):
    """Load tenant-scoped dataset state needed by the access policy."""

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None: ...


class WorkspaceRoleReader(Protocol):
    """Read the account's legacy role in a workspace."""

    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str | None: ...


class DatasetAccessError(Exception):
    """Base class for framework-neutral dataset access failures."""


class DatasetNotFoundError(DatasetAccessError):
    """Raised when a dataset does not belong to the active workspace."""

    def __init__(self) -> None:
        super().__init__("Dataset not found")


class DatasetAccessDeniedError(DatasetAccessError):
    """Raised when legacy dataset permission rules deny the actor."""

    def __init__(self) -> None:
        super().__init__("You do not have permission to access this dataset")


def can_access_dataset(snapshot: DatasetAccessSnapshot, *, actor_id: str, workspace_role: str | None) -> bool:
    """Evaluate legacy dataset visibility without database or framework access."""

    dataset = snapshot.dataset
    if workspace_role == _OWNER_ROLE or dataset.maintainer_id == actor_id:
        return True
    if dataset.permission == _ALL_TEAM_MEMBERS:
        return True
    if dataset.permission == _PARTIAL_MEMBERS:
        return snapshot.actor_has_partial_access
    if dataset.permission == _ONLY_ME:
        return False
    return False


class DatasetAccessService:
    """Resolve an owned dataset and enforce legacy permissions when configured."""

    def __init__(
        self,
        *,
        datasets: DatasetAccessReader,
        workspace_roles: WorkspaceRoleReader,
        legacy_permissions_enabled: bool,
    ) -> None:
        self._datasets = datasets
        self._workspace_roles = workspace_roles
        self._legacy_permissions_enabled = legacy_permissions_enabled

    def require_accessible(self, context: RequestContext, dataset_id: str) -> DatasetRecord:
        snapshot = self._datasets.get_access_snapshot(
            workspace_id=context.active_workspace_id,
            dataset_id=dataset_id,
            actor_id=context.account_id,
        )
        if snapshot is None:
            raise DatasetNotFoundError()
        if not self._legacy_permissions_enabled:
            return snapshot.dataset

        workspace_role = self._workspace_roles.get_legacy_role(
            workspace_id=context.active_workspace_id,
            account_id=context.account_id,
        )
        if can_access_dataset(snapshot, actor_id=context.account_id, workspace_role=workspace_role):
            return snapshot.dataset
        raise DatasetAccessDeniedError()


class DatasetAccess(Protocol):
    def require_accessible(self, context: RequestContext, dataset_id: str) -> DatasetRecord: ...


class SyncDocumentReader(Protocol):
    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]: ...

    def get_by_ref(self, document_ref: DocumentRef) -> DocumentRecord | None: ...


class DocumentSyncDispatcher(Protocol):
    def dispatch(self, *, dataset_id: str, document_id: str) -> None: ...


class DocumentSyncError(Exception):
    """Base class for document synchronization failures."""


class SyncDocumentNotFoundError(DocumentSyncError):
    def __init__(self) -> None:
        super().__init__("Document not found")


class SyncDocumentSourceError(DocumentSyncError):
    def __init__(self) -> None:
        super().__init__("Document is not notion type")


class DocumentSyncApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        documents: SyncDocumentReader,
        dispatcher: DocumentSyncDispatcher,
    ) -> None:
        self._dataset_access = dataset_access
        self._documents = documents
        self._dispatcher = dispatcher

    def sync_dataset(self, context: RequestContext, dataset_id: str) -> int:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        dataset_ref = DatasetRef(context.active_workspace_id, dataset.id)
        document_refs = self._documents.list_active_notion_refs(dataset_ref)
        for document_ref in document_refs:
            self._dispatcher.dispatch(dataset_id=dataset_ref.dataset_id, document_id=document_ref.document_id)
        return len(document_refs)

    def sync_document(self, context: RequestContext, dataset_id: str, document_id: str) -> None:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        document_ref = DatasetRef(context.active_workspace_id, dataset.id).document(document_id)
        document = self._documents.get_by_ref(document_ref)
        if document is None:
            raise SyncDocumentNotFoundError()
        if document.data_source_type != "notion_import":
            raise SyncDocumentSourceError()
        self._dispatcher.dispatch(dataset_id=dataset.id, document_id=document.id)


class EstimateDocumentReader(Protocol):
    def get_by_ref(self, document_ref: DocumentRef) -> DocumentRecord | None: ...

    def list_by_batch(self, dataset_ref: DatasetRef, batch: str) -> tuple[DocumentRecord, ...]: ...


class IndexingEstimateGateway(Protocol):
    def estimate(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        command: EstimateCommand,
    ) -> IndexingEstimate: ...


class IndexingEstimateApplicationError(Exception):
    """Base class for framework-neutral estimate failures."""


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
        documents: EstimateDocumentReader,
        gateway: IndexingEstimateGateway,
    ) -> None:
        self._dataset_access = dataset_access
        self._documents = documents
        self._gateway = gateway

    def estimate_new_sources(
        self,
        context: RequestContext,
        command: NewSourcesEstimateCommand,
    ) -> IndexingEstimate:
        dataset_id = command.dataset_id
        if dataset_id is not None:
            dataset = self._dataset_access.require_accessible(context, dataset_id)
            dataset_id = dataset.id
        normalized = NewSourcesEstimateCommand(
            sources=command.sources,
            process_rule=normalize_process_rule(command.process_rule),
            doc_form=command.doc_form,
            doc_language=command.doc_language,
            dataset_id=dataset_id,
            indexing_technique=command.indexing_technique,
        )
        return self._gateway.estimate(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            command=normalized,
        )

    def estimate_document(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
    ) -> IndexingEstimate:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        document = self._documents.get_by_ref(DatasetRef(context.active_workspace_id, dataset.id).document(document_id))
        if document is None:
            raise EstimateDocumentNotFoundError()
        self._require_unfinished((document,))
        return self._estimate_documents(context, dataset, (document,))

    def estimate_batch(self, context: RequestContext, *, dataset_id: str, batch: str) -> IndexingEstimate:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        documents = self._documents.list_by_batch(DatasetRef(context.active_workspace_id, dataset.id), batch)
        self._require_unfinished(documents)
        return self._estimate_documents(context, dataset, documents)

    def _estimate_documents(
        self,
        context: RequestContext,
        dataset: DatasetRecord,
        documents: tuple[DocumentRecord, ...],
    ) -> IndexingEstimate:
        if not documents:
            return IndexingEstimate(total_segments=0, preview=[])
        return self._gateway.estimate(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            command=ExistingDocumentsEstimateCommand(dataset=dataset, documents=documents),
        )

    @staticmethod
    def _require_unfinished(documents: tuple[DocumentRecord, ...]) -> None:
        if any(document.indexing_status in {"completed", "error"} for document in documents):
            raise EstimateDocumentAlreadyFinishedError()
