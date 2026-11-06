"""Load detached execution inputs in short, owner-scoped transactions."""

from collections.abc import Sequence
from dataclasses import replace

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import WorkflowRun
from models.dataset import Pipeline
from models.human_input_contracts import PauseFormSnapshot
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from repositories.knowledge.dataset_read_repository import get_pipeline_dataset
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_snapshot
from services.errors.app import WorkflowNotFoundError
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.execution.ports import PipelineDatasetSnapshot


class WorkflowRuntimeContextRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def pause_forms(
        self, *, tenant_id: str, app_id: str, workflow_run_id: str, form_ids: Sequence[str]
    ) -> list[PauseFormSnapshot]:
        return HumanInputFormSubmissionRepository(sessions=self._sessions).pause_forms(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            form_ids=form_ids,
        )

    def pipeline_workflow(self, *, tenant_id: str, pipeline_id: str, draft: bool) -> WorkflowSnapshot:
        with self._sessions() as session:
            pipeline = session.scalar(
                select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id)
            )
            if pipeline is None:
                raise WorkflowNotFoundError("Pipeline not found")
            workflow = (
                WorkflowDefinitionStore.get_draft_workflow(pipeline, session=session)
                if draft
                else WorkflowDefinitionStore.get_published_workflow(pipeline, session=session)
            )
            if workflow is None:
                raise WorkflowNotFoundError("Workflow not initialized" if draft else "Workflow not published")
            return workflow_snapshot(workflow)

    def pipeline_dataset(self, *, tenant_id: str, pipeline_id: str) -> PipelineDatasetSnapshot:
        with self._sessions() as session:
            pipeline = session.scalar(
                select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id)
            )
            if pipeline is None:
                raise WorkflowNotFoundError("Pipeline not found")
            dataset = get_pipeline_dataset(pipeline, session=session)
            if dataset is None:
                raise WorkflowNotFoundError("Pipeline dataset not found")
            return PipelineDatasetSnapshot(
                id=dataset.id,
                tenant_id=dataset.tenant_id,
                name=dataset.name,
                description=dataset.description,
                chunk_structure=dataset.chunk_structure,
                built_in_field_enabled=dataset.built_in_field_enabled,
            )

    def restore_graph(self, workflow: WorkflowSnapshot, workflow_run_id: str | None) -> WorkflowSnapshot:
        if workflow_run_id is None:
            raise WorkflowNotFoundError("Workflow run id is required when resuming")
        with self._sessions() as session:
            graph = session.scalar(
                select(WorkflowRun.graph).where(
                    WorkflowRun.id == workflow_run_id,
                    WorkflowRun.tenant_id == workflow.tenant_id,
                    WorkflowRun.app_id == workflow.app_id,
                    WorkflowRun.workflow_id == workflow.id,
                )
            )
        if graph is None:
            raise WorkflowNotFoundError(f"Workflow run graph not found: {workflow_run_id}")
        return replace(workflow, graph=graph)

    def workflow(self, *, tenant_id: str, app_id: str, workflow_id: str) -> WorkflowSnapshot:
        with self._sessions() as session:
            # Use the common definition selection rule, including owner checks.
            workflow = WorkflowDefinitionStore.get_by_id(
                session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id
            )
            if workflow is None:
                raise WorkflowNotFoundError("Workflow not found")
            return workflow_snapshot(workflow)
