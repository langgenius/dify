"""Load detached execution inputs in short, owner-scoped transactions."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.attributes import set_committed_value

from models import Workflow, WorkflowRun
from models.dataset import Dataset, Pipeline
from models.human_input_contracts import PauseFormSnapshot
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from repositories.knowledge.dataset_read_repository import get_pipeline_dataset
from repositories.workflow.definition_repository import WorkflowDefinitionStore
from services.errors.app import WorkflowNotFoundError


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

    def pipeline_workflow(self, *, tenant_id: str, pipeline_id: str, draft: bool) -> Workflow:
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
            session.expunge(workflow)
            return workflow

    def pipeline_dataset(self, *, tenant_id: str, pipeline_id: str) -> Dataset:
        with self._sessions() as session:
            pipeline = session.scalar(
                select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id)
            )
            if pipeline is None:
                raise WorkflowNotFoundError("Pipeline not found")
            dataset = get_pipeline_dataset(pipeline, session=session)
            if dataset is None:
                raise WorkflowNotFoundError("Pipeline dataset not found")
            session.expunge(dataset)
            return dataset

    def restore_graph(self, workflow: Workflow, workflow_run_id: str | None) -> None:
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
        set_committed_value(workflow, "graph", graph)

    def workflow(self, *, tenant_id: str, app_id: str, workflow_id: str) -> Workflow:
        with self._sessions() as session:
            # Use the common definition selection rule, including owner checks.
            workflow = WorkflowDefinitionStore.get_by_id(
                session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id
            )
            if workflow is None:
                raise WorkflowNotFoundError("Workflow not found")
            session.expunge(workflow)
            return workflow
