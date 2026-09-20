"""Shared builders for the adjacent test modules."""

import json
from datetime import datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session

from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import (
    Authorization,
    AuthorizationConfig,
    ExternalKnowledgeApiSetting,
)


class ExternalDatasetServiceTestDataFactory:
    """Build non-session value objects used by tests outside persistence paths."""

    @staticmethod
    def create_external_knowledge_api_mock(
        api_id: str = "api-123",
        tenant_id: str = "tenant-123",
        name: str = "Test API",
        settings: dict[str, Any] | None = None,
        description: str = "Test description",
        created_by: str = "user-123",
        updated_by: str = "user-123",
        created_at: datetime = datetime(2024, 1, 1, 12, 0),
        updated_at: datetime = datetime(2024, 1, 1, 12, 0),
    ) -> ExternalKnowledgeApis:
        """Create an ExternalKnowledgeApis object."""
        api = ExternalKnowledgeApis(
            name=name,
            description=description,
            tenant_id=tenant_id,
            settings="{}",
            created_by=created_by,
            updated_by=updated_by,
        )
        api.id = api_id

        if settings is None:
            settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        api.settings = json.dumps(settings, ensure_ascii=False)
        api.created_at = created_at
        api.updated_at = updated_at

        return api

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Dataset",
        provider: str = "external",
        description: str = "",
        retrieval_model: dict[str, Any] | None = None,
        created_by: str = "user-123",
    ) -> Dataset:
        """Create a Dataset object."""
        return Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name=name,
            provider=provider,
            description=description,
            retrieval_model=retrieval_model or {},
            created_by=created_by,
        )

    @staticmethod
    def create_external_knowledge_binding_mock(
        binding_id: str = "binding-123",
        tenant_id: str = "tenant-123",
        dataset_id: str = "dataset-123",
        external_knowledge_api_id: str = "api-123",
        external_knowledge_id: str = "knowledge-123",
        created_by: str = "user-123",
    ) -> ExternalKnowledgeBindings:
        """Create an ExternalKnowledgeBindings object."""
        binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            external_knowledge_api_id=external_knowledge_api_id,
            dataset_id=dataset_id,
            external_knowledge_id=external_knowledge_id,
            created_by=created_by,
        )
        binding.id = binding_id

        return binding

    @staticmethod
    def create_authorization_mock(
        auth_type: str = "api-key",
        api_key: str = "test-key",
        header: str = "Authorization",
        token_type: str = "bearer",
    ) -> Authorization:
        """Create an Authorization object."""
        config = AuthorizationConfig(api_key=api_key, type=token_type, header=header)
        return Authorization(type=auth_type, config=config)

    @staticmethod
    def create_api_setting_mock(
        url: str = "https://api.example.com/retrieval",
        request_method: str = "post",
        headers: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> ExternalKnowledgeApiSetting:
        """Create an ExternalKnowledgeApiSetting object."""
        if headers is None:
            headers = {"Content-Type": "application/json"}
        if params is None:
            params = {}

        return ExternalKnowledgeApiSetting(url=url, request_method=request_method, headers=headers, params=params)


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return ExternalDatasetServiceTestDataFactory()


def _make_external_knowledge_api(
    *,
    api_id: str = "api-123",
    tenant_id: str = "tenant-123",
    name: str = "Test API",
    description: str = "Test description",
    settings: dict[str, Any] | list[dict[str, Any]] | None = None,
    created_by: str = "user-123",
    updated_by: str = "user-123",
) -> ExternalKnowledgeApis:
    """Build a real ExternalKnowledgeApis row for SQLite-backed service tests."""
    if settings is None:
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}
    api = ExternalKnowledgeApis(
        tenant_id=tenant_id,
        created_by=created_by,
        updated_by=updated_by,
        name=name,
        description=description,
        settings=json.dumps(settings, ensure_ascii=False),
    )
    api.id = api_id
    return api


def _make_dataset(
    *,
    dataset_id: str = "dataset-123",
    tenant_id: str = "tenant-123",
    name: str = "Test Dataset",
    provider: str = "external",
    description: str = "",
    retrieval_model: dict[str, Any] | None = None,
    created_by: str = "user-123",
) -> Dataset:
    """Build a real Dataset row with the fields required by ExternalDatasetService."""
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        provider=provider,
        retrieval_model=retrieval_model or {},
        created_by=created_by,
        maintainer=created_by,
    )
    return dataset


def _make_external_knowledge_binding(
    *,
    binding_id: str = "binding-123",
    tenant_id: str = "tenant-123",
    dataset_id: str = "dataset-123",
    external_knowledge_api_id: str = "api-123",
    external_knowledge_id: str = "knowledge-123",
    created_by: str = "user-123",
) -> ExternalKnowledgeBindings:
    """Build a real ExternalKnowledgeBindings row for tenant-scoped lookup tests."""
    binding = ExternalKnowledgeBindings(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        external_knowledge_api_id=external_knowledge_api_id,
        external_knowledge_id=external_knowledge_id,
        created_by=created_by,
    )
    binding.id = binding_id
    return binding


def _add_and_commit(session: Session, *objects: object) -> None:
    """Persist rows so service methods exercise real SQLAlchemy queries."""
    session.add_all(objects)
    session.commit()


def _seed_external_retrieval_dependencies(
    session: Session,
    *,
    tenant_id: str = "tenant-123",
    dataset_id: str = "dataset-123",
    api_id: str = "api-123",
) -> tuple[ExternalKnowledgeBindings, ExternalKnowledgeApis]:
    """Seed the binding and API template required by fetch_external_knowledge_retrieval."""
    binding = _make_external_knowledge_binding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        external_knowledge_api_id=api_id,
    )
    api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id)
    _add_and_commit(session, binding, api)
    return binding, api
