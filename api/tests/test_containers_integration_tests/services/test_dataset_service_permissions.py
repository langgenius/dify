"""Testcontainers integration tests for DatasetService permission and lifecycle SQL paths."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetAutoDisableLog,
    DatasetCollectionBinding,
    DatasetPermission,
    DatasetPermissionEnum,
)
from models.enums import DataSourceType
from services.dataset_service import DatasetCollectionBindingService, DatasetPermissionService, DatasetService
from services.errors.account import NoPermissionError


class DatasetPermissionIntegrationFactory:
    @staticmethod
    def create_account_with_tenant(
        db_session_with_containers: Session,
        role: TenantAccountRole = TenantAccountRole.OWNER,
    ) -> tuple[Account, Tenant]:
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
        db_session_with_containers.add_all([account, tenant])
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.role = role
        account._current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_account_in_tenant(
        db_session_with_containers: Session,
        tenant: Tenant,
        role: TenantAccountRole = TenantAccountRole.EDITOR,
    ) -> Account:
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.role = role
        account._current_tenant = tenant
        return account

    @staticmethod
    def create_dataset(
        db_session_with_containers: Session,
        *,
        tenant_id: str,
        created_by: str,
        name: str | None = None,
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        indexing_technique: str | None = IndexTechniqueType.HIGH_QUALITY,
        enable_api: bool = True,
    ) -> Dataset:
        dataset = Dataset(
            tenant_id=tenant_id,
            name=name or f"dataset-{uuid4()}",
            description="desc",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=indexing_technique,
            created_by=created_by,
            provider="vendor",
            permission=permission,
            retrieval_model={"top_k": 2},
        )
        dataset.enable_api = enable_api
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_dataset_permission(
        db_session_with_containers: Session,
        *,
        dataset_id: str,
        tenant_id: str,
        account_id: str,
    ) -> DatasetPermission:
        permission = DatasetPermission(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            account_id=account_id,
            has_permission=True,
        )
        db_session_with_containers.add(permission)
        db_session_with_containers.commit()
        return permission

    @staticmethod
    def create_app_dataset_join(
        db_session_with_containers: Session,
        *,
        dataset_id: str,
    ) -> AppDatasetJoin:
        join = AppDatasetJoin(
            app_id=str(uuid4()),
            dataset_id=dataset_id,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()
        return join

    @staticmethod
    def create_collection_binding(
        db_session_with_containers: Session,
        *,
        provider_name: str,
        model_name: str,
        collection_type: str = "dataset",
    ) -> DatasetCollectionBinding:
        binding = DatasetCollectionBinding(
            provider_name=provider_name,
            model_name=model_name,
            collection_name=f"collection_{uuid4().hex}",
            type=collection_type,
        )
        db_session_with_containers.add(binding)
        db_session_with_containers.commit()
        return binding

    @staticmethod
    def create_auto_disable_log(
        db_session_with_containers: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
    ) -> DatasetAutoDisableLog:
        log = DatasetAutoDisableLog(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
        )
        db_session_with_containers.add(log)
        db_session_with_containers.commit()
        return log


class TestDatasetServicePermissionsAndLifecycle:
    def test_delete_dataset_returns_false_when_dataset_is_missing(self, db_session_with_containers: Session):
        owner, _tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)

        result = DatasetService.delete_dataset(str(uuid4()), user=owner)

        assert result is False

    def test_delete_dataset_checks_permission_and_deletes_dataset(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
        )

        with patch("services.dataset_service.dataset_was_deleted.send") as send_deleted_signal:
            result = DatasetService.delete_dataset(dataset.id, user=owner)

        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        send_deleted_signal.assert_called_once_with(dataset)

    def test_dataset_use_check_returns_true_when_join_exists(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
        )
        DatasetPermissionIntegrationFactory.create_app_dataset_join(
            db_session_with_containers,
            dataset_id=dataset.id,
        )

        assert DatasetService.dataset_use_check(dataset.id) is True

    def test_dataset_use_check_returns_false_when_join_missing(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
        )

        assert DatasetService.dataset_use_check(dataset.id) is False

    def test_check_dataset_permission_rejects_cross_tenant_access(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        outsider, _other_tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(
            db_session_with_containers
        )
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, outsider)

    def test_check_dataset_permission_rejects_only_me_dataset_for_non_creator(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, member)

    def test_check_dataset_permission_rejects_partial_team_user_without_binding(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, member)

    def test_check_dataset_permission_allows_partial_team_creator(self, db_session_with_containers: Session):
        creator, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(
            db_session_with_containers,
            role=TenantAccountRole.EDITOR,
        )
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=creator.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )

        DatasetService.check_dataset_permission(dataset, creator)

    def test_check_dataset_permission_allows_partial_team_member_with_binding(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=member.id,
        )

        DatasetService.check_dataset_permission(dataset, member)

    def test_check_dataset_operator_permission_rejects_only_me_for_non_creator(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        operator = DatasetPermissionIntegrationFactory.create_account_in_tenant(
            db_session_with_containers,
            tenant,
            role=TenantAccountRole.EDITOR,
        )
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_operator_permission(user=operator, dataset=dataset)

    def test_check_dataset_operator_permission_rejects_partial_team_without_binding(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        operator = DatasetPermissionIntegrationFactory.create_account_in_tenant(
            db_session_with_containers,
            tenant,
            role=TenantAccountRole.EDITOR,
        )
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_operator_permission(user=operator, dataset=dataset)

    def test_check_dataset_operator_permission_allows_partial_team_with_binding(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        operator = DatasetPermissionIntegrationFactory.create_account_in_tenant(
            db_session_with_containers,
            tenant,
            role=TenantAccountRole.EDITOR,
        )
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=operator.id,
        )

        DatasetService.check_dataset_operator_permission(user=operator, dataset=dataset)

    def test_update_dataset_api_status_raises_not_found_for_missing_dataset(self, flask_app_with_containers: Flask):
        with flask_app_with_containers.app_context():
            with pytest.raises(NotFound, match="Dataset not found"):
                DatasetService.update_dataset_api_status(str(uuid4()), True)

    def test_update_dataset_api_status_requires_current_user_id(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            enable_api=False,
        )

        with patch("services.dataset_service.current_user", SimpleNamespace(id=None)):
            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.update_dataset_api_status(dataset.id, True)

    def test_update_dataset_api_status_updates_fields_and_commits(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            enable_api=False,
        )
        now = datetime(2026, 4, 14, 18, 0, 0)

        with (
            patch("services.dataset_service.current_user", owner),
            patch("services.dataset_service.naive_utc_now", return_value=now),
        ):
            DatasetService.update_dataset_api_status(dataset.id, True)

        db_session_with_containers.refresh(dataset)
        assert dataset.enable_api is True
        assert dataset.updated_by == owner.id
        assert dataset.updated_at == now

    def test_get_dataset_auto_disable_logs_returns_empty_when_billing_is_disabled(
        self, db_session_with_containers: Session
    ):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False, subscription=SimpleNamespace(plan="professional"))
        )

        with (
            patch("services.dataset_service.current_user", owner),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
        ):
            result = DatasetService.get_dataset_auto_disable_logs(str(uuid4()))

        assert result == {"document_ids": [], "count": 0}

    def test_get_dataset_auto_disable_logs_returns_recent_document_ids(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
        )
        DatasetPermissionIntegrationFactory.create_auto_disable_log(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=str(uuid4()),
        )
        DatasetPermissionIntegrationFactory.create_auto_disable_log(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=str(uuid4()),
        )
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=True, subscription=SimpleNamespace(plan="professional"))
        )

        with (
            patch("services.dataset_service.current_user", owner),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
        ):
            result = DatasetService.get_dataset_auto_disable_logs(dataset.id)

        assert result["count"] == 2
        assert len(result["document_ids"]) == 2


class TestDatasetCollectionBindingServiceIntegration:
    def test_get_dataset_collection_binding_returns_existing_binding(self, db_session_with_containers: Session):
        binding = DatasetPermissionIntegrationFactory.create_collection_binding(
            db_session_with_containers,
            provider_name="provider",
            model_name="model",
        )

        result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "model")

        assert result.id == binding.id

    def test_get_dataset_collection_binding_creates_binding_when_missing(self, db_session_with_containers: Session):
        result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "missing-model")

        persisted = db_session_with_containers.get(DatasetCollectionBinding, result.id)
        assert persisted is not None
        assert persisted.provider_name == "provider"
        assert persisted.model_name == "missing-model"
        assert persisted.type == "dataset"
        assert persisted.collection_name

    def test_get_dataset_collection_binding_by_id_and_type_raises_when_missing(self, flask_app_with_containers: Flask):
        with flask_app_with_containers.app_context():
            with pytest.raises(ValueError, match="Dataset collection binding not found"):
                DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(str(uuid4()))

    def test_get_dataset_collection_binding_by_id_and_type_returns_binding(self, db_session_with_containers: Session):
        binding = DatasetPermissionIntegrationFactory.create_collection_binding(
            db_session_with_containers,
            provider_name="provider",
            model_name="model",
        )

        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(binding.id)

        assert result.id == binding.id


class TestDatasetPermissionServiceIntegration:
    def test_get_dataset_partial_member_list_returns_scalar_results(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member_a = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        member_b = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=member_a.id,
        )
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=member_b.id,
        )

        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        assert set(result) == {member_a.id, member_b.id}

    def test_update_partial_member_list_replaces_permissions_and_commits(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member_a = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        member_b = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        stale_member = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=stale_member.id,
        )

        DatasetPermissionService.update_partial_member_list(
            tenant.id,
            dataset.id,
            [{"user_id": member_a.id}, {"user_id": member_b.id}],
        )

        permissions = db_session_with_containers.query(DatasetPermission).filter_by(dataset_id=dataset.id).all()
        assert {permission.account_id for permission in permissions} == {member_a.id, member_b.id}

    def test_check_permission_requires_dataset_editor(self):
        user = SimpleNamespace(is_dataset_editor=False, is_dataset_operator=False)
        dataset = SimpleNamespace(id="dataset-1", permission=DatasetPermissionEnum.ALL_TEAM)

        with pytest.raises(NoPermissionError, match="does not have permission"):
            DatasetPermissionService.check_permission(user, dataset, DatasetPermissionEnum.ALL_TEAM, [])

    def test_check_permission_prevents_dataset_operator_from_changing_permission_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = SimpleNamespace(id="dataset-1", permission=DatasetPermissionEnum.ALL_TEAM)

        with pytest.raises(NoPermissionError, match="cannot change the dataset permissions"):
            DatasetPermissionService.check_permission(user, dataset, DatasetPermissionEnum.ONLY_ME, [])

    def test_check_permission_requires_partial_member_list_for_partial_members_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = SimpleNamespace(id="dataset-1", permission=DatasetPermissionEnum.PARTIAL_TEAM)

        with pytest.raises(ValueError, match="Partial member list is required"):
            DatasetPermissionService.check_permission(user, dataset, DatasetPermissionEnum.PARTIAL_TEAM, [])

    def test_check_permission_rejects_dataset_operator_member_list_changes(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = SimpleNamespace(id="dataset-1", permission=DatasetPermissionEnum.PARTIAL_TEAM)

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            with pytest.raises(ValueError, match="cannot change the dataset permissions"):
                DatasetPermissionService.check_permission(
                    user,
                    dataset,
                    DatasetPermissionEnum.PARTIAL_TEAM,
                    [{"user_id": "user-2"}],
                )

    def test_check_permission_allows_dataset_operator_when_member_list_is_unchanged(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = SimpleNamespace(id="dataset-1", permission=DatasetPermissionEnum.PARTIAL_TEAM)

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            DatasetPermissionService.check_permission(
                user,
                dataset,
                DatasetPermissionEnum.PARTIAL_TEAM,
                [{"user_id": "user-1"}],
            )

    def test_clear_partial_member_list_deletes_permissions_and_commits(self, db_session_with_containers: Session):
        owner, tenant = DatasetPermissionIntegrationFactory.create_account_with_tenant(db_session_with_containers)
        member = DatasetPermissionIntegrationFactory.create_account_in_tenant(db_session_with_containers, tenant)
        dataset = DatasetPermissionIntegrationFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionIntegrationFactory.create_dataset_permission(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant.id,
            account_id=member.id,
        )

        DatasetPermissionService.clear_partial_member_list(dataset.id)

        remaining = db_session_with_containers.query(DatasetPermission).filter_by(dataset_id=dataset.id).all()
        assert remaining == []
