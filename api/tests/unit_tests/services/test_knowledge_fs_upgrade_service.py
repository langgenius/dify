from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetMetadata, DatasetPermissionEnum, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom
from models.knowledge_fs import (
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeFileLease,
    KnowledgeFSUpgradeFileLeaseStatus,
    KnowledgeFSUpgradeItemStatus,
    KnowledgeFSUpgradeJob,
    KnowledgeFSUpgradeJobStatus,
    KnowledgeFSUpgradeSource,
    KnowledgeFSUpgradeStage,
)
from models.model import UploadFile
from models.oauth import DatasourceProvider
from services import dataset_knowledge_fs_upgrade_service as upgrade_module
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeConflictError,
    KnowledgeFSUpgradeDocumentReconciler,
    KnowledgeFSUpgradeError,
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeNotReadyError,
    KnowledgeFSUpgradeRunner,
    KnowledgeFSUpgradeSnapshotService,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSMetadataFieldListResponse,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002"
_DATASET_ID = "00000000-0000-0000-0000-000000000003"
_CONTROL_SPACE_ID = "00000000-0000-0000-0000-000000000004"
_UPLOAD_FILE_ID = "00000000-0000-0000-0000-000000000005"
_DOCUMENT_ASSET_ID = "00000000-0000-0000-0000-000000000006"
_LOGICAL_DOCUMENT_ID = "00000000-0000-0000-0000-000000000007"


def _job(**overrides: object) -> KnowledgeFSUpgradeJob:
    values: dict[str, object] = {
        "tenant_id": _TENANT_ID,
        "old_dataset_id": _DATASET_ID,
        "requested_by_account_id": _ACCOUNT_ID,
        "owner_account_id": _ACCOUNT_ID,
        "idempotency_key": "upgrade-service-test",
        "snapshot_at": naive_utc_now(),
        "config_snapshot": {},
        "permission_snapshot": {},
        "app_binding_snapshot": [],
        "tag_ids_snapshot": [],
    }
    values.update(overrides)
    return KnowledgeFSUpgradeJob(**values)  # type: ignore[arg-type]


def _logical_document(*, enabled: bool, row_version: int = 1) -> KnowledgeFSLogicalDocumentResponse:
    return KnowledgeFSLogicalDocumentResponse.model_validate(
        {
            "active": {
                "contentHash": "a" * 64,
                "createdAt": "2026-08-17T00:00:00Z",
                "documentAssetId": _DOCUMENT_ASSET_ID,
                "documentAssetVersion": 1,
                "documentId": _LOGICAL_DOCUMENT_ID,
                "knowledgeSpaceId": "00000000-0000-0000-0000-000000000008",
                "mimeType": "text/plain",
                "revision": 1,
                "sizeBytes": 12,
                "state": "candidate",
            },
            "createdAt": "2026-08-17T00:00:00Z",
            "enabled": enabled,
            "id": _LOGICAL_DOCUMENT_ID,
            "knowledgeSpaceId": "00000000-0000-0000-0000-000000000008",
            "rowVersion": row_version,
            "status": "pending",
            "title": "guide.txt",
            "updatedAt": "2026-08-17T00:00:00Z",
            "userMetadata": {},
        }
    )


def test_retry_restores_failed_items_and_unreleased_file_lease(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.FAILED)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000010",
            name="guide.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="error",
            status=KnowledgeFSUpgradeItemStatus.FAILED,
            old_upload_file_id=_UPLOAD_FILE_ID,
        )
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key="source-1",
            payload_snapshot={},
            status=KnowledgeFSUpgradeItemStatus.FAILED,
        )
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=_UPLOAD_FILE_ID,
            expires_at=naive_utc_now() - timedelta(days=1),
            status=KnowledgeFSUpgradeFileLeaseStatus.EXPIRED,
        )
        session.add_all([document, source, lease])

    retried = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).retry(
        tenant_id=_TENANT_ID,
        job_id=job.id,
    )

    assert retried.status is KnowledgeFSUpgradeJobStatus.QUEUED
    with sqlite_session_factory() as session:
        assert session.get(KnowledgeFSUpgradeDocument, document.id).status is KnowledgeFSUpgradeItemStatus.PENDING
        assert session.get(KnowledgeFSUpgradeSource, source.id).status is KnowledgeFSUpgradeItemStatus.PENDING
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted_lease.status is KnowledgeFSUpgradeFileLeaseStatus.ACTIVE
        assert persisted_lease.expires_at > naive_utc_now()


def test_snapshot_is_immutable_after_the_legacy_dataset_changes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="Upgrade workspace")
    owner = Account(name="Owner", email="upgrade-owner@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner])
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=owner.id,
                role=TenantAccountRole.OWNER,
            )
        )
        dataset = Dataset(
            tenant_id=tenant.id,
            name="Legacy handbook",
            description="Click-time description",
            data_source_type=DataSourceType.UPLOAD_FILE,
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=owner.id,
            embedding_model="text-embedding-3-large",
            embedding_model_provider="openai",
            retrieval_model={"top_k": 8, "reranking_enable": True},
            enable_api=True,
        )
        session.add(dataset)
        session.flush()
        upload_file = UploadFile(
            tenant_id=tenant.id,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{tenant.id}/handbook.txt",
            name="handbook.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=owner.id,
            created_at=naive_utc_now(),
            used=False,
        )
        metadata = DatasetMetadata(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            type="string",
            name="department",
            created_by=owner.id,
        )
        document = Document(
            id="00000000-0000-0000-0000-000000000012",
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info=json.dumps({"upload_file_id": upload_file.id}),
            batch="batch-1",
            name="handbook.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=owner.id,
            enabled=False,
            archived=True,
            indexing_status="completed",
            doc_metadata={"department": "support"},
        )
        session.add_all([upload_file, metadata, document])
        tenant_id = tenant.id
        owner_id = owner.id
        dataset_id = dataset.id

    job = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="immutable-snapshot",
    )
    replayed = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="immutable-snapshot",
    )
    assert replayed.id == job.id
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, dataset_id)
        persisted_document = session.get(Document, document.id)
        assert persisted_dataset is not None
        assert persisted_document is not None
        persisted_dataset.name = "Changed after click"
        persisted_document.enabled = True
        persisted_document.archived = False

    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        snapshot_document = session.scalar(
            select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.job_id == job.id)
        )
        assert persisted_job is not None
        assert snapshot_document is not None
        assert persisted_job.config_snapshot["name"] == "Legacy handbook"
        assert persisted_job.config_snapshot["embedding_model"] == "text-embedding-3-large"
        assert persisted_job.config_snapshot["embedding_model_provider"] == "openai"
        assert persisted_job.config_snapshot["retrieval_model"] == {"top_k": 8, "reranking_enable": True}
        assert persisted_job.config_snapshot["enable_api"] is True
        assert persisted_job.config_snapshot["metadata_fields"] == [{"name": "department", "type": "string"}]
        assert snapshot_document.desired_enabled is False
        assert snapshot_document.legacy_archived is True
        assert snapshot_document.metadata_snapshot == {"department": "support"}


def test_finalize_requires_every_document_and_source_handoff(sqlite_session_factory: sessionmaker[Session]) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.FINALIZING,
        total_documents=2,
        completed_documents=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    with pytest.raises(KnowledgeFSUpgradeError, match="Not all Dataset documents"):
        KnowledgeFSUpgradeRunner(sqlite_session_factory)._finalize(job)


def test_shared_source_file_lease_is_released_after_every_document_handoff(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = Account(name="Upgrade owner", email="upgrade-shared-file@example.com")
    with sqlite_session_factory.begin() as session:
        session.add(account)
        session.flush()
        upload_file = UploadFile(
            tenant_id=_TENANT_ID,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{_TENANT_ID}/shared.txt",
            name="shared.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=naive_utc_now(),
            used=False,
        )
        job = _job(
            owner_account_id=account.id,
            status=KnowledgeFSUpgradeJobStatus.RUNNING,
            stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
            new_control_space_id=_CONTROL_SPACE_ID,
            total_documents=2,
        )
        session.add_all([upload_file, job])
        session.flush()
        for suffix in ("21", "22"):
            session.add(
                KnowledgeFSUpgradeDocument(
                    job_id=job.id,
                    tenant_id=_TENANT_ID,
                    old_document_id=f"00000000-0000-0000-0000-0000000000{suffix}",
                    name=f"guide-{suffix}.txt",
                    data_source_type="upload_file",
                    data_source_info={"upload_file_id": upload_file.id},
                    metadata_snapshot={},
                    desired_enabled=True,
                    legacy_archived=False,
                    legacy_indexing_status="completed",
                    old_upload_file_id=upload_file.id,
                )
            )
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=upload_file.id,
            expires_at=naive_utc_now() + timedelta(days=1),
        )
        session.add(lease)

    staged = MagicMock()
    staged.stage.side_effect = [SimpleNamespace(id="staged-1"), SimpleNamespace(id="staged-2")]
    staged.claim.side_effect = [
        SimpleNamespace(document_asset_id="asset-1", compilation_job_id="compilation-1"),
        SimpleNamespace(document_asset_id="asset-2", compilation_job_id="compilation-2"),
    ]
    monkeypatch.setattr(upgrade_module, "KnowledgeFSStagedUploadService", lambda *_args, **_kwargs: staged)
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: SimpleNamespace(facade=MagicMock()))
    monkeypatch.setattr(upgrade_module.storage, "load", lambda _key: b"shared body")
    monkeypatch.setattr(
        upgrade_module.FeatureService,
        "get_knowledge_file_size_limit",
        lambda _tenant_id: 15,
    )

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner._submit_next_document(job) is True
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeFileLeaseStatus.ACTIVE

    assert runner._submit_next_document(job) is True
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeFileLeaseStatus.RELEASED
        assert persisted.released_at is not None


def test_reconciler_applies_metadata_then_snapshot_availability(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
        stage=KnowledgeFSUpgradeStage.COMPLETED,
        new_control_space_id=_CONTROL_SPACE_ID,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000011",
            name="guide.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={"department": "support"},
            desired_enabled=False,
            legacy_archived=True,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            old_upload_file_id=_UPLOAD_FILE_ID,
            new_document_asset_id=_DOCUMENT_ASSET_ID,
        )
        session.add(document)

    initial = _logical_document(enabled=True, row_version=1)
    after_metadata = initial.model_copy(update={"row_version": 2})
    after_availability = after_metadata.model_copy(update={"enabled": False, "row_version": 3})
    facade = MagicMock()
    facade.list_logical_documents.return_value = KnowledgeFSLogicalDocumentListResponse(
        data=[initial], next_cursor=None
    )
    facade.update_document_metadata.return_value = after_metadata
    facade.update_logical_document_availability.return_value = after_availability
    monkeypatch.setattr(
        upgrade_module,
        "get_knowledge_fs_runtime",
        lambda _: SimpleNamespace(facade=facade),
    )

    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 0

    metadata_payload = facade.update_document_metadata.call_args.kwargs["payload"]
    assert metadata_payload.expected_row_version == 1
    assert metadata_payload.patch == {"department": "support"}
    availability_payload = facade.update_logical_document_availability.call_args.kwargs["payload"]
    assert availability_payload.expected_row_version == 2
    assert availability_payload.enabled is False
    with sqlite_session_factory() as session:
        persisted = session.scalar(
            select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.id == document.id)
        )
        assert persisted is not None
        assert persisted.new_logical_document_id == _LOGICAL_DOCUMENT_ID
        assert persisted.state_reconciled_at is not None


def test_metadata_fields_are_created_idempotently() -> None:
    job = _job(
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={
            "metadata_fields": [
                {"name": "department", "type": "string"},
                {"name": "priority", "type": "number"},
            ]
        },
    )
    facade = MagicMock()
    facade.list_metadata_fields.return_value = KnowledgeFSMetadataFieldListResponse(
        data=[
            {
                "id": "field-1",
                "name": "department",
                "type": "string",
                "count": 0,
                "rowVersion": 0,
                "createdAt": "2026-08-17T00:00:00Z",
                "updatedAt": "2026-08-17T00:00:00Z",
            }
        ],
        next_cursor=None,
    )

    upgrade_module._migrate_metadata_fields(job, facade)

    facade.create_metadata_field.assert_called_once()
    assert facade.create_metadata_field.call_args.kwargs["payload"].model_dump() == {
        "name": "priority",
        "type": "number",
    }


def _active_model(provider: str, model: str) -> SimpleNamespace:
    return SimpleNamespace(provider=SimpleNamespace(provider=provider), model=model)


def test_configuration_prefers_active_legacy_models_and_uses_default_reasoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    embedding = _active_model("langgenius/openai/openai", "text-embedding-3-large")
    rerank = _active_model("langgenius/cohere/cohere", "rerank-v3.5")
    reasoning = _active_model("langgenius/anthropic/anthropic", "claude-sonnet")
    models_by_type = {
        ModelType.TEXT_EMBEDDING: [embedding],
        ModelType.RERANK: [rerank],
        ModelType.LLM: [reasoning],
    }
    configurations = MagicMock()
    configurations.get_models.side_effect = lambda *, model_type, **_kwargs: models_by_type[model_type]
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value = configurations
    provider_manager.get_default_model.return_value = reasoning
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-3-large",
            "retrieval_model": {
                "top_k": 12,
                "score_threshold_enabled": True,
                "score_threshold": 0.72,
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "rerank-v3.5",
                },
            },
        }
    )

    resolved = upgrade_module._resolve_configuration(job)

    assert resolved["embedding"] == {
        "pluginId": "langgenius/openai",
        "provider": "openai",
        "model": "text-embedding-3-large",
    }
    retrieval = resolved["retrieval"]
    assert retrieval["reasoningModel"] == {
        "pluginId": "langgenius/anthropic",
        "provider": "anthropic",
        "model": "claude-sonnet",
    }
    assert retrieval["rerank"] == {
        "enabled": True,
        "model": {
            "pluginId": "langgenius/cohere",
            "provider": "cohere",
            "model": "rerank-v3.5",
        },
    }
    assert retrieval["scoreThreshold"] == {"enabled": True, "stage": "mode-final", "value": 0.72}
    assert retrieval["topK"] == 12
    provider_manager.get_default_model.assert_called_once_with(tenant_id=_TENANT_ID, model_type=ModelType.LLM)


def test_configuration_falls_back_to_active_workspace_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = {
        ModelType.TEXT_EMBEDDING: _active_model("langgenius/openai/openai", "embedding-default"),
        ModelType.RERANK: _active_model("langgenius/cohere/cohere", "rerank-default"),
        ModelType.LLM: _active_model("langgenius/anthropic/anthropic", "reasoning-default"),
    }
    configurations = MagicMock()
    configurations.get_models.side_effect = lambda *, model_type, **_kwargs: [defaults[model_type]]
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value = configurations
    provider_manager.get_default_model.side_effect = lambda *, model_type, **_kwargs: defaults[model_type]
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "inactive-legacy-embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "inactive-legacy-rerank",
                }
            },
        }
    )

    resolved = upgrade_module._resolve_configuration(job)

    assert resolved["embedding"]["model"] == "embedding-default"
    assert resolved["retrieval"]["rerank"]["model"]["model"] == "rerank-default"
    assert resolved["retrieval"]["reasoningModel"]["model"] == "reasoning-default"
    assert resolved["retrieval"]["topK"] == 4


def test_configuration_fails_when_workspace_default_reasoning_model_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    embedding = _active_model("langgenius/openai/openai", "embedding")
    rerank = _active_model("langgenius/cohere/cohere", "rerank")
    models_by_type = {
        ModelType.TEXT_EMBEDDING: [embedding],
        ModelType.RERANK: [rerank],
        ModelType.LLM: [],
    }
    configurations = MagicMock()
    configurations.get_models.side_effect = lambda *, model_type, **_kwargs: models_by_type[model_type]
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value = configurations
    provider_manager.get_default_model.return_value = None
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "rerank",
                }
            },
        }
    )

    with pytest.raises(KnowledgeFSUpgradeError, match="Workspace default llm model is unavailable"):
        upgrade_module._resolve_configuration(job)


def test_access_migration_maps_visibility_members_apps_api_and_tags(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    viewer_id = "00000000-0000-0000-0000-000000000030"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.MIGRATING_ACCESS,
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={"enable_api": True, "metadata_fields": []},
        permission_snapshot={
            "visibility": KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS.value,
            "member_account_ids": [_ACCOUNT_ID, viewer_id],
        },
        app_binding_snapshot=[
            {"app_id": "00000000-0000-0000-0000-000000000031", "caller_kind": "agent"},
            {"app_id": "00000000-0000-0000-0000-000000000032", "caller_kind": "workflow"},
        ],
        tag_ids_snapshot=["00000000-0000-0000-0000-000000000033"],
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    runtime = SimpleNamespace(
        facade=MagicMock(),
        control_plane=MagicMock(),
        app_bindings=MagicMock(),
        space_tags=MagicMock(),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: runtime)

    KnowledgeFSUpgradeRunner(sqlite_session_factory)._migrate_access(job)

    members = runtime.control_plane.replace_members.call_args.kwargs["members"]
    assert len(members) == 1
    assert members[0].account_id == viewer_id
    assert members[0].role is KnowledgeFSControlSpacePermissionRole.VIEWER
    assert runtime.control_plane.update_visibility.call_args.kwargs["visibility"] is (
        KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
    )
    external_access = runtime.control_plane.update_external_access.call_args.kwargs["payload"]
    assert external_access.service_api_enabled is True
    assert external_access.agent_enabled is True
    assert external_access.workflow_enabled is True
    assert external_access.mcp_enabled is False
    binding_payloads = [call.kwargs["payload"] for call in runtime.app_bindings.upsert.call_args_list]
    assert [payload.caller_kind for payload in binding_payloads] == [
        KnowledgeFSAppSpaceJoinType.AGENT,
        KnowledgeFSAppSpaceJoinType.WORKFLOW,
    ]
    assert runtime.space_tags.replace_tags.call_args.kwargs["tag_ids"] == job.tag_ids_snapshot
    with sqlite_session_factory() as session:
        assert session.get(KnowledgeFSUpgradeJob, job.id).stage is KnowledgeFSUpgradeStage.FINALIZING


@pytest.mark.parametrize(
    ("stage", "method_name", "result", "expected"),
    [
        (KnowledgeFSUpgradeStage.WAITING_FOR_SPACE, "_advance_when_space_is_active", None, True),
        (KnowledgeFSUpgradeStage.CREATING_SOURCES, "_create_next_source", True, True),
        (KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS, "_submit_next_document", True, True),
        (KnowledgeFSUpgradeStage.MIGRATING_ACCESS, "_migrate_access", None, True),
        (KnowledgeFSUpgradeStage.FINALIZING, "_finalize", None, False),
    ],
)
def test_runner_dispatches_each_durable_stage(
    stage: KnowledgeFSUpgradeStage,
    method_name: str,
    result: bool | None,
    expected: bool,
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED, stage=stage)
    runner = KnowledgeFSUpgradeRunner(MagicMock())
    runner._load_job = MagicMock(return_value=job)  # type: ignore[method-assign]
    runner._mark_running = MagicMock()  # type: ignore[method-assign]
    stage_method = MagicMock(return_value=result)
    setattr(runner, method_name, stage_method)

    assert runner.run_next(job_id=job.id, celery_task_id="task-1") is expected

    runner._mark_running.assert_called_once_with(job_id=job.id, celery_task_id="task-1")
    stage_method.assert_called_once_with(job)


def test_runner_validation_creates_space_and_waits() -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED, stage=KnowledgeFSUpgradeStage.VALIDATING)
    runner = KnowledgeFSUpgradeRunner(MagicMock())
    runner._load_job = MagicMock(return_value=job)  # type: ignore[method-assign]
    runner._mark_running = MagicMock()  # type: ignore[method-assign]
    runner._create_space = MagicMock()  # type: ignore[method-assign]

    with pytest.raises(KnowledgeFSUpgradeNotReadyError, match="provisioning is pending"):
        runner.run_next(job_id=job.id)

    runner._create_space.assert_called_once_with(job)


def test_runner_terminal_and_unknown_stages_do_not_continue() -> None:
    runner = KnowledgeFSUpgradeRunner(MagicMock())
    runner._mark_running = MagicMock()  # type: ignore[method-assign]
    runner._load_job = MagicMock(return_value=_job(status=KnowledgeFSUpgradeJobStatus.SUCCEEDED))  # type: ignore[method-assign]
    assert runner.run_next(job_id="done") is False
    runner._mark_running.assert_not_called()

    runner._load_job = MagicMock(  # type: ignore[method-assign]
        return_value=_job(status=KnowledgeFSUpgradeJobStatus.QUEUED, stage=KnowledgeFSUpgradeStage.COMPLETED)
    )
    assert runner.run_next(job_id="completed-stage") is False
    runner._mark_running.assert_called_once()


def test_runner_failure_loading_and_running_state_are_persisted(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=_UPLOAD_FILE_ID,
            expires_at=naive_utc_now() + timedelta(minutes=1),
        )
        session.add(lease)

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    loaded = runner._load_job(job.id)
    assert loaded.id == job.id
    runner._mark_running(job_id=job.id, celery_task_id="task-2")
    runner.fail(job_id=job.id, error=ValueError("broken"))

    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.FAILED
        assert persisted.attempt_count == 1
        assert persisted.celery_task_id == "task-2"
        assert persisted.last_error_code == "ValueError"
        assert persisted.last_error_message == "broken"
        assert persisted.completed_at is not None
        assert persisted_lease is not None
        assert persisted_lease.expires_at > naive_utc_now() + timedelta(days=6)

    with pytest.raises(KnowledgeFSUpgradeNotFoundError):
        runner._load_job("00000000-0000-0000-0000-000000000099")
    with pytest.raises(KnowledgeFSUpgradeNotFoundError):
        runner._mark_running(job_id="00000000-0000-0000-0000-000000000099", celery_task_id=None)

    runner.fail(job_id="00000000-0000-0000-0000-000000000099", error=RuntimeError("ignored"))


def _resolved_configuration() -> dict[str, object]:
    return {
        "embedding": {"pluginId": "langgenius/openai", "provider": "openai", "model": "embedding"},
        "retrieval": {
            "defaultMode": "fast",
            "reasoningModel": {
                "pluginId": "langgenius/anthropic",
                "provider": "anthropic",
                "model": "reasoning",
            },
            "rerank": {
                "enabled": True,
                "model": {"pluginId": "langgenius/cohere", "provider": "cohere", "model": "rerank"},
            },
            "scoreThreshold": {"enabled": False, "stage": "mode-final", "value": None},
            "topK": 4,
        },
    }


def test_runner_creates_space_and_advances_after_activation(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.VALIDATING,
        total_sources=1,
        config_snapshot={"name": "Legacy", "description": "Description", "icon": "book"},
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    application = MagicMock()
    application.create_space.return_value = SimpleNamespace(control_space_id=_CONTROL_SPACE_ID)
    monkeypatch.setattr(upgrade_module, "_resolve_configuration", lambda _job: _resolved_configuration())
    monkeypatch.setattr(
        upgrade_module,
        "get_knowledge_fs_runtime",
        lambda _: SimpleNamespace(application=application),
    )
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    runner._create_space(job)

    payload = application.create_space.call_args.kwargs["payload"]
    assert payload.name == "Legacy"
    assert payload.idempotency_key == f"upgrade:{job.id}:space"
    with sqlite_session_factory.begin() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.stage is KnowledgeFSUpgradeStage.WAITING_FOR_SPACE
        control_space = KnowledgeFSControlSpace(
            tenant_id=_TENANT_ID,
            owner_account_id=_ACCOUNT_ID,
            provisioning_key="upgrade-test-space",
            knowledge_space_id="00000000-0000-0000-0000-000000000040",
            state=KnowledgeFSControlSpaceState.ACTIVE,
        )
        session.add(control_space)
        session.flush()
        persisted.new_control_space_id = control_space.id
        control_space_id = control_space.id

    job.new_control_space_id = control_space_id
    runner._advance_when_space_is_active(job)
    with sqlite_session_factory() as session:
        assert session.get(KnowledgeFSUpgradeJob, job.id).stage is KnowledgeFSUpgradeStage.CREATING_SOURCES


def test_runner_waiting_for_space_reports_each_invalid_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, stage=KnowledgeFSUpgradeStage.WAITING_FOR_SPACE)
    with sqlite_session_factory.begin() as session:
        session.add(job)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)

    with pytest.raises(KnowledgeFSUpgradeError, match="reference is missing"):
        runner._advance_when_space_is_active(job)

    job.new_control_space_id = _CONTROL_SPACE_ID
    with pytest.raises(KnowledgeFSUpgradeError, match="was not found"):
        runner._advance_when_space_is_active(job)

    with sqlite_session_factory.begin() as session:
        control_space = KnowledgeFSControlSpace(
            tenant_id=_TENANT_ID,
            owner_account_id=_ACCOUNT_ID,
            provisioning_key="upgrade-test-provisioning",
        )
        session.add(control_space)
        session.flush()
        job.new_control_space_id = control_space.id
        control_space_id = control_space.id

    with pytest.raises(KnowledgeFSUpgradeNotReadyError, match="provisioning is pending"):
        runner._advance_when_space_is_active(job)

    with sqlite_session_factory.begin() as session:
        control_space = session.get(KnowledgeFSControlSpace, control_space_id)
        assert control_space is not None
        control_space.state = KnowledgeFSControlSpaceState.ERROR
    with pytest.raises(KnowledgeFSUpgradeError, match="failed in error"):
        runner._advance_when_space_is_active(job)


def _website_source_payload() -> dict[str, object]:
    return {
        "kind": "website_crawl",
        "name": "Legacy Web",
        "provider": "firecrawl",
        "datasource": "crawl",
        "parameters": {"only_main_content": True},
        "root_url": "https://example.com",
        "crawl_options": {"include_subpages": False, "limit": 1},
        "selection": [{"source_url": "https://example.com/page", "title": "Page"}],
        "sync_policy": "manual",
    }


def test_runner_creates_source_and_marks_its_documents_handed_off(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    source_key = "website:firecrawl:job:1"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.CREATING_SOURCES,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_documents=2,
        total_sources=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=source_key,
            payload_snapshot=_website_source_payload(),
        )
        documents = [
            KnowledgeFSUpgradeDocument(
                job_id=job.id,
                tenant_id=_TENANT_ID,
                old_document_id=f"00000000-0000-0000-0000-00000000005{index}",
                name=f"page-{index}",
                data_source_type="website_crawl",
                data_source_info={"url": f"https://example.com/{index}"},
                metadata_snapshot={},
                desired_enabled=True,
                legacy_archived=False,
                legacy_indexing_status="completed",
                source_key=source_key,
            )
            for index in range(2)
        ]
        session.add_all([source, *documents])

    from tasks import knowledge_fs_initial_source_tasks as source_tasks

    submit = MagicMock(
        return_value=SimpleNamespace(
            connection_id="connection-1",
            source_id="source-1",
            workflow_id="workflow-1",
            workflow_error="initial-sync-failed",
        )
    )
    monkeypatch.setattr(source_tasks, "submit_initial_source_for_upgrade", submit)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner._create_next_source(job) is True

    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        persisted_source = session.get(KnowledgeFSUpgradeSource, source.id)
        assert persisted_job is not None
        assert persisted_job.completed_documents == 2
        assert persisted_job.completed_sources == 1
        assert persisted_source is not None
        assert persisted_source.status is KnowledgeFSUpgradeItemStatus.SUCCEEDED
        assert persisted_source.last_error_code == "initial-sync-failed"
        assert all(
            item.status is KnowledgeFSUpgradeItemStatus.SUCCEEDED
            for item in session.scalars(
                select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.job_id == job.id)
            )
        )

    assert runner._create_next_source(job) is True
    with sqlite_session_factory() as session:
        assert session.get(KnowledgeFSUpgradeJob, job.id).stage is KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS


@pytest.mark.parametrize("not_ready", [True, False])
def test_runner_source_failure_is_retryable_or_persisted(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, not_ready: bool
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.CREATING_SOURCES,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_sources=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=f"source-failure-{not_ready}",
            payload_snapshot=_website_source_payload(),
        )
        session.add(source)

    from tasks import knowledge_fs_initial_source_tasks as source_tasks

    error: Exception
    if not_ready:
        error = source_tasks.KnowledgeFSInitialSourceNotReadyError("busy")
    else:
        error = RuntimeError("source failed")
    monkeypatch.setattr(source_tasks, "submit_initial_source_for_upgrade", MagicMock(side_effect=error))
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)

    expected_error = KnowledgeFSUpgradeNotReadyError if not_ready else RuntimeError
    with pytest.raises(expected_error):
        runner._create_next_source(job)

    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeSource, source.id)
        assert persisted is not None
        expected_status = KnowledgeFSUpgradeItemStatus.PENDING if not_ready else KnowledgeFSUpgradeItemStatus.FAILED
        assert persisted.status is expected_status
        if not not_ready:
            assert persisted.last_error_code == "RuntimeError"
            assert persisted.last_error_message == "source failed"


def test_runner_document_boundaries_and_successful_finalize(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_documents=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000060",
            name="missing.txt",
            data_source_type="upload_file",
            data_source_info={},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
        )
        session.add(document)

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    with pytest.raises(KnowledgeFSUpgradeError, match="no source file reference"):
        runner._submit_next_document(job)
    with sqlite_session_factory.begin() as session:
        persisted_document = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted_document is not None
        assert persisted_document.status is KnowledgeFSUpgradeItemStatus.FAILED
        persisted_document.status = KnowledgeFSUpgradeItemStatus.SUCCEEDED
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        persisted_job.completed_documents = 1

    assert runner._submit_next_document(job) is True
    with sqlite_session_factory.begin() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        assert persisted_job.stage is KnowledgeFSUpgradeStage.MIGRATING_ACCESS
        persisted_job.stage = KnowledgeFSUpgradeStage.FINALIZING

    runner._finalize(job)
    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        assert persisted_job.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED
        assert persisted_job.stage is KnowledgeFSUpgradeStage.COMPLETED
        assert persisted_job.completed_at is not None


def test_upgrade_helper_source_identities_payloads_and_validation() -> None:
    notion = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000071",
        name="Notion page",
        data_source_type="notion_import",
        data_source_info={"workspace_id": "workspace", "notion_page_id": "page"},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )
    website = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000072",
        name="Website page",
        data_source_type="website_crawl",
        data_source_info={"url": "https://example.com/page"},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )
    unsupported = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000073",
        name="Unsupported",
        data_source_type="upload_file",
        data_source_info={},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )

    assert upgrade_module._expected_provider_item_id(notion) == '["workspace","page"]'
    assert (
        upgrade_module._expected_provider_item_id(website)
        == upgrade_module.sha256(b"https://example.com/page").hexdigest()
    )
    with pytest.raises(KnowledgeFSUpgradeError, match="no provider item identity"):
        upgrade_module._expected_provider_item_id(unsupported)

    assert upgrade_module._notion_source_group_key({"workspace_id": "workspace", "credential_id": "cred"}) == (
        "notion:workspace:cred"
    )
    assert (
        upgrade_module._website_source_group_key(
            {"provider": " Firecrawl ", "job_id": "crawl", "url": "https://example.com"}
        )
        == "website:firecrawl:crawl"
    )
    with pytest.raises(KnowledgeFSUpgradeConflictError):
        upgrade_module._notion_source_group_key({})
    with pytest.raises(KnowledgeFSUpgradeConflictError):
        upgrade_module._website_source_group_key({"provider": "firecrawl"})

    notion_document = SimpleNamespace(
        data_source_type="notion_import",
        name="Page",
    )
    notion_payload = upgrade_module._source_payload_snapshot(
        "Dataset",
        [(notion_document, {"workspace_id": "workspace", "notion_page_id": "page", "type": "page"})],
    )
    assert notion_payload["kind"] == "online_document"
    website_payload = upgrade_module._source_payload_snapshot(
        "Dataset",
        [(SimpleNamespace(data_source_type="website_crawl", name="Page"), {"provider": "firecrawl", "url": "u"})],
    )
    assert website_payload["kind"] == "website_crawl"
    assert upgrade_module._chunks([1, 2, 3], 2) == [[1, 2], [3]]
    with pytest.raises(KnowledgeFSUpgradeError, match="reference is missing"):
        upgrade_module._required_space_id(_job())


def test_notion_credential_resolution_prefers_direct_then_workspace_match(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        direct = DatasourceProvider(
            tenant_id=_TENANT_ID,
            name="Direct",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "direct-workspace"},
        )
        fallback = DatasourceProvider(
            tenant_id=_TENANT_ID,
            name="Fallback",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "fallback-workspace"},
        )
        session.add_all([direct, fallback])
        session.flush()
        direct_id = direct.id
        fallback_id = fallback.id

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert (
        runner._resolve_notion_credential(
            tenant_id=_TENANT_ID,
            legacy_credential_id=direct_id,
            workspace_id="ignored",
        )
        == direct_id
    )
    assert (
        runner._resolve_notion_credential(
            tenant_id=_TENANT_ID,
            legacy_credential_id="00000000-0000-0000-0000-000000000090",
            workspace_id="fallback-workspace",
        )
        == fallback_id
    )


def test_notion_credential_resolution_handles_single_fallback_and_missing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    single_tenant_id = "00000000-0000-0000-0000-000000000091"
    missing_tenant_id = "00000000-0000-0000-0000-000000000092"
    with sqlite_session_factory.begin() as session:
        only = DatasourceProvider(
            tenant_id=single_tenant_id,
            name="Only",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "another-workspace"},
        )
        session.add(only)
        session.flush()
        only_id = only.id

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert (
        runner._resolve_notion_credential(
            tenant_id=single_tenant_id,
            legacy_credential_id="",
            workspace_id="unmatched",
        )
        == only_id
    )
    with pytest.raises(KnowledgeFSUpgradeError, match="credential is unavailable"):
        runner._resolve_notion_credential(
            tenant_id=missing_tenant_id,
            legacy_credential_id="",
            workspace_id="missing",
        )


def test_document_submission_persists_missing_file_and_invalid_body_errors(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = Account(name="Upgrade owner", email="upgrade-errors@example.com")
    with sqlite_session_factory.begin() as session:
        session.add(account)
        session.flush()
        job = _job(
            owner_account_id=account.id,
            status=KnowledgeFSUpgradeJobStatus.RUNNING,
            stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
            new_control_space_id=_CONTROL_SPACE_ID,
            total_documents=2,
        )
        session.add(job)
        session.flush()
        missing = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000093",
            name="missing.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            old_upload_file_id=_UPLOAD_FILE_ID,
        )
        session.add(missing)

    staged = MagicMock()
    monkeypatch.setattr(upgrade_module, "KnowledgeFSStagedUploadService", lambda *_args, **_kwargs: staged)
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: SimpleNamespace(facade=MagicMock()))
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    with pytest.raises(KnowledgeFSUpgradeError, match="source file is unavailable"):
        runner._submit_next_document(job)

    with sqlite_session_factory.begin() as session:
        persisted_missing = session.get(KnowledgeFSUpgradeDocument, missing.id)
        assert persisted_missing is not None
        assert persisted_missing.status is KnowledgeFSUpgradeItemStatus.FAILED
        upload_file = UploadFile(
            tenant_id=_TENANT_ID,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{_TENANT_ID}/invalid.txt",
            name="invalid.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=naive_utc_now(),
            used=False,
        )
        session.add(upload_file)
        session.flush()
        invalid = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000094",
            name="invalid.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": upload_file.id},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            old_upload_file_id=upload_file.id,
        )
        session.add(invalid)

    monkeypatch.setattr(upgrade_module.storage, "load", lambda _key: "not-bytes")
    with pytest.raises(KnowledgeFSUpgradeError, match="invalid body"):
        runner._submit_next_document(job)
    with sqlite_session_factory() as session:
        persisted_invalid = session.get(KnowledgeFSUpgradeDocument, invalid.id)
        assert persisted_invalid is not None
        assert persisted_invalid.status is KnowledgeFSUpgradeItemStatus.FAILED


def test_reconciler_records_missing_remote_document_and_remote_error(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    source_key = "website:firecrawl:job:1"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
        stage=KnowledgeFSUpgradeStage.COMPLETED,
        new_control_space_id=_CONTROL_SPACE_ID,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=source_key,
            payload_snapshot=_website_source_payload(),
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            new_source_id="source-1",
        )
        missing = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000095",
            name="missing-page",
            data_source_type="website_crawl",
            data_source_info={"url": "https://example.com/missing"},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            source_key=source_key,
        )
        remote_error = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000096",
            name="remote-error",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={"department": "support"},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            new_document_asset_id=_DOCUMENT_ASSET_ID,
        )
        session.add_all([source, missing, remote_error])

    facade = MagicMock()
    facade.list_logical_documents.return_value = KnowledgeFSLogicalDocumentListResponse(
        data=[_logical_document(enabled=True)], next_cursor=None
    )
    facade.update_document_metadata.side_effect = RuntimeError("remote metadata failed")
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: SimpleNamespace(facade=facade))

    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 2
    with sqlite_session_factory() as session:
        persisted_missing = session.get(KnowledgeFSUpgradeDocument, missing.id)
        persisted_error = session.get(KnowledgeFSUpgradeDocument, remote_error.id)
        assert persisted_missing is not None
        assert persisted_missing.state_reconcile_attempt_count == 1
        assert persisted_missing.state_reconcile_error == "The new logical document is not visible yet"
        assert persisted_error is not None
        assert persisted_error.state_reconcile_attempt_count == 1
        assert persisted_error.state_reconcile_error == "remote metadata failed"
