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
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, DifyBuilderContext
from enums import WorkflowKind
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowRun, WorkflowType
from runtime_contracts.builder.execution import WorkflowExecutionTransport
from services.dify_builder.application.execution_policy import (
    HttpResponseFixtureV1,
)
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
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


@pytest.fixture
def no_live(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from contextlib import ExitStack
    from unittest.mock import patch

    from core.helper import ssrf_proxy
    from core.helper.code_executor.code_executor import CodeExecutor
    from core.model_manager import ModelManager
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from factories import file_factory

    # The spawned SQL-race owner enters this fixture with its own MonkeyPatch.
    # Keep that explicit invocation contract while method patches own their cleanup.
    assert isinstance(monkeypatch, pytest.MonkeyPatch)
    spies = []
    with ExitStack() as methods:
        for owner, name in [
            *((ssrf_proxy, n) for n in ("get", "post", "put", "patch", "delete", "head")),
            (CodeExecutor, "execute_code"),
            (ModelManager, "get_model_instance"),
            (OAuthHandler, "refresh_credentials"),
            (ToolManager, "get_workflow_tool_runtime"),
            (file_factory, "build_from_mapping"),
        ]:
            spy = methods.enter_context(
                patch.object(owner, name, side_effect=AssertionError(f"live capability reached: {name}"))
            )
            spies.append(spy)
        yield
        for spy in spies:
            spy.assert_not_called()


def configure(owner: NativeOwner, name: str, *, fixture: bool = False) -> dict[str, str]:
    factory, actor, app, workflow, sid, tid = owner
    graph = yaml.safe_load((FIXTURES / name).read_text())
    inputs = {"text": "native scalar"} if name == "scalar.yml" else {"path": "sample"}
    graph_json = json.dumps(graph)
    with factory.begin() as session:
        _loaded_workflow3 = session.get(Workflow, workflow.id)
        assert _loaded_workflow3 is not None
        _loaded_workflow3.graph = graph_json
        _loaded_dify_builder_test_input4 = session.get(DifyBuilderTestInput, tid)
        assert _loaded_dify_builder_test_input4 is not None
        _loaded_dify_builder_test_input4.inputs = inputs
    if fixture:
        # Stamping rereads the draft in its own session, so commit the graph first.
        with factory() as session:
            _loaded_workflow13 = session.get(Workflow, workflow.id)
            assert _loaded_workflow13 is not None
            committed_revision = execution_revision(_loaded_workflow13)
        envelope = BuilderExecutionPolicyService(factory).stamp_http_fixtures(
            app.id,
            actor,
            base_app_revision=committed_revision,
            fixtures=(
                HttpResponseFixtureV1(
                    node_id="http",
                    source="user_sample",
                    status_code=200,
                    content_type="text/plain",
                    body="native fixture ✓",
                ),
            ),
        )
        with factory.begin() as session:
            _loaded_dify_builder_test_input14 = session.get(DifyBuilderTestInput, tid)
            assert _loaded_dify_builder_test_input14 is not None
            _loaded_dify_builder_test_input14.http_fixtures = envelope.model_dump(mode="json")
    return inputs


@pytest.mark.usefixtures("no_live")
def test_ordinary_native_scalar_execution_remains_ordinary(native_owner: NativeOwner) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from services.app_generate_service import AppGenerateService
    from services.dify_builder.run_mapping import run_id_from_stream_chunk, stream_chunk_as_mapping

    factory, actor, app, workflow, sid, tid = native_owner
    with factory() as session:
        account = session.get(Account, actor.account_id)
        assert account is not None
        native_app = session.get(App, app.id)
        assert native_app is not None
        response = AppGenerateService.generate(
            native_app,
            account,
            {"inputs": {"text": "ordinary"}},
            InvokeFrom.DEBUGGER,
            session=session,
            streaming=True,
            workflow_execution_mode=WorkflowExecutionTransport.IN_PROCESS,
        )
    native_id = ""
    try:
        for chunk in response:
            payload = stream_chunk_as_mapping(chunk)
            if payload:
                native_id = native_id or run_id_from_stream_chunk(payload)
    finally:
        response.close()
    with factory() as session:
        native = session.get(WorkflowRun, native_id)
        assert native is not None
        assert str(native.status) == "succeeded"
        assert native.outputs_dict == {"out": "ordinary"}
        assert session.scalars(select(DifyBuilderExecutionRequest)).first() is None
