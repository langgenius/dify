from collections.abc import Mapping
from contextlib import AbstractContextManager
from types import TracebackType
from typing import Never, cast

import pytest

from machinery.context import RequestContext
from models.enums import DocumentCreatedFrom
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.documents.adapters import DocumentResponsePresentationAdapter
from services.knowledge.documents.application import (
    DatasetCreatorAccess,
    DatasetDocumentApplicationService,
    DocumentDatasetRepository,
    DocumentLifecycleCache,
    DocumentModelConfigurationGateway,
    DocumentOperations,
    DocumentRepository,
    DocumentTaskDispatcher,
    DocumentUploads,
)
from services.knowledge.documents.contracts import DocumentCreationGateway, DocumentWriteConfig
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.locks import KnowledgeIndexingLease, KnowledgeIndexingLeaseLostError


class _Lease:
    @property
    def token(self) -> str:
        return "lease-token"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class _ReleaseLostContext(AbstractContextManager[KnowledgeIndexingLease]):
    def __enter__(self) -> KnowledgeIndexingLease:
        return _Lease()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        del exc_value, traceback
        if exc_type is None:
            raise KnowledgeIndexingLeaseLostError("simulated release race")
        return False


class _RecordingIndexingLock:
    def __init__(self, *, calls: list[str] | None = None) -> None:
        self.hold_calls: list[tuple[str, int, str | None, float]] = []
        self._calls = calls

    def try_acquire(self, name: str, *, timeout: int) -> KnowledgeIndexingLease | None:
        raise AssertionError(f"Unexpected try_acquire({name!r}, timeout={timeout!r})")

    def try_acquire_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
    ) -> KnowledgeIndexingLease | None:
        raise AssertionError(f"Unexpected try_acquire_handoff({name!r}, timeout={timeout!r}, owner_id={owner_id!r})")

    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[KnowledgeIndexingLease]:
        self.hold_calls.append((name, timeout, expected_token, blocking_timeout))
        if self._calls is not None:
            self._calls.append("lock")
        return _ReleaseLostContext()

    def hold_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[KnowledgeIndexingLease]:
        raise AssertionError(
            "Unexpected hold_handoff("
            f"{name!r}, timeout={timeout!r}, owner_id={owner_id!r}, blocking_timeout={blocking_timeout!r})"
        )


class _SourceAuthorization:
    def __init__(self, calls: list[str] | None = None) -> None:
        self._calls = calls

    def authorize(self, context: RequestContext, config: KnowledgeConfig) -> DocumentWriteConfig:
        del context
        if self._calls is not None:
            self._calls.append("authorize")
        return DocumentWriteConfig(
            original_document_id=config.original_document_id,
            duplicate=config.duplicate,
            indexing_technique=config.indexing_technique,
            data_source=None,
            process_rule=None,
            retrieval_model=None,
            summary_index_setting=None,
            doc_form=config.doc_form,
            doc_language=config.doc_language,
            embedding_model=config.embedding_model,
            embedding_model_provider=config.embedding_model_provider,
            name=config.name,
            is_multimodal=config.is_multimodal,
        )

    def validate_stored_website(self, context: RequestContext, source_info: Mapping[str, object]) -> None:
        del context, source_info
        raise AssertionError("Unexpected stored website validation")


class _UnexpectedDependency:
    def __getattr__(self, name: str) -> Never:
        raise AssertionError(f"Unexpected dependency call: {name}")


def _config(*, original_document_id: str | None = None) -> KnowledgeConfig:
    return KnowledgeConfig(
        original_document_id=original_document_id,
        duplicate=False,
        indexing_technique="economy",
        data_source=None,
        process_rule=None,
        retrieval_model=None,
        summary_index_setting=None,
        doc_form="text_model",
        doc_language="English",
        embedding_model=None,
        embedding_model_provider=None,
        name=None,
        is_multimodal=False,
    )


def _service(
    lock: _RecordingIndexingLock, *, authorization_calls: list[str] | None = None
) -> DatasetDocumentApplicationService:
    unused = _UnexpectedDependency()
    return DatasetDocumentApplicationService(
        dataset_access=cast(DatasetAccess, unused),
        datasets=cast(DocumentDatasetRepository, unused),
        documents=cast(DocumentRepository, unused),
        operations=cast(DocumentOperations, unused),
        uploads=cast(DocumentUploads, unused),
        indexing_locks=lock,
        lifecycle_cache=cast(DocumentLifecycleCache, unused),
        model_configuration=cast(DocumentModelConfigurationGateway, unused),
        creation=cast(DocumentCreationGateway, unused),
        source_authorization=_SourceAuthorization(authorization_calls),
        creator_access=cast(DatasetCreatorAccess, unused),
        tasks=cast(DocumentTaskDispatcher, unused),
        presenter=DocumentResponsePresentationAdapter(),
    )


def test_new_document_creation_keeps_committed_result_when_lease_is_lost_on_release(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    locks = _RecordingIndexingLock()
    service = _service(locks)
    persisted: dict[str, object] = {"documents": [{"id": "document-1"}], "batch": "batch-1"}
    persist_calls: list[bool] = []

    def persist(*_args: object, **_kwargs: object) -> dict[str, object]:
        persist_calls.append(True)
        return persisted

    monkeypatch.setattr(service, "_persist_creation", persist)

    result = service._run_creation(
        RequestContext("request-1", None, "actor-1", "tenant-1"),
        DatasetRef("tenant-1", "dataset-1"),
        _config(),
        initialize=False,
        created_from=DocumentCreatedFrom.API,
        priority=False,
    )

    assert result is persisted
    assert locks.hold_calls == [("add_document_lock_dataset_id_dataset-1", 600, None, 600)]
    assert persist_calls == [True]


def test_new_document_source_is_authorized_before_acquiring_the_dataset_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    locks = _RecordingIndexingLock(calls=calls)
    service = _service(locks, authorization_calls=calls)

    def persist(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"documents": [], "batch": "batch"}

    monkeypatch.setattr(service, "_persist_creation", persist)

    service._run_creation(
        RequestContext("request-1", None, "actor-1", "tenant-1"),
        DatasetRef("tenant-1", "dataset-1"),
        _config(),
        initialize=False,
        created_from=DocumentCreatedFrom.API,
        priority=False,
    )

    assert calls == ["authorize", "lock"]


def test_document_update_does_not_suppress_a_lease_error(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service(_RecordingIndexingLock())

    def persist(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise KnowledgeIndexingLeaseLostError("lost before persistence")

    monkeypatch.setattr(service, "_persist_creation", persist)

    with pytest.raises(KnowledgeIndexingLeaseLostError, match="lost before persistence"):
        service._run_creation(
            RequestContext("request-1", None, "actor-1", "tenant-1"),
            DatasetRef("tenant-1", "dataset-1"),
            _config(original_document_id="document-1"),
            initialize=False,
            created_from=DocumentCreatedFrom.API,
            priority=False,
        )


def test_creation_failure_remains_the_primary_error(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service(_RecordingIndexingLock())

    def persist(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("response construction failed")

    monkeypatch.setattr(service, "_persist_creation", persist)

    with pytest.raises(RuntimeError, match="response construction failed"):
        service._run_creation(
            RequestContext("request-1", None, "actor-1", "tenant-1"),
            DatasetRef("tenant-1", "dataset-1"),
            _config(),
            initialize=False,
            created_from=DocumentCreatedFrom.API,
            priority=False,
        )
