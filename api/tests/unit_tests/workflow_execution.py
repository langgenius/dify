"""Real execution records for tests that exercise workflow persistence."""

from dataclasses import replace
from datetime import datetime

from sqlalchemy.orm import Session

from enums.agent import WorkflowAgentBindingType
from models.agent import WORKFLOW_EXECUTION_BINDING_VERSION, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.human_input_contracts import HumanInputFormRecord
from models.workflow import WorkflowRun
from repositories.workflow.execution_write_repository import DebugLease, read_debug_lease, write_debug_lease


def execution_binding(*, workflow_run_id: str, tenant_id: str, app_id: str, agent_id: str) -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_run_id,
        workflow_version=WORKFLOW_EXECUTION_BINDING_VERSION,
        node_id=agent_id,
        agent_id=agent_id,
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        node_job_config=WorkflowNodeJobConfig(),
    )


def debug_lease(session: Session, execution_id: str) -> DebugLease | None:
    run = session.get(WorkflowRun, execution_id)
    return read_debug_lease(session, run) if run is not None else None


def set_debug_deadline(session: Session, execution_id: str, expires_at: datetime) -> None:
    run = session.get(WorkflowRun, execution_id)
    assert run is not None
    lease = read_debug_lease(session, run)
    write_debug_lease(
        session, run, replace(lease, expires_at=expires_at) if lease is not None else DebugLease(expires_at)
    )


class NoHumanInputForms:
    """Graphs without timed-out forms must never perform a form lookup."""

    def get_by_form_id(self, form_id: str) -> HumanInputFormRecord | None:
        raise AssertionError(f"Unexpected human input form lookup: {form_id}")


NO_HUMAN_INPUT_FORMS = NoHumanInputForms()
