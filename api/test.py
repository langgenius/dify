from sqlalchemy import select
from sqlalchemy.orm import Session

from app_factory import create_app
from extensions.ext_database import db
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import Workflow
from services.async_workflow_service import AsyncWorkflowService
from services.workflow.entities import TriggerData

app = create_app()
celery = app.extensions["celery"]

with app.app_context():
    with Session(db.engine) as session:
        app_id = "be35877e-e15a-42fd-986c-382df10a1377"

        workflow = session.scalar(
            select(Workflow).where(Workflow.app_id == app_id).order_by(Workflow.created_at.desc()).limit(1)
        )

        if not workflow:
            raise ValueError("No workflow found")

        # Get tenant owner as the user
        tenant_owner = session.scalar(
            select(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(
                TenantAccountJoin.tenant_id == workflow.tenant_id,
                TenantAccountJoin.role == TenantAccountRole.OWNER,
            )
        )

        if not tenant_owner:
            raise ValueError("Tenant owner not found")

        AsyncWorkflowService.trigger_workflow_async(
            session,
            tenant_owner,
            TriggerData(
                app_id=app_id,
                workflow_id=workflow.id,
                root_node_id="1755948573244",
                trigger_type=WorkflowRunTriggeredFrom.WEBHOOK,
                inputs={"hello": "Elaina"},
                tenant_id=workflow.tenant_id,
            ),
        )
