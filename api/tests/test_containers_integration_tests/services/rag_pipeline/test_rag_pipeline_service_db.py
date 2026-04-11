"""
Integration tests for RagPipelineService methods that interact with the database.

Migrated from unit_tests/services/rag_pipeline/test_rag_pipeline_service.py, replacing
db.session.scalar/commit/delete mocker patches with real PostgreSQL operations.

Covers:
- get_pipeline: Dataset and Pipeline lookups
- update_customized_pipeline_template: find + unique-name check + commit
- delete_customized_pipeline_template: find + delete + commit
"""

from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate
from models.enums import DataSourceType
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, PipelineTemplateInfoEntity
from services.rag_pipeline.rag_pipeline import RagPipelineService


class TestRagPipelineServiceGetPipeline:
    """Integration tests for RagPipelineService.get_pipeline."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _make_service(self, flask_app_with_containers) -> RagPipelineService:
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
            return RagPipelineService(session_maker=session_factory)

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
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """get_pipeline raises ValueError when dataset does not exist."""
        service = self._make_service(flask_app_with_containers)

        with pytest.raises(ValueError, match="Dataset not found"):
            service.get_pipeline(tenant_id=str(uuid4()), dataset_id=str(uuid4()))

    def test_get_pipeline_raises_when_pipeline_not_found(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """get_pipeline raises ValueError when dataset exists but has no linked pipeline."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = self._create_dataset(db_session_with_containers, tenant_id, created_by, pipeline_id=None)
        db_session_with_containers.flush()

        service = self._make_service(flask_app_with_containers)

        with pytest.raises(ValueError, match="(Dataset not found|Pipeline not found)"):
            service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset.id)

    def test_get_pipeline_returns_pipeline_when_found(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """get_pipeline returns the Pipeline when both Dataset and Pipeline exist."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        pipeline = self._create_pipeline(db_session_with_containers, tenant_id, created_by)
        dataset = self._create_dataset(db_session_with_containers, tenant_id, created_by, pipeline_id=pipeline.id)
        db_session_with_containers.flush()

        service = self._make_service(flask_app_with_containers)

        result = service.get_pipeline(tenant_id=tenant_id, dataset_id=dataset.id)

        assert result.id == pipeline.id


class TestUpdateCustomizedPipelineTemplate:
    """Integration tests for RagPipelineService.update_customized_pipeline_template."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_template(
        self, db_session: Session, tenant_id: str, created_by: str, name: str = "Template"
    ) -> PipelineCustomizedTemplate:
        template = PipelineCustomizedTemplate(
            tenant_id=tenant_id,
            name=name,
            description="Original description",
            chunk_structure="fixed_size",
            icon={"type": "emoji", "value": "📄"},
            position=1,
            yaml_content="{}",
            install_count=0,
            language="en-US",
            created_by=created_by,
        )
        db_session.add(template)
        db_session.flush()
        return template

    def test_update_template_succeeds(self, db_session_with_containers: Session, flask_app_with_containers) -> None:
        """update_customized_pipeline_template updates name and description."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        template = self._create_template(db_session_with_containers, tenant_id, created_by)
        db_session_with_containers.flush()

        fake_user = SimpleNamespace(id=created_by, current_tenant_id=tenant_id)

        with patch("services.rag_pipeline.rag_pipeline.current_user", fake_user):
            info = PipelineTemplateInfoEntity(
                name="Updated Name",
                description="Updated description",
                icon_info=IconInfo(icon="🔥"),
            )
            result = RagPipelineService.update_customized_pipeline_template(template.id, info)

        assert result.name == "Updated Name"
        assert result.description == "Updated description"

    def test_update_template_raises_when_not_found(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """update_customized_pipeline_template raises ValueError when template doesn't exist."""
        fake_user = SimpleNamespace(id=str(uuid4()), current_tenant_id=str(uuid4()))

        with patch("services.rag_pipeline.rag_pipeline.current_user", fake_user):
            info = PipelineTemplateInfoEntity(
                name="New Name",
                description="desc",
                icon_info=IconInfo(icon="📄"),
            )
            with pytest.raises(ValueError, match="Customized pipeline template not found"):
                RagPipelineService.update_customized_pipeline_template(str(uuid4()), info)

    def test_update_template_raises_on_duplicate_name(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """update_customized_pipeline_template raises ValueError when new name already exists."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        template1 = self._create_template(db_session_with_containers, tenant_id, created_by, name="Original")
        self._create_template(db_session_with_containers, tenant_id, created_by, name="Duplicate")
        db_session_with_containers.flush()

        fake_user = SimpleNamespace(id=created_by, current_tenant_id=tenant_id)

        with patch("services.rag_pipeline.rag_pipeline.current_user", fake_user):
            info = PipelineTemplateInfoEntity(
                name="Duplicate",
                description="desc",
                icon_info=IconInfo(icon="📄"),
            )
            with pytest.raises(ValueError, match="Template name is already exists"):
                RagPipelineService.update_customized_pipeline_template(template1.id, info)


class TestDeleteCustomizedPipelineTemplate:
    """Integration tests for RagPipelineService.delete_customized_pipeline_template."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_template(self, db_session: Session, tenant_id: str, created_by: str) -> PipelineCustomizedTemplate:
        template = PipelineCustomizedTemplate(
            tenant_id=tenant_id,
            name=f"Template {uuid4()}",
            description="Description",
            chunk_structure="fixed_size",
            icon={"type": "emoji", "value": "📄"},
            position=1,
            yaml_content="{}",
            install_count=0,
            language="en-US",
            created_by=created_by,
        )
        db_session.add(template)
        db_session.flush()
        return template

    def test_delete_template_succeeds(self, db_session_with_containers: Session, flask_app_with_containers) -> None:
        """delete_customized_pipeline_template removes the template from the DB."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        template = self._create_template(db_session_with_containers, tenant_id, created_by)
        template_id = template.id
        db_session_with_containers.flush()

        fake_user = SimpleNamespace(id=created_by, current_tenant_id=tenant_id)

        with patch("services.rag_pipeline.rag_pipeline.current_user", fake_user):
            RagPipelineService.delete_customized_pipeline_template(template_id)

            # Verify the record is deleted within the same context
            from sqlalchemy import select

            from extensions.ext_database import db as ext_db

            remaining = ext_db.session.scalar(
                select(PipelineCustomizedTemplate).where(PipelineCustomizedTemplate.id == template_id)
            )
            assert remaining is None

    def test_delete_template_raises_when_not_found(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """delete_customized_pipeline_template raises ValueError when template doesn't exist."""
        fake_user = SimpleNamespace(id=str(uuid4()), current_tenant_id=str(uuid4()))

        with patch("services.rag_pipeline.rag_pipeline.current_user", fake_user):
            with pytest.raises(ValueError, match="Customized pipeline template not found"):
                RagPipelineService.delete_customized_pipeline_template(str(uuid4()))
