"""CI-only composed native execution: port through real worker, Graphon and SQL.

No generator/runner/factory/persistence replacement in the positive controls.
The package SSRF convenience stub is deliberately replaced with failing spies.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, DifyBuilderContext
from enums import WorkflowKind
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder import (
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.dify_builder.revision import execution_revision
from services.dify_builder.serde import context_to_dict

FIXTURES = Path(__file__).parents[4] / "fixtures/workflow/builder_restricted"


type NativeOwner = tuple[sessionmaker[Session], Actor, App, Workflow, str, str]


@pytest.fixture
def native_owner(flask_req_ctx_with_containers: None, db_session_with_containers: Session) -> Iterator[NativeOwner]:
    assert flask_req_ctx_with_containers is None  # Request context fixture is active.
    session = db_session_with_containers
    engine = db.engine
    assert session.get_bind() is engine
    assert engine.dialect.name == "postgresql"
    tenant = Tenant(name="Restricted native CI")
    account = Account(name="Native owner", email=f"{uuid4()}@example.invalid")
    session.add_all([tenant, account])
    session.flush()
    session.add(
        TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True)
    )
    app = App(
        tenant_id=tenant.id,
        name="Restricted native CI",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW,
        kind=WorkflowKind.STANDARD,
        version="draft",
        graph=json.dumps(yaml.safe_load((FIXTURES / "scalar.yml").read_text())),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=account.id,
    )
    builder_session = DifyBuilderSession(
        app_id=app.id,
        tenant_id=tenant.id,
        owner_account_id=account.id,
        entry_mode="build",
        current_state="build.await_testdata",
        version=1,
    )
    published = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW,
        kind=WorkflowKind.STANDARD,
        version="2026-10-09 00:00:00",
        graph=workflow.graph,
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=account.id,
    )
    session.add(published)
    session.flush()
    app.workflow_id = published.id
    published_id, published_graph = published.id, published.graph
    session.add_all([workflow, builder_session])
    session.flush()
    test_input = DifyBuilderTestInput(
        session_id=builder_session.id,
        source="user",
        inputs={"text": "native scalar"},
        start_schema_hash=schema_hash(start_schema(dict(workflow.graph_dict), app.mode)),
    )
    session.add(test_input)
    session.flush()
    # Task admission validates the same current commit production creates.
    # A standalone Session row is not an active Builder task authority.
    session.add(
        DifyBuilderSessionCommit(
            session_id=builder_session.id,
            version=builder_session.version,
            state=builder_session.current_state,
            context=context_to_dict(
                DifyBuilderContext(test_input_ref=test_input.id, last_snapshot_hash=execution_revision(workflow))
            ),
            actor=account.id,
        )
    )
    session.commit()
    yield (
        sessionmaker(bind=engine, expire_on_commit=False),
        Actor(account_id=account.id, tenant_id=tenant.id),
        app,
        workflow,
        builder_session.id,
        test_input.id,
    )

    session.expire_all()
    _loaded_app1 = session.get(App, app.id)
    assert _loaded_app1 is not None
    assert _loaded_app1.workflow_id == published_id
    _loaded_workflow2 = session.get(Workflow, published_id)
    assert _loaded_workflow2 is not None
    assert _loaded_workflow2.graph == published_graph
