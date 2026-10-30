from __future__ import annotations

import inspect
import time
import types
from collections.abc import Callable, Iterator
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock as _dataset_service_segment_MagicMock
from unittest.mock import create_autospec
from unittest.mock import patch as _dataset_service_dataset_patch
from unittest.mock import patch as _dataset_service_segment_patch

import pytest
from redis.exceptions import LockNotOwnedError
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelInstance
from core.rag.index_processor.constant.built_in_field import BuiltInField as _metadata_built_in_fields_BuiltInField
from core.rag.index_processor.constant.index_type import (
    IndexStructureType as _dataset_service_lock_not_owned_IndexStructureType,
)
from core.rag.index_processor.constant.index_type import (
    IndexStructureType as _dataset_service_segment_IndexStructureType,
)
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from models import Account as _dataset_service_dataset_Account
from models import Account as _dataset_service_segment_Account
from models.account import Account as _dataset_service_lock_not_owned_Account
from models.account import Tenant
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetCollectionBinding,
    DatasetPermission,
    DatasetPermissionEnum,
    DocumentSegment,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
    build_built_in_field_values,
)
from models.dataset import DatasetProcessRule as _dataset_service_lock_not_owned_DatasetProcessRule
from models.dataset import Document as _dataset_service_lock_not_owned_Document
from models.dataset import (
    Document as _dataset_service_segment_Document,
)
from models.dataset import Document as _metadata_built_in_fields_Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode, SegmentStatus
from models.model import UploadFile
from models.source import DataSourceOauthBinding
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.enterprise import rbac_service
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo,
    RagPipelineDatasetCreateEntity,
)
from services.errors.base import NoPermissionError
from services.errors.dataset import DatasetNameDuplicateError
from services.knowledge import dataset_service
from services.knowledge.dataset_service import DatasetCollectionBindingService, DatasetPermissionService, SegmentService
from services.knowledge.dataset_service import DatasetService as _dataset_service_dataset_DatasetService
from services.knowledge.dataset_service import DocumentService as _dataset_service_lock_not_owned_DocumentService
from services.knowledge.dataset_service import DocumentService as _metadata_built_in_fields_DocumentService
from services.knowledge.dataset_service import (
    DocumentService as _save_document_with_dataset_id_mysql_snapshot_DocumentService,
)
from services.knowledge.entities.knowledge_entities import DataSource as _dataset_service_lock_not_owned_DataSource
from services.knowledge.entities.knowledge_entities import InfoList as _dataset_service_lock_not_owned_InfoList
from services.knowledge.entities.knowledge_entities import (
    KnowledgeConfig as _dataset_service_lock_not_owned_KnowledgeConfig,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.application import SegmentIndex, SegmentIndexingState, SegmentMutationService
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_account, make_dataset, make_document, make_tenant, make_upload_file
from tests.helpers.unit.services.dataset_service_test_helpers import Account as _dataset_service_document_Account
from tests.helpers.unit.services.dataset_service_test_helpers import (
    BuiltInField as _dataset_service_document_BuiltInField,
)
from tests.helpers.unit.services.dataset_service_test_helpers import (
    CloudPlan,
    DocumentIndexingError,
    FileInfo,
    FileNotExistsError,
    NotFound,
    NotionIcon,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    ProcessRule,
    RerankingModel,
    RetrievalMethod,
    RetrievalModel,
    Rule,
    Segmentation,
    TenantAccountRole,
    WebsiteInfo,
    _make_features,
    _make_knowledge_configuration,
    _make_lock_context,
    _make_retrieval_model,
    _make_upload_knowledge_config,
    json,
)
from tests.helpers.unit.services.dataset_service_test_helpers import (
    DatasetProcessRule as _dataset_service_document_DatasetProcessRule,
)
from tests.helpers.unit.services.dataset_service_test_helpers import (
    DatasetService as _dataset_service_document_DatasetService,
)
from tests.helpers.unit.services.dataset_service_test_helpers import DataSource as _dataset_service_document_DataSource
from tests.helpers.unit.services.dataset_service_test_helpers import Document as _dataset_service_document_Document
from tests.helpers.unit.services.dataset_service_test_helpers import (
    DocumentService as _dataset_service_document_DocumentService,
)
from tests.helpers.unit.services.dataset_service_test_helpers import (
    IndexStructureType as _dataset_service_document_IndexStructureType,
)
from tests.helpers.unit.services.dataset_service_test_helpers import InfoList as _dataset_service_document_InfoList
from tests.helpers.unit.services.dataset_service_test_helpers import (
    KnowledgeConfig as _dataset_service_document_KnowledgeConfig,
)
from tests.helpers.unit.services.dataset_service_test_helpers import MagicMock as _dataset_service_dataset_MagicMock
from tests.helpers.unit.services.dataset_service_test_helpers import patch as _dataset_service_document_patch

"""Regression coverage for #41735.

The pre-fix code in ``DocumentService.save_document_with_dataset_id``
read ``UploadFile`` rows inside a single session that had its
``REPEATABLE READ`` snapshot pinned by an earlier ``Dataset`` SELECT.
When ``FileService.upload_text`` / ``upload_file`` committed the
``upload_files`` row in a SEPARATE session, the row was invisible to
*this* session until the snapshot was refreshed, and
``save_document_with_dataset_id`` reported ``One or more files not
found.`` even though the row was committed (verified via a second
session).

The fix forces ``session.commit()`` immediately before the
``UploadFile`` lookup so the next SELECT starts a fresh snapshot.
This file pins that contract by reading the function source and
asserting the structural invariant directly.
"""


class TestSaveDocumentWithDatasetIdMysqlSnapshotCases:
    @staticmethod
    def test_session_committed_before_upload_file_lookup() -> None:
        """#41735: ``session.commit()`` must run BEFORE the ``UploadFile``
        SELECT so the SELECT sees rows committed by ``FileService.upload_text``
        on a different session. MySQL REPEATABLE READ keeps the original
        snapshot for the rest of the transaction; the commit ends it so the
        next SELECT starts a fresh transaction with a new snapshot.
        PostgreSQL's default READ COMMITTED rebuilds the read view per
        statement so the extra commit is a no-op there.

        Read the function source and assert that ``session.commit()`` is
        called BEFORE the ``UploadFile`` SELECT — the same structural
        invariant the reproduction in the issue depends on, without needing
        a live MySQL database.
        """
        source_lines = inspect.getsource(
            _save_document_with_dataset_id_mysql_snapshot_DocumentService.save_prepared_documents
        ).splitlines()

        upload_select_line = next(
            (i for i, line in enumerate(source_lines) if "select(UploadFile)" in line),
            None,
        )
        assert upload_select_line is not None, "save_prepared_documents must contain a select(UploadFile) call"

        # Find every ``session.commit()`` call, then keep the last one
        # whose line number is BEFORE the UploadFile SELECT. If the fix is
        # in place, that commit is the snapshot refresh.
        last_commit_before_upload = -1
        for i, line in enumerate(source_lines):
            if i >= upload_select_line:
                break
            if "session.commit()" in line:
                last_commit_before_upload = i

        assert last_commit_before_upload >= 0, (
            "save_prepared_documents must call session.commit() at least once before the UploadFile SELECT"
        )

        # The fix is a focused call: one extra ``session.commit()`` between
        # the (already-existing) ``DocumentService.check_doc_form`` call and
        # the ``select(UploadFile)`` call. Pin that there's a comment
        # referencing #41735 right above the new commit so a future edit
        # doesn't accidentally delete the snapshot refresh without
        # understanding why it's there.
        assert "#41735" in "\n".join(source_lines), (
            "The fix's invariant comment referencing issue #41735 must be present in save_prepared_documents"
        )


CREATED_AT = datetime(2026, 10, 16, 8, 0, 0)
CREATED_AT_EPOCH = 1792137600


FRACTIONAL_CREATED_AT = datetime(2026, 10, 16, 8, 0, 0, 900000)


class TestMetadataBuiltInFieldsCases:
    @staticmethod
    @pytest.fixture
    def non_utc_host_timezone(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
        monkeypatch.setenv("TZ", "Asia/Tokyo")
        time.tzset()
        yield
        monkeypatch.undo()
        time.tzset()

    @staticmethod
    @pytest.mark.usefixtures("non_utc_host_timezone")
    def test_build_built_in_field_values_treats_naive_datetimes_as_utc() -> None:
        values = build_built_in_field_values(
            document_name="doc.txt",
            uploader="Alice",
            upload_date=CREATED_AT,
            last_update_date=CREATED_AT,
            data_source_type=DataSourceType.UPLOAD_FILE,
        )

        assert values == {
            _metadata_built_in_fields_BuiltInField.document_name: "doc.txt",
            _metadata_built_in_fields_BuiltInField.uploader: "Alice",
            _metadata_built_in_fields_BuiltInField.upload_date: CREATED_AT_EPOCH,
            _metadata_built_in_fields_BuiltInField.last_update_date: CREATED_AT_EPOCH,
            _metadata_built_in_fields_BuiltInField.source: "file_upload",
        }

    @staticmethod
    @pytest.mark.parametrize(
        ("data_source_type", "source"),
        [
            (DataSourceType.UPLOAD_FILE, "file_upload"),
            (DataSourceType.LOCAL_FILE, "file_upload"),
            (DataSourceType.NOTION_IMPORT, "notion"),
            (DataSourceType.WEBSITE_CRAWL, "website"),
            (DataSourceType.ONLINE_DOCUMENT, "online_document"),
            (DataSourceType.ONLINE_DRIVE, "online_drive"),
        ],
    )
    def test_build_built_in_field_values_maps_source_to_metadata_label(
        data_source_type: DataSourceType, source: str
    ) -> None:
        values = build_built_in_field_values(
            document_name="doc.txt",
            uploader=None,
            upload_date=CREATED_AT,
            last_update_date=CREATED_AT,
            data_source_type=data_source_type,
        )

        assert values[_metadata_built_in_fields_BuiltInField.source] == source

    @staticmethod
    @pytest.mark.parametrize(
        "data_source_type",
        [DataSourceType.UPLOAD_FILE, DataSourceType.NOTION_IMPORT, DataSourceType.WEBSITE_CRAWL],
    )
    def test_build_document_writes_built_in_fields_in_shared_format(
        monkeypatch: pytest.MonkeyPatch, data_source_type: DataSourceType
    ) -> None:
        monkeypatch.setattr(dataset_service, "naive_utc_now", lambda: CREATED_AT)
        dataset = make_dataset(built_in_field_enabled=True)

        document = _metadata_built_in_fields_DocumentService.build_document(
            dataset=dataset,
            process_rule_id=None,
            data_source_type=data_source_type,
            document_form="text_model",
            document_language="English",
            data_source_info={},
            created_from="web",
            position=1,
            account=make_account(name="Alice"),
            name="doc.txt",
            batch="batch-1",
        )

        assert document.doc_metadata == build_built_in_field_values(
            document_name="doc.txt",
            uploader="Alice",
            upload_date=CREATED_AT,
            last_update_date=CREATED_AT,
            data_source_type=data_source_type,
        )

    @staticmethod
    def test_build_document_skips_built_in_fields_when_disabled() -> None:
        dataset = make_dataset(built_in_field_enabled=False)

        document = _metadata_built_in_fields_DocumentService.build_document(
            dataset=dataset,
            process_rule_id=None,
            data_source_type=DataSourceType.UPLOAD_FILE,
            document_form="text_model",
            document_language="English",
            data_source_info={},
            created_from="web",
            position=1,
            account=make_account(name="Alice"),
            name="doc.txt",
            batch="batch-1",
        )

        assert not document.doc_metadata

    @staticmethod
    def test_build_built_in_field_values_keeps_fractional_epoch_seconds() -> None:
        values = build_built_in_field_values(
            document_name="doc.txt",
            uploader=None,
            upload_date=FRACTIONAL_CREATED_AT,
            last_update_date=FRACTIONAL_CREATED_AT,
            data_source_type=DataSourceType.UPLOAD_FILE,
        )

        assert values[_metadata_built_in_fields_BuiltInField.upload_date] == pytest.approx(
            CREATED_AT_EPOCH + 0.9, abs=1e-6
        )
        assert values[_metadata_built_in_fields_BuiltInField.last_update_date] == pytest.approx(
            CREATED_AT_EPOCH + 0.9, abs=1e-6
        )

    @staticmethod
    @pytest.mark.parametrize(
        "field",
        [_metadata_built_in_fields_BuiltInField.upload_date, _metadata_built_in_fields_BuiltInField.last_update_date],
    )
    @pytest.mark.parametrize(("condition", "matches"), [("after", True), (">", True), ("=", False), ("is", False)])
    def test_fractional_built_in_dates_keep_integer_second_boundary_semantics(
        sqlite_session_factory: sessionmaker[Session],
        field: _metadata_built_in_fields_BuiltInField,
        condition: str,
        matches: bool,
    ) -> None:
        values = build_built_in_field_values(
            document_name="doc.txt",
            uploader=None,
            upload_date=FRACTIONAL_CREATED_AT,
            last_update_date=FRACTIONAL_CREATED_AT,
            data_source_type=DataSourceType.UPLOAD_FILE,
        )
        doc_metadata: dict[str, object] = dict(values)
        with sqlite_session_factory.begin() as session:
            session.add(make_document(document_id="document-1", doc_metadata=doc_metadata))

        filters = DatasetRetrieval.process_metadata_filter_func(0, condition, field, CREATED_AT_EPOCH, [])
        with sqlite_session_factory() as session:
            found = session.scalars(select(_metadata_built_in_fields_Document.id).where(*filters)).all()

        assert found == (["document-1"] if matches else [])


"""SQLite-backed tests for dataset-level operations in :mod:`services.knowledge.dataset_service`.

Mapped objects in this module are real SQLAlchemy models. Provider runtimes,
RBAC clients, Celery tasks, and model-manager results remain mocked at their
external boundaries.
"""


def _dataset_service_dataset_account(
    *,
    account_id: str = "user-1",
    tenant_id: str = "tenant-1",
    role: TenantAccountRole = TenantAccountRole.OWNER,
) -> _dataset_service_dataset_Account:
    return make_account(
        account_id=account_id,
        name=f"User {account_id}",
        email=f"{account_id}@example.com",
        role=role,
        tenant=make_tenant(tenant_id=tenant_id, name=f"Tenant {tenant_id}"),
    )


def _dataset_service_dataset_dataset(
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    name: str = "Dataset",
    maintainer: str = "user-1",
    permission: DatasetPermissionEnum = DatasetPermissionEnum.ALL_TEAM,
    provider: str = "vendor",
    indexing_technique: str = IndexTechniqueType.ECONOMY,
    chunk_structure: str | None = "text_model",
) -> Dataset:
    return make_dataset(
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        name=name,
        description="",
        provider=provider,
        created_by=maintainer,
        maintainer=maintainer,
        permission=permission,
        indexing_technique=indexing_technique,
        chunk_structure=chunk_structure,
        embedding_model_provider="provider",
        embedding_model="embedding-model",
    )


def _external_api(*, api_id: str = "api-1", tenant_id: str = "tenant-1") -> ExternalKnowledgeApis:
    api = ExternalKnowledgeApis(
        name="External API",
        description="",
        tenant_id=tenant_id,
        settings="{}",
        created_by="user-1",
        updated_by="user-1",
    )
    api.id = api_id
    return api


def _binding(
    *,
    binding_id: str = "binding-1",
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    api_id: str = "api-1",
    knowledge_id: str = "knowledge-1",
) -> ExternalKnowledgeBindings:
    binding = ExternalKnowledgeBindings(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        external_knowledge_api_id=api_id,
        external_knowledge_id=knowledge_id,
        created_by="user-1",
    )
    binding.id = binding_id
    return binding


class TestDatasetServiceDatasetCases:
    class TestDatasetServiceValidation:
        @pytest.mark.parametrize(
            ("dataset_doc_form", "incoming_doc_form"),
            [(None, "text_model"), ("text_model", "text_model")],
        )
        def test_check_doc_form_allows_matching_or_missing_dataset_doc_form(
            self,
            sqlite_session: Session,
            dataset_doc_form: str | None,
            incoming_doc_form: str,
        ) -> None:
            dataset = _dataset_service_dataset_dataset(chunk_structure=dataset_doc_form)
            sqlite_session.add(dataset)
            sqlite_session.commit()

            _dataset_service_dataset_DatasetService.check_doc_form(dataset, incoming_doc_form, session=sqlite_session)

        def test_check_doc_form_rejects_mismatched_doc_form(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(chunk_structure="qa_model")
            sqlite_session.add(dataset)
            sqlite_session.commit()

            with pytest.raises(ValueError, match="doc_form is different"):
                _dataset_service_dataset_DatasetService.check_doc_form(dataset, "text_model", session=sqlite_session)

        @pytest.mark.parametrize("operator_check", [False, True])
        def test_dataset_permission_checks_ignore_foreign_tenant_binding(
            self, sqlite_session: Session, operator_check: bool
        ) -> None:
            dataset = _dataset_service_dataset_dataset(
                dataset_id="dataset-1",
                tenant_id="tenant-1",
                permission=DatasetPermissionEnum.PARTIAL_TEAM,
                maintainer="owner-1",
            )
            user = _dataset_service_dataset_account(
                account_id="user-1",
                tenant_id="tenant-1",
                role=TenantAccountRole.NORMAL,
            )
            sqlite_session.add_all(
                [
                    dataset,
                    DatasetPermission(dataset_id=dataset.id, account_id=user.id, tenant_id="tenant-2"),
                ]
            )
            sqlite_session.commit()

            if operator_check:
                with pytest.raises(NoPermissionError):
                    _dataset_service_dataset_DatasetService.check_dataset_operator_permission(
                        user, dataset, session=sqlite_session
                    )
            else:
                with pytest.raises(NoPermissionError):
                    _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, user, sqlite_session)

        def test_check_dataset_model_setting_skips_non_high_quality_datasets(self) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.ECONOMY)

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                _dataset_service_dataset_DatasetService.check_dataset_model_setting(dataset)

            model_manager_cls.assert_not_called()

        def test_check_dataset_model_setting_validates_high_quality_embedding(self) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                _dataset_service_dataset_DatasetService.check_dataset_model_setting(dataset)

            model_manager_cls.for_tenant.return_value.get_model_instance.assert_called_once_with(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )

        @pytest.mark.parametrize(
            ("error", "message"),
            [
                (LLMBadRequestError(), "No Embedding Model available"),
                (ProviderTokenNotInitError("token missing"), "token missing"),
            ],
        )
        def test_check_dataset_model_setting_wraps_provider_errors(self, error: Exception, message: str) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = error
                with pytest.raises(ValueError, match=message):
                    _dataset_service_dataset_DatasetService.check_dataset_model_setting(dataset)

        @pytest.mark.parametrize(("features", "expected"), [([ModelFeature.VISION], True), ([], False)])
        def test_check_is_multimodal_model_reads_runtime_schema(
            self, features: list[ModelFeature], expected: bool
        ) -> None:
            model_type_instance = _dataset_service_dataset_MagicMock()
            model_type_instance.get_model_schema.return_value = SimpleNamespace(features=features)
            model_instance = SimpleNamespace(
                model_type_instance=model_type_instance,
                model_name="embedding-model",
                credentials={"api_key": "secret"},
            )

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance
                result = _dataset_service_dataset_DatasetService.check_is_multimodal_model(
                    "tenant-1", "provider", "embedding-model"
                )

            assert result is expected

        def test_check_is_multimodal_model_rejects_missing_schema(self) -> None:
            model_type_instance = _dataset_service_dataset_MagicMock()
            model_type_instance.get_model_schema.return_value = None
            model_instance = SimpleNamespace(
                model_type_instance=model_type_instance,
                model_name="embedding-model",
                credentials={},
            )

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance
                with pytest.raises(ValueError, match="Model schema not found"):
                    _dataset_service_dataset_DatasetService.check_is_multimodal_model(
                        "tenant-1", "provider", "embedding-model"
                    )

        @pytest.mark.parametrize(
            ("method", "error", "message"),
            [
                (
                    _dataset_service_dataset_DatasetService.check_embedding_model_setting,
                    ProviderTokenNotInitError("provider setup"),
                    "provider setup",
                ),
                (
                    _dataset_service_dataset_DatasetService.check_reranking_model_setting,
                    LLMBadRequestError(),
                    "No Rerank Model available",
                ),
            ],
        )
        def test_direct_model_setting_checks_wrap_runtime_errors(
            self, method: Callable[[str, str, str], None], error: Exception, message: str
        ) -> None:
            with _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls:
                model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = error
                with pytest.raises(ValueError, match=message):
                    method("tenant-1", "provider", "model")

    class TestDatasetServiceRetrieval:
        def test_get_dataset_for_tenant_rejects_cross_tenant_row(self, sqlite_session: Session) -> None:
            owned = _dataset_service_dataset_dataset()
            foreign = _dataset_service_dataset_dataset(dataset_id="dataset-2", tenant_id="tenant-2", name="Foreign")
            sqlite_session.add_all([owned, foreign])
            sqlite_session.commit()

            assert (
                _dataset_service_dataset_DatasetService.get_dataset_for_tenant(
                    owned.id, "tenant-1", session=sqlite_session
                )
                is owned
            )
            assert (
                _dataset_service_dataset_DatasetService.get_dataset_for_tenant(
                    foreign.id, "tenant-1", session=sqlite_session
                )
                is None
            )

        def test_get_datasets_filters_by_creator_ids(
            self, application_tags, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            creator_one = _dataset_service_dataset_dataset(
                dataset_id="creator-one", name="Creator One", maintainer="creator-1"
            )
            creator_two = _dataset_service_dataset_dataset(
                dataset_id="creator-two", name="Creator Two", maintainer="creator-2"
            )
            excluded = _dataset_service_dataset_dataset(dataset_id="excluded", name="Excluded", maintainer="creator-3")
            foreign = _dataset_service_dataset_dataset(
                dataset_id="foreign",
                tenant_id="tenant-2",
                name="Foreign",
                maintainer="creator-1",
            )
            sqlite_session.add_all([creator_one, creator_two, excluded, foreign])
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=False)
            datasets, total = _dataset_service_dataset_DatasetService.get_datasets(
                page=1,
                per_page=20,
                session=sqlite_session,
                tenant_id="tenant-1",
                creator_ids=["creator-1", "creator-2"],
                tags=application_tags,
            )

            assert total == 2
            assert {dataset.id for dataset in datasets} == {creator_one.id, creator_two.id}

        def test_get_datasets_applies_rbac_resource_scope_and_maintainer_override(
            self, application_tags, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            user = _dataset_service_dataset_account(role=TenantAccountRole.NORMAL)
            accessible = _dataset_service_dataset_dataset(
                dataset_id="accessible", name="Accessible", maintainer="other"
            )
            owned = _dataset_service_dataset_dataset(dataset_id="owned", name="Owned", maintainer=user.id)
            hidden = _dataset_service_dataset_dataset(dataset_id="hidden", name="Hidden", maintainer="other")
            foreign = _dataset_service_dataset_dataset(dataset_id="foreign", tenant_id="tenant-2", name="Foreign")
            sqlite_session.add_all([accessible, owned, hidden, foreign])
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=True)

            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=SimpleNamespace(workspace=SimpleNamespace(permission_keys=[])),
                ),
            ):
                datasets, total = _dataset_service_dataset_DatasetService.get_datasets(
                    page=1,
                    per_page=20,
                    session=sqlite_session,
                    tenant_id="tenant-1",
                    user=user,
                    accessible_dataset_ids=[accessible.id],
                    tags=application_tags,
                )

            assert total == 2
            assert {dataset.id for dataset in datasets} == {accessible.id, owned.id}

        def test_get_datasets_without_user_keeps_only_team_visible_rows(
            self, application_tags, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            shared = _dataset_service_dataset_dataset(
                dataset_id="shared", name="Shared", permission=DatasetPermissionEnum.ALL_TEAM
            )
            private = _dataset_service_dataset_dataset(
                dataset_id="private", name="Private", permission=DatasetPermissionEnum.ONLY_ME
            )
            sqlite_session.add_all([shared, private])
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=False)
            datasets, total = _dataset_service_dataset_DatasetService.get_datasets(
                page=1, per_page=20, session=sqlite_session, tenant_id="tenant-1", tags=application_tags
            )

            assert total == 1
            assert [dataset.id for dataset in datasets] == [shared.id]

        def test_get_datasets_by_ids_intersects_requested_and_accessible_ids(
            self, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            user = _dataset_service_dataset_account(role=TenantAccountRole.NORMAL)
            accessible = _dataset_service_dataset_dataset(
                dataset_id="accessible", name="Accessible", maintainer="other"
            )
            owned = _dataset_service_dataset_dataset(dataset_id="owned", name="Owned", maintainer=user.id)
            hidden = _dataset_service_dataset_dataset(dataset_id="hidden", name="Hidden", maintainer="other")
            sqlite_session.add_all([accessible, owned, hidden])
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=True)
            datasets, total = _dataset_service_dataset_DatasetService.get_datasets_by_ids(
                [accessible.id, owned.id, hidden.id],
                "tenant-1",
                user=user,
                accessible_dataset_ids=[accessible.id, "not-requested"],
                session=sqlite_session,
            )

            assert total == 2
            assert {dataset.id for dataset in datasets} == {accessible.id, owned.id}

        def test_get_datasets_rbac_without_user_returns_no_rows(
            self, application_tags, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            sqlite_session.add(_dataset_service_dataset_dataset())
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=True)
            datasets, total = _dataset_service_dataset_DatasetService.get_datasets(
                page=1, per_page=20, session=sqlite_session, tenant_id="tenant-1", tags=application_tags
            )

            assert datasets == []
            assert total == 0

        def test_get_datasets_rbac_include_all_requires_workspace_permission(
            self, application_tags, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            user = _dataset_service_dataset_account(role=TenantAccountRole.NORMAL)
            sqlite_session.add_all(
                [
                    _dataset_service_dataset_dataset(dataset_id="one", name="One", maintainer="other"),
                    _dataset_service_dataset_dataset(dataset_id="two", name="Two", maintainer="other"),
                ]
            )
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=True)
            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=SimpleNamespace(
                        workspace=SimpleNamespace(permission_keys=["dataset.create_and_management"])
                    ),
                ),
            ):
                datasets, total = _dataset_service_dataset_DatasetService.get_datasets(
                    page=1,
                    per_page=20,
                    session=sqlite_session,
                    tenant_id="tenant-1",
                    user=user,
                    include_all=True,
                    tags=application_tags,
                )

            assert total == 2
            assert {dataset.id for dataset in datasets} == {"one", "two"}

    class TestDatasetServiceCreationAndUpdate:
        def test_create_empty_dataset_rejects_duplicate_name(self, sqlite_session: Session) -> None:
            sqlite_session.add(_dataset_service_dataset_dataset(name="Existing"))
            sqlite_session.commit()

            with pytest.raises(DatasetNameDuplicateError, match="already exists"):
                _dataset_service_dataset_DatasetService.create_empty_dataset(
                    "tenant-1",
                    "Existing",
                    "",
                    IndexTechniqueType.ECONOMY,
                    _dataset_service_dataset_account(),
                    session=sqlite_session,
                )

        def test_create_empty_dataset_persists_default_embedding_and_creator_scope(
            self,
            sqlite_session: Session,
            sqlite_session_factory: sessionmaker[Session],
        ) -> None:
            embedding_model = SimpleNamespace(provider="provider", model_name="default-embedding")

            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"
                ),
            ):
                model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = embedding_model
                dataset = _dataset_service_dataset_DatasetService.create_empty_dataset(
                    "tenant-1",
                    "Created",
                    "Description",
                    IndexTechniqueType.HIGH_QUALITY,
                    _dataset_service_dataset_account(),
                    session=sqlite_session,
                )

            with sqlite_session_factory() as observer:
                persisted = observer.get(Dataset, dataset.id)
                assert persisted is not None
                assert persisted.tenant_id == "tenant-1"
                assert persisted.maintainer == "user-1"
                assert persisted.embedding_model == "default-embedding"

        def test_create_empty_external_dataset_persists_tenant_owned_binding(self, sqlite_session: Session) -> None:
            sqlite_session.add_all([_external_api(), _external_api(api_id="api-foreign", tenant_id="tenant-2")])
            sqlite_session.commit()

            with _dataset_service_dataset_patch(
                "services.knowledge.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"
            ):
                dataset = _dataset_service_dataset_DatasetService.create_empty_dataset(
                    "tenant-1",
                    "External",
                    "",
                    IndexTechniqueType.ECONOMY,
                    _dataset_service_dataset_account(),
                    provider="external",
                    external_knowledge_api_id="api-1",
                    external_knowledge_id="knowledge-1",
                    retrieval_model=_make_retrieval_model(),
                    session=sqlite_session,
                )

            binding = sqlite_session.scalar(
                select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == dataset.id)
            )
            assert binding is not None
            assert binding.tenant_id == dataset.tenant_id
            assert binding.external_knowledge_api_id == "api-1"

        def test_create_empty_external_dataset_rejects_foreign_api(self, sqlite_session: Session) -> None:
            sqlite_session.add(_external_api(api_id="api-foreign", tenant_id="tenant-2"))
            sqlite_session.commit()

            with (
                pytest.raises(ValueError, match="api template not found"),
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"
                ),
            ):
                _dataset_service_dataset_DatasetService.create_empty_dataset(
                    "tenant-1",
                    "External",
                    "",
                    IndexTechniqueType.ECONOMY,
                    _dataset_service_dataset_account(),
                    provider="external",
                    external_knowledge_api_id="api-foreign",
                    external_knowledge_id="knowledge-1",
                    session=sqlite_session,
                )

        def test_create_empty_rag_pipeline_dataset_generates_incremental_name(self, sqlite_session: Session) -> None:
            sqlite_session.add(_dataset_service_dataset_dataset(name="Untitled 1"))
            sqlite_session.commit()
            entity = RagPipelineDatasetCreateEntity(
                name="",
                description="Pipeline dataset",
                icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

            with _dataset_service_dataset_patch(
                "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
            ):
                dataset = _dataset_service_dataset_DatasetService.create_empty_rag_pipeline_dataset(
                    "tenant-1", entity, sqlite_session
                )

            assert dataset.name == "Untitled 2"
            pipeline = sqlite_session.get(Pipeline, dataset.pipeline_id)
            assert pipeline is not None
            assert pipeline.tenant_id == dataset.tenant_id

        def test_create_empty_rag_pipeline_dataset_rejects_duplicate_name(self, sqlite_session: Session) -> None:
            sqlite_session.add(_dataset_service_dataset_dataset(name="Existing"))
            sqlite_session.commit()
            entity = RagPipelineDatasetCreateEntity(
                name="Existing",
                description="",
                icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
                ),
                pytest.raises(DatasetNameDuplicateError, match="already exists"),
            ):
                _dataset_service_dataset_DatasetService.create_empty_rag_pipeline_dataset(
                    "tenant-1", entity, sqlite_session
                )

        def test_create_empty_rag_pipeline_dataset_requires_authenticated_account(
            self, sqlite_session: Session
        ) -> None:
            account = _dataset_service_dataset_account()
            account.id = ""
            entity = RagPipelineDatasetCreateEntity(
                name="Dataset",
                description="",
                icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
                pytest.raises(ValueError, match="Current user or current user id not found"),
            ):
                _dataset_service_dataset_DatasetService.create_empty_rag_pipeline_dataset(
                    "tenant-1", entity, sqlite_session
                )

        def test_update_dataset_rejects_missing_and_duplicate_rows(self, sqlite_session: Session) -> None:
            current = _dataset_service_dataset_dataset(name="Current")
            duplicate = _dataset_service_dataset_dataset(dataset_id="dataset-2", name="Duplicate")
            sqlite_session.add_all([current, duplicate])
            sqlite_session.commit()

            with pytest.raises(ValueError, match="Dataset not found"):
                _dataset_service_dataset_DatasetService.update_dataset(
                    "missing", {}, _dataset_service_dataset_account(), session=sqlite_session
                )
            with pytest.raises(ValueError, match="Dataset name already exists"):
                _dataset_service_dataset_DatasetService.update_dataset(
                    current.id, {"name": duplicate.name}, _dataset_service_dataset_account(), session=sqlite_session
                )

        @pytest.mark.parametrize(
            ("provider", "helper_name"),
            [("external", "_update_external_dataset"), ("vendor", "_update_internal_dataset")],
        )
        def test_update_dataset_routes_by_provider(
            self, sqlite_session: Session, provider: str, helper_name: str
        ) -> None:
            dataset = _dataset_service_dataset_dataset(provider=provider)
            sqlite_session.add(dataset)
            sqlite_session.commit()

            with (
                _dataset_service_dataset_patch.object(
                    _dataset_service_dataset_DatasetService, "check_dataset_permission"
                ),
                _dataset_service_dataset_patch.object(
                    _dataset_service_dataset_DatasetService, helper_name, return_value=dataset
                ) as update_helper,
            ):
                result = _dataset_service_dataset_DatasetService.update_dataset(
                    dataset.id,
                    {"name": dataset.name},
                    _dataset_service_dataset_account(),
                    session=sqlite_session,
                )

            assert result is dataset
            update_helper.assert_called_once()

        @pytest.mark.parametrize(
            ("payload", "message"),
            [
                ({"external_knowledge_api_id": "api-1"}, "External knowledge id is required"),
                ({"external_knowledge_id": "knowledge-1"}, "External knowledge api id is required"),
            ],
        )
        def test_update_external_dataset_requires_binding_fields(
            self, unbound_session: Session, payload: dict[str, str], message: str
        ) -> None:
            with pytest.raises(ValueError, match=message):
                _dataset_service_dataset_DatasetService._update_external_dataset(
                    _dataset_service_dataset_dataset(provider="external"),
                    payload,
                    _dataset_service_dataset_account(),
                    unbound_session,
                )

        def test_update_external_dataset_flushes_dataset_and_binding_without_committing(
            self, sqlite_session: Session
        ) -> None:
            dataset = _dataset_service_dataset_dataset(provider="external")
            api = _external_api()
            binding = _binding()
            sqlite_session.add_all([dataset, api, binding])
            sqlite_session.commit()
            transaction_events: list[str] = []
            event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

            updated = _dataset_service_dataset_DatasetService._update_external_dataset(
                dataset,
                {
                    "name": "Updated",
                    "description": "Changed",
                    "external_knowledge_id": "knowledge-2",
                    "external_knowledge_api_id": api.id,
                },
                _dataset_service_dataset_account(),
                sqlite_session,
            )

            assert updated is dataset
            assert dataset.name == "Updated"
            assert binding.external_knowledge_id == "knowledge-2"
            assert transaction_events == []

        def test_update_external_dataset_rejects_cross_tenant_api(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(provider="external")
            foreign_api = _external_api(api_id="api-foreign", tenant_id="tenant-2")
            sqlite_session.add_all([dataset, foreign_api, _binding()])
            sqlite_session.commit()

            with pytest.raises(ValueError, match="api template not found"):
                _dataset_service_dataset_DatasetService._update_external_dataset(
                    dataset,
                    {
                        "external_knowledge_id": "knowledge-2",
                        "external_knowledge_api_id": foreign_api.id,
                    },
                    _dataset_service_dataset_account(),
                    sqlite_session,
                )

        def test_update_external_knowledge_binding_rejects_missing_row(self, sqlite_session: Session) -> None:
            with pytest.raises(ValueError, match="binding not found"):
                _dataset_service_dataset_DatasetService._update_external_knowledge_binding(
                    "missing-dataset",
                    "knowledge-2",
                    "api-2",
                    sqlite_session,
                )

        def test_update_internal_dataset_executes_real_update_without_committing(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(name="Before")
            sqlite_session.add(dataset)
            sqlite_session.commit()
            transaction_events: list[str] = []
            event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

            with (
                _dataset_service_dataset_patch.object(
                    _dataset_service_dataset_DatasetService, "_handle_indexing_technique_change", return_value="update"
                ),
                _dataset_service_dataset_patch.object(
                    _dataset_service_dataset_DatasetService, "_update_pipeline_knowledge_base_node_data"
                ),
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.deal_dataset_vector_index_task.delay"
                ) as vector_task,
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.regenerate_summary_index_task.delay"
                ) as summary_task,
            ):
                updated = _dataset_service_dataset_DatasetService._update_internal_dataset(
                    dataset,
                    {"name": "After", "description": "Changed"},
                    _dataset_service_dataset_account(),
                    sqlite_session,
                )

            assert updated.name == "After"
            assert updated.description == "Changed"
            assert transaction_events == []
            vector_task.assert_called_once_with(dataset.id, "update")
            summary_task.assert_called_once()

        def test_update_pipeline_node_data_returns_for_non_pipeline_or_missing_pipeline(
            self, sqlite_session: Session
        ) -> None:
            ordinary = _dataset_service_dataset_dataset()
            missing_pipeline = _dataset_service_dataset_dataset(dataset_id="pipeline-dataset", name="Pipeline Dataset")
            missing_pipeline.runtime_mode = "rag_pipeline"
            missing_pipeline.pipeline_id = "missing-pipeline"
            sqlite_session.add_all([ordinary, missing_pipeline])
            sqlite_session.commit()

            _dataset_service_dataset_DatasetService._update_pipeline_knowledge_base_node_data(
                ordinary, "user-1", sqlite_session
            )
            _dataset_service_dataset_DatasetService._update_pipeline_knowledge_base_node_data(
                missing_pipeline, "user-1", sqlite_session
            )

        def test_update_pipeline_node_data_rolls_back_real_session_on_failure(self, sqlite_session: Session) -> None:
            pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="", created_by="user-1")
            pipeline.id = "pipeline-1"
            dataset = _dataset_service_dataset_dataset()
            dataset.runtime_mode = "rag_pipeline"
            dataset.pipeline_id = pipeline.id
            sqlite_session.add_all([pipeline, dataset])
            sqlite_session.commit()
            sqlite_session.begin()
            transaction_events: list[str] = []
            event.listen(
                sqlite_session,
                "after_soft_rollback",
                lambda _session, _previous_transaction: transaction_events.append("rollback"),
            )

            with _dataset_service_dataset_patch("services.knowledge.dataset_service.RagPipelineService") as service_cls:
                service_cls.return_value.get_published_workflow.side_effect = RuntimeError("boom")
                with pytest.raises(RuntimeError, match="boom"):
                    _dataset_service_dataset_DatasetService._update_pipeline_knowledge_base_node_data(
                        dataset, "user-1", sqlite_session
                    )

            assert transaction_events == ["rollback"]

    class TestDatasetServiceEmbeddingSettings:
        def test_handle_indexing_technique_change_returns_none_without_requested_change(
            self, unbound_session: Session
        ) -> None:
            assert (
                _dataset_service_dataset_DatasetService._handle_indexing_technique_change(
                    _dataset_service_dataset_dataset(), {}, {}, unbound_session
                )
                is None
            )

        def test_handle_indexing_technique_change_switches_to_economy(self, unbound_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
            filtered_data: dict[str, object] = {}

            result = _dataset_service_dataset_DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": IndexTechniqueType.ECONOMY},
                filtered_data,
                unbound_session,
            )

            assert result == "remove"
            assert filtered_data == {
                "embedding_model": None,
                "embedding_model_provider": None,
                "collection_binding_id": None,
            }

        def test_handle_indexing_technique_change_delegates_high_quality_configuration(
            self, unbound_session: Session
        ) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
            filtered_data: dict[str, object] = {}

            with _dataset_service_dataset_patch.object(
                _dataset_service_dataset_DatasetService, "_configure_embedding_model_for_high_quality"
            ) as configure:
                result = _dataset_service_dataset_DatasetService._handle_indexing_technique_change(
                    dataset,
                    {"indexing_technique": IndexTechniqueType.HIGH_QUALITY},
                    filtered_data,
                    unbound_session,
                )

            assert result == "add"
            configure.assert_called_once()

        def test_handle_unchanged_indexing_preserves_existing_model(self, unbound_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

            with _dataset_service_dataset_patch.object(
                _dataset_service_dataset_DatasetService, "_preserve_existing_embedding_settings"
            ) as preserve:
                result = (
                    _dataset_service_dataset_DatasetService._handle_embedding_model_update_when_technique_unchanged(
                        dataset,
                        {},
                        {},
                        unbound_session,
                    )
                )

            assert result is None
            preserve.assert_called_once()

        def test_update_embedding_model_settings_delegates_changed_model(self, unbound_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset()

            with _dataset_service_dataset_patch.object(
                _dataset_service_dataset_DatasetService, "_apply_new_embedding_settings"
            ) as apply_settings:
                result = _dataset_service_dataset_DatasetService._update_embedding_model_settings(
                    dataset,
                    {"embedding_model_provider": "provider-2", "embedding_model": "model-2"},
                    {},
                    unbound_session,
                )

            assert result == "update"
            apply_settings.assert_called_once()

        def test_configure_high_quality_wraps_provider_error(self, unbound_session: Session) -> None:
            account = _dataset_service_dataset_account()
            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
                _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
            ):
                model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = LLMBadRequestError()
                with pytest.raises(ValueError, match="No Embedding Model available"):
                    _dataset_service_dataset_DatasetService._configure_embedding_model_for_high_quality(
                        {"embedding_model_provider": "provider", "embedding_model": "model"},
                        {},
                        unbound_session,
                    )

        def test_preserve_existing_embedding_settings(self) -> None:
            dataset = _dataset_service_dataset_dataset()
            filtered_data: dict[str, object] = {}

            _dataset_service_dataset_DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

            assert filtered_data["embedding_model_provider"] == dataset.embedding_model_provider
            assert filtered_data["embedding_model"] == dataset.embedding_model

        def test_update_embedding_model_settings_returns_none_when_unchanged(self, unbound_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset()

            result = _dataset_service_dataset_DatasetService._update_embedding_model_settings(
                dataset,
                {
                    "embedding_model_provider": dataset.embedding_model_provider,
                    "embedding_model": dataset.embedding_model,
                },
                {},
                unbound_session,
            )

            assert result is None

        def test_apply_new_embedding_settings_uses_real_collection_binding(self, unbound_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset()
            filtered_data: dict[str, object] = {}
            account = _dataset_service_dataset_account()
            embedding_model = SimpleNamespace(provider="new-provider", model_name="new-model")
            collection_binding = DatasetCollectionBinding(
                provider_name="new-provider",
                model_name="new-model",
                type="dataset",
                collection_name="collection",
            )
            collection_binding.id = "collection-binding-1"

            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
                _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
                _dataset_service_dataset_patch.object(
                    DatasetCollectionBindingService,
                    "get_dataset_collection_binding",
                    return_value=collection_binding,
                ),
            ):
                model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
                _dataset_service_dataset_DatasetService._apply_new_embedding_settings(
                    dataset,
                    {"embedding_model_provider": "new-provider", "embedding_model": "new-model"},
                    filtered_data,
                    unbound_session,
                )

            assert filtered_data["embedding_model_provider"] == "new-provider"
            assert filtered_data["embedding_model"] == "new-model"
            assert filtered_data["collection_binding_id"] == collection_binding.id

        def test_apply_new_embedding_settings_preserves_existing_values_when_token_missing(
            self, unbound_session: Session
        ) -> None:
            dataset = _dataset_service_dataset_dataset()
            filtered_data: dict[str, object] = {}

            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
                ),
                _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
            ):
                model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                    "missing"
                )
                _dataset_service_dataset_DatasetService._apply_new_embedding_settings(
                    dataset,
                    {"embedding_model_provider": "provider-2", "embedding_model": "model-2"},
                    filtered_data,
                    unbound_session,
                )

            assert filtered_data["embedding_model_provider"] == dataset.embedding_model_provider
            assert filtered_data["embedding_model"] == dataset.embedding_model

        @pytest.mark.parametrize(
            ("summary_setting", "expected"),
            [
                (None, False),
                ({"enable": False}, False),
                ({"enable": True, "model_name": "old-model", "model_provider_name": "provider"}, False),
                ({"enable": True, "model_name": "new-model", "model_provider_name": "provider"}, True),
            ],
        )
        def test_check_summary_index_setting_model_changed(
            self, summary_setting: dict[str, object] | None, expected: bool
        ) -> None:
            dataset = _dataset_service_dataset_dataset()
            dataset.summary_index_setting = {
                "enable": True,
                "model_name": "old-model",
                "model_provider_name": "provider",
            }

            data = {} if summary_setting is None else {"summary_index_setting": summary_setting}
            assert (
                _dataset_service_dataset_DatasetService._check_summary_index_setting_model_changed(dataset, data)
                is expected
            )

    class TestDatasetServiceRagPipelineSettings:
        def test_requires_current_tenant(self, unbound_session: Session) -> None:
            account = _dataset_service_dataset_account()
            account._current_tenant = None

            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
                pytest.raises(ValueError, match="Current user or current tenant not found"),
            ):
                _dataset_service_dataset_DatasetService.update_rag_pipeline_dataset_settings(
                    _dataset_service_dataset_dataset(),
                    _make_knowledge_configuration(),
                    session=unbound_session,
                )

        def test_unpublished_high_quality_settings_use_real_merged_dataset(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
            sqlite_session.add(dataset)
            sqlite_session.commit()
            account = _dataset_service_dataset_account()
            embedding_model = SimpleNamespace(provider="provider-2", model_name="embedding-2")
            collection_binding = DatasetCollectionBinding(
                provider_name="provider-2",
                model_name="embedding-2",
                type="dataset",
                collection_name="collection",
            )
            collection_binding.id = "collection-binding-2"

            with (
                _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
                _dataset_service_dataset_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
                _dataset_service_dataset_patch.object(
                    _dataset_service_dataset_DatasetService, "check_is_multimodal_model", return_value=True
                ),
                _dataset_service_dataset_patch.object(
                    DatasetCollectionBindingService,
                    "get_dataset_collection_binding",
                    return_value=collection_binding,
                ),
            ):
                model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
                _dataset_service_dataset_DatasetService.update_rag_pipeline_dataset_settings(
                    dataset,
                    _make_knowledge_configuration(
                        embedding_model_provider="provider-2",
                        embedding_model="embedding-2",
                        summary_index_setting={"enable": True},
                    ),
                    session=sqlite_session,
                )

            persisted = sqlite_session.get(Dataset, dataset.id)
            assert persisted is not None
            assert persisted.indexing_technique == IndexTechniqueType.HIGH_QUALITY
            assert persisted.embedding_model == "embedding-2"
            assert persisted.collection_binding_id == collection_binding.id
            assert persisted.is_multimodal is True

        def test_unpublished_economy_settings_update_keyword_number(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
            sqlite_session.add(dataset)
            sqlite_session.commit()

            with _dataset_service_dataset_patch(
                "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
            ):
                _dataset_service_dataset_DatasetService.update_rag_pipeline_dataset_settings(
                    dataset,
                    _make_knowledge_configuration(
                        indexing_technique=IndexTechniqueType.ECONOMY,
                        keyword_number=17,
                    ),
                    session=sqlite_session,
                )

            persisted = sqlite_session.get(Dataset, dataset.id)
            assert persisted is not None
            assert persisted.indexing_technique == IndexTechniqueType.ECONOMY
            assert persisted.keyword_number == 17

        def test_published_economy_settings_commit_keyword_change_and_dispatch_no_task(
            self, sqlite_session: Session
        ) -> None:
            dataset = _dataset_service_dataset_dataset(
                indexing_technique=IndexTechniqueType.ECONOMY, chunk_structure="paragraph"
            )
            dataset.keyword_number = 4
            sqlite_session.add(dataset)
            sqlite_session.commit()

            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
                ),
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.deal_dataset_index_update_task.delay"
                ) as update_task,
            ):
                _dataset_service_dataset_DatasetService.update_rag_pipeline_dataset_settings(
                    dataset,
                    _make_knowledge_configuration(
                        chunk_structure="paragraph",
                        indexing_technique=IndexTechniqueType.ECONOMY,
                        keyword_number=12,
                    ),
                    has_published=True,
                    session=sqlite_session,
                )

            assert sqlite_session.get(Dataset, dataset.id).keyword_number == 12
            update_task.assert_not_called()

        @pytest.mark.parametrize(
            ("dataset", "configuration", "message"),
            [
                (
                    _dataset_service_dataset_dataset(chunk_structure="paragraph"),
                    _make_knowledge_configuration(chunk_structure="sentence"),
                    "Chunk structure is not allowed",
                ),
                (
                    _dataset_service_dataset_dataset(
                        indexing_technique=IndexTechniqueType.HIGH_QUALITY, chunk_structure="paragraph"
                    ),
                    _make_knowledge_configuration(
                        chunk_structure="paragraph",
                        indexing_technique=IndexTechniqueType.ECONOMY,
                    ),
                    "not allowed to be updated to economy",
                ),
            ],
        )
        def test_published_settings_reject_incompatible_changes(
            self,
            sqlite_session: Session,
            dataset: Dataset,
            configuration,
            message: str,
        ) -> None:
            sqlite_session.add(dataset)
            sqlite_session.commit()

            with (
                _dataset_service_dataset_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_dataset_account()
                ),
                pytest.raises(ValueError, match=message),
            ):
                _dataset_service_dataset_DatasetService.update_rag_pipeline_dataset_settings(
                    dataset,
                    configuration,
                    has_published=True,
                    session=sqlite_session,
                )

    class TestDatasetPermissions:
        def test_check_dataset_permission_enforces_tenant_and_partial_members(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(
                permission=DatasetPermissionEnum.PARTIAL_TEAM, maintainer="owner"
            )
            permitted_user = _dataset_service_dataset_account(account_id="permitted", role=TenantAccountRole.NORMAL)
            denied_user = _dataset_service_dataset_account(account_id="denied", role=TenantAccountRole.NORMAL)
            foreign_user = _dataset_service_dataset_account(
                account_id="foreign", tenant_id="tenant-2", role=TenantAccountRole.NORMAL
            )
            sqlite_session.add_all(
                [
                    dataset,
                    DatasetPermission(
                        tenant_id=dataset.tenant_id,
                        dataset_id=dataset.id,
                        account_id=permitted_user.id,
                    ),
                ]
            )
            sqlite_session.commit()

            _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, permitted_user, sqlite_session)
            with pytest.raises(NoPermissionError):
                _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, denied_user, sqlite_session)
            with pytest.raises(NoPermissionError):
                _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, foreign_user, sqlite_session)

        def test_check_dataset_permission_skips_legacy_acl_in_rbac_mode(
            self, config_overrides: Callable[..., None], sqlite_session: Session
        ) -> None:
            dataset = _dataset_service_dataset_dataset(permission=DatasetPermissionEnum.ONLY_ME, maintainer="owner")
            non_member = _dataset_service_dataset_account(account_id="non-member", role=TenantAccountRole.NORMAL)
            foreign_user = _dataset_service_dataset_account(
                account_id="foreign", tenant_id="tenant-2", role=TenantAccountRole.NORMAL
            )
            sqlite_session.add(dataset)
            sqlite_session.commit()

            config_overrides(RBAC_ENABLED=True)

            _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, non_member, sqlite_session)
            with pytest.raises(NoPermissionError):
                _dataset_service_dataset_DatasetService.check_dataset_permission(dataset, foreign_user, sqlite_session)

        def test_dataset_operator_cannot_change_permission_or_member_list(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(permission=DatasetPermissionEnum.PARTIAL_TEAM)
            operator = _dataset_service_dataset_account(role=TenantAccountRole.DATASET_OPERATOR)
            sqlite_session.add_all(
                [
                    dataset,
                    DatasetPermission(tenant_id="tenant-1", dataset_id=dataset.id, account_id="member-1"),
                ]
            )
            sqlite_session.commit()

            with pytest.raises(NoPermissionError, match="cannot change"):
                DatasetPermissionService.check_permission(
                    operator,
                    dataset,
                    DatasetPermissionEnum.ALL_TEAM,
                    None,
                    session=sqlite_session,
                )

        def test_non_editor_cannot_change_dataset_permissions(self, sqlite_session: Session) -> None:
            user = _dataset_service_dataset_account(role=TenantAccountRole.NORMAL)

            with pytest.raises(NoPermissionError, match="does not have permission"):
                DatasetPermissionService.check_permission(
                    user,
                    _dataset_service_dataset_dataset(),
                    DatasetPermissionEnum.ALL_TEAM,
                    None,
                    session=sqlite_session,
                )

        def test_dataset_operator_can_keep_unchanged_partial_member_list(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_dataset_dataset(permission=DatasetPermissionEnum.PARTIAL_TEAM)
            operator = _dataset_service_dataset_account(role=TenantAccountRole.DATASET_OPERATOR)
            sqlite_session.add_all(
                [
                    dataset,
                    DatasetPermission(tenant_id="tenant-1", dataset_id=dataset.id, account_id="member-1"),
                ]
            )
            sqlite_session.commit()

            DatasetPermissionService.check_permission(
                operator,
                dataset,
                DatasetPermissionEnum.PARTIAL_TEAM,
                [{"user_id": "member-1"}],
                session=sqlite_session,
            )
            with pytest.raises(ValueError, match="cannot change"):
                DatasetPermissionService.check_permission(
                    operator,
                    dataset,
                    DatasetPermissionEnum.PARTIAL_TEAM,
                    [{"user_id": "member-2"}],
                    session=sqlite_session,
                )

        def test_update_partial_member_list_flush_failure_does_not_rollback_caller_session(
            self, sqlite_session: Session
        ) -> None:
            transaction_events: list[str] = []

            def fail_flush(_session, _flush_context, _instances) -> None:
                raise RuntimeError("flush failed")

            event.listen(sqlite_session, "before_flush", fail_flush)
            event.listen(sqlite_session, "after_rollback", lambda _session: transaction_events.append("rollback"))
            try:
                with pytest.raises(RuntimeError, match="flush failed"):
                    DatasetPermissionService.update_partial_member_list(
                        "tenant-1",
                        "dataset-1",
                        [{"user_id": "member-1"}],
                        sqlite_session,
                    )
            finally:
                event.remove(sqlite_session, "before_flush", fail_flush)

            assert transaction_events == []

        def test_clear_partial_member_list_execute_failure_does_not_rollback_caller_session(
            self, sqlite_session: Session
        ) -> None:
            transaction_events: list[str] = []

            def fail_execute(_orm_execute_state) -> None:
                raise RuntimeError("execute failed")

            event.listen(sqlite_session, "do_orm_execute", fail_execute)
            event.listen(sqlite_session, "after_rollback", lambda _session: transaction_events.append("rollback"))
            try:
                with pytest.raises(RuntimeError, match="execute failed"):
                    DatasetPermissionService.clear_partial_member_list("dataset-1", sqlite_session)
            finally:
                event.remove(sqlite_session, "do_orm_execute", fail_execute)

            assert transaction_events == []

    @staticmethod
    @pytest.mark.parametrize("rbac_enabled", [False, True])
    @pytest.mark.parametrize("commit_fails", [False, True])
    @pytest.mark.parametrize("expire_on_commit", [False, True])
    def test_empty_pipeline_syncs_creator_after_commit(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        config_overrides: Callable[..., None],
        rbac_enabled: bool,
        commit_fails: bool,
        expire_on_commit: bool,
    ) -> None:
        config_overrides(RBAC_ENABLED=rbac_enabled)
        sqlite_session.expire_on_commit = expire_on_commit
        account = _dataset_service_dataset_account()
        entity = RagPipelineDatasetCreateEntity(
            name="New pipeline",
            description="",
            permission=DatasetPermissionEnum.ONLY_ME,
            icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
        )
        commit = sqlite_session.commit
        observed: list[tuple[str, str, object]] = []
        transactions_at_sync: list[bool] = []

        def commit_session() -> None:
            if commit_fails:
                raise RuntimeError("commit failed")
            commit()

        def sync_binding(_tenant_id: str, _account_id: str, *, resource_type: object, resource_id: str) -> list[object]:
            transactions_at_sync.append(sqlite_session.in_transaction())
            with sqlite_session_factory() as observer:
                stored = observer.get(Dataset, resource_id)
                if stored is not None:
                    observed.append((stored.tenant_id, stored.created_by, resource_type))
            return []

        with (
            _dataset_service_dataset_patch("services.knowledge.dataset_service.current_user", account),
            _dataset_service_dataset_patch.object(sqlite_session, "commit", side_effect=commit_session),
            _dataset_service_dataset_patch.object(
                rbac_service.RBACService.AccessPolicies,
                "sync_creator_access_policy_member_bindings",
                side_effect=sync_binding,
            ) as sync,
        ):
            if commit_fails:
                with pytest.raises(RuntimeError, match="commit failed"):
                    _dataset_service_dataset_DatasetService.create_empty_rag_pipeline_dataset(
                        "tenant-1", entity, sqlite_session
                    )
            else:
                dataset = _dataset_service_dataset_DatasetService.create_empty_rag_pipeline_dataset(
                    "tenant-1", entity, sqlite_session
                )
                if rbac_enabled:
                    assert transactions_at_sync == [False]
                    assert observed == [("tenant-1", account.id, rbac_service.RBACResourceType.DATASET)]
                    sync.assert_called_once_with(
                        "tenant-1",
                        account.id,
                        resource_type=rbac_service.RBACResourceType.DATASET,
                        resource_id=dataset.id,
                    )
            if commit_fails or not rbac_enabled:
                sync.assert_not_called()


"""Unit tests for DocumentService behaviors in dataset_service."""


def _dataset_service_document_account(
    *, account_id: str = "user-1", tenant_id: str = "tenant-1"
) -> _dataset_service_document_Account:
    return make_account(
        account_id=account_id,
        name="User",
        email=f"{account_id}@example.com",
        tenant=make_tenant(tenant_id=tenant_id, name="Tenant"),
    )


def _dataset_row(
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    built_in_field_enabled: bool = False,
    data_source_type: str | None = None,
    indexing_technique: str | None = "economy",
) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        provider="vendor",
        created_by="user-1",
        maintainer="user-1",
        built_in_field_enabled=built_in_field_enabled,
        chunk_structure=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
        data_source_type=data_source_type,
        indexing_technique=indexing_technique,
    )


def _document_row(
    *,
    document_id: str = "document-1",
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    name: str = "Document",
    indexing_status: str = IndexingStatus.COMPLETED,
    data_source_type: str = DataSourceType.UPLOAD_FILE,
    data_source_info: str = "{}",
    enabled: bool = True,
    archived: bool = False,
    is_paused: bool = False,
) -> _dataset_service_document_Document:
    document = _dataset_service_document_Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=data_source_type,
        data_source_info=data_source_info,
        batch="batch-1",
        name=name,
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        indexing_status=indexing_status,
        doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
        word_count=10,
        enabled=enabled,
        archived=archived,
        is_paused=is_paused,
        completed_at=datetime(2026, 1, 2) if indexing_status == IndexingStatus.COMPLETED else None,
    )
    document.created_at = datetime(2026, 1, 1)
    document.updated_at = datetime(2026, 1, 2)
    return document


def _upload_file(*, file_id: str, tenant_id: str = "tenant-1", name: str = "upload.txt") -> UploadFile:
    return make_upload_file(
        file_id=file_id,
        tenant_id=tenant_id,
        storage_type="opendal",
        key=f"key-{file_id}",
        name=name,
        size=1,
        created_by="user-1",
        created_at=datetime(2026, 1, 1),
    )


def _process_rule(
    *, dataset_id: str = "dataset-1", rule_id: str = "rule-1", mode: str = "automatic"
) -> _dataset_service_document_DatasetProcessRule:
    rules = (
        json.dumps(_dataset_service_document_DatasetProcessRule.AUTOMATIC_RULES)
        if mode == "automatic"
        else Rule(
            pre_processing_rules=[PreProcessingRule(id="remove_extra_spaces", enabled=True)],
            segmentation=Segmentation(separator="\n", max_tokens=100),
        ).model_dump_json()
    )
    process_rule = _dataset_service_document_DatasetProcessRule(
        dataset_id=dataset_id, mode=mode, rules=rules, created_by="user-1"
    )
    process_rule.id = rule_id
    return process_rule


class _RetryFlagLock:
    def __init__(self, store: _RetryFlagStore, key: str):
        self.store = store
        self.key = key
        self.token = f"owner-{store.next_token}"
        store.next_token += 1

    def acquire(self, *, blocking: bool):
        assert blocking is False
        if self.key in self.store.values:
            if self.store.replacement_on_conflict:
                replacement_key, replacement_value = self.store.replacement_on_conflict
                self.store.values[replacement_key] = replacement_value
            return False
        self.store.values[self.key] = self.token
        return True

    def release(self):
        if self.store.values.get(self.key) == self.token:
            self.store.values.pop(self.key)


class _RetryFlagStore:
    def __init__(
        self,
        values: dict[str, str] | None = None,
        replacement_on_conflict: tuple[str, str] | None = None,
    ):
        self.values = values or {}
        self.replacement_on_conflict = replacement_on_conflict
        self.next_token = 1

    def lock(self, key: str, *, timeout: int, thread_local: bool):
        assert timeout == 600
        assert thread_local is False
        return _RetryFlagLock(self, key)


class TestDatasetServiceDocumentCases:
    class TestDocumentServiceDisplayStatus:
        """Unit tests for DocumentService display-status helpers."""

        @pytest.mark.parametrize(
            ("raw_status", "expected"),
            [
                ("enabled", "available"),
                ("AVAILABLE", "available"),
                ("paused", "paused"),
                ("unknown", None),
                (None, None),
            ],
        )
        def test_normalize_display_status(self, raw_status, expected):
            assert _dataset_service_document_DocumentService.normalize_display_status(raw_status) == expected

        def test_build_display_status_filters_returns_empty_tuple_for_unknown_status(self):
            assert _dataset_service_document_DocumentService.build_display_status_filters("missing") == ()

        def test_apply_display_status_filter_returns_original_query_for_unknown_status(self):
            query = select(_dataset_service_document_Document)

            result = _dataset_service_document_DocumentService.apply_display_status_filter(query, "missing")

            assert result is query

        def test_apply_display_status_filter_applies_where_for_known_status(self):
            query = select(_dataset_service_document_Document)

            result = _dataset_service_document_DocumentService.apply_display_status_filter(query, "enabled")

            assert result is not query
            assert "documents.enabled" in str(result)

    class TestDocumentServiceRetrieval:
        def test_get_document_by_id_uses_provided_session(self, sqlite_session: Session):
            document = _document_row()
            sqlite_session.add(document)
            sqlite_session.commit()

            assert (
                _dataset_service_document_DocumentService.get_document_by_id(document.id, session=sqlite_session)
                is document
            )
            assert (
                _dataset_service_document_DocumentService.get_document_by_id("missing", session=sqlite_session) is None
            )

        def test_get_document_by_ids_enforces_dataset_owner_and_state(self, sqlite_session: Session):
            dataset = _dataset_row()
            expected = _document_row(document_id="expected")
            sqlite_session.add_all(
                [
                    dataset,
                    expected,
                    _document_row(document_id="disabled", enabled=False),
                    _document_row(document_id="archived", archived=True),
                    _document_row(document_id="waiting", indexing_status=IndexingStatus.WAITING),
                    _document_row(document_id="other-dataset", dataset_id="dataset-2"),
                    _document_row(document_id="other-tenant", tenant_id="tenant-2"),
                ]
            )
            sqlite_session.commit()

            documents = _dataset_service_document_DocumentService.get_document_by_ids(
                DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id),
                ["expected", "disabled", "archived", "waiting", "other-dataset", "other-tenant"],
                sqlite_session,
            )

            assert [document.id for document in documents] == [expected.id]

    class TestDocumentServiceMutations:
        """Unit tests for DocumentService mutation and orchestration helpers."""

        @pytest.mark.parametrize(("archived", "expected"), [(True, True), (False, False)])
        def test_check_archived_returns_boolean_status(self, archived, expected):
            document = _document_row(archived=archived)

            assert _dataset_service_document_DocumentService.check_archived(document) is expected

        def test_delete_documents_limits_query_and_cleanup_to_dataset_ref(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(
                document_id="doc-1",
                data_source_info=json.dumps({"upload_file_id": "file-1"}),
            )
            other_dataset = _document_row(document_id="other-dataset", dataset_id="dataset-2")
            other_tenant = _document_row(document_id="other-tenant", tenant_id="tenant-2")
            sqlite_session.add_all([dataset, document, other_dataset, other_tenant])
            sqlite_session.commit()

            with _dataset_service_document_patch(
                "services.knowledge.dataset_service.batch_clean_document_task"
            ) as clean_task:
                dataset_ref = DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)
                _dataset_service_document_DocumentService.delete_documents(
                    dataset_ref,
                    [document.id, other_dataset.id, other_tenant.id],
                    _dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                    sqlite_session,
                )

            assert sqlite_session.get(_dataset_service_document_Document, document.id) is None
            assert sqlite_session.get(_dataset_service_document_Document, other_dataset.id) is other_dataset
            assert sqlite_session.get(_dataset_service_document_Document, other_tenant.id) is other_tenant
            clean_task.delay.assert_called_once_with(
                [document.id], dataset.id, _dataset_service_document_IndexStructureType.PARAGRAPH_INDEX, ["file-1"]
            )

        def test_delete_documents_with_empty_ids_does_not_commit(self, sqlite_session: Session):
            commits = 0

            def count_commit(_session):
                nonlocal commits
                commits += 1

            event.listen(sqlite_session, "after_commit", count_commit)
            dataset = _dataset_row()
            _dataset_service_document_DocumentService.delete_documents(
                DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id),
                [],
                _dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                sqlite_session,
            )
            event.remove(sqlite_session, "after_commit", count_commit)
            assert commits == 0

        def test_delete_document_dispatches_cleanup_after_the_deletion_commits(self, sqlite_session: Session) -> None:
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1", data_source_info=json.dumps({"upload_file_id": "file-1"}))
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            visible_when_dispatched: list[bool] = []

            def record_visibility(*_args: object) -> None:
                # Cleanup and in-flight indexing run in other sessions; they must not see the row.
                with Session(sqlite_session.get_bind()) as other_session:
                    visible_when_dispatched.append(
                        other_session.get(_dataset_service_document_Document, "doc-1") is not None
                    )

            with _dataset_service_document_patch(
                "events.event_handlers.clean_when_document_deleted.clean_document_task"
            ) as clean_task:
                clean_task.delay.side_effect = record_visibility
                _dataset_service_document_DocumentService.delete_document(document, sqlite_session)

            clean_task.delay.assert_called_once_with(
                "doc-1", dataset.id, _dataset_service_document_IndexStructureType.PARAGRAPH_INDEX, "file-1"
            )
            assert visible_when_dispatched == [False]

        def test_rename_document_raises_when_dataset_is_missing(self, sqlite_session: Session):
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                pytest.raises(ValueError, match="Dataset not found"),
            ):
                _dataset_service_document_DocumentService.rename_document(
                    "dataset-1", "doc-1", "New Name", sqlite_session
                )

        def test_rename_document_raises_when_document_is_missing(self, sqlite_session: Session):
            dataset = _dataset_row()
            sqlite_session.add(dataset)
            sqlite_session.commit()
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                pytest.raises(ValueError, match="Document not found"),
            ):
                _dataset_service_document_DocumentService.rename_document(
                    dataset.id, "doc-1", "New Name", sqlite_session
                )

        def test_rename_document_rejects_cross_tenant_access(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(tenant_id="tenant-other")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                pytest.raises(ValueError, match="No permission"),
            ):
                _dataset_service_document_DocumentService.rename_document(
                    dataset.id, document.id, "New Name", sqlite_session
                )

        def test_rename_document_updates_document_metadata_and_upload_file_name(self, sqlite_session: Session):
            dataset = _dataset_row(built_in_field_enabled=True)
            document = _document_row(
                data_source_info=json.dumps({"upload_file_id": "file-1"}),
            )
            document.doc_metadata = {_dataset_service_document_BuiltInField.document_name: "Old"}
            upload_file = UploadFile(
                tenant_id=dataset.tenant_id,
                storage_type="opendal",
                key="key",
                name="old.txt",
                size=1,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by="user-1",
                created_at=datetime(2026, 1, 1),
                used=False,
            )
            upload_file.id = "file-1"
            sqlite_session.add_all([dataset, document, upload_file])
            sqlite_session.commit()
            commits = 0

            def count_commit(_session):
                nonlocal commits
                commits += 1

            event.listen(sqlite_session, "after_commit", count_commit)
            with _dataset_service_document_patch(
                "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
            ):
                result = _dataset_service_document_DocumentService.rename_document(
                    dataset.id, document.id, "New Name", sqlite_session
                )
            event.remove(sqlite_session, "after_commit", count_commit)

            assert result is document
            assert document.name == "New Name"
            assert document.doc_metadata[_dataset_service_document_BuiltInField.document_name] == "New Name"
            assert sqlite_session.get(UploadFile, upload_file.id).name == "New Name"
            assert commits == 0

        def test_recover_document_raises_when_document_is_not_paused(self, unbound_session: Session):
            document = _document_row(is_paused=False)
            with pytest.raises(DocumentIndexingError):
                _dataset_service_document_DocumentService.recover_document(document, unbound_session)

        def test_recover_document_persists_and_dispatches(self, sqlite_session: Session):
            document = _document_row(is_paused=True)
            sqlite_session.add(document)
            sqlite_session.commit()
            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.recover_document_indexing_task"
                ) as task,
            ):
                _dataset_service_document_DocumentService.recover_document(document, sqlite_session)

            sqlite_session.expire_all()
            recovered = sqlite_session.get(_dataset_service_document_Document, document.id)
            assert recovered is not None
            assert recovered.is_paused is False
            redis.delete.assert_called_once_with(f"document_{document.id}_is_paused")
            task.delay.assert_called_once_with(document.dataset_id, document.id)

        def test_retry_document_raises_when_retry_flag_is_already_set(self, sqlite_session: Session):
            document = _document_row(indexing_status=IndexingStatus.ERROR)
            sqlite_session.add(document)
            sqlite_session.commit()
            retry_flags = _RetryFlagStore({f"document_{document.id}_is_retried": "other-request"})
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client", retry_flags),
                pytest.raises(ValueError, match="being retried"),
            ):
                _dataset_service_document_DocumentService.retry_document(
                    "dataset-1", [document], sqlite_session, actor_id="user-1"
                )

        def test_retry_document_leaves_batch_unchanged_when_later_document_is_already_being_retried(
            self, sqlite_session: Session
        ):
            first_document = _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR)
            second_document = _document_row(document_id="doc-2", indexing_status=IndexingStatus.ERROR)
            sqlite_session.add_all([first_document, second_document])
            sqlite_session.commit()
            first_retry_key = "document_doc-1_is_retried"
            second_retry_key = "document_doc-2_is_retried"
            retry_flags = _RetryFlagStore({second_retry_key: "other-request"})
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client", retry_flags),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.retry_document_indexing_task"
                ) as retry_task,
                pytest.raises(ValueError, match="being retried"),
            ):
                _dataset_service_document_DocumentService.retry_document(
                    "dataset-1", [first_document, second_document], sqlite_session, actor_id="user-1"
                )

            assert first_document.indexing_status == IndexingStatus.ERROR
            assert second_document.indexing_status == IndexingStatus.ERROR
            assert first_retry_key not in retry_flags.values
            assert retry_flags.values[second_retry_key] == "other-request"
            retry_task.delay.assert_not_called()

        def test_retry_document_does_not_release_a_retry_flag_reacquired_by_another_request(
            self, sqlite_session: Session
        ):
            first_retry_key = "document_doc-1_is_retried"
            second_retry_key = "document_doc-2_is_retried"
            retry_flags = _RetryFlagStore(
                {second_retry_key: "other-request"},
                replacement_on_conflict=(first_retry_key, "new-owner"),
            )
            documents = [
                _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR),
                _document_row(document_id="doc-2", indexing_status=IndexingStatus.ERROR),
            ]
            sqlite_session.add_all(documents)
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client", retry_flags),
                pytest.raises(ValueError, match="being retried"),
            ):
                _dataset_service_document_DocumentService.retry_document(
                    "dataset-1", documents, sqlite_session, actor_id="user-1"
                )

            assert retry_flags.values[first_retry_key] == "new-owner"
            assert retry_flags.values[second_retry_key] == "other-request"

        def test_retry_document_releases_flags_when_status_commit_fails(self, sqlite_session: Session):
            retry_flags = _RetryFlagStore()
            document = _document_row(indexing_status=IndexingStatus.ERROR)
            sqlite_session.add(document)
            sqlite_session.commit()

            def fail_commit(_session):
                raise RuntimeError("database unavailable")

            event.listen(sqlite_session, "before_commit", fail_commit)
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client", retry_flags),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.retry_document_indexing_task"
                ) as retry_task,
                pytest.raises(RuntimeError, match="database unavailable"),
            ):
                _dataset_service_document_DocumentService.retry_document(
                    "dataset-1", [document], sqlite_session, actor_id="user-1"
                )
            event.remove(sqlite_session, "before_commit", fail_commit)

            assert retry_flags.values == {}
            retry_task.delay.assert_not_called()

        def test_retry_document_persists_status_and_dispatches(self, sqlite_session: Session):
            documents = [
                _document_row(document_id="doc-1", indexing_status=IndexingStatus.ERROR),
                _document_row(document_id="doc-2", indexing_status=IndexingStatus.PAUSED),
            ]
            sqlite_session.add_all(documents)
            sqlite_session.commit()
            retry_flags = _RetryFlagStore()
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_document_account()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client", retry_flags),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.retry_document_indexing_task"
                ) as task,
            ):
                _dataset_service_document_DocumentService.retry_document(
                    "dataset-1", documents, sqlite_session, actor_id="user-1"
                )

            sqlite_session.expire_all()
            statuses = sqlite_session.scalars(
                select(_dataset_service_document_Document.indexing_status).order_by(
                    _dataset_service_document_Document.id
                )
            ).all()
            assert statuses == [IndexingStatus.WAITING, IndexingStatus.WAITING]
            task.delay.assert_called_once_with("dataset-1", ["doc-1", "doc-2"], "user-1")

        def test_sync_website_document_raises_when_sync_flag_exists(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row()
            with _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis:
                mock_redis.get.return_value = "1"

                with pytest.raises(ValueError, match="being synced"):
                    _dataset_service_document_DocumentService.sync_website_document(dataset, document, sqlite_session)

        @pytest.mark.parametrize(
            ("document_dataset_id", "document_tenant_id"),
            [("dataset-2", "tenant-1"), ("dataset-1", "tenant-2")],
        )
        def test_sync_website_document_rejects_document_outside_dataset(
            self, document_dataset_id: str, document_tenant_id: str, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(dataset_id=document_dataset_id, tenant_id=document_tenant_id)

            with (
                pytest.raises(ValueError, match="Document not found"),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
            ):
                _dataset_service_document_DocumentService.sync_website_document(dataset, document, sqlite_session)

            mock_redis.get.assert_not_called()

        def test_sync_website_document_updates_status_sets_cache_and_dispatches_task(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(
                data_source_type=DataSourceType.WEBSITE_CRAWL,
                data_source_info=json.dumps({"mode": "crawl"}),
            )
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.sync_website_document_indexing_task"
                ) as sync_task,
            ):
                mock_redis.get.return_value = None

                _dataset_service_document_DocumentService.sync_website_document(dataset, document, sqlite_session)

            sqlite_session.expire_all()
            synced = sqlite_session.get(_dataset_service_document_Document, document.id)
            assert synced is not None
            assert synced.indexing_status == IndexingStatus.WAITING
            assert synced.data_source_info_dict["mode"] == "scrape"
            mock_redis.setex.assert_called_once_with(f"document_{document.id}_is_sync", 600, 1)
            sync_task.delay.assert_called_once_with(dataset.id, document.id)

    class TestDocumentServiceSaveDocumentWithoutDatasetId:
        """Unit tests for dataset creation around save_document_without_dataset_id."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account):
                yield account

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_without_dataset_id_creates_high_quality_dataset_with_default_retrieval_model(
            self, account_context, sqlite_session: Session
        ):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="high_quality",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                embedding_model="embedding-model",
                embedding_model_provider="provider",
                summary_index_setting={"enable": True},
                is_multimodal=True,
            )
            binding = DatasetCollectionBinding(
                provider_name="provider",
                model_name="embedding-model",
                type="dataset",
                collection_name="collection",
            )
            binding.id = "binding-1"
            first_document = _document_row(name="VeryLongDocumentNameForDataset.txt")

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                    return_value=binding,
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService,
                    "save_document_with_dataset_id",
                    return_value=([first_document], "batch-1"),
                ) as save_document,
            ):
                dataset, documents, batch = _dataset_service_document_DocumentService.save_document_without_dataset_id(
                    tenant_id="tenant-1",
                    knowledge_config=knowledge_config,
                    account=account_context,
                    session=sqlite_session,
                )

            assert documents == [first_document]
            assert batch == "batch-1"
            assert dataset.collection_binding_id == "binding-1"
            assert dataset.retrieval_model["search_method"] == RetrievalMethod.SEMANTIC_SEARCH
            assert dataset.retrieval_model["top_k"] == 4
            assert dataset.summary_index_setting == {"enable": True}
            assert dataset.is_multimodal is True
            assert dataset.name == first_document.name[:18] + "..."
            assert (
                dataset.description
                == "useful for when you want to answer queries about the VeryLongDocumentNameForDataset.txt"
            )
            assert sqlite_session.get(Dataset, dataset.id) is dataset
            save_document.assert_called_once_with(
                dataset,
                knowledge_config,
                account_context,
                session=sqlite_session,
            )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_without_dataset_id_uses_provided_retrieval_model(
            self, account_context, sqlite_session: Session
        ):
            retrieval_model = RetrievalModel(
                search_method=RetrievalMethod.SEMANTIC_SEARCH,
                reranking_enable=True,
                reranking_model=RerankingModel(
                    reranking_provider_name="rerank-provider",
                    reranking_model_name="rerank-model",
                ),
                top_k=9,
                score_threshold_enabled=True,
                score_threshold=0.6,
            )
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                retrieval_model=retrieval_model,
            )
            first_document = _document_row(name="Doc")

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService,
                    "save_document_with_dataset_id",
                    return_value=([first_document], "batch-1"),
                ),
            ):
                dataset, _, _ = _dataset_service_document_DocumentService.save_document_without_dataset_id(
                    "tenant-1",
                    knowledge_config,
                    account_context,
                    sqlite_session,
                )

            assert dataset.retrieval_model == retrieval_model.model_dump()
            assert dataset.collection_binding_id is None
            assert sqlite_session.get(Dataset, dataset.id) is dataset

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_without_dataset_id_rejects_sandbox_batch_upload(
            self, account_context, unbound_session: Session
        ):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1", "file-2"]),
                    )
                ),
            )

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features",
                    return_value=_make_features(plan=CloudPlan.SANDBOX),
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "check_documents_upload_quota"
                ) as check_quota,
                pytest.raises(ValueError, match="does not support batch upload"),
            ):
                _dataset_service_document_DocumentService.save_document_without_dataset_id(
                    "tenant-1", knowledge_config, account_context, unbound_session
                )

            check_quota.assert_not_called()

    class TestDocumentServiceUpdateDocumentWithDatasetId:
        """Unit tests for the document-update orchestration path."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account):
                yield account

        def test_update_document_with_dataset_id_raises_when_document_is_missing(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
            )
            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ) as check_model_setting,
                pytest.raises(NotFound, match="Document not found"),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

            check_model_setting.assert_called_once_with(dataset)

        def test_update_document_with_dataset_id_rejects_non_available_documents(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1", indexing_status=IndexingStatus.INDEXING)
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
            )
            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                pytest.raises(ValueError, match="Document is not available"),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        def test_update_document_with_dataset_id_upload_file_process_rule_and_name_override(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            upload_file = UploadFile(
                tenant_id=dataset.tenant_id,
                storage_type="opendal",
                key="key",
                name="upload.txt",
                size=1,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by=account_context.id,
                created_at=datetime(2026, 1, 1),
                used=False,
            )
            upload_file.id = "file-1"
            segment = DocumentSegment(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=1,
                content="content",
                word_count=1,
                tokens=1,
                created_by=account_context.id,
            )
            sqlite_session.add_all([dataset, document, upload_file, segment])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(
                    mode="custom",
                    rules=Rule(
                        pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                        segmentation=Segmentation(separator="\n", max_tokens=128),
                    ),
                ),
                name="Renamed document",
                doc_form=_dataset_service_document_IndexStructureType.QA_INDEX,
            )
            updated_at = datetime(2026, 2, 1)

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.naive_utc_now", return_value=updated_at
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task"
                ) as update_task,
            ):
                result = _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

            assert result is document
            assert document.dataset_process_rule_id is not None
            assert (
                sqlite_session.get(_dataset_service_document_DatasetProcessRule, document.dataset_process_rule_id)
                is not None
            )
            assert document.data_source_type == "upload_file"
            assert document.data_source_info == '{"upload_file_id": "file-1"}'
            assert document.name == "Renamed document"
            assert document.indexing_status == "waiting"
            assert document.completed_at is None
            assert document.processing_started_at is None
            assert document.parsing_completed_at is None
            assert document.cleaning_completed_at is None
            assert document.splitting_completed_at is None
            assert document.updated_at == updated_at
            assert document.created_from == "web"
            assert document.doc_form == _dataset_service_document_IndexStructureType.QA_INDEX
            sqlite_session.expire_all()
            persisted = sqlite_session.get(_dataset_service_document_Document, document.id)
            assert persisted is not None
            assert persisted.name == "Renamed document"
            assert sqlite_session.get(DocumentSegment, segment.id).status == "re_segment"
            update_task.delay.assert_called_once_with(document.dataset_id, document.id)

        def test_update_document_with_dataset_id_notion_import_requires_binding(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="notion_import",
                        notion_info_list=[
                            NotionInfo(
                                credential_id="credential-1",
                                workspace_id="workspace-1",
                                pages=[NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page")],
                            )
                        ],
                    )
                ),
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                pytest.raises(ValueError, match="Data source binding not found"),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        def test_update_document_with_dataset_id_website_crawl_updates_segments_and_dispatches_task(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            segment = DocumentSegment(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=1,
                content="content",
                word_count=1,
                tokens=1,
                created_by=account_context.id,
            )
            sqlite_session.add_all([dataset, document, segment])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="website_crawl",
                        website_info_list=WebsiteInfo(
                            provider="firecrawl",
                            job_id="job-1",
                            urls=["https://example.com"],
                            only_main_content=False,
                        ),
                    )
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARENT_CHILD_INDEX,
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task"
                ) as update_task,
            ):
                result = _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

            assert result is document
            assert document.data_source_type == "website_crawl"
            assert document.data_source_info == (
                '{"url": "https://example.com", "provider": "firecrawl", "job_id": "job-1", '
                '"only_main_content": false, "mode": "crawl"}'
            )
            assert document.name == ""
            assert document.doc_form == _dataset_service_document_IndexStructureType.PARENT_CHILD_INDEX
            sqlite_session.expire_all()
            assert sqlite_session.get(DocumentSegment, segment.id).status == "re_segment"
            update_task.delay.assert_called_once_with("dataset-1", "doc-1")

    class TestDocumentServiceCreateValidation:
        """Unit tests for document creation validation helpers."""

        def test_document_create_args_validate_requires_data_source_or_process_rule(self):
            knowledge_config = _dataset_service_document_KnowledgeConfig(indexing_technique="economy")

            with pytest.raises(ValueError, match="Data source or Process rule is required"):
                _dataset_service_document_DocumentService.document_create_args_validate(knowledge_config)

        def test_document_create_args_validate_delegates_to_sub_validators(self):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(mode="automatic"),
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "data_source_args_validate"
                ) as validate_data_source,
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "process_rule_args_validate"
                ) as validate_process_rule,
            ):
                _dataset_service_document_DocumentService.document_create_args_validate(knowledge_config)

            validate_data_source.assert_called_once_with(knowledge_config)
            validate_process_rule.assert_called_once_with(knowledge_config)

        @pytest.mark.parametrize(
            ("data_source_type", "message"),
            [
                ("upload_file", "File source info is required"),
                ("notion_import", "Notion source info is required"),
                ("website_crawl", "Website source info is required"),
            ],
        )
        def test_data_source_args_validate_requires_source_specific_info(self, data_source_type, message):
            info_list = _dataset_service_document_InfoList.model_validate({"data_source_type": data_source_type})
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(info_list=info_list),
            )

            with pytest.raises(ValueError, match=message):
                _dataset_service_document_DocumentService.data_source_args_validate(knowledge_config)

        def test_process_rule_args_validate_clears_rules_for_automatic_mode(self):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(
                    mode="automatic",
                    rules=Rule(
                        pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                        segmentation=Segmentation(separator="\n", max_tokens=128),
                    ),
                ),
            )

            _dataset_service_document_DocumentService.process_rule_args_validate(knowledge_config)

            assert knowledge_config.process_rule is not None
            assert knowledge_config.process_rule.rules is None

        def test_process_rule_args_validate_deduplicates_rules_and_skips_max_tokens_for_full_doc_hierarchical(self):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(
                    mode="hierarchical",
                    rules=Rule(
                        pre_processing_rules=[
                            PreProcessingRule(id="remove_stopwords", enabled=True),
                            PreProcessingRule(id="remove_stopwords", enabled=False),
                        ],
                        segmentation=Segmentation(separator="\n", max_tokens=0),
                        parent_mode="full-doc",
                    ),
                ),
            )

            _dataset_service_document_DocumentService.process_rule_args_validate(knowledge_config)

            assert knowledge_config.process_rule is not None
            assert knowledge_config.process_rule.rules is not None
            assert len(knowledge_config.process_rule.rules.pre_processing_rules) == 1
            assert knowledge_config.process_rule.rules.pre_processing_rules[0].enabled is False

        def test_process_rule_args_validate_hierarchical_defaults_parent_mode_to_paragraph(self):
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(
                    mode="hierarchical",
                    rules=Rule(
                        pre_processing_rules=[
                            PreProcessingRule(id="remove_extra_spaces", enabled=True),
                        ],
                        segmentation=Segmentation(separator="\n", max_tokens=1024),
                        subchunk_segmentation=Segmentation(separator="\n", max_tokens=512),
                    ),
                ),
            )

            _dataset_service_document_DocumentService.process_rule_args_validate(knowledge_config)

            assert knowledge_config.process_rule is not None
            assert knowledge_config.process_rule.rules is not None
            assert knowledge_config.process_rule.rules.parent_mode == "paragraph"

    class TestDocumentServiceSaveDocumentWithDatasetId:
        """Unit tests for non-SQL validation branches in save_document_with_dataset_id."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account),
                _dataset_service_document_patch.object(_dataset_service_document_DatasetService, "check_doc_form"),
            ):
                yield account

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_with_dataset_id_requires_file_info_for_upload_source(
            self, account_context, unbound_session: Session
        ):
            dataset = _dataset_row()
            knowledge_config = _make_upload_knowledge_config(file_ids=None)

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                pytest.raises(ValueError, match="File source info is required"),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_with_dataset_id_blocks_batch_upload_for_sandbox_plan(
            self, account_context, unbound_session: Session
        ):
            dataset = _dataset_row()
            knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features",
                    return_value=_make_features(plan=CloudPlan.SANDBOX),
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "check_documents_upload_quota"
                ) as check_quota,
                pytest.raises(ValueError, match="does not support batch upload"),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

            check_quota.assert_not_called()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_with_dataset_id_enforces_batch_upload_limit(
            self,
            account_context,
            unbound_session: Session,
            config_overrides: Callable[..., None],
        ):
            config_overrides(BATCH_UPLOAD_LIMIT=1)
            dataset = _dataset_row()
            knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "check_documents_upload_quota"
                ) as check_quota,
                pytest.raises(ValueError, match="batch upload limit of 1"),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

            check_quota.assert_not_called()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_updates_existing_document_and_data_source_type(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=None)
            knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
            updated_document = _document_row(document_id="doc-1")
            updated_document.batch = "batch-existing"

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task.delay"
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "update_prepared_document", return_value=updated_document
                ) as update_document,
            ):
                documents, batch = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

            assert dataset.data_source_type == "upload_file"
            assert documents == [updated_document]
            assert batch == "batch-existing"
            update_document.assert_called_once_with(dataset, knowledge_config, account_context, session=sqlite_session)

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_requires_data_source_for_new_documents(
            self, account_context, unbound_session: Session
        ):
            dataset = _dataset_row()
            knowledge_config = _make_upload_knowledge_config(data_source=None)

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                pytest.raises(ValueError, match="Data source is required when creating new documents"),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=unbound_session,
                )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_requires_existing_process_rule_for_custom_mode(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            sqlite_session.add(dataset)
            sqlite_session.commit()
            knowledge_config = _make_upload_knowledge_config(
                file_ids=["file-1"],
                process_rule=ProcessRule(mode="custom"),
            )

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                pytest.raises(ValueError, match="No process rule found"),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_upload_file_creates_and_reindexes_documents(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
            dataset_process_rule = _process_rule()
            knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
            duplicate_document = _document_row(document_id="doc-duplicate", name="existing.txt")
            upload_file_a = _upload_file(file_id="file-1", name="existing.txt")
            upload_file_b = _upload_file(file_id="file-2", name="new.txt")
            sqlite_session.add_all([dataset, dataset_process_rule, duplicate_document, upload_file_a, upload_file_b])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DocumentIndexingTaskProxy"
                ) as document_proxy_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DuplicateDocumentIndexingTaskProxy"
                ) as duplicate_proxy_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.time.strftime", return_value="20260101010101"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.secrets.randbelow", return_value=23
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                documents, batch = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=dataset_process_rule,
                    session=sqlite_session,
                )

            assert [document.name for document in documents] == ["existing.txt", "new.txt"]
            assert batch == "20260101010101100023"
            assert duplicate_document.dataset_process_rule_id == "rule-1"
            assert duplicate_document.updated_at == datetime(2026, 2, 1)
            assert duplicate_document.batch == batch
            assert duplicate_document.indexing_status == IndexingStatus.WAITING
            created_document = next(document for document in documents if document.name == "new.txt")
            sqlite_session.expire_all()
            assert sqlite_session.get(_dataset_service_document_Document, created_document.id) is not None
            document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, [created_document.id])
            document_proxy_cls.return_value.delay.assert_called_once()
            duplicate_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-duplicate"])
            duplicate_proxy_cls.return_value.delay.assert_called_once()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_notion_import_truncates_names_and_cleans_removed_pages(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.NOTION_IMPORT)
            dataset_process_rule = _process_rule()
            notion_page_name = "a" * 300
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="notion_import",
                        notion_info_list=[
                            NotionInfo(
                                credential_id="credential-1",
                                workspace_id="workspace-1",
                                pages=[
                                    NotionPage(page_id="page-keep", page_name="Keep page", type="page"),
                                    NotionPage(
                                        page_id="page-new",
                                        page_name=notion_page_name,
                                        page_icon=NotionIcon(type="emoji", emoji="page"),
                                        type="page",
                                    ),
                                ],
                            )
                        ],
                    )
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                doc_language="English",
            )
            existing_keep = _document_row(
                document_id="doc-keep",
                data_source_type=DataSourceType.NOTION_IMPORT,
            )
            existing_keep.data_source_info = json.dumps({"notion_page_id": "page-keep"})
            existing_remove = _document_row(
                document_id="doc-remove",
                data_source_type=DataSourceType.NOTION_IMPORT,
            )
            existing_remove.data_source_info = json.dumps({"notion_page_id": "page-remove"})
            sqlite_session.add_all([dataset, dataset_process_rule, existing_keep, existing_remove])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.clean_notion_document_task"
                ) as clean_task,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DocumentIndexingTaskProxy"
                ) as document_proxy_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.uuid.uuid4", return_value="doc-new"
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                documents, _ = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=dataset_process_rule,
                    session=sqlite_session,
                )

            created_document = next(document for document in documents if document.id == "doc-new")
            assert created_document in documents
            assert len(created_document.name) == 255
            assert sqlite_session.get(_dataset_service_document_Document, created_document.id) is created_document
            clean_task.delay.assert_called_once_with(["doc-remove"], dataset.id)
            document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-new"])
            document_proxy_cls.return_value.delay.assert_called_once()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_website_crawl_truncates_long_urls(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.WEBSITE_CRAWL)
            dataset_process_rule = _process_rule()
            sqlite_session.add_all([dataset, dataset_process_rule])
            sqlite_session.commit()
            long_url = "https://example.com/" + ("a" * 260)
            short_url = "https://example.com/short"
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="website_crawl",
                        website_info_list=WebsiteInfo(
                            provider="firecrawl",
                            job_id="job-1",
                            urls=[long_url, short_url],
                            only_main_content=True,
                        ),
                    )
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                doc_language="English",
            )
            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DocumentIndexingTaskProxy"
                ) as document_proxy_cls,
            ):
                mock_redis.lock.return_value = _make_lock_context()

                documents, _ = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=dataset_process_rule,
                    session=sqlite_session,
                )

            assert [document.name for document in documents] == [long_url[:200] + "...", short_url]
            assert (
                sqlite_session.scalars(
                    select(_dataset_service_document_Document).order_by(_dataset_service_document_Document.position)
                ).all()
                == documents
            )
            document_proxy_cls.assert_called_once_with(
                dataset.tenant_id, dataset.id, [document.id for document in documents]
            )
            document_proxy_cls.return_value.delay.assert_called_once()

    class TestDocumentServiceBatchUpdateStatus:
        """Unit tests for batch_update_document_status orchestration and helper branches."""

        def test_prepare_disable_update_requires_completed_document(self):
            document = _document_row(indexing_status=IndexingStatus.WAITING)
            document.completed_at = None

            with pytest.raises(DocumentIndexingError, match="is not completed"):
                _dataset_service_document_DocumentService._prepare_disable_update(
                    document, user=_dataset_service_document_account(), now=datetime(2026, 2, 1)
                )

        def test_prepare_archive_update_sets_async_task_for_enabled_document(self):
            document = _document_row(enabled=True, archived=False)

            result = _dataset_service_document_DocumentService._prepare_archive_update(
                document, user=_dataset_service_document_account(), now=datetime(2026, 2, 1)
            )

            assert result is not None
            assert result["updates"]["archived"] is True
            assert result["set_cache"] is True
            assert result["async_task"]["args"] == [document.id]

        def test_prepare_unarchive_update_sets_async_task_for_enabled_document(self):
            document = _document_row(enabled=True, archived=True)

            result = _dataset_service_document_DocumentService._prepare_unarchive_update(
                document, now=datetime(2026, 2, 1)
            )

            assert result is not None
            assert result["updates"]["archived"] is False
            assert result["set_cache"] is True
            assert result["async_task"]["args"] == [document.id]

        def test_batch_update_document_status_rejects_indexing_documents(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(name="Busy document")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()

            with _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis:
                mock_redis.get.return_value = "1"

                with pytest.raises(DocumentIndexingError, match="Busy document is being indexed"):
                    _dataset_service_document_DocumentService.batch_update_document_status(
                        dataset, [document.id], "archive", _dataset_service_document_account(), sqlite_session
                    )

            sqlite_session.refresh(document)
            assert document.archived is False

        def test_batch_update_document_status_rolls_back_when_commit_fails(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(enabled=False)
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()

            def fail_commit(_session):
                raise RuntimeError("commit failed")

            event.listen(sqlite_session, "before_commit", fail_commit)
            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
            ):
                mock_redis.get.return_value = None

                with pytest.raises(RuntimeError, match="commit failed"):
                    _dataset_service_document_DocumentService.batch_update_document_status(
                        dataset, [document.id], "enable", _dataset_service_document_account(), sqlite_session
                    )
            event.remove(sqlite_session, "before_commit", fail_commit)

            sqlite_session.refresh(document)
            assert document.enabled is False

        def test_batch_update_document_status_raises_async_task_error_after_commit(self, sqlite_session: Session):
            dataset = _dataset_row()
            document = _document_row(enabled=False)
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.add_document_to_index_task"
                ) as add_task,
            ):
                mock_redis.get.return_value = None
                add_task.delay.side_effect = RuntimeError("task failed")

                with pytest.raises(RuntimeError, match="task failed"):
                    _dataset_service_document_DocumentService.batch_update_document_status(
                        dataset, [document.id], "enable", _dataset_service_document_account(), sqlite_session
                    )

            sqlite_session.refresh(document)
            assert document.enabled is True
            mock_redis.setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)

    class TestDocumentServiceTenantAndUpdateEdges:
        """Unit tests for tenant-count and update edge cases."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account):
                yield account

        def test_get_tenant_documents_count_scopes_state_and_tenant(self, account_context, sqlite_session: Session):
            sqlite_session.add_all(
                [
                    _document_row(document_id="one"),
                    _document_row(document_id="two"),
                    _document_row(document_id="disabled", enabled=False),
                    _document_row(document_id="archived", archived=True),
                    _document_row(document_id="unfinished", indexing_status=IndexingStatus.WAITING),
                    _document_row(document_id="foreign", tenant_id="tenant-2"),
                ]
            )
            sqlite_session.commit()

            result = _dataset_service_document_DocumentService.get_tenant_documents_count(sqlite_session)

            assert result == 2

        def test_update_document_with_dataset_id_uses_automatic_process_rule_payload(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            upload_file = _upload_file(file_id="file-1")
            sqlite_session.add_all([dataset, document, upload_file])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
                process_rule=ProcessRule(
                    mode="automatic",
                    rules=Rule(
                        pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                        segmentation=Segmentation(separator="\n", max_tokens=128),
                    ),
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
            )
            updated_at = datetime(2026, 2, 1)

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.naive_utc_now", return_value=updated_at
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task"
                ) as update_task,
            ):
                result = _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

            assert result is document
            assert document.dataset_process_rule_id is not None
            assert document.name == "upload.txt"
            process_rule = sqlite_session.get(
                _dataset_service_document_DatasetProcessRule, document.dataset_process_rule_id
            )
            assert process_rule is not None
            assert process_rule.mode == "automatic"
            assert process_rule.rules == json.dumps(_dataset_service_document_DatasetProcessRule.AUTOMATIC_RULES)
            update_task.delay.assert_called_once_with("dataset-1", "doc-1")

        def test_update_document_with_dataset_id_requires_upload_file_info(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(data_source_type="upload_file")
                ),
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                pytest.raises(ValueError, match="No file info list found"),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        def test_update_document_with_dataset_id_raises_when_upload_file_is_missing(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="upload_file",
                        file_info_list=FileInfo(file_ids=["file-1"]),
                    )
                ),
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                pytest.raises(FileNotExistsError),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        def test_update_document_with_dataset_id_requires_notion_info_list(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(data_source_type="notion_import")
                ),
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                pytest.raises(ValueError, match="No notion info list found"),
            ):
                _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

        def test_update_document_with_dataset_id_notion_import_updates_page_info(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row()
            document = _document_row(document_id="doc-1")
            binding = DataSourceOauthBinding(
                tenant_id=dataset.tenant_id,
                access_token="token",
                provider="notion",
                source_info={"workspace_id": '"workspace-1"'},
                disabled=False,
            )
            sqlite_session.add_all([dataset, document, binding])
            sqlite_session.commit()
            document_data = _dataset_service_document_KnowledgeConfig(
                original_document_id="doc-1",
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="notion_import",
                        notion_info_list=[
                            NotionInfo(
                                credential_id="credential-1",
                                workspace_id="workspace-1",
                                pages=[
                                    NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                    NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="database"),
                                ],
                            )
                        ],
                    )
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
            )

            with (
                _dataset_service_document_patch.object(
                    _dataset_service_document_DatasetService, "check_dataset_model_setting"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.naive_utc_now", return_value=datetime(2026, 2, 1)
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task"
                ) as update_task,
            ):
                result = _dataset_service_document_DocumentService.update_document_with_dataset_id(
                    dataset,
                    document_data,
                    account_context,
                    session=sqlite_session,
                )

            assert result is document
            assert document.data_source_type == "notion_import"
            assert document.name == ""
            assert document.data_source_info == json.dumps(
                {
                    "credential_id": "credential-1",
                    "notion_workspace_id": "workspace-1",
                    "notion_page_id": "page-2",
                    "notion_page_icon": None,
                    "type": "database",
                }
            )
            sqlite_session.refresh(document)
            update_task.delay.assert_called_once_with("dataset-1", "doc-1")

    class TestDocumentServiceSaveWithoutDatasetBilling:
        """Unit tests for batch-count and quota branches in save_document_without_dataset_id."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account):
                yield account

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_without_dataset_id_counts_notion_pages_for_quota(
            self,
            account_context,
            sqlite_session: Session,
            config_overrides: Callable[..., None],
        ):
            config_overrides(BATCH_UPLOAD_LIMIT="10")
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="notion_import",
                        notion_info_list=[
                            NotionInfo(
                                credential_id="credential-1",
                                workspace_id="workspace-1",
                                pages=[
                                    NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                    NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="page"),
                                ],
                            ),
                            NotionInfo(
                                credential_id="credential-2",
                                workspace_id="workspace-2",
                                pages=[NotionPage(page_id="page-3", page_name="Page 3", page_icon=None, type="page")],
                            ),
                        ],
                    )
                ),
            )
            features = _make_features()
            document = _document_row(name="Doc")

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=features
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "check_documents_upload_quota"
                ) as check_quota,
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService,
                    "save_document_with_dataset_id",
                    return_value=([document], "batch-1"),
                ),
            ):
                dataset, _, _ = _dataset_service_document_DocumentService.save_document_without_dataset_id(
                    "tenant-1",
                    knowledge_config,
                    account_context,
                    sqlite_session,
                )

            check_quota.assert_called_once_with(3, features)
            assert sqlite_session.get(Dataset, dataset.id) is dataset

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        def test_save_document_without_dataset_id_enforces_batch_limit_for_website_urls(
            self,
            account_context,
            unbound_session: Session,
            config_overrides: Callable[..., None],
        ):
            config_overrides(BATCH_UPLOAD_LIMIT="1")
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(
                        data_source_type="website_crawl",
                        website_info_list=WebsiteInfo(
                            provider="firecrawl",
                            job_id="job-1",
                            urls=["https://example.com/a", "https://example.com/b"],
                            only_main_content=True,
                        ),
                    )
                ),
            )

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "check_documents_upload_quota"
                ) as check_quota,
                pytest.raises(ValueError, match="batch upload limit of 1"),
            ):
                _dataset_service_document_DocumentService.save_document_without_dataset_id(
                    "tenant-1", knowledge_config, account_context, unbound_session
                )

            check_quota.assert_not_called()

    class TestDocumentServiceSaveDocumentAdditionalBranches:
        """Additional unit tests for dataset bootstrap and process-rule branches."""

        @pytest.fixture
        def account_context(self):
            account = _dataset_service_document_account()

            with (
                _dataset_service_document_patch("services.knowledge.dataset_service.current_user", account),
                _dataset_service_document_patch.object(_dataset_service_document_DatasetService, "check_doc_form"),
            ):
                yield account

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_initializes_high_quality_dataset_from_default_embedding_model(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=None, indexing_technique=None)
            knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
            knowledge_config.indexing_technique = "high_quality"
            knowledge_config.embedding_model = None
            knowledge_config.embedding_model_provider = None
            updated_document = _document_row(document_id="doc-1")
            updated_document.batch = "batch-existing"
            binding = DatasetCollectionBinding(
                provider_name="default-provider",
                model_name="default-embedding",
                type="dataset",
                collection_name="collection",
            )
            binding.id = "binding-1"

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                    return_value=binding,
                ) as get_binding,
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "update_prepared_document", return_value=updated_document
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task.delay"
                ),
            ):
                default_model = object.__new__(ModelInstance)
                default_model.model_name = "default-embedding"
                default_model.provider = "default-provider"
                model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = default_model

                documents, batch = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

            assert documents == [updated_document]
            assert batch == "batch-existing"
            assert dataset.data_source_type == "upload_file"
            assert dataset.indexing_technique == "high_quality"
            assert dataset.embedding_model == "default-embedding"
            assert dataset.embedding_model_provider == "default-provider"
            assert dataset.collection_binding_id == "binding-1"
            assert dataset.retrieval_model == {
                "search_method": "semantic_search",
                "reranking_enable": False,
                "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
                "top_k": 4,
                "score_threshold_enabled": False,
            }
            get_binding.assert_called_once_with("default-provider", "default-embedding", sqlite_session)

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_uses_explicit_embedding_and_retrieval_model(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(indexing_technique=None)
            knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
            knowledge_config.indexing_technique = "high_quality"
            knowledge_config.embedding_model = "explicit-model"
            knowledge_config.embedding_model_provider = "explicit-provider"
            knowledge_config.retrieval_model = RetrievalModel(
                search_method="semantic_search",
                reranking_enable=True,
                reranking_model=RerankingModel(
                    reranking_provider_name="rerank-provider",
                    reranking_model_name="rerank-model",
                ),
                top_k=7,
                score_threshold_enabled=True,
                score_threshold=0.3,
            )
            binding = DatasetCollectionBinding(
                provider_name="explicit-provider",
                model_name="explicit-model",
                type="dataset",
                collection_name="collection",
            )
            binding.id = "binding-2"
            updated_document = _document_row(document_id="doc-1")

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.ModelManager") as model_manager_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                    return_value=binding,
                ) as get_binding,
                _dataset_service_document_patch.object(
                    _dataset_service_document_DocumentService, "update_prepared_document", return_value=updated_document
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.document_indexing_update_task.delay"
                ),
            ):
                _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset, knowledge_config, account_context, session=sqlite_session
                )

            model_manager_cls.for_tenant.return_value.get_default_model_instance.assert_not_called()
            get_binding.assert_called_once_with("explicit-provider", "explicit-model", sqlite_session)
            assert dataset.embedding_model == "explicit-model"
            assert dataset.embedding_model_provider == "explicit-provider"
            assert dataset.retrieval_model == knowledge_config.retrieval_model.model_dump()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_creates_custom_process_rule_for_new_upload_document(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
            knowledge_config = _make_upload_knowledge_config(
                file_ids=["file-1"],
                process_rule=ProcessRule(
                    mode="custom",
                    rules=Rule(
                        pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                        segmentation=Segmentation(separator="\n", max_tokens=128),
                    ),
                ),
            )
            upload_file = _upload_file(file_id="file-1", name="file.txt")
            sqlite_session.add_all([dataset, upload_file])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.DocumentIndexingTaskProxy"
                ) as document_proxy_cls,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.time.strftime", return_value="20260101010101"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.secrets.randbelow", return_value=23
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                documents, batch = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

            assert len(documents) == 1
            created_document = documents[0]
            assert created_document.name == "file.txt"
            assert batch == "20260101010101100023"
            created_rule = sqlite_session.get(
                _dataset_service_document_DatasetProcessRule, created_document.dataset_process_rule_id
            )
            assert created_rule is not None
            assert created_rule.mode == "custom"
            assert created_rule.rules == knowledge_config.process_rule.rules.model_dump_json()
            document_proxy_cls.assert_called_once_with("tenant-1", "dataset-1", [created_document.id])
            document_proxy_cls.return_value.delay.assert_called_once()

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_creates_automatic_process_rule_for_new_upload_document(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
            knowledge_config = _make_upload_knowledge_config(
                file_ids=["file-1"],
                process_rule=ProcessRule(mode="automatic"),
            )
            sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch("services.knowledge.dataset_service.DocumentIndexingTaskProxy"),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.time.strftime", return_value="20260101010101"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.secrets.randbelow", return_value=23
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                documents, _ = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

            created_rule = sqlite_session.get(
                _dataset_service_document_DatasetProcessRule, documents[0].dataset_process_rule_id
            )
            assert created_rule is not None
            assert created_rule.mode == "automatic"
            assert created_rule.rules == json.dumps(_dataset_service_document_DatasetProcessRule.AUTOMATIC_RULES)
            assert sqlite_session.get(_dataset_service_document_Document, documents[0].id) is documents[0]

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_creates_fallback_automatic_process_rule_when_latest_is_missing(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
            knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"], process_rule=None)
            sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch("services.knowledge.dataset_service.DocumentIndexingTaskProxy"),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.time.strftime", return_value="20260101010101"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.secrets.randbelow", return_value=23
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                documents, _ = _dataset_service_document_DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    session=sqlite_session,
                )

            created_rule = sqlite_session.get(
                _dataset_service_document_DatasetProcessRule, documents[0].dataset_process_rule_id
            )
            assert created_rule is not None
            assert created_rule.mode == "automatic"
            assert created_rule.rules == json.dumps(_dataset_service_document_DatasetProcessRule.AUTOMATIC_RULES)

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_raises_when_upload_file_lookup_is_incomplete(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.UPLOAD_FILE)
            knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
            sqlite_session.add_all([dataset, _upload_file(file_id="file-1", name="file.txt")])
            sqlite_session.commit()

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.time.strftime", return_value="20260101010101"
                ),
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.secrets.randbelow", return_value=23
                ),
            ):
                mock_redis.lock.return_value = _make_lock_context()
                with pytest.raises(FileNotExistsError, match="One or more files not found"):
                    _dataset_service_document_DocumentService.save_document_with_dataset_id(
                        dataset,
                        knowledge_config,
                        account_context,
                        session=sqlite_session,
                    )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_requires_notion_info_list_for_notion_import(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.NOTION_IMPORT)
            process_rule = _process_rule()
            sqlite_session.add_all([dataset, process_rule])
            sqlite_session.commit()
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(data_source_type="notion_import")
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                doc_language="English",
            )

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
            ):
                mock_redis.lock.return_value = _make_lock_context()
                with pytest.raises(ValueError, match="No notion info list found"):
                    _dataset_service_document_DocumentService.save_document_with_dataset_id(
                        dataset,
                        knowledge_config,
                        account_context,
                        dataset_process_rule=process_rule,
                        session=sqlite_session,
                    )

        @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        def test_save_document_with_dataset_id_requires_website_info_list_for_website_crawl(
            self, account_context, sqlite_session: Session
        ):
            dataset = _dataset_row(data_source_type=DataSourceType.WEBSITE_CRAWL)
            process_rule = _process_rule()
            sqlite_session.add_all([dataset, process_rule])
            sqlite_session.commit()
            knowledge_config = _dataset_service_document_KnowledgeConfig(
                indexing_technique="economy",
                data_source=_dataset_service_document_DataSource(
                    info_list=_dataset_service_document_InfoList(data_source_type="website_crawl")
                ),
                doc_form=_dataset_service_document_IndexStructureType.PARAGRAPH_INDEX,
                doc_language="English",
            )

            with (
                _dataset_service_document_patch(
                    "services.knowledge.dataset_service.FeatureService.get_features", return_value=_make_features()
                ),
                _dataset_service_document_patch("services.knowledge.dataset_service.redis_client") as mock_redis,
            ):
                mock_redis.lock.return_value = _make_lock_context()
                with pytest.raises(ValueError, match="No website info list found"):
                    _dataset_service_document_DocumentService.save_document_with_dataset_id(
                        dataset,
                        knowledge_config,
                        account_context,
                        dataset_process_rule=process_rule,
                        session=sqlite_session,
                    )


TENANT_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
DATASET_ID = "33333333-3333-3333-3333-333333333333"
DOCUMENT_ID = "44444444-4444-4444-4444-444444444444"


class FakeLock:
    """Lock that always fails on enter with LockNotOwnedError."""

    def __enter__(self) -> None:
        raise LockNotOwnedError("simulated")

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: types.TracebackType | None
    ) -> bool:
        # Normal contextmanager signature; return False so exceptions propagate
        return False


class TestDatasetServiceLockNotOwnedCases:
    @staticmethod
    @pytest.fixture
    def fake_current_user(
        monkeypatch: pytest.MonkeyPatch,
    ) -> _dataset_service_lock_not_owned_Account:
        tenant = Tenant(name="Test Tenant")
        tenant.id = TENANT_ID
        user = _dataset_service_lock_not_owned_Account(name="Test User", email="test@example.com")
        user.id = USER_ID
        user._current_tenant = tenant
        monkeypatch.setattr("services.knowledge.dataset_service.current_user", user)
        return user

    @staticmethod
    @pytest.fixture
    def fake_features(monkeypatch: pytest.MonkeyPatch) -> types.SimpleNamespace:
        features = types.SimpleNamespace(
            billing=types.SimpleNamespace(subscription=types.SimpleNamespace(plan="ENTERPRISE")),
            documents_upload_quota=types.SimpleNamespace(limit=10_000, size=0),
        )
        monkeypatch.setattr(
            "services.knowledge.dataset_service.FeatureService.get_features",
            lambda _tenant_id, **_kwargs: features,
        )
        return features

    @staticmethod
    @pytest.fixture
    def fake_lock(monkeypatch: pytest.MonkeyPatch) -> None:
        """Patch redis_client.lock to always raise LockNotOwnedError on enter."""

        def _fake_lock(*_args: object, **_kwargs: object) -> FakeLock:
            return FakeLock()

        # DatasetService imports redis_client directly from extensions.ext_redis
        monkeypatch.setattr("services.knowledge.dataset_service.redis_client.lock", _fake_lock)

    # ---------------------------------------------------------------------------
    # 1. Knowledge Pipeline document creation (save_document_with_dataset_id)
    # ---------------------------------------------------------------------------

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [
            (
                _dataset_service_lock_not_owned_Account,
                Tenant,
                Dataset,
                _dataset_service_lock_not_owned_DatasetProcessRule,
                _dataset_service_lock_not_owned_Document,
            )
        ],
        indirect=True,
    )
    @pytest.mark.usefixtures("fake_features", "fake_lock")
    def test_save_document_with_dataset_id_ignores_lock_not_owned(
        monkeypatch: pytest.MonkeyPatch,
        fake_current_user: _dataset_service_lock_not_owned_Account,
        sqlite_session: Session,
    ) -> None:
        # Arrange
        dataset = Dataset(
            id=DATASET_ID,
            tenant_id=TENANT_ID,
            name="Test Dataset",
            description="",
            created_by=USER_ID,
            data_source_type="upload_file",
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        )
        process_rule = _dataset_service_lock_not_owned_DatasetProcessRule(
            dataset_id=DATASET_ID,
            mode=ProcessRuleMode.AUTOMATIC,
            rules=None,
            created_by=USER_ID,
        )
        sqlite_session.add_all([fake_current_user._current_tenant, fake_current_user, dataset, process_rule])
        sqlite_session.commit()

        knowledge_config = _dataset_service_lock_not_owned_KnowledgeConfig(
            doc_form=_dataset_service_lock_not_owned_IndexStructureType.QA_INDEX,
            original_document_id=None,  # go into "new document" branch
            data_source=_dataset_service_lock_not_owned_DataSource(
                info_list=_dataset_service_lock_not_owned_InfoList(data_source_type="upload_file")
            ),
            indexing_technique="high_quality",
            duplicate=False,
            doc_language="en",
        )

        account = fake_current_user

        # Avoid touching real doc_form logic
        monkeypatch.setattr(
            "services.knowledge.dataset_service.DatasetService.check_doc_form", lambda *_args, **_kwargs: None
        )

        # Act: this would hit the redis lock, whose __enter__ raises LockNotOwnedError.
        # Our implementation should catch it and still return (documents, batch).
        documents, batch = _dataset_service_lock_not_owned_DocumentService.save_document_with_dataset_id(
            dataset=dataset,
            knowledge_config=knowledge_config,
            account=account,
            dataset_process_rule=process_rule,
            session=sqlite_session,
        )

        # Assert
        # We mainly care that:
        # - No exception is raised
        # - The function returns a sensible tuple
        assert documents == []
        assert batch
        assert not sqlite_session.in_transaction()
        assert sqlite_session.scalar(select(func.count(_dataset_service_lock_not_owned_Document.id))) == 0
        assert sqlite_session.get(_dataset_service_lock_not_owned_DatasetProcessRule, process_rule.id) is process_rule

    # ---------------------------------------------------------------------------
    # 2. Single-segment creation (add_segment)
    # ---------------------------------------------------------------------------

    # ---------------------------------------------------------------------------
    # 3. Multi-segment creation (multi_create_segment)
    # ---------------------------------------------------------------------------

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [
            (
                _dataset_service_lock_not_owned_Account,
                Tenant,
                Dataset,
                _dataset_service_lock_not_owned_Document,
                DocumentSegment,
            )
        ],
        indirect=True,
    )
    @pytest.mark.usefixtures("fake_lock")
    def test_multi_create_segment_ignores_lock_not_owned(
        fake_current_user: _dataset_service_lock_not_owned_Account,
        sqlite_session: Session,
    ) -> None:
        # Arrange
        dataset = Dataset(
            id=DATASET_ID,
            tenant_id=TENANT_ID,
            name="Test Dataset",
            description="",
            created_by=USER_ID,
            indexing_technique=IndexTechniqueType.ECONOMY,
        )
        document = _dataset_service_lock_not_owned_Document(
            id=DOCUMENT_ID,
            tenant_id=TENANT_ID,
            dataset_id=DATASET_ID,
            position=1,
            data_source_type=DataSourceType("upload_file"),
            data_source_info="{}",
            batch="batch-1",
            name="Test Document",
            created_from=DocumentCreatedFrom("web"),
            created_by=USER_ID,
            word_count=0,
            doc_form=_dataset_service_lock_not_owned_IndexStructureType.QA_INDEX,
        )
        sqlite_session.add_all([fake_current_user._current_tenant, fake_current_user, dataset, document])
        sqlite_session.commit()

        mutations = create_autospec(SegmentMutationService, instance=True)
        result = SegmentService.multi_create_segment(
            segments=[{"content": "question", "answer": "answer", "keywords": ["key"]}],
            document=document,
            dataset=dataset,
            session=sqlite_session,
            mutations=mutations,
        )

        assert result is None
        mutations.index_segments.assert_not_called()
        assert not sqlite_session.in_transaction()
        assert sqlite_session.scalar(select(func.count(DocumentSegment.id))) == 0
        sqlite_session.refresh(document)
        assert document.word_count == 0


"""SQLite-backed tests for segment and child-chunk dataset services."""


def _dataset_service_segment_account(
    *, account_id: str = "user-1", tenant_id: str = "tenant-1"
) -> _dataset_service_segment_Account:
    account = _dataset_service_segment_Account(name="User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


def _dataset_service_segment_dataset(*, dataset_id: str = "dataset-1", tenant_id: str = "tenant-1") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        provider="vendor",
        created_by="user-1",
        maintainer="user-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider",
        embedding_model="embedding-model",
        chunk_structure=_dataset_service_segment_IndexStructureType.PARAGRAPH_INDEX,
    )


def _document(
    *,
    document_id: str = "document-1",
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    doc_form: str = _dataset_service_segment_IndexStructureType.PARAGRAPH_INDEX,
    word_count: int = 20,
) -> _dataset_service_segment_Document:
    document = _dataset_service_segment_Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        indexing_status="completed",
        doc_form=doc_form,
        word_count=word_count,
    )

    document.created_at = datetime(2026, 1, 1)
    document.updated_at = datetime(2026, 1, 2)
    return document


def _segment(
    *,
    segment_id: str = "segment-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    tenant_id: str = "tenant-1",
    position: int = 1,
    content: str = "segment content",
    enabled: bool = True,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=position,
        content=content,
        word_count=len(content),
        tokens=0,
        created_by="user-1",
        enabled=enabled,
        keywords=[],
        answer=None,
        index_node_id=f"node-{segment_id}",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _child(
    *,
    child_id: str = "child-1",
    segment_id: str = "segment-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    tenant_id: str = "tenant-1",
    position: int = 1,
    content: str = "child content",
) -> ChildChunk:
    child = ChildChunk(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        position=position,
        index_node_id=f"node-{child_id}",
        index_node_hash=f"hash-{child_id}",
        content=content,
        word_count=len(content),
        created_by="user-1",
    )
    child.id = child_id
    return child


def _persist_chain(session: Session) -> tuple[Dataset, _dataset_service_segment_Document, DocumentSegment]:
    dataset = _dataset_service_segment_dataset()
    document = _document()
    segment = _segment()
    session.add_all([dataset, document, segment])
    session.commit()
    return dataset, document, segment


class TestDatasetServiceSegmentCases:
    class TestSegmentServiceQueries:
        def test_get_child_chunks_filters_owner_keyword_and_paginates(self, sqlite_session: Session) -> None:
            _persist_chain(sqlite_session)
            sqlite_session.add_all(
                [
                    _child(child_id="child-1", position=1, content="alpha match"),
                    _child(child_id="child-2", position=2, content="beta"),
                    _child(child_id="child-3", position=3, content="alpha second"),
                    _child(child_id="foreign", tenant_id="tenant-2", position=4, content="alpha foreign"),
                ]
            )
            sqlite_session.commit()

            with _dataset_service_segment_patch(
                "services.knowledge.dataset_service.current_user", _dataset_service_segment_account()
            ):
                page = SegmentService.get_child_chunks(
                    "segment-1",
                    "document-1",
                    "dataset-1",
                    page=1,
                    limit=1,
                    keyword="alpha",
                    session=sqlite_session,
                )

            assert page.total == 2
            assert [child.id for child in page.items] == ["child-1"]

        def test_get_child_chunk_by_id_scopes_tenant(self, sqlite_session: Session) -> None:
            owned = _child()
            sqlite_session.add(owned)
            sqlite_session.commit()

            assert SegmentService.get_child_chunk_by_id(owned.id, "tenant-1", sqlite_session) is owned
            assert SegmentService.get_child_chunk_by_id(owned.id, "tenant-2", sqlite_session) is None

        def test_get_child_chunk_by_segment_ref_enforces_full_chain(self, sqlite_session: Session) -> None:
            child = _child()
            sqlite_session.add(child)
            sqlite_session.commit()
            valid_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), "segment-1")

            assert SegmentService.get_child_chunk_by_segment_ref(child.id, valid_ref, sqlite_session) is child
            spoofed_refs = [
                SegmentRef(DocumentRef(DatasetRef("tenant-2", "dataset-1"), "document-1"), "segment-1"),
                SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), "segment-1"),
                SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-2"), "segment-1"),
                SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), "segment-2"),
            ]
            for spoofed_ref in spoofed_refs:
                assert SegmentService.get_child_chunk_by_segment_ref(child.id, spoofed_ref, sqlite_session) is None

        def test_get_segments_filters_status_keyword_and_orders(self, sqlite_session: Session) -> None:
            sqlite_session.add_all(
                [
                    _segment(segment_id="one", position=2, content="alpha later"),
                    _segment(segment_id="two", position=1, content="alpha first"),
                    _segment(segment_id="three", position=3, content="beta"),
                    _segment(segment_id="foreign", tenant_id="tenant-2", position=1, content="alpha foreign"),
                ]
            )
            sqlite_session.commit()

            segments, total = SegmentService.get_segments(
                "document-1",
                "tenant-1",
                status_list=[SegmentStatus.COMPLETED],
                keyword="alpha",
                session=sqlite_session,
            )

            assert total == 2
            assert [segment.id for segment in segments] == ["two", "one"]

        def test_get_segment_by_id_and_ref_scope_complete_owner(self, sqlite_session: Session) -> None:
            segment = _segment()
            sqlite_session.add(segment)
            sqlite_session.commit()
            valid_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), segment.id)

            assert SegmentService.get_segment_by_id(segment.id, "tenant-1", sqlite_session) is segment
            assert SegmentService.get_segment_by_id(segment.id, "tenant-2", sqlite_session) is None
            assert SegmentService.get_segment_by_ref(valid_ref, sqlite_session) is segment
            spoofed_refs = [
                SegmentRef(DocumentRef(DatasetRef("tenant-2", "dataset-1"), "document-1"), segment.id),
                SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), segment.id),
                SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-2"), segment.id),
            ]
            for spoofed_ref in spoofed_refs:
                assert SegmentService.get_segment_by_ref(spoofed_ref, sqlite_session) is None

        def test_get_segments_by_document_and_dataset_returns_real_rows(self, sqlite_session: Session) -> None:
            sqlite_session.add_all(
                [
                    _segment(segment_id="enabled"),
                    _segment(segment_id="disabled", position=2, enabled=False),
                    _segment(segment_id="other", document_id="document-2", position=1),
                    _segment(segment_id="foreign", tenant_id="tenant-2"),
                ]
            )
            sqlite_session.commit()

            segments = SegmentService.get_segments_by_document_and_dataset(
                "document-1",
                "dataset-1",
                sqlite_session,
                tenant_id="tenant-1",
                status=SegmentStatus.COMPLETED,
                enabled=True,
            )

            assert [segment.id for segment in segments] == ["enabled"]

    class TestSegmentServiceValidation:
        def test_qa_segment_requires_answer(self) -> None:
            with pytest.raises(ValueError, match="Answer is required"):
                SegmentService.segment_create_args_validate(
                    {"content": "question"}, _document(doc_form=_dataset_service_segment_IndexStructureType.QA_INDEX)
                )

        @pytest.mark.parametrize("content", [None, "", "   "])
        def test_segment_requires_non_empty_content(self, content: str | None) -> None:
            with pytest.raises(ValueError, match="Content is empty"):
                SegmentService.segment_create_args_validate({"content": content}, _document())

        def test_segment_attachment_ids_must_be_a_list(self) -> None:
            with pytest.raises(ValueError, match="Attachment IDs is invalid"):
                SegmentService.segment_create_args_validate({"content": "text", "attachment_ids": "file"}, _document())

        def test_segment_attachment_limit_is_enforced(self, config_overrides: Callable[..., None]) -> None:
            config_overrides(SINGLE_CHUNK_ATTACHMENT_LIMIT=1)

            with pytest.raises(ValueError, match="Exceeded maximum attachment limit"):
                SegmentService.segment_create_args_validate(
                    {"content": "text", "attachment_ids": ["one", "two"]},
                    _document(),
                )

        def test_segment_attachment_limit_accepts_exact_boundary(self, config_overrides: Callable[..., None]) -> None:
            config_overrides(SINGLE_CHUNK_ATTACHMENT_LIMIT=2)

            SegmentService.segment_create_args_validate(
                {"content": "text", "attachment_ids": ["one", "two"]},
                _document(),
            )

    class TestSegmentServiceMutations:
        @pytest.mark.parametrize(
            ("document_dataset_id", "document_tenant_id"),
            [("dataset-2", "tenant-1"), ("dataset-1", "tenant-2")],
        )
        def test_delete_segment_rejects_document_outside_dataset(
            self, document_dataset_id: str, document_tenant_id: str, sqlite_session: Session
        ) -> None:
            dataset = _dataset_service_segment_dataset()
            document = _document(dataset_id=document_dataset_id, tenant_id=document_tenant_id)
            segment = _segment(dataset_id=document_dataset_id, tenant_id=document_tenant_id)
            mutations = create_autospec(SegmentMutationService, instance=True, spec_set=True)

            with pytest.raises(ValueError, match="Document does not belong to the dataset"):
                SegmentService.delete_segment(segment, document, dataset, sqlite_session, mutations=mutations)

            mutations.delete_segment.assert_not_called()

        def test_multi_create_segment_marks_each_real_row_error_on_vector_failure(
            self, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
        ) -> None:
            dataset = _dataset_service_segment_dataset()
            document = _document(word_count=0)
            sqlite_session.add_all([dataset, document])
            sqlite_session.commit()
            embedding_model = SimpleNamespace(get_text_embedding_num_tokens=lambda *, texts: [len(texts) + 1])
            index = create_autospec(SegmentIndex, instance=True, spec_set=True)

            def fail(*_args: object, **_kwargs: object) -> None:
                assert not sqlite_session.in_transaction()
                raise RuntimeError("vector failed")

            index.create_many.side_effect = fail
            mutations = SegmentMutationService(
                store=SQLAlchemySegmentRepository(session_factory=sqlite_session_factory),
                index=index,
                text_hash=lambda text: text,
                indexing_state=create_autospec(SegmentIndexingState, instance=True, spec_set=True),
            )

            with (
                _dataset_service_segment_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_segment_account()
                ),
                _dataset_service_segment_patch("services.knowledge.dataset_service.ModelManager") as manager_cls,
            ):
                manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
                segments = SegmentService.multi_create_segment(
                    [{"content": "one"}, {"content": "two"}],
                    document,
                    dataset,
                    sqlite_session,
                    mutations=mutations,
                )

            assert segments is not None
            assert len(segments) == 2
            assert all(segment.status == SegmentStatus.ERROR and not segment.enabled for segment in segments)
            assert document.word_count == 6

        def test_multi_create_segment_persists_qa_counts_positions_and_tokens(self, sqlite_session: Session) -> None:
            dataset = _dataset_service_segment_dataset()
            document = _document(doc_form=_dataset_service_segment_IndexStructureType.QA_INDEX, word_count=5)
            sqlite_session.add_all([dataset, document, _segment(segment_id="existing")])
            sqlite_session.commit()
            embedding_model = _dataset_service_segment_MagicMock()
            embedding_model.get_text_embedding_num_tokens.side_effect = [[11], [13]]
            mutations = create_autospec(SegmentMutationService, instance=True, spec_set=True)

            with (
                _dataset_service_segment_patch(
                    "services.knowledge.dataset_service.current_user", _dataset_service_segment_account()
                ),
                _dataset_service_segment_patch("services.knowledge.dataset_service.ModelManager") as manager_cls,
            ):
                manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
                segments = SegmentService.multi_create_segment(
                    [
                        {"content": "question-1", "answer": "answer-1", "keywords": ["key"]},
                        {"content": "question-2", "answer": "answer-2"},
                    ],
                    document,
                    dataset,
                    sqlite_session,
                    mutations=mutations,
                )

            assert segments is not None
            assert [segment.position for segment in segments] == [2, 3]
            assert [segment.tokens for segment in segments] == [11, 13]
            assert [segment.answer for segment in segments] == ["answer-1", "answer-2"]
            expected_increment = sum(len(segment.content) + len(segment.answer or "") for segment in segments)
            assert document.word_count == 5 + expected_increment
            assert embedding_model.get_text_embedding_num_tokens.call_args_list[0].kwargs == {
                "texts": ["question-1answer-1"]
            }
            assert embedding_model.get_text_embedding_num_tokens.call_args_list[1].kwargs == {
                "texts": ["question-2answer-2"]
            }
            mutations.index_segments.assert_called_once_with(
                DatasetRef("tenant-1", "dataset-1").document("document-1"),
                segment_ids=[segment.id for segment in segments],
                keywords_list=[["key"], None],
            )
