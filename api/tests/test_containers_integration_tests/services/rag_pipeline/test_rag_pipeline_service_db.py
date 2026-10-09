"""
Integration tests for RagPipelineService methods that interact with the database.

Migrated from unit_tests/services/rag_pipeline/test_rag_pipeline_service.py, replacing
db.session.scalar/commit/delete mocker patches with real PostgreSQL operations.

Covers:
- get_pipeline: Dataset and Pipeline lookups
- PipelineTemplateRepository: owned transactions, tenant isolation and name conflicts
"""

from collections.abc import Generator
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate
from models.enums import DataSourceType
from repositories.knowledge.pipeline_template_repository import PipelineTemplateRepository
from services.knowledge.pipeline_templates.application import (
    PipelineTemplateInput,
    PipelineTemplateNameConflictError,
    PipelineTemplateNotFoundError,
)
from services.rag_pipeline.rag_pipeline import RagPipelineService


class TestRagPipelineServiceGetPipeline:
    """Integration tests for RagPipelineService.get_pipeline."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _make_service(
        self, flask_app_with_containers: Flask, db_session_with_containers: Session
    ) -> RagPipelineService:
        with (
            patch(
                "services.rag_pipeline.rag_pipeline.DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository",
                return_value=None,
            ),
            patch(
                "services.rag_pipeline.rag_pipeline.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
                return_value=None,
            ),
        ):
            session_factory = sessionmaker(bind=flask_app_with_containers.extensions["sqlalchemy"].engine)
            return RagPipelineService(db_session_with_containers, session_maker=session_factory)

    def _create_pipeline(self, db_session: Session, tenant_id: str, created_by: str) -> Pipeline:
        pipeline = Pipeline(
            tenant_id=tenant_id,
            name=f"Pipeline {uuid4()}",
            description="",
            created_by=created_by,
        )
        db_session.add(pipeline)
        db_session.flush()
        return pipeline

    def _create_dataset(
        self, db_session: Session, tenant_id: str, created_by: str, pipeline_id: str | None = None
    ) -> Dataset:
        dataset = Dataset(
            tenant_id=tenant_id,
            name=f"Dataset {uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
            pipeline_id=pipeline_id,
        )
        db_session.add(dataset)
        db_session.flush()
        return dataset

    def test_get_pipeline_raises_when_dataset_not_found(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ) -> None:
        """get_pipeline raises ValueError when dataset does not exist."""
        service = self._make_service(flask_app_with_containers, db_session_with_containers)

        with pytest.raises(ValueError, match="Dataset not found"):
            service.get_pipeline(tenant_id=str(uuid4()), dataset_id=str(uuid4()))

    def test_get_pipeline_raises_when_pipeline_not_found(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ) -> None:
        """get_pipeline raises ValueError when dataset exists but has no linked pipeline."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = self._create_dataset(db_session_with_containers, tenant_id, created_by, pipeline_id=None)
        db_session_with_containers.flush()

        service = self._make_service(flask_app_with_containers, db_session_with_containers)

        with pytest.raises(ValueError, match="Pipeline not found"):
            service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset.id)

    def test_get_pipeline_returns_pipeline_when_found(
        self, db_session_with_containers: Session, flask_app_with_containers: Flask
    ) -> None:
        """get_pipeline returns the Pipeline when both Dataset and Pipeline exist."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        pipeline = self._create_pipeline(db_session_with_containers, tenant_id, created_by)
        dataset = self._create_dataset(db_session_with_containers, tenant_id, created_by, pipeline_id=pipeline.id)
        db_session_with_containers.flush()

        service = self._make_service(flask_app_with_containers, db_session_with_containers)

        result = service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset.id)

        assert result.id == pipeline.id


class TestPipelineTemplateRepository:
    """Exercise the owned repository transactions on PostgreSQL."""

    @pytest.fixture
    def repository(self, db_session_with_containers: Session) -> PipelineTemplateRepository:
        # Join the test's connection so repository commits release their savepoint
        # without committing unrelated fixture state.
        factory = sessionmaker(
            bind=db_session_with_containers.connection(),
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        return PipelineTemplateRepository(factory)

    def test_lifecycle_and_tenant_isolation(
        self,
        repository: PipelineTemplateRepository,
        db_session_with_containers: Session,
    ) -> None:
        tenant_id, actor_id = str(uuid4()), str(uuid4())
        info = PipelineTemplateInput("Template", "Description", {"icon": "book"})
        repository.create(tenant_id, actor_id, info, yaml_content="workflow: {}", chunk_structure="paragraph")
        template = db_session_with_containers.query(PipelineCustomizedTemplate).filter_by(tenant_id=tenant_id).one()
        assert repository.get_yaml(tenant_id, template.id) == "workflow: {}"

        other_tenant = str(uuid4())
        with pytest.raises(PipelineTemplateNotFoundError):
            repository.get_yaml(other_tenant, template.id)
        with pytest.raises(PipelineTemplateNotFoundError):
            repository.update(other_tenant, actor_id, template.id, info)
        with pytest.raises(PipelineTemplateNotFoundError):
            repository.delete(other_tenant, template.id)

        repository.update(tenant_id, actor_id, template.id, PipelineTemplateInput("Updated", "Changed", {}))
        db_session_with_containers.refresh(template)
        assert (template.name, template.description, template.updated_by) == ("Updated", "Changed", actor_id)
        repository.delete(tenant_id, template.id)
        with pytest.raises(PipelineTemplateNotFoundError):
            repository.get_yaml(tenant_id, template.id)

    def test_duplicate_name_rolls_back_update(
        self,
        repository: PipelineTemplateRepository,
        db_session_with_containers: Session,
    ) -> None:
        tenant_id, actor_id = str(uuid4()), str(uuid4())
        for name in ("First", "Second"):
            repository.create(
                tenant_id,
                actor_id,
                PipelineTemplateInput(name, "Original", {}),
                yaml_content="workflow: {}",
                chunk_structure="paragraph",
            )
        second = (
            db_session_with_containers.query(PipelineCustomizedTemplate)
            .filter_by(tenant_id=tenant_id, name="Second")
            .one()
        )
        with pytest.raises(PipelineTemplateNameConflictError):
            repository.update(tenant_id, actor_id, second.id, PipelineTemplateInput("First", "Changed", {}))
        db_session_with_containers.refresh(second)
        assert (second.name, second.description) == ("Second", "Original")

    @pytest.mark.parametrize("operation", ["update", "delete"])
    def test_missing_template(
        self,
        repository: PipelineTemplateRepository,
        operation: str,
    ) -> None:
        if operation == "update":
            with pytest.raises(PipelineTemplateNotFoundError, match="Customized pipeline template not found"):
                repository.update(str(uuid4()), str(uuid4()), str(uuid4()), PipelineTemplateInput("Name", "", {}))
        else:
            with pytest.raises(PipelineTemplateNotFoundError, match="Customized pipeline template not found"):
                repository.delete(str(uuid4()), str(uuid4()))
