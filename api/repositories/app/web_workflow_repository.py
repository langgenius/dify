"""Read the owner-scoped models required to dispatch a WebApp workflow."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import WebAppRequestContext
from models.model import App, EndUser
from models.workflow import Workflow
from services.app.web_workflow_service import WebWorkflowQuery
from services.workflow.run_entities import WebWorkflowTarget


class WebWorkflowRepository(WebWorkflowQuery[App, EndUser, Workflow]):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_app_and_user(self, context: WebAppRequestContext) -> WebWorkflowTarget[App, EndUser] | None:
        with self._session_factory() as session:
            row = session.execute(
                select(App, EndUser)
                .join(EndUser, EndUser.app_id == App.id)
                .where(
                    App.id == context.app_id,
                    App.tenant_id == context.tenant_id,
                    App.enable_site.is_(True),
                    EndUser.id == context.end_user_id,
                    EndUser.tenant_id == context.tenant_id,
                )
            ).one_or_none()
            if row is None:
                return None
            app, user = row
            return WebWorkflowTarget(app=app, user=user, mode=app.mode, workflow_id=app.workflow_id)

    @override
    def get_workflow(self, *, tenant_id: str, app_id: str, workflow_id: str | None) -> Workflow | None:
        if workflow_id is None:
            return None
        with self._session_factory() as session:
            return session.scalar(
                select(Workflow).where(
                    Workflow.id == workflow_id,
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == app_id,
                )
            )
