"""Testcontainers integration tests for WorkflowService.delete_workflow."""

import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError, WorkflowService


class TestWorkflowDeletion:
    def _create_tenant_and_account(self, session: Session) -> tuple[Tenant, Account]:
        tenant = Tenant(name=f"Tenant {uuid4()}")
        session.add(tenant)
        session.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"wf_del_{uuid4()}@example.com",
            password="hashed",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        session.add(account)
        session.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        session.add(join)
        session.flush()
        return tenant, account

    def _create_app(self, session: Session, *, tenant: Tenant, account: Account, workflow_id: str | None = None) -> App:
        app = App(
            tenant_id=tenant.id,
            name=f"App {uuid4()}",
            description="",
            mode="workflow",
            icon_type="emoji",
            icon="bot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
            api_rpm=100,
            api_rph=100,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=account.id,
            updated_by=account.id,
            workflow_id=workflow_id,
        )
        session.add(app)
        session.flush()
        return app

    def _create_workflow(
        self, session: Session, *, tenant: Tenant, app: App, account: Account, version: str = "1.0"
    ) -> Workflow:
        workflow = Workflow(
            id=str(uuid4()),
            tenant_id=tenant.id,
            app_id=app.id,
            type="workflow",
            version=version,
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        session.add(workflow)
        session.flush()
        return workflow

    def _create_tool_provider(
        self, session: Session, *, tenant: Tenant, app: App, account: Account, version: str
    ) -> WorkflowToolProvider:
        provider = WorkflowToolProvider(
            name=f"tool-{uuid4()}",
            label=f"Tool {uuid4()}",
            icon="wrench",
            app_id=app.id,
            version=version,
            user_id=account.id,
            tenant_id=tenant.id,
            description="test tool provider",
        )
        session.add(provider)
        session.flush()
        return provider

    def test_delete_workflow_success(self, db_session_with_containers):
        tenant, account = self._create_tenant_and_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, tenant=tenant, account=account)
        workflow = self._create_workflow(
            db_session_with_containers, tenant=tenant, app=app, account=account, version="1.0"
        )
        db_session_with_containers.commit()
        workflow_id = workflow.id

        service = WorkflowService(sessionmaker(bind=db.engine))
        result = service.delete_workflow(
            session=db_session_with_containers, workflow_id=workflow_id, tenant_id=tenant.id
        )

        assert result is True
        db_session_with_containers.expire_all()
        assert db_session_with_containers.get(Workflow, workflow_id) is None

    def test_delete_draft_workflow_raises_error(self, db_session_with_containers):
        tenant, account = self._create_tenant_and_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, tenant=tenant, account=account)
        workflow = self._create_workflow(
            db_session_with_containers, tenant=tenant, app=app, account=account, version="draft"
        )
        db_session_with_containers.commit()

        service = WorkflowService(sessionmaker(bind=db.engine))
        with pytest.raises(DraftWorkflowDeletionError):
            service.delete_workflow(session=db_session_with_containers, workflow_id=workflow.id, tenant_id=tenant.id)

    def test_delete_workflow_in_use_by_app_raises_error(self, db_session_with_containers):
        tenant, account = self._create_tenant_and_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, tenant=tenant, account=account)
        workflow = self._create_workflow(
            db_session_with_containers, tenant=tenant, app=app, account=account, version="1.0"
        )
        # Point app to this workflow
        app.workflow_id = workflow.id
        db_session_with_containers.commit()

        service = WorkflowService(sessionmaker(bind=db.engine))
        with pytest.raises(WorkflowInUseError, match="currently in use by app"):
            service.delete_workflow(session=db_session_with_containers, workflow_id=workflow.id, tenant_id=tenant.id)

    def test_delete_workflow_published_as_tool_raises_error(self, db_session_with_containers):
        tenant, account = self._create_tenant_and_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, tenant=tenant, account=account)
        workflow = self._create_workflow(
            db_session_with_containers, tenant=tenant, app=app, account=account, version="1.0"
        )
        self._create_tool_provider(db_session_with_containers, tenant=tenant, app=app, account=account, version="1.0")
        db_session_with_containers.commit()

        service = WorkflowService(sessionmaker(bind=db.engine))
        with pytest.raises(WorkflowInUseError, match="published as a tool"):
            service.delete_workflow(session=db_session_with_containers, workflow_id=workflow.id, tenant_id=tenant.id)
