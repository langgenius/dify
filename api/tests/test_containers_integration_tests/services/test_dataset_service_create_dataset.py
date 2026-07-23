"""Testcontainers integration tests for DatasetService.create_empty_rag_pipeline_dataset."""

from __future__ import annotations

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountJoin
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity


class TestDatasetServiceCreateRagPipelineDataset:
    def _create_tenant_and_account(self, container_session) -> tuple[Tenant, Account]:
        tenant = Tenant(name=f"Tenant {uuid4()}")
        container_session.add(tenant)
        container_session.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"ds_create_{uuid4()}@example.com",
            password="hashed",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        container_session.add(account)
        container_session.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        container_session.add(join)
        container_session.commit()
        return tenant, account

    def _build_entity(self, name: str = "Test Dataset") -> RagPipelineDatasetCreateEntity:
        icon_info = IconInfo(icon="\U0001f4d9", icon_background="#FFF4ED", icon_type="emoji")
        return RagPipelineDatasetCreateEntity(
            name=name,
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

    def test_create_rag_pipeline_dataset_raises_when_current_user_id_is_none(self, container_session: Session):
        tenant, _ = self._create_tenant_and_account(container_session)

        mock_user = Mock(id=None)
        with patch("services.dataset_service.current_user", mock_user):
            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.create_empty_rag_pipeline_dataset(
                    tenant_id=tenant.id,
                    rag_pipeline_dataset_create_entity=self._build_entity(),
                    session=container_session,
                )
