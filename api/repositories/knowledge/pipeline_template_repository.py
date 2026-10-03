"""Owned read sessions and write transactions for pipeline templates."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate
from models.workflow import Workflow
from services.knowledge.pipeline_templates.application import (
    PipelineTemplateInput,
    PipelineTemplateNameConflictError,
    PipelineTemplateNotFoundError,
)


class PipelineTemplateRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @staticmethod
    def _template(session: Session, workspace_id: str, template_id: str) -> PipelineCustomizedTemplate:
        template = session.scalar(
            select(PipelineCustomizedTemplate).where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == workspace_id,
            )
        )
        if template is None:
            raise PipelineTemplateNotFoundError("Customized pipeline template not found.")
        return template

    @staticmethod
    def _check_name(session: Session, workspace_id: str, name: str, excluding_id: str | None = None) -> None:
        stmt = select(PipelineCustomizedTemplate.id).where(
            PipelineCustomizedTemplate.tenant_id == workspace_id,
            PipelineCustomizedTemplate.name == name,
        )
        if excluding_id is not None:
            stmt = stmt.where(PipelineCustomizedTemplate.id != excluding_id)
        if session.scalar(stmt.limit(1)) is not None:
            raise PipelineTemplateNameConflictError()

    def get_yaml(self, workspace_id: str, template_id: str) -> str:
        with self._session_factory() as session:
            return self._template(session, workspace_id, template_id).yaml_content

    def update(self, workspace_id: str, actor_id: str, template_id: str, template: PipelineTemplateInput) -> None:
        with self._session_factory.begin() as session:
            model = self._template(session, workspace_id, template_id)
            if template.name:
                self._check_name(session, workspace_id, template.name, excluding_id=template_id)
            model.name = template.name
            model.description = template.description
            model.icon = template.icon
            model.updated_by = actor_id

    def delete(self, workspace_id: str, template_id: str) -> None:
        with self._session_factory.begin() as session:
            session.delete(self._template(session, workspace_id, template_id))

    @staticmethod
    def _pipeline(session: Session, workspace_id: str, pipeline_id: str) -> Pipeline:
        pipeline = session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == workspace_id)
        )
        if pipeline is None:
            raise PipelineTemplateNotFoundError("Pipeline not found.")
        return pipeline

    def get_dataset_id(self, workspace_id: str, pipeline_id: str) -> str:
        with self._session_factory() as session:
            self._pipeline(session, workspace_id, pipeline_id)
            dataset_id = session.scalar(
                select(Dataset.id).where(Dataset.pipeline_id == pipeline_id, Dataset.tenant_id == workspace_id)
            )
            if dataset_id is None:
                raise PipelineTemplateNotFoundError("Dataset not found")
            return dataset_id

    def validate_publication(self, workspace_id: str, pipeline_id: str, name: str) -> str:
        with self._session_factory() as session:
            pipeline = self._pipeline(session, workspace_id, pipeline_id)
            if not pipeline.workflow_id:
                raise PipelineTemplateNotFoundError("Pipeline workflow not found")
            workflow_id = session.scalar(
                select(Workflow.id).where(
                    Workflow.id == pipeline.workflow_id,
                    Workflow.tenant_id == workspace_id,
                    Workflow.app_id == pipeline_id,
                )
            )
            if workflow_id is None:
                raise PipelineTemplateNotFoundError("Workflow not found")
            draft_id = session.scalar(
                select(Workflow.id).where(
                    Workflow.tenant_id == workspace_id,
                    Workflow.app_id == pipeline_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
            if draft_id is None:
                raise PipelineTemplateNotFoundError("Draft workflow not found")
            self._check_name(session, workspace_id, name)
            dataset = session.scalar(
                select(Dataset).where(Dataset.pipeline_id == pipeline_id, Dataset.tenant_id == workspace_id)
            )
            if dataset is None:
                raise PipelineTemplateNotFoundError("Dataset not found")
            return dataset.chunk_structure

    def create(
        self,
        workspace_id: str,
        actor_id: str,
        template: PipelineTemplateInput,
        *,
        yaml_content: str,
        chunk_structure: str,
    ) -> None:
        with self._session_factory.begin() as session:
            self._check_name(session, workspace_id, template.name)
            max_position = session.scalar(
                select(func.max(PipelineCustomizedTemplate.position)).where(
                    PipelineCustomizedTemplate.tenant_id == workspace_id
                )
            )
            session.add(
                PipelineCustomizedTemplate(
                    tenant_id=workspace_id,
                    name=template.name,
                    description=template.description,
                    icon=template.icon,
                    yaml_content=yaml_content,
                    chunk_structure=chunk_structure,
                    position=max_position + 1 if max_position else 1,
                    install_count=0,
                    language="en-US",
                    created_by=actor_id,
                )
            )
