"""Run ownership port: forms never infer Enterprise execution from a missing Dify run."""

from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.form_repository import Form


class HumanInputRunGateway(Protocol):
    """Authorize a persisted pause, publish resume, and stop an owned execution."""

    def is_paused(self, form: Form, session: Session) -> bool: ...

    def request_resume(self, form: Form) -> None: ...

    def stop(self, form: Form, error: str) -> None: ...


class DifyHumanInputRunGateway:
    """Preserve the community run-before-form lock and active-checkpoint check."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def is_paused(self, form: Form, session: Session) -> bool:
        """Lock the owner-scoped run; accept only its committed active checkpoint."""
        if form.workflow_run_id is None:
            return True
        repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
        run = repository.get_workflow_run_by_id_for_update(
            session, tenant_id=form.tenant_id, app_id=form.app_id, run_id=form.workflow_run_id
        )
        return (
            run is not None
            and run.status == WorkflowExecutionStatus.PAUSED
            and repository.has_active_workflow_pause(
                session, tenant_id=form.tenant_id, app_id=form.app_id, run_id=run.id
            )
        )

    def request_resume(self, form: Form) -> None:
        """Publish the existing community resume task after the form commit."""
        if form.workflow_run_id is not None:
            from tasks.app_generate.workflow_execute_task import resume_app_execution

            resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": form.workflow_run_id}})

    def stop(self, form: Form, error: str) -> None:
        """Stop the owner-scoped community execution in one short transaction."""
        if form.workflow_run_id is not None:
            repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
            with self._sessions() as session, session.begin():
                run = repository.get_workflow_run_by_id_for_update(
                    session, tenant_id=form.tenant_id, app_id=form.app_id, run_id=form.workflow_run_id
                )
                if run is not None and run.status in (WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED):
                    repository.stop_workflow_run(session, run=run, error=error, finished_at=naive_utc_now())


def build_run_gateway(form: Form, sessions: sessionmaker[Session]) -> HumanInputRunGateway:
    """Select only persisted ownership; Enterprise adapters register only in Enterprise."""
    if form.run_gateway == "enterprise":
        from configs import dify_config
        from enums import DeploymentEdition

        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            raise ValueError("Enterprise Human Input run gateway is unavailable")
        from services.enterprise.human_input_run_gateway import EnterpriseHumanInputRunGateway

        return EnterpriseHumanInputRunGateway(sessions)
    return DifyHumanInputRunGateway(sessions)
