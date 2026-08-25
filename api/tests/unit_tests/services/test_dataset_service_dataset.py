"""SQLite-backed tests for dataset-level operations in :mod:`services.dataset_service`.

Mapped objects in this module are real SQLAlchemy models. Provider runtimes,
RBAC clients, Celery tasks, and model-manager results remain mocked at their
external boundaries.
"""

from __future__ import annotations

from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from models import Account
from models.account import Tenant
from models.dataset import (
    Dataset,
    DatasetCollectionBinding,
    DatasetPermission,
    DatasetPermissionEnum,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
)
from services.dataset_service import DatasetCollectionBindingService, DatasetPermissionService, DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo,
    RagPipelineDatasetCreateEntity,
)
from services.errors.account import NoPermissionError
from services.errors.dataset import DatasetNameDuplicateError

from .dataset_service_test_helpers import (
    MagicMock,
    TenantAccountRole,
    _make_knowledge_configuration,
    _make_retrieval_model,
)


def _account(
    *,
    account_id: str = "user-1",
    tenant_id: str = "tenant-1",
    role: TenantAccountRole = TenantAccountRole.OWNER,
) -> Account:
    account = Account(name=f"User {account_id}", email=f"{account_id}@example.com")
    account.id = account_id
    account.role = role
    tenant = Tenant(name=f"Tenant {tenant_id}")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


def _dataset(
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
    return Dataset(
        id=dataset_id,
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
        dataset = _dataset(chunk_structure=dataset_doc_form)
        sqlite_session.add(dataset)
        sqlite_session.commit()

        DatasetService.check_doc_form(dataset, incoming_doc_form, session=sqlite_session)

    def test_check_doc_form_rejects_mismatched_doc_form(self, sqlite_session: Session) -> None:
        dataset = _dataset(chunk_structure="qa_model")
        sqlite_session.add(dataset)
        sqlite_session.commit()

        with pytest.raises(ValueError, match="doc_form is different"):
            DatasetService.check_doc_form(dataset, "text_model", session=sqlite_session)

    @pytest.mark.parametrize("operator_check", [False, True])
    def test_dataset_permission_checks_ignore_foreign_tenant_binding(
        self, sqlite_session: Session, operator_check: bool
    ) -> None:
        dataset = _dataset(
            dataset_id="dataset-1",
            tenant_id="tenant-1",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            maintainer="owner-1",
        )
        user = _account(
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
                DatasetService.check_dataset_operator_permission(user, dataset, session=sqlite_session)
        else:
            with pytest.raises(NoPermissionError):
                DatasetService.check_dataset_permission(dataset, user, sqlite_session)

    def test_check_dataset_model_setting_skips_non_high_quality_datasets(self) -> None:
        dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

        model_manager_cls.assert_not_called()

    def test_check_dataset_model_setting_validates_high_quality_embedding(self) -> None:
        dataset = _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

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
        dataset = _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = error
            with pytest.raises(ValueError, match=message):
                DatasetService.check_dataset_model_setting(dataset)

    @pytest.mark.parametrize(("features", "expected"), [([ModelFeature.VISION], True), ([], False)])
    def test_check_is_multimodal_model_reads_runtime_schema(self, features: list[ModelFeature], expected: bool) -> None:
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = SimpleNamespace(features=features)
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance
            result = DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

        assert result is expected

    def test_check_is_multimodal_model_rejects_missing_schema(self) -> None:
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = None
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = model_instance
            with pytest.raises(ValueError, match="Model schema not found"):
                DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

    @pytest.mark.parametrize(
        ("method", "error", "message"),
        [
            (
                DatasetService.check_embedding_model_setting,
                ProviderTokenNotInitError("provider setup"),
                "provider setup",
            ),
            (DatasetService.check_reranking_model_setting, LLMBadRequestError(), "No Rerank Model available"),
        ],
    )
    def test_direct_model_setting_checks_wrap_runtime_errors(
        self, method: Callable[[str, str, str], None], error: Exception, message: str
    ) -> None:
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = error
            with pytest.raises(ValueError, match=message):
                method("tenant-1", "provider", "model")


class TestDatasetServiceRetrieval:
    def test_get_dataset_for_tenant_rejects_cross_tenant_row(self, sqlite_session: Session) -> None:
        owned = _dataset()
        foreign = _dataset(dataset_id="dataset-2", tenant_id="tenant-2", name="Foreign")
        sqlite_session.add_all([owned, foreign])
        sqlite_session.commit()

        assert DatasetService.get_dataset_for_tenant(owned.id, "tenant-1", session=sqlite_session) is owned
        assert DatasetService.get_dataset_for_tenant(foreign.id, "tenant-1", session=sqlite_session) is None

    def test_get_datasets_applies_rbac_resource_scope_and_maintainer_override(self, sqlite_session: Session) -> None:
        user = _account(role=TenantAccountRole.NORMAL)
        accessible = _dataset(dataset_id="accessible", name="Accessible", maintainer="other")
        owned = _dataset(dataset_id="owned", name="Owned", maintainer=user.id)
        hidden = _dataset(dataset_id="hidden", name="Hidden", maintainer="other")
        foreign = _dataset(dataset_id="foreign", tenant_id="tenant-2", name="Foreign")
        sqlite_session.add_all([accessible, owned, hidden, foreign])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.dataset_service.enterprise_rbac_service.RBACService.MyPermissions.get",
                return_value=SimpleNamespace(workspace=SimpleNamespace(permission_keys=[])),
            ),
        ):
            datasets, total = DatasetService.get_datasets(
                page=1,
                per_page=20,
                session=sqlite_session,
                tenant_id="tenant-1",
                user=user,
                accessible_dataset_ids=[accessible.id],
                include_own_datasets=True,
            )

        assert total == 2
        assert {dataset.id for dataset in datasets} == {accessible.id, owned.id}

    def test_get_datasets_without_user_keeps_only_team_visible_rows(self, sqlite_session: Session) -> None:
        shared = _dataset(dataset_id="shared", name="Shared", permission=DatasetPermissionEnum.ALL_TEAM)
        private = _dataset(dataset_id="private", name="Private", permission=DatasetPermissionEnum.ONLY_ME)
        sqlite_session.add_all([shared, private])
        sqlite_session.commit()

        with patch("services.dataset_service.dify_config.RBAC_ENABLED", False):
            datasets, total = DatasetService.get_datasets(
                page=1,
                per_page=20,
                session=sqlite_session,
                tenant_id="tenant-1",
            )

        assert total == 1
        assert [dataset.id for dataset in datasets] == [shared.id]

    def test_get_datasets_by_ids_intersects_requested_and_accessible_ids(self, sqlite_session: Session) -> None:
        user = _account(role=TenantAccountRole.NORMAL)
        accessible = _dataset(dataset_id="accessible", name="Accessible", maintainer="other")
        owned = _dataset(dataset_id="owned", name="Owned", maintainer=user.id)
        hidden = _dataset(dataset_id="hidden", name="Hidden", maintainer="other")
        sqlite_session.add_all([accessible, owned, hidden])
        sqlite_session.commit()

        with patch("services.dataset_service.dify_config.RBAC_ENABLED", True):
            datasets, total = DatasetService.get_datasets_by_ids(
                [accessible.id, owned.id, hidden.id],
                "tenant-1",
                user=user,
                accessible_dataset_ids=[accessible.id, "not-requested"],
                include_own_datasets=True,
                session=sqlite_session,
            )

        assert total == 2
        assert {dataset.id for dataset in datasets} == {accessible.id, owned.id}

    def test_get_datasets_rbac_without_user_returns_no_rows(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset())
        sqlite_session.commit()

        with patch("services.dataset_service.dify_config.RBAC_ENABLED", True):
            datasets, total = DatasetService.get_datasets(
                page=1,
                per_page=20,
                session=sqlite_session,
                tenant_id="tenant-1",
            )

        assert datasets == []
        assert total == 0

    def test_get_datasets_rbac_include_all_requires_workspace_permission(self, sqlite_session: Session) -> None:
        user = _account(role=TenantAccountRole.NORMAL)
        sqlite_session.add_all(
            [
                _dataset(dataset_id="one", name="One", maintainer="other"),
                _dataset(dataset_id="two", name="Two", maintainer="other"),
            ]
        )
        sqlite_session.commit()

        with (
            patch("services.dataset_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.dataset_service.enterprise_rbac_service.RBACService.MyPermissions.get",
                return_value=SimpleNamespace(
                    workspace=SimpleNamespace(permission_keys=["dataset.create_and_management"])
                ),
            ),
        ):
            datasets, total = DatasetService.get_datasets(
                page=1,
                per_page=20,
                session=sqlite_session,
                tenant_id="tenant-1",
                user=user,
                include_all=True,
            )

        assert total == 2
        assert {dataset.id for dataset in datasets} == {"one", "two"}


class TestDatasetServiceCreationAndUpdate:
    def test_create_empty_dataset_rejects_duplicate_name(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(name="Existing"))
        sqlite_session.commit()

        with pytest.raises(DatasetNameDuplicateError, match="already exists"):
            DatasetService.create_empty_dataset(
                "tenant-1",
                "Existing",
                "",
                IndexTechniqueType.ECONOMY,
                _account(),
                session=sqlite_session,
            )

    def test_create_empty_dataset_persists_default_embedding_and_creator_scope(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        embedding_model = SimpleNamespace(provider="provider", model_name="default-embedding")

        with (
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"),
        ):
            model_manager_cls.for_tenant.return_value.get_default_model_instance.return_value = embedding_model
            dataset = DatasetService.create_empty_dataset(
                "tenant-1",
                "Created",
                "Description",
                IndexTechniqueType.HIGH_QUALITY,
                _account(),
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

        with patch("services.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"):
            dataset = DatasetService.create_empty_dataset(
                "tenant-1",
                "External",
                "",
                IndexTechniqueType.ECONOMY,
                _account(),
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
            patch("services.dataset_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"),
        ):
            DatasetService.create_empty_dataset(
                "tenant-1",
                "External",
                "",
                IndexTechniqueType.ECONOMY,
                _account(),
                provider="external",
                external_knowledge_api_id="api-foreign",
                external_knowledge_id="knowledge-1",
                session=sqlite_session,
            )

    def test_create_empty_rag_pipeline_dataset_generates_incremental_name(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(name="Untitled 1"))
        sqlite_session.commit()
        entity = RagPipelineDatasetCreateEntity(
            name="",
            description="Pipeline dataset",
            icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with patch("services.dataset_service.current_user", _account()):
            dataset = DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity, sqlite_session)

        assert dataset.name == "Untitled 2"
        pipeline = sqlite_session.get(Pipeline, dataset.pipeline_id)
        assert pipeline is not None
        assert pipeline.tenant_id == dataset.tenant_id

    def test_create_empty_rag_pipeline_dataset_rejects_duplicate_name(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(name="Existing"))
        sqlite_session.commit()
        entity = RagPipelineDatasetCreateEntity(
            name="Existing",
            description="",
            icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with (
            patch("services.dataset_service.current_user", _account()),
            pytest.raises(DatasetNameDuplicateError, match="already exists"),
        ):
            DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity, sqlite_session)

    def test_create_empty_rag_pipeline_dataset_requires_authenticated_account(self, sqlite_session: Session) -> None:
        account = _account()
        account.id = ""
        entity = RagPipelineDatasetCreateEntity(
            name="Dataset",
            description="",
            icon_info=IconInfo(icon_type="emoji", icon="📚", icon_background="#FFFFFF", icon_url=None),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with (
            patch("services.dataset_service.current_user", account),
            pytest.raises(ValueError, match="Current user or current user id not found"),
        ):
            DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity, sqlite_session)

    def test_update_dataset_rejects_missing_and_duplicate_rows(self, sqlite_session: Session) -> None:
        current = _dataset(name="Current")
        duplicate = _dataset(dataset_id="dataset-2", name="Duplicate")
        sqlite_session.add_all([current, duplicate])
        sqlite_session.commit()

        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.update_dataset("missing", {}, _account(), session=sqlite_session)
        with pytest.raises(ValueError, match="Dataset name already exists"):
            DatasetService.update_dataset(current.id, {"name": duplicate.name}, _account(), session=sqlite_session)

    @pytest.mark.parametrize(
        ("provider", "helper_name"),
        [("external", "_update_external_dataset"), ("vendor", "_update_internal_dataset")],
    )
    def test_update_dataset_routes_by_provider(self, sqlite_session: Session, provider: str, helper_name: str) -> None:
        dataset = _dataset(provider=provider)
        sqlite_session.add(dataset)
        sqlite_session.commit()

        with (
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(DatasetService, helper_name, return_value=dataset) as update_helper,
        ):
            result = DatasetService.update_dataset(
                dataset.id,
                {"name": dataset.name},
                _account(),
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
            DatasetService._update_external_dataset(_dataset(provider="external"), payload, _account(), unbound_session)

    def test_update_external_dataset_flushes_dataset_and_binding_without_committing(
        self, sqlite_session: Session
    ) -> None:
        dataset = _dataset(provider="external")
        api = _external_api()
        binding = _binding()
        sqlite_session.add_all([dataset, api, binding])
        sqlite_session.commit()
        transaction_events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

        updated = DatasetService._update_external_dataset(
            dataset,
            {
                "name": "Updated",
                "description": "Changed",
                "external_knowledge_id": "knowledge-2",
                "external_knowledge_api_id": api.id,
            },
            _account(),
            sqlite_session,
        )

        assert updated is dataset
        assert dataset.name == "Updated"
        assert binding.external_knowledge_id == "knowledge-2"
        assert transaction_events == []

    def test_update_external_dataset_rejects_cross_tenant_api(self, sqlite_session: Session) -> None:
        dataset = _dataset(provider="external")
        foreign_api = _external_api(api_id="api-foreign", tenant_id="tenant-2")
        sqlite_session.add_all([dataset, foreign_api, _binding()])
        sqlite_session.commit()

        with pytest.raises(ValueError, match="api template not found"):
            DatasetService._update_external_dataset(
                dataset,
                {
                    "external_knowledge_id": "knowledge-2",
                    "external_knowledge_api_id": foreign_api.id,
                },
                _account(),
                sqlite_session,
            )

    def test_update_external_knowledge_binding_rejects_missing_row(self, sqlite_session: Session) -> None:
        with pytest.raises(ValueError, match="binding not found"):
            DatasetService._update_external_knowledge_binding(
                "missing-dataset",
                "knowledge-2",
                "api-2",
                sqlite_session,
            )

    def test_update_internal_dataset_executes_real_update_without_committing(self, sqlite_session: Session) -> None:
        dataset = _dataset(name="Before")
        sqlite_session.add(dataset)
        sqlite_session.commit()
        transaction_events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

        with (
            patch.object(DatasetService, "_handle_indexing_technique_change", return_value="update"),
            patch.object(DatasetService, "_update_pipeline_knowledge_base_node_data"),
            patch("services.dataset_service.deal_dataset_vector_index_task.delay") as vector_task,
            patch("services.dataset_service.regenerate_summary_index_task.delay") as summary_task,
        ):
            updated = DatasetService._update_internal_dataset(
                dataset,
                {"name": "After", "description": "Changed"},
                _account(),
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
        ordinary = _dataset()
        missing_pipeline = _dataset(dataset_id="pipeline-dataset", name="Pipeline Dataset")
        missing_pipeline.runtime_mode = "rag_pipeline"
        missing_pipeline.pipeline_id = "missing-pipeline"
        sqlite_session.add_all([ordinary, missing_pipeline])
        sqlite_session.commit()

        DatasetService._update_pipeline_knowledge_base_node_data(ordinary, "user-1", sqlite_session)
        DatasetService._update_pipeline_knowledge_base_node_data(missing_pipeline, "user-1", sqlite_session)

    def test_update_pipeline_node_data_rolls_back_real_session_on_failure(self, sqlite_session: Session) -> None:
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="", created_by="user-1")
        pipeline.id = "pipeline-1"
        dataset = _dataset()
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

        with patch("services.dataset_service.RagPipelineService") as service_cls:
            service_cls.return_value.get_published_workflow.side_effect = RuntimeError("boom")
            with pytest.raises(RuntimeError, match="boom"):
                DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1", sqlite_session)

        assert transaction_events == ["rollback"]


class TestDatasetServiceEmbeddingSettings:
    def test_handle_indexing_technique_change_returns_none_without_requested_change(
        self, unbound_session: Session
    ) -> None:
        assert DatasetService._handle_indexing_technique_change(_dataset(), {}, {}, unbound_session) is None

    def test_handle_indexing_technique_change_switches_to_economy(self, unbound_session: Session) -> None:
        dataset = _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
        filtered_data: dict[str, object] = {}

        result = DatasetService._handle_indexing_technique_change(
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
        dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
        filtered_data: dict[str, object] = {}

        with patch.object(DatasetService, "_configure_embedding_model_for_high_quality") as configure:
            result = DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": IndexTechniqueType.HIGH_QUALITY},
                filtered_data,
                unbound_session,
            )

        assert result == "add"
        configure.assert_called_once()

    def test_handle_unchanged_indexing_preserves_existing_model(self, unbound_session: Session) -> None:
        dataset = _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

        with patch.object(DatasetService, "_preserve_existing_embedding_settings") as preserve:
            result = DatasetService._handle_embedding_model_update_when_technique_unchanged(
                dataset,
                {},
                {},
                unbound_session,
            )

        assert result is None
        preserve.assert_called_once()

    def test_update_embedding_model_settings_delegates_changed_model(self, unbound_session: Session) -> None:
        dataset = _dataset()

        with patch.object(DatasetService, "_apply_new_embedding_settings") as apply_settings:
            result = DatasetService._update_embedding_model_settings(
                dataset,
                {"embedding_model_provider": "provider-2", "embedding_model": "model-2"},
                {},
                unbound_session,
            )

        assert result == "update"
        apply_settings.assert_called_once()

    def test_configure_high_quality_wraps_provider_error(self, unbound_session: Session) -> None:
        account = _account()
        with (
            patch("services.dataset_service.current_user", account),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = LLMBadRequestError()
            with pytest.raises(ValueError, match="No Embedding Model available"):
                DatasetService._configure_embedding_model_for_high_quality(
                    {"embedding_model_provider": "provider", "embedding_model": "model"},
                    {},
                    unbound_session,
                )

    def test_preserve_existing_embedding_settings(self) -> None:
        dataset = _dataset()
        filtered_data: dict[str, object] = {}

        DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

        assert filtered_data["embedding_model_provider"] == dataset.embedding_model_provider
        assert filtered_data["embedding_model"] == dataset.embedding_model

    def test_update_embedding_model_settings_returns_none_when_unchanged(self, unbound_session: Session) -> None:
        dataset = _dataset()

        result = DatasetService._update_embedding_model_settings(
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
        dataset = _dataset()
        filtered_data: dict[str, object] = {}
        account = _account()
        embedding_model = SimpleNamespace(provider="new-provider", model_name="new-model")
        collection_binding = DatasetCollectionBinding(
            provider_name="new-provider",
            model_name="new-model",
            type="dataset",
            collection_name="collection",
        )
        collection_binding.id = "collection-binding-1"

        with (
            patch("services.dataset_service.current_user", account),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(
                DatasetCollectionBindingService,
                "get_dataset_collection_binding",
                return_value=collection_binding,
            ),
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            DatasetService._apply_new_embedding_settings(
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
        dataset = _dataset()
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.side_effect = ProviderTokenNotInitError(
                "missing"
            )
            DatasetService._apply_new_embedding_settings(
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
        dataset = _dataset()
        dataset.summary_index_setting = {
            "enable": True,
            "model_name": "old-model",
            "model_provider_name": "provider",
        }

        data = {} if summary_setting is None else {"summary_index_setting": summary_setting}
        assert DatasetService._check_summary_index_setting_model_changed(dataset, data) is expected


class TestDatasetServiceRagPipelineSettings:
    def test_requires_current_tenant(self, unbound_session: Session) -> None:
        account = _account()
        account._current_tenant = None

        with (
            patch("services.dataset_service.current_user", account),
            pytest.raises(ValueError, match="Current user or current tenant not found"),
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                _dataset(),
                _make_knowledge_configuration(),
                session=unbound_session,
            )

    def test_unpublished_high_quality_settings_use_real_merged_dataset(self, sqlite_session: Session) -> None:
        dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
        sqlite_session.add(dataset)
        sqlite_session.commit()
        account = _account()
        embedding_model = SimpleNamespace(provider="provider-2", model_name="embedding-2")
        collection_binding = DatasetCollectionBinding(
            provider_name="provider-2",
            model_name="embedding-2",
            type="dataset",
            collection_name="collection",
        )
        collection_binding.id = "collection-binding-2"

        with (
            patch("services.dataset_service.current_user", account),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=True),
            patch.object(
                DatasetCollectionBindingService,
                "get_dataset_collection_binding",
                return_value=collection_binding,
            ),
        ):
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            DatasetService.update_rag_pipeline_dataset_settings(
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
        dataset = _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
        sqlite_session.add(dataset)
        sqlite_session.commit()

        with patch("services.dataset_service.current_user", _account()):
            DatasetService.update_rag_pipeline_dataset_settings(
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
        dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY, chunk_structure="paragraph")
        dataset.keyword_number = 4
        sqlite_session.add(dataset)
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.deal_dataset_index_update_task.delay") as update_task,
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
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
                _dataset(chunk_structure="paragraph"),
                _make_knowledge_configuration(chunk_structure="sentence"),
                "Chunk structure is not allowed",
            ),
            (
                _dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, chunk_structure="paragraph"),
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
            patch("services.dataset_service.current_user", _account()),
            pytest.raises(ValueError, match=message),
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                dataset,
                configuration,
                has_published=True,
                session=sqlite_session,
            )


class TestDatasetPermissions:
    def test_check_dataset_permission_enforces_tenant_and_partial_members(self, sqlite_session: Session) -> None:
        dataset = _dataset(permission=DatasetPermissionEnum.PARTIAL_TEAM, maintainer="owner")
        permitted_user = _account(account_id="permitted", role=TenantAccountRole.NORMAL)
        denied_user = _account(account_id="denied", role=TenantAccountRole.NORMAL)
        foreign_user = _account(account_id="foreign", tenant_id="tenant-2", role=TenantAccountRole.NORMAL)
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

        DatasetService.check_dataset_permission(dataset, permitted_user, sqlite_session)
        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(dataset, denied_user, sqlite_session)
        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(dataset, foreign_user, sqlite_session)

    def test_dataset_operator_cannot_change_permission_or_member_list(self, sqlite_session: Session) -> None:
        dataset = _dataset(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        operator = _account(role=TenantAccountRole.DATASET_OPERATOR)
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
        user = _account(role=TenantAccountRole.NORMAL)

        with pytest.raises(NoPermissionError, match="does not have permission"):
            DatasetPermissionService.check_permission(
                user,
                _dataset(),
                DatasetPermissionEnum.ALL_TEAM,
                None,
                session=sqlite_session,
            )

    def test_dataset_operator_can_keep_unchanged_partial_member_list(self, sqlite_session: Session) -> None:
        dataset = _dataset(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        operator = _account(role=TenantAccountRole.DATASET_OPERATOR)
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
