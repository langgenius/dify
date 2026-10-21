"""Celery publisher for claimed knowledge task intents."""

from collections.abc import Mapping
from typing import Any, cast

from celery import Task

from configs import dify_config
from enums import DeploymentEdition
from services.knowledge.task_outbox.contracts import KnowledgeTaskIntent, KnowledgeTaskKind
from services.knowledge.task_outbox.tenant_queue import (
    KNOWLEDGE_TASK_PRIORITY_V2_QUEUE,
    KNOWLEDGE_TASK_SUMMARY_V2_QUEUE,
    KNOWLEDGE_TASK_V2_QUEUE,
    KnowledgeTenantTask,
    enqueue_knowledge_tenant_task,
)

_SUMMARY_TASK_KINDS = frozenset(
    {
        KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
    }
)


def _required_str(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Knowledge task payload requires {key}")
    return value


def _optional_str(payload: Mapping[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Knowledge task payload field {key} must be a string or null")
    return value


def _string_list(payload: Mapping[str, object], key: str) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Knowledge task payload field {key} must be a string list")
    return cast(list[str], value)


def _optional_string_list(payload: Mapping[str, object], key: str) -> list[str] | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Knowledge task payload field {key} must be a string list or null")
    return cast(list[str], value)


def _optional_bool(payload: Mapping[str, object], key: str, *, default: bool) -> bool:
    value = payload.get(key)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ValueError(f"Knowledge task payload field {key} must be a boolean or null")
    return value


def _string_mapping(payload: Mapping[str, object], key: str) -> dict[str, str]:
    value = payload.get(key)
    if not isinstance(value, dict) or not all(
        isinstance(name, str) and isinstance(item, str) for name, item in value.items()
    ):
        raise ValueError(f"Knowledge task payload field {key} must be a string mapping")
    return cast(dict[str, str], value)


def _mapping(payload: Mapping[str, object], key: str) -> dict[str, object]:
    value = payload.get(key)
    if not isinstance(value, dict) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Knowledge task payload field {key} must be an object")
    return cast(dict[str, object], value)


def _optional_mapping(payload: Mapping[str, object], key: str) -> dict[str, object] | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError(f"Knowledge task payload field {key} must be an object")
    return dict(value)


def _required_nullable_str(payload: Mapping[str, object], key: str) -> str | None:
    if key not in payload:
        raise ValueError(f"Knowledge task payload field {key} is required")
    return _optional_str(payload, key)


def _required_nullable_mapping(payload: Mapping[str, object], key: str) -> dict[str, object] | None:
    if key not in payload:
        raise ValueError(f"Knowledge task payload field {key} is required")
    return _optional_mapping(payload, key)


def _delivery_queue(kind: KnowledgeTaskKind, *, priority: bool = False) -> str:
    if priority:
        return KNOWLEDGE_TASK_PRIORITY_V2_QUEUE
    if kind in _SUMMARY_TASK_KINDS:
        return KNOWLEDGE_TASK_SUMMARY_V2_QUEUE
    return KNOWLEDGE_TASK_V2_QUEUE


class CeleryKnowledgeTaskPublisher:
    def __init__(self) -> None:
        from tasks.add_document_to_index_task import add_document_to_index_task
        from tasks.batch_clean_document_task import batch_clean_document_task
        from tasks.clean_dataset_task import clean_dataset_task
        from tasks.clean_document_task import clean_document_task
        from tasks.clean_upload_files_task import clean_upload_files_task
        from tasks.cleanup_knowledge_index_task import cleanup_knowledge_index_task
        from tasks.deal_dataset_vector_index_task import deal_dataset_vector_index_task
        from tasks.delete_segment_from_index_task import delete_segment_from_index_task
        from tasks.disable_segments_from_index_task import disable_segments_from_index_task
        from tasks.document_indexing_sync_task import sync_notion_document_indexing_task
        from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task
        from tasks.document_indexing_update_task import document_indexing_update_task
        from tasks.duplicate_document_indexing_task import (
            normal_duplicate_document_indexing_task,
            priority_duplicate_document_indexing_task,
        )
        from tasks.enable_segments_to_index_task import enable_segments_to_index_task
        from tasks.generate_summary_index_task import generate_summary_index_task
        from tasks.index_created_segments_task import index_created_segments_task
        from tasks.reconcile_segment_index_task import reconcile_segment_index_task
        from tasks.recover_document_indexing_task import recover_document_indexing_task
        from tasks.regenerate_summary_index_task import regenerate_summary_index_task
        from tasks.remove_document_from_index_task import remove_document_from_index_task
        from tasks.retry_document_indexing_task import retry_document_indexing_task
        from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task

        self._tasks: dict[KnowledgeTaskKind, Task[..., Any]] = {
            KnowledgeTaskKind.DOCUMENT_CLEANUP: clean_document_task,
            KnowledgeTaskKind.DOCUMENT_BATCH_CLEANUP: batch_clean_document_task,
            KnowledgeTaskKind.FILE_CLEANUP: clean_upload_files_task,
            KnowledgeTaskKind.DELETION_INDEX_CLEANUP: cleanup_knowledge_index_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_CREATE: normal_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE: normal_duplicate_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_UPDATE: document_indexing_update_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_STATE: add_document_to_index_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_RECOVER: recover_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_SYNC: sync_website_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_RETRY: retry_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX: generate_summary_index_task,
            KnowledgeTaskKind.DATASET_CLEANUP: clean_dataset_task,
            KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE: deal_dataset_vector_index_task,
            KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE: regenerate_summary_index_task,
            KnowledgeTaskKind.SEGMENT_INDEX_ENABLE: enable_segments_to_index_task,
            KnowledgeTaskKind.SEGMENT_INDEX_DISABLE: disable_segments_from_index_task,
            KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE: reconcile_segment_index_task,
            KnowledgeTaskKind.SEGMENT_INDEX_CREATE: index_created_segments_task,
            KnowledgeTaskKind.SEGMENT_DELETE_CLEANUP: delete_segment_from_index_task,
        }
        self._priority_tasks: dict[KnowledgeTaskKind, Task[..., Any]] = {
            KnowledgeTaskKind.DOCUMENT_INDEX_CREATE: priority_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE: priority_duplicate_document_indexing_task,
        }
        self._remove_document_task = remove_document_from_index_task
        self._document_sync_tasks: dict[str, Task[..., Any]] = {
            "notion": sync_notion_document_indexing_task,
            "website": sync_website_document_indexing_task,
        }

    def publish(self, intent: KnowledgeTaskIntent) -> None:
        payload = intent.payload
        task = self._tasks[intent.kind]
        match intent.kind:
            case KnowledgeTaskKind.DELETION_INDEX_CLEANUP:
                args: list[object] = [dict(payload), intent.id]
            case KnowledgeTaskKind.FILE_CLEANUP:
                args = [_string_list(payload, "file_ids"), intent.tenant_id, intent.id]
            case KnowledgeTaskKind.DOCUMENT_INDEX_CREATE | KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE:
                priority = payload.get("priority", False)
                if not isinstance(priority, bool):
                    raise ValueError("Knowledge task payload field priority must be a boolean")
                if priority:
                    task = self._priority_tasks[intent.kind]
                args = [
                    intent.tenant_id,
                    _required_str(payload, "dataset_id"),
                    _string_list(payload, "document_ids"),
                    _string_mapping(payload, "generations"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_INDEX_UPDATE:
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _required_str(payload, "generation"),
                    _string_list(payload, "attachment_ids"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_INDEX_STATE:
                action = _required_str(payload, "action")
                if action == "remove":
                    task = self._remove_document_task
                elif action != "add":
                    raise ValueError("Knowledge document indexing action must be add or remove")
                args = [
                    _required_str(payload, "document_id"),
                    _required_str(payload, "generation"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_INDEX_RECOVER:
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _required_str(payload, "generation"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_INDEX_SYNC:
                # Durable website-sync intents deployed before the source
                # discriminator existed are safe to route to the website
                # worker, which still revalidates the locked document source.
                source = payload.get("source", "website")
                if not isinstance(source, str) or source not in self._document_sync_tasks:
                    raise ValueError("Knowledge document sync source must be notion or website")
                task = self._document_sync_tasks[source]
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _required_str(payload, "generation"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_CLEANUP:
                args = [
                    _required_str(payload, "document_id"),
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "doc_form"),
                    _optional_str(payload, "file_id"),
                    intent.tenant_id,
                    _optional_mapping(payload, "cleanup_manifest"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_BATCH_CLEANUP:
                args = [
                    _string_list(payload, "document_ids"),
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "doc_form"),
                    _string_list(payload, "file_ids"),
                    intent.tenant_id,
                    _optional_mapping(payload, "cleanup_manifest"),
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_INDEX_RETRY:
                repair = payload.get("repair", False)
                if not isinstance(repair, bool):
                    raise ValueError("Knowledge task payload field repair must be a boolean")
                args = [
                    _required_str(payload, "dataset_id"),
                    _string_list(payload, "document_ids"),
                    _required_str(payload, "actor_id"),
                    _string_mapping(payload, "lock_tokens"),
                    _string_mapping(payload, "generations"),
                    repair,
                    intent.id,
                ]
            case KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX:
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _optional_string_list(payload, "segment_ids"),
                    intent.id,
                    _optional_str(payload, "expected_generation"),
                    False,
                    _required_str(payload, "expected_indexing_technique"),
                    _required_nullable_str(payload, "expected_embedding_model_provider"),
                    _required_nullable_str(payload, "expected_embedding_model"),
                    _required_nullable_mapping(payload, "expected_summary_index_setting"),
                ]
            case KnowledgeTaskKind.DATASET_CLEANUP:
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "tenant_id"),
                    _optional_str(payload, "indexing_technique"),
                    payload.get("index_struct"),
                    _optional_str(payload, "collection_binding_id"),
                    _optional_str(payload, "doc_form"),
                    _optional_str(payload, "pipeline_id"),
                    _mapping(payload, "manifest"),
                    intent.id,
                    _optional_str(payload, "embedding_model_provider"),
                    _optional_str(payload, "embedding_model"),
                ]
            case KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE:
                regenerate_summary_vectors = payload.get("regenerate_summary_vectors", False)
                if not isinstance(regenerate_summary_vectors, bool):
                    raise ValueError("Knowledge task payload field regenerate_summary_vectors must be a boolean")
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "action"),
                    _required_str(payload, "expected_indexing_technique"),
                    _optional_str(payload, "expected_embedding_model_provider"),
                    _optional_str(payload, "expected_embedding_model"),
                    regenerate_summary_vectors,
                    intent.id,
                    intent.tenant_id,
                ]
            case KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE:
                regenerate_vectors_only = payload.get("regenerate_vectors_only")
                if not isinstance(regenerate_vectors_only, bool):
                    raise ValueError("Knowledge task payload field regenerate_vectors_only must be a boolean")
                args = [
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "regenerate_reason"),
                    regenerate_vectors_only,
                    _required_str(payload, "expected_indexing_technique"),
                    _required_nullable_str(payload, "expected_embedding_model_provider"),
                    _required_nullable_str(payload, "expected_embedding_model"),
                    intent.id,
                    _required_nullable_mapping(payload, "expected_summary_index_setting"),
                ]
            case KnowledgeTaskKind.SEGMENT_INDEX_ENABLE | KnowledgeTaskKind.SEGMENT_INDEX_DISABLE:
                expected_enabled = payload.get("expected_enabled")
                if not isinstance(expected_enabled, bool):
                    raise ValueError("Knowledge task payload field expected_enabled must be a boolean")
                args = [
                    _string_list(payload, "segment_ids"),
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    intent.id,
                    expected_enabled,
                    _required_str(payload, "generation"),
                ]
            case KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE:
                args = [
                    intent.tenant_id,
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _required_str(payload, "segment_id"),
                    _string_list(payload, "delete_node_ids"),
                    intent.id,
                    _optional_str(payload, "parent_generation"),
                    _optional_string_list(payload, "batch_segment_ids"),
                    _optional_str(payload, "job_id"),
                    _optional_bool(payload, "expected_enabled", default=True),
                ]
            case KnowledgeTaskKind.SEGMENT_INDEX_CREATE:
                args = [
                    intent.tenant_id,
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _string_list(payload, "segment_ids"),
                    _required_str(payload, "generation"),
                    _optional_str(payload, "job_id"),
                    intent.id,
                ]
            case KnowledgeTaskKind.SEGMENT_DELETE_CLEANUP:
                args = [
                    _string_list(payload, "index_node_ids"),
                    _required_str(payload, "dataset_id"),
                    _required_str(payload, "document_id"),
                    _string_list(payload, "segment_ids"),
                    _string_list(payload, "child_node_ids"),
                    intent.tenant_id,
                    _mapping(payload, "cleanup_manifest"),
                    intent.id,
                    _optional_string_list(payload, "summary_node_ids") or [],
                ]
        task_id = f"knowledge-outbox:{intent.id}"
        priority = (
            intent.kind in {KnowledgeTaskKind.DOCUMENT_INDEX_CREATE, KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE}
            and payload.get("priority", False) is True
        )
        delivery_queue = _delivery_queue(intent.kind, priority=priority)
        if (
            intent.kind in {KnowledgeTaskKind.DOCUMENT_INDEX_CREATE, KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE}
            and dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
        ):
            enqueue_knowledge_tenant_task(
                intent.tenant_id,
                KnowledgeTenantTask(
                    task_name=task.name,
                    queue_name=delivery_queue,
                    args=tuple(args),
                    task_id=task_id,
                ),
            )
            return
        task.apply_async(tuple(args), task_id=task_id, queue=delivery_queue)
