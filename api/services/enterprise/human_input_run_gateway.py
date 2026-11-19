"""AppDeploy execution adapter; form and recipient state remains owned by Dify."""

import logging
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.form_repository import Form
from services.enterprise.base import EnterpriseRequest
from services.errors.enterprise import EnterpriseAPINotFoundError

logger = logging.getLogger(__name__)


class PauseState(BaseModel):
    state: Literal["paused", "running", "stopped", "finished"]
    has_checkpoint: bool


class EnterpriseHumanInputRunGateway:
    """Call E1–E3 without reading or writing a community WorkflowRun."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @staticmethod
    def _path(form: Form) -> str:
        """Require a runtime form and encode its persisted application/run IDs."""
        if form.workflow_run_id is None:
            raise ValueError("Enterprise form requires a workflow run")
        return (
            f"/app-deploy/apps/{quote(form.app_id, safe='')}"
            f"/workflow-runs/{quote(form.workflow_run_id, safe='')}"
        )

    def is_paused(self, form: Form, session: Session) -> bool:
        """Accept only a known paused run with a checkpoint; propagate dependency failures."""
        try:
            state = PauseState.model_validate(EnterpriseRequest.send_request("GET", self._path(form) + "/pause-state"))
        except EnterpriseAPINotFoundError:
            return False
        return state.state == "paused" and state.has_checkpoint

    def request_resume(self, form: Form) -> None:
        """Attempt the committed outbox effect; the periodic poller repairs any failure."""
        self._deliver(form, stop=False)

    def stop(self, form: Form, error: str) -> None:
        """Attempt stop after expiration commits, retaining failures for the poller."""
        self._deliver(form, stop=True)

    def _deliver(self, form: Form, *, stop: bool) -> None:
        """Clear only the acknowledged status; failures and process death retain pending work."""
        try:
            EnterpriseRequest.send_request(
                "POST",
                self._path(form) + (":stop" if stop else ":requestResume"),
                json={"error": "Human input form expired"} if stop else None,
            )
            with self._sessions() as session, session.begin():
                session.execute(
                    update(HumanInputForm)
                    .where(
                        HumanInputForm.id == form.id,
                        HumanInputForm.tenant_id == form.tenant_id,
                        HumanInputForm.app_id == form.app_id,
                        HumanInputForm.run_gateway == "enterprise",
                        HumanInputForm.status == form.status,
                    )
                    .values(run_effect_pending=False)
                )
        except Exception:
            logger.exception(
                "Enterprise HITL effect remains pending form_id=%s run_id=%s", form.id, form.workflow_run_id
            )


def drain_pending_run_effects(sessions: sessionmaker[Session]) -> None:
    """Retry every committed Enterprise effect until 2xx, independently of broker publication.

    Called only by the Enterprise-registered periodic task. Network requests run
    outside transactions; duplicates after a crash are safe under E2/E3's contract.
    """
    from core.human_input_v2.shared.values import TenantId
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository

    with sessions() as session:
        owners = session.execute(
            select(HumanInputForm.id, HumanInputForm.tenant_id, HumanInputForm.app_id).where(
                HumanInputForm.run_gateway == "enterprise",
                HumanInputForm.run_effect_pending.is_(True),
            )
        ).all()
    gateway = EnterpriseHumanInputRunGateway(sessions)
    for form_id, tenant_id, app_id in owners:
        with sessions() as session:
            form = SQLAlchemyFormRepository(session, TenantId(tenant_id), app_id).get_form_by_id(form_id)
        if form is not None:
            if form.status == HumanInputFormStatus.EXPIRED:
                gateway.stop(form, "Human input form expired")
            elif form.status in (HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT):
                gateway.request_resume(form)
