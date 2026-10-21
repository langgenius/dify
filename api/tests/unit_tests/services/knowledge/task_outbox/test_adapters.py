from collections.abc import Mapping

import pytest

from enums import DeploymentEdition
from services.knowledge.task_outbox.adapters import CeleryKnowledgeTaskPublisher
from services.knowledge.task_outbox.contracts import KnowledgeTaskIntent, KnowledgeTaskKind
from services.knowledge.task_outbox.tenant_queue import (
    KNOWLEDGE_TASK_PRIORITY_V2_QUEUE,
    KNOWLEDGE_TASK_SUMMARY_V2_QUEUE,
    KNOWLEDGE_TASK_V2_QUEUE,
    KnowledgeTenantTask,
)
from tests.unit_tests.config_override import apply_config_overrides


class ApplyAsyncRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[object, ...], str]] = []
        self.queues: list[str] = []

    def __call__(self, args: tuple[object, ...], *, task_id: str, queue: str) -> object:
        self.calls.append((args, task_id))
        self.queues.append(queue)
        return object()


def _intent(kind: KnowledgeTaskKind, payload: dict[str, object]) -> KnowledgeTaskIntent:
    return KnowledgeTaskIntent(
        id="intent-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=None,
        resource_id="dataset-1",
        kind=kind,
        payload=payload,
        attempts=1,
        claim_id="claim-1",
    )


def test_dataset_cleanup_publication_accepts_empty_dataset_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DATASET_CLEANUP], "apply_async", recorder)
    manifest: Mapping[str, object] = {
        "document_ids": [],
        "segment_ids": [],
        "document_files": [],
        "image_files": [],
        "segment_attachments": [],
    }

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DATASET_CLEANUP,
            {
                "dataset_id": "dataset-1",
                "tenant_id": "tenant-1",
                "indexing_technique": None,
                "index_struct": None,
                "collection_binding_id": None,
                "doc_form": None,
                "pipeline_id": None,
                "manifest": manifest,
            },
        )
    )

    assert recorder.calls == [
        (
            ("dataset-1", "tenant-1", None, None, None, None, None, manifest, "intent-1", None, None),
            "knowledge-outbox:intent-1",
        )
    ]


def test_document_cleanup_publication_passes_persisted_tenant_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DOCUMENT_CLEANUP], "apply_async", recorder)
    cleanup_manifest: Mapping[str, object] = {
        "document_files": [{"id": "file-1", "key": "documents/source.txt"}],
        "image_files": [],
        "segment_attachments": [],
    }

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DOCUMENT_CLEANUP,
            {
                "document_id": "document-1",
                "dataset_id": "dataset-1",
                "doc_form": "text_model",
                "file_id": "file-1",
                "cleanup_manifest": cleanup_manifest,
            },
        )
    )

    assert recorder.calls == [
        (
            ("document-1", "dataset-1", "text_model", "file-1", "tenant-1", cleanup_manifest, "intent-1"),
            "knowledge-outbox:intent-1",
        )
    ]


def test_batch_document_cleanup_publication_passes_outbox_id(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DOCUMENT_BATCH_CLEANUP], "apply_async", recorder)
    cleanup_manifest: Mapping[str, object] = {
        "document_files": [],
        "image_files": [],
        "segment_attachments": [],
    }

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DOCUMENT_BATCH_CLEANUP,
            {
                "document_ids": ["document-1"],
                "dataset_id": "dataset-1",
                "doc_form": "text_model",
                "file_ids": [],
                "cleanup_manifest": cleanup_manifest,
            },
        )
    )

    assert recorder.calls == [
        (
            (["document-1"], "dataset-1", "text_model", [], "tenant-1", cleanup_manifest, "intent-1"),
            "knowledge-outbox:intent-1",
        )
    ]


def test_dataset_vector_publication_passes_expected_index_state(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
            {
                "dataset_id": "dataset-1",
                "action": "update",
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": "provider-1",
                "expected_embedding_model": "model-1",
                "regenerate_summary_vectors": True,
            },
        )
    )

    assert recorder.calls == [
        (
            ("dataset-1", "update", "high_quality", "provider-1", "model-1", True, "intent-1", "tenant-1"),
            "knowledge-outbox:intent-1",
        )
    ]


def test_document_retry_publication_passes_lock_handoff_and_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DOCUMENT_INDEX_RETRY], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
            {
                "dataset_id": "dataset-1",
                "document_ids": ["document-1"],
                "actor_id": "user-1",
                "lock_tokens": {"document-1": "producer-token"},
                "generations": {"document-1": "7c36309e-7ca9-46d1-ac11-799cb3d58603"},
                "repair": False,
            },
        )
    )

    assert recorder.calls == [
        (
            (
                "dataset-1",
                ["document-1"],
                "user-1",
                {"document-1": "producer-token"},
                {"document-1": "7c36309e-7ca9-46d1-ac11-799cb3d58603"},
                False,
                "intent-1",
            ),
            "knowledge-outbox:intent-1",
        )
    ]
    assert recorder.queues == [KNOWLEDGE_TASK_V2_QUEUE]


def test_summary_publication_passes_expected_index_state_once(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
            {
                "dataset_id": "dataset-1",
                "regenerate_reason": "embedding_model_changed",
                "regenerate_vectors_only": True,
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": "provider-1",
                "expected_embedding_model": "model-1",
                "expected_summary_index_setting": {"enable": True},
            },
        )
    )

    assert recorder.calls == [
        (
            (
                "dataset-1",
                "embedding_model_changed",
                True,
                "high_quality",
                "provider-1",
                "model-1",
                "intent-1",
                {"enable": True},
            ),
            "knowledge-outbox:intent-1",
        )
    ]
    assert recorder.queues == [KNOWLEDGE_TASK_SUMMARY_V2_QUEUE]


def test_document_summary_publication_passes_generation_and_outbox_id(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
            {
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "segment_ids": ["segment-1", "segment-2"],
                "expected_generation": "generation-1",
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": "provider-1",
                "expected_embedding_model": "embedding-model-1",
                "expected_summary_index_setting": {"enable": True, "model": "summary-model-a"},
            },
        )
    )

    assert recorder.calls == [
        (
            (
                "dataset-1",
                "document-1",
                ["segment-1", "segment-2"],
                "intent-1",
                "generation-1",
                False,
                "high_quality",
                "provider-1",
                "embedding-model-1",
                {"enable": True, "model": "summary-model-a"},
            ),
            "knowledge-outbox:intent-1",
        )
    ]
    assert recorder.queues == [KNOWLEDGE_TASK_SUMMARY_V2_QUEUE]


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        (
            KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
            {
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "segment_ids": None,
                "expected_generation": "generation-1",
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": None,
                "expected_embedding_model": None,
                "expected_summary_index_setting": None,
            },
        ),
        (
            KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
            {
                "dataset_id": "dataset-1",
                "regenerate_reason": "embedding_model_changed",
                "regenerate_vectors_only": True,
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": None,
                "expected_embedding_model": None,
                "expected_summary_index_setting": None,
            },
        ),
    ],
)
@pytest.mark.parametrize(
    "missing_field",
    [
        "expected_embedding_model_provider",
        "expected_embedding_model",
        "expected_summary_index_setting",
    ],
)
def test_summary_publication_rejects_an_incomplete_model_configuration(
    kind: KnowledgeTaskKind,
    payload: dict[str, object],
    missing_field: str,
) -> None:
    incomplete_payload = dict(payload)
    incomplete_payload.pop(missing_field)

    with pytest.raises(ValueError, match=missing_field):
        CeleryKnowledgeTaskPublisher().publish(_intent(kind, incomplete_payload))


@pytest.mark.parametrize(
    ("kind", "payload", "expected_args"),
    [
        (
            KnowledgeTaskKind.DOCUMENT_INDEX_RECOVER,
            {"dataset_id": "dataset-1", "document_id": "document-1", "generation": "generation-1"},
            ("dataset-1", "document-1", "generation-1", "intent-1"),
        ),
        (
            KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
            {"dataset_id": "dataset-1", "document_id": "document-1", "generation": "generation-1"},
            ("dataset-1", "document-1", "generation-1", "intent-1"),
        ),
    ],
)
def test_document_recovery_and_sync_publication_preserves_generation_signature(
    monkeypatch: pytest.MonkeyPatch,
    kind: KnowledgeTaskKind,
    payload: dict[str, object],
    expected_args: tuple[object, ...],
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[kind], "apply_async", recorder)

    publisher.publish(_intent(kind, payload))

    assert recorder.calls == [(expected_args, "knowledge-outbox:intent-1")]
    assert recorder.queues == [KNOWLEDGE_TASK_V2_QUEUE]


def test_notion_sync_publication_routes_to_versioned_notion_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._document_sync_tasks["notion"], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
            {
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "generation": "generation-1",
                "source": "notion",
            },
        )
    )

    assert recorder.calls == [(("dataset-1", "document-1", "generation-1", "intent-1"), "knowledge-outbox:intent-1")]
    assert recorder.queues == [KNOWLEDGE_TASK_V2_QUEUE]


@pytest.mark.parametrize(
    ("summary_payload", "expected_summary_node_ids"),
    [
        ({}, []),
        ({"summary_node_ids": ["summary-node-1"]}, ["summary-node-1"]),
    ],
)
def test_segment_cleanup_publication_appends_summary_nodes_without_reordering_legacy_arguments(
    monkeypatch: pytest.MonkeyPatch,
    summary_payload: dict[str, object],
    expected_summary_node_ids: list[str],
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.SEGMENT_DELETE_CLEANUP], "apply_async", recorder)
    cleanup_manifest: Mapping[str, object] = {"files": []}

    publisher.publish(
        _intent(
            KnowledgeTaskKind.SEGMENT_DELETE_CLEANUP,
            {
                "index_node_ids": ["node-1"],
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "segment_ids": ["segment-1"],
                "child_node_ids": ["child-1"],
                "cleanup_manifest": cleanup_manifest,
                **summary_payload,
            },
        )
    )

    assert recorder.calls == [
        (
            (
                ["node-1"],
                "dataset-1",
                "document-1",
                ["segment-1"],
                ["child-1"],
                "tenant-1",
                cleanup_manifest,
                "intent-1",
                expected_summary_node_ids,
            ),
            "knowledge-outbox:intent-1",
        )
    ]
    assert recorder.queues == [KNOWLEDGE_TASK_V2_QUEUE]


def test_segment_reconcile_publication_passes_owner_chain_and_outbox_id(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE], "apply_async", recorder)

    publisher.publish(
        _intent(
            KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
            {
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "segment_id": "segment-1",
                "delete_node_ids": ["old-node-1", "old-node-2"],
            },
        )
    )

    assert recorder.calls == [
        (
            (
                "tenant-1",
                "dataset-1",
                "document-1",
                "segment-1",
                ["old-node-1", "old-node-2"],
                "intent-1",
                None,
                None,
                None,
                True,
            ),
            "knowledge-outbox:intent-1",
        )
    ]


@pytest.mark.parametrize("kind", [KnowledgeTaskKind.SEGMENT_INDEX_ENABLE, KnowledgeTaskKind.SEGMENT_INDEX_DISABLE])
def test_segment_status_messages_omit_obsolete_repair_parameter(
    monkeypatch: pytest.MonkeyPatch, kind: KnowledgeTaskKind
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[kind], "apply_async", recorder)
    enabled = kind == KnowledgeTaskKind.SEGMENT_INDEX_ENABLE
    publisher.publish(
        _intent(
            kind,
            {
                "segment_ids": ["segment-1"],
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "expected_enabled": enabled,
                "generation": "generation-1",
                "repair": True,
            },
        )
    )
    assert recorder.calls == [
        ((["segment-1"], "dataset-1", "document-1", "intent-1", enabled, "generation-1"), "knowledge-outbox:intent-1")
    ]


@pytest.mark.parametrize("priority", [False, True])
@pytest.mark.parametrize("kind", [KnowledgeTaskKind.DOCUMENT_INDEX_CREATE, KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE])
def test_document_creation_messages_preserve_generation_and_selected_queue(
    monkeypatch: pytest.MonkeyPatch, kind: KnowledgeTaskKind, priority: bool
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    normal = ApplyAsyncRecorder()
    paid = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[kind], "apply_async", normal)
    monkeypatch.setattr(publisher._priority_tasks[kind], "apply_async", paid)
    generations = {"document-1": "generation-1"}
    publisher.publish(
        _intent(
            kind,
            {
                "dataset_id": "dataset-1",
                "document_ids": ["document-1"],
                "generations": generations,
                "priority": priority,
            },
        )
    )
    selected, unused = (paid, normal) if priority else (normal, paid)
    assert selected.calls == [
        (("tenant-1", "dataset-1", ["document-1"], generations, "intent-1"), "knowledge-outbox:intent-1")
    ]
    assert selected.queues == [KNOWLEDGE_TASK_PRIORITY_V2_QUEUE if priority else KNOWLEDGE_TASK_V2_QUEUE]
    assert unused.calls == []


def test_file_cleanup_message_uses_persisted_tenant_and_file_candidates(monkeypatch: pytest.MonkeyPatch) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.FILE_CLEANUP], "apply_async", recorder)
    publisher.publish(_intent(KnowledgeTaskKind.FILE_CLEANUP, {"file_ids": ["file-1", "file-2"]}))
    assert recorder.calls == [((["file-1", "file-2"], "tenant-1", "intent-1"), "knowledge-outbox:intent-1")]


@pytest.mark.parametrize(
    ("completion_payload", "expected_completion"),
    [
        ({}, (None, None, None, True)),
        (
            {
                "parent_generation": "generation-1",
                "batch_segment_ids": ["segment-1", "segment-2"],
                "job_id": "job-1",
                "expected_enabled": False,
            },
            ("generation-1", ["segment-1", "segment-2"], "job-1", False),
        ),
    ],
)
def test_segment_reconcile_message_appends_optional_parent_completion(
    monkeypatch: pytest.MonkeyPatch,
    completion_payload: dict[str, object],
    expected_completion: tuple[object, object, object, object],
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    recorder = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE], "apply_async", recorder)
    publisher.publish(
        _intent(
            KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
            {
                "dataset_id": "dataset-1",
                "document_id": "document-1",
                "segment_id": "segment-1",
                "delete_node_ids": ["old-node"],
                **completion_payload,
            },
        )
    )
    assert recorder.calls == [
        (
            (
                "tenant-1",
                "dataset-1",
                "document-1",
                "segment-1",
                ["old-node"],
                "intent-1",
                *expected_completion,
            ),
            "knowledge-outbox:intent-1",
        )
    ]


@pytest.mark.parametrize("priority", [False, True])
@pytest.mark.parametrize("kind", [KnowledgeTaskKind.DOCUMENT_INDEX_CREATE, KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE])
def test_cloud_imports_enter_acknowledged_tenant_queue(
    monkeypatch: pytest.MonkeyPatch, kind: KnowledgeTaskKind, priority: bool
) -> None:
    publisher = CeleryKnowledgeTaskPublisher()
    normal = ApplyAsyncRecorder()
    paid = ApplyAsyncRecorder()
    monkeypatch.setattr(publisher._tasks[kind], "apply_async", normal)
    monkeypatch.setattr(publisher._priority_tasks[kind], "apply_async", paid)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    enqueued: list[tuple[str, KnowledgeTenantTask]] = []

    def enqueue(tenant_id: str, task: KnowledgeTenantTask) -> int:
        enqueued.append((tenant_id, task))
        return 1

    monkeypatch.setattr("services.knowledge.task_outbox.adapters.enqueue_knowledge_tenant_task", enqueue)
    generations = {"document-1": "generation-1"}
    publisher.publish(
        _intent(
            kind,
            {
                "dataset_id": "dataset-1",
                "document_ids": ["document-1"],
                "generations": generations,
                "priority": priority,
            },
        )
    )

    selected = publisher._priority_tasks[kind] if priority else publisher._tasks[kind]
    assert enqueued == [
        (
            "tenant-1",
            KnowledgeTenantTask(
                task_name=selected.name,
                queue_name=KNOWLEDGE_TASK_PRIORITY_V2_QUEUE if priority else KNOWLEDGE_TASK_V2_QUEUE,
                args=("tenant-1", "dataset-1", ["document-1"], generations, "intent-1"),
                task_id="knowledge-outbox:intent-1",
            ),
        )
    ]
    assert normal.calls == paid.calls == []
