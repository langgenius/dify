"""Deployed unversioned document tasks only reconcile durable current state."""

from dataclasses import dataclass, field

import pytest

import tasks.document_indexing_sync_task as sync_module
import tasks.document_indexing_task as create_module
import tasks.document_indexing_update_task as update_module
import tasks.duplicate_document_indexing_task as duplicate_module
import tasks.recover_document_indexing_task as recover_module
import tasks.retry_document_indexing_task as retry_module


def _unexpected_provider_access(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("an unversioned delivery reached an external execution boundary")


def _no_op(*_args: object, **_kwargs: object) -> None:
    pass


@dataclass
class ConversionRecorder:
    error: Exception | None = None
    calls: list[tuple[tuple[object, ...], dict[str, object]]] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> None:
        self.calls.append((args, kwargs))
        if self.error is not None:
            raise self.error


def test_real_unversioned_task_signatures_only_call_conversion_boundary(monkeypatch: pytest.MonkeyPatch) -> None:
    create_conversion = ConversionRecorder()
    duplicate_conversion = ConversionRecorder()
    update_conversion = ConversionRecorder()
    sync_conversion = ConversionRecorder()
    recover_conversion = ConversionRecorder()
    retry_conversion = ConversionRecorder()
    monkeypatch.setattr(create_module, "convert_legacy_document_indexing_delivery", create_conversion)
    monkeypatch.setattr(duplicate_module, "convert_legacy_document_indexing_delivery", duplicate_conversion)
    monkeypatch.setattr(update_module, "convert_legacy_document_indexing_delivery", update_conversion)
    monkeypatch.setattr(
        sync_module.SQLAlchemyDocumentRepository,
        "convert_legacy_notion_sync_delivery",
        sync_conversion,
    )
    monkeypatch.setattr(recover_module, "convert_legacy_document_indexing_delivery", recover_conversion)
    monkeypatch.setattr(retry_module, "convert_legacy_document_indexing_delivery", retry_conversion)
    monkeypatch.setattr(create_module, "_advance_legacy_tenant_queue", _no_op)
    monkeypatch.setattr(duplicate_module, "_advance_legacy_tenant_queue", _no_op)
    monkeypatch.setattr(create_module, "build_document_indexing_service", _unexpected_provider_access)
    monkeypatch.setattr(duplicate_module, "_run_document_indexing_batch", _unexpected_provider_access)
    monkeypatch.setattr(update_module, "RedisKnowledgeIndexingLock", _unexpected_provider_access)
    monkeypatch.setattr(sync_module, "_indexing_lock", _unexpected_provider_access)
    monkeypatch.setattr(recover_module, "_indexing_lock", _unexpected_provider_access)
    monkeypatch.setattr(retry_module, "RedisKnowledgeIndexingLock", _unexpected_provider_access)

    create_module.document_indexing_task.run("dataset-1", ["document-1"])
    create_module.normal_document_indexing_task.run("tenant-1", "dataset-1", ["document-1"])
    create_module.priority_document_indexing_task.run("tenant-1", "dataset-1", ["document-1"])
    duplicate_module.duplicate_document_indexing_task.run("dataset-1", ["document-1"])
    duplicate_module.normal_duplicate_document_indexing_task.run("tenant-1", "dataset-1", ["document-1"])
    duplicate_module.priority_duplicate_document_indexing_task.run("tenant-1", "dataset-1", ["document-1"])
    update_module.document_indexing_update_task.run("dataset-1", "document-1")
    sync_module.document_indexing_sync_task.run("dataset-1", "document-1")
    recover_module.recover_document_indexing_task.run("dataset-1", "document-1")
    retry_module.retry_document_indexing_task.run("dataset-1", ["document-1"], "actor-1")

    assert create_conversion.calls == [
        (("dataset-1", ["document-1"]), {}),
        (("dataset-1", ["document-1"]), {}),
        (("dataset-1", ["document-1"]), {}),
    ]
    assert duplicate_conversion.calls == [
        (("dataset-1", ["document-1"]), {}),
        (("dataset-1", ["document-1"]), {}),
        (("dataset-1", ["document-1"]), {}),
    ]
    assert update_conversion.calls == [(("dataset-1", ["document-1"]), {})]
    assert sync_conversion.calls == [(("dataset-1", "document-1"), {})]
    assert recover_conversion.calls == [(("dataset-1", ["document-1"]), {})]
    assert retry_conversion.calls == [(("dataset-1", ["document-1"]), {"actor_id": "actor-1"})]


def test_legacy_conversion_failure_reaches_celery_autoretry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        update_module,
        "convert_legacy_document_indexing_delivery",
        ConversionRecorder(error=RuntimeError("database unavailable")),
    )

    with pytest.raises(RuntimeError, match="database unavailable"):
        update_module.document_indexing_update_task.run("dataset-1", "document-1")


@pytest.mark.parametrize(
    "task",
    [
        create_module.document_indexing_task,
        duplicate_module.duplicate_document_indexing_task,
        sync_module.document_indexing_sync_task,
    ],
)
def test_deployed_legacy_consumers_redeliver_conversion_failures(task: object) -> None:
    assert task.acks_late is True  # type: ignore[attr-defined]
    assert task.reject_on_worker_lost is True  # type: ignore[attr-defined]
    assert task.autoretry_for == (Exception,)  # type: ignore[attr-defined]
