"""Console variable use cases own admission scope and release reads before file I/O."""

from collections.abc import Callable, Iterator
from functools import partial
from typing import Literal, NoReturn
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.db import session_factory
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from extensions.ext_database import db
from graphon.variables import IntegerVariable, SegmentType, StringSegment, StringVariable
from machinery.context import RequestContext
from models.dataset import Pipeline
from models.model import App, AppMode
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowKind
from services.workflow.console_variable_service import ConsoleWorkflowVariableService
from services.workflow.contracts import DraftWorkflowMissingError, WorkflowOwner
from services.workflow.variable_contracts import (
    DraftVariableNotFoundError,
    DraftVariableOwnerNotFoundError,
    InvalidDraftVariableError,
)
from tests.unit_tests.model_factories import make_account, make_app, make_upload_file, make_workflow

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")
type ConsoleVariableScope = tuple[ConsoleWorkflowVariableService, WorkflowOwner, str, list[Session]]


@pytest.fixture(autouse=True)
def _provide_app_context() -> None:
    """The application use case has no Flask dependency."""


@pytest.fixture(params=["app", "pipeline", "snippet"])
def scope(
    request: pytest.FixtureRequest,
    sqlite_session_factory: sessionmaker[Session],
    console_workflow_variables: ConsoleWorkflowVariableService,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[ConsoleVariableScope]:
    kind = request.param
    owner = WorkflowOwner(str(uuid4()), kind)
    with sqlite_session_factory.begin() as session:
        session.add(make_account())
        if kind == "app":
            session.add(make_app(app_id=owner.id, mode=AppMode.ADVANCED_CHAT))
        elif kind == "pipeline":
            row = Pipeline(tenant_id="tenant-1", name="Pipeline", description="", created_by="account-1")
            row.id = owner.id
            session.add(row)
        else:
            session.add(CustomizedSnippet(id=owner.id, tenant_id="tenant-1", name="Snippet"))
        workflow = make_workflow(
            app_id=owner.id,
            kind=WorkflowKind.SNIPPET if kind == "snippet" else WorkflowKind.STANDARD,
            environment_variables=[
                IntegerVariable(name="count", value=2),
                LLMEnvironmentVariable(name="model", value={"provider": "provider", "name": "model", "mode": "chat"}),
            ],
            conversation_variables=[StringVariable(name="topic", value="default")],
        )
        session.add(workflow)
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=owner.id,
            user_id="account-1",
            node_id="node",
            name="answer",
            value=StringSegment(value="before"),
            node_execution_id=str(uuid4()),
        )
        session.add(variable)
        session.flush()
        variable_id = variable.id
    opened: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        opened.append(session)

    def reject_global(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("Console variables accessed a global database")

    monkeypatch.setattr(db, "session", reject_global)
    monkeypatch.setattr(type(db), "engine", property(reject_global))
    monkeypatch.setattr(session_factory, "get_session_maker", reject_global)
    event.listen(sqlite_session_factory, "after_begin", track)
    yield console_workflow_variables, owner, variable_id, opened
    event.remove(sqlite_session_factory, "after_begin", track)


def test_variable_lifecycle_and_noop_patch(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, owner, variable_id, opened = scope
    assert service.list_variables(CONTEXT, owner, page=1, limit=20).total == 1
    original = service.get(CONTEXT, owner, variable_id)
    assert service.patch(CONTEXT, owner, variable_id, name=None, value=None) == original
    updated = service.patch(CONTEXT, owner, variable_id, name="renamed", value="after")
    assert updated.value is not None
    assert (updated.name, updated.value.value) == ("renamed", "after")
    assert service.node(CONTEXT, owner, "node").variables[0].id == variable_id
    assert all(not session.in_transaction() for session in opened)
    assert service.reset(CONTEXT, owner, variable_id) is None
    with sqlite_session_factory() as session:
        assert session.get(WorkflowDraftVariable, variable_id) is None


@pytest.mark.parametrize("operation", ["get", "patch", "delete", "reset"])
@pytest.mark.parametrize("mismatch", ["tenant", "account", "owner"])
def test_every_single_variable_operation_enforces_ownership(
    scope: ConsoleVariableScope,
    operation: Literal["get", "patch", "delete", "reset"],
    mismatch: Literal["tenant", "account", "owner"],
) -> None:
    service, owner, variable_id, _ = scope
    context = CONTEXT
    if mismatch == "tenant":
        context = CONTEXT._replace(active_workspace_id="foreign")
    elif mismatch == "account":
        context = CONTEXT._replace(account_id="foreign")
    else:
        owner = WorkflowOwner(str(uuid4()), owner.kind)
    actions: dict[str, Callable[[RequestContext, WorkflowOwner, str], object]] = {
        "get": service.get,
        "patch": partial(service.patch, name=None, value="blocked"),
        "delete": service.delete,
        "reset": service.reset,
    }
    action = actions[operation]
    with pytest.raises(DraftVariableNotFoundError if mismatch == "account" else DraftVariableOwnerNotFoundError):
        action(context, owner, variable_id)


@pytest.mark.parametrize("node_id", ["sys", "conversation"])
def test_node_endpoint_rejects_reserved_selectors(scope: ConsoleVariableScope, node_id: str) -> None:
    service, owner, _, _ = scope
    with pytest.raises(InvalidDraftVariableError):
        service.node(CONTEXT, owner, node_id)
    with pytest.raises(InvalidDraftVariableError):
        service.delete_node(CONTEXT, owner, node_id)


def test_delete_collections_preserves_other_users_and_nodes(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, owner, variable_id, _ = scope
    with sqlite_session_factory.begin() as session:
        other = WorkflowDraftVariable.new_node_variable(
            app_id=owner.id,
            user_id="other",
            node_id="node",
            name="other",
            value=StringSegment(value="other"),
            node_execution_id=str(uuid4()),
        )
        sibling = WorkflowDraftVariable.new_node_variable(
            app_id=owner.id,
            user_id="account-1",
            node_id="sibling",
            name="sibling",
            value=StringSegment(value="sibling"),
            node_execution_id=str(uuid4()),
        )
        session.add_all([other, sibling])
        session.flush()
    service.delete_node(CONTEXT, owner, "node")
    with sqlite_session_factory() as session:
        assert set(session.scalars(select(WorkflowDraftVariable.id))) == {other.id, sibling.id}
    service.delete_all(CONTEXT, owner)
    with sqlite_session_factory() as session:
        assert set(session.scalars(select(WorkflowDraftVariable.id))) == {other.id}


def test_environment_and_conversation_rules(scope: ConsoleVariableScope) -> None:
    service, owner, _, _ = scope
    environment = service.environment(CONTEXT, owner)
    assert {value["value_type"] for value in environment} == (
        {"integer", "llm"} if owner.kind == "pipeline" else {"number", "llm"}
    )
    assert all(value["editable"] and not value["edited"] for value in environment)
    conversations = service.conversation(CONTEXT, owner).variables
    conversation_values: list[object] = []
    for variable in conversations:
        assert variable.value is not None
        conversation_values.append(variable.value.value)
    assert conversation_values == ([] if owner.kind == "snippet" else ["default"])


@pytest.mark.parametrize("scope", ["snippet"], indirect=True)
@pytest.mark.parametrize("node_id", ["sys", "conversation"])
def test_snippet_hides_special_rows(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session], node_id: str
) -> None:
    service, owner, variable_id, _ = scope
    with sqlite_session_factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, variable_id)
        assert variable is not None
        variable.node_id = node_id
    assert service.list_variables(CONTEXT, owner, page=1, limit=20).total == 0
    assert service.system(CONTEXT, owner).variables == []
    for action in [service.get, service.delete, service.reset]:
        with pytest.raises(DraftVariableNotFoundError):
            action(CONTEXT, owner, variable_id)
    with pytest.raises(DraftVariableNotFoundError):
        service.patch(CONTEXT, owner, variable_id, name=None, value="blocked")


def test_missing_draft_and_unsupported_app_mode(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, owner, variable_id, _ = scope
    with sqlite_session_factory.begin() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == owner.id))
        assert workflow is not None
        session.delete(workflow)
    with pytest.raises(DraftWorkflowMissingError):
        service.list_variables(CONTEXT, owner, page=1, limit=20)
    if owner.kind == "app":
        with sqlite_session_factory.begin() as session:
            app = session.get(App, owner.id)
            assert app is not None
            app.mode = AppMode.CHAT
        with pytest.raises(DraftVariableOwnerNotFoundError):
            service.get(CONTEXT, owner, variable_id)


@pytest.mark.parametrize("transfer", ["local_file", "remote_url"])
def test_file_patch_releases_database_and_uses_injected_factory(
    scope: ConsoleVariableScope,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    transfer: Literal["local_file", "remote_url"],
) -> None:
    service, owner, variable_id, opened = scope
    file_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, tenant_id="tenant-1", name="input.txt"))
        variable = session.get(WorkflowDraftVariable, variable_id)
        assert variable is not None
        variable.value_type = SegmentType.FILE

    def remote_info(url: str) -> tuple[str, str, int]:
        assert url == "https://example.com/remote.txt"
        assert all(not session.in_transaction() for session in opened)
        return "text/plain", "remote.txt", 10

    monkeypatch.setattr("factories.file_factory.builders.get_remote_file_info", remote_info)
    updated = service.patch(
        CONTEXT,
        owner,
        variable_id,
        name=None,
        value={
            "type": "document",
            "transfer_method": transfer,
            "upload_file_id": file_id if transfer == "local_file" else None,
            "url": "https://example.com/remote.txt",
        },
    )
    assert updated.value is not None
    assert updated.value.value.filename == ("input.txt" if transfer == "local_file" else "remote.txt")
    assert service.get(CONTEXT, owner, variable_id).value == updated.value
    assert service.node(CONTEXT, owner, "node").variables[0].value == updated.value
    assert all(not session.in_transaction() for session in opened)


@pytest.mark.parametrize(
    ("value_type", "value"),
    [
        (SegmentType.FILE, "invalid"),
        (SegmentType.ARRAY_FILE, {}),
        (SegmentType.ARRAY_FILE, [{}, "invalid"]),
    ],
)
def test_invalid_file_inputs_fail_before_file_lookup(
    scope: ConsoleVariableScope,
    sqlite_session_factory: sessionmaker[Session],
    value_type: SegmentType,
    value: object,
) -> None:
    service, owner, variable_id, _ = scope
    with sqlite_session_factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, variable_id)
        assert variable is not None
        variable.value_type = value_type
    with pytest.raises(InvalidDraftVariableError):
        service.patch(CONTEXT, owner, variable_id, name=None, value=value)


@pytest.mark.parametrize("scope", ["app"], indirect=True)
@pytest.mark.parametrize("operation", ["replace", "patch", "conversation"])
def test_definition_variable_updates_and_missing_draft(
    scope: ConsoleVariableScope,
    sqlite_session_factory: sessionmaker[Session],
    operation: Literal["replace", "patch", "conversation"],
) -> None:
    service, owner, _, opened = scope
    values = [StringVariable(id="env-b", name="b", value="new-b"), StringVariable(id="env-d", name="d", value="new-d")]
    mappings = [value.model_dump(mode="json") for value in values]
    with sqlite_session_factory.begin() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == owner.id))
        assert workflow is not None
        workflow.environment_variables = [
            StringVariable(id="env-" + name, name=name, value="old-" + name) for name in ["a", "b", "c"]
        ]

    def save() -> None:
        if operation == "conversation":
            service.update_conversation(CONTEXT, owner.id, mappings)
        else:
            service.update_environment(
                CONTEXT, owner.id, mappings, deleted_ids=["env-a"] if operation == "patch" else None
            )

    save()
    assert all(not session.in_transaction() for session in opened)
    with sqlite_session_factory.begin() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == owner.id))
        assert workflow is not None
        actual = workflow.conversation_variables if operation == "conversation" else workflow.environment_variables
        assert [(variable.id, variable.value) for variable in actual] == (
            [("env-b", "new-b"), ("env-c", "old-c"), ("env-d", "new-d")]
            if operation == "patch"
            else [("env-b", "new-b"), ("env-d", "new-d")]
        )
        assert workflow.updated_by == CONTEXT.account_id
        session.delete(workflow)
    with pytest.raises(DraftWorkflowMissingError):
        save()


@pytest.mark.parametrize("scope", ["app"], indirect=True)
def test_environment_patch_rejects_overlapping_mutations(scope: ConsoleVariableScope) -> None:
    service, owner, _, _ = scope
    with pytest.raises(ValueError, match="cannot be upserted and deleted"):
        service.update_environment(
            CONTEXT,
            owner.id,
            [{"id": "same", "name": "a", "value_type": "string", "value": "value"}],
            deleted_ids=["same"],
        )


@pytest.mark.parametrize("scope", ["app"], indirect=True)
def test_conversation_update_requires_chatflow(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, owner, _, _ = scope
    with sqlite_session_factory.begin() as session:
        app = session.get(App, owner.id)
        assert app is not None
        app.mode = AppMode.WORKFLOW
    with pytest.raises(DraftVariableOwnerNotFoundError):
        service.update_conversation(CONTEXT, owner.id, [])


@pytest.mark.parametrize("stored", [False, True])
def test_file_values_cannot_reference_another_tenants_upload(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session], stored: bool
) -> None:
    import json

    service, owner, variable_id, _ = scope
    file_id = str(uuid4())
    value = {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id, "tenant_id": "foreign"}
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, tenant_id="foreign"))
        variable = session.get(WorkflowDraftVariable, variable_id)
        assert variable is not None
        variable.value_type = SegmentType.FILE
        if stored:
            variable.value = json.dumps(value)
    action = (
        partial(service.get, CONTEXT, owner, variable_id)
        if stored
        else partial(service.patch, CONTEXT, owner, variable_id, name=None, value=value)
    )
    with pytest.raises(ValueError, match="Invalid upload file"):
        action()


def test_file_array_reset_resolves_canonical_metadata_without_global_database(
    scope: ConsoleVariableScope, sqlite_session_factory: sessionmaker[Session]
) -> None:
    import json

    from fields.workflow_draft_variable_fields import WorkflowDraftVariableResponse
    from graphon.enums import WorkflowNodeExecutionStatus
    from graphon.file.constants import FILE_MODEL_IDENTITY
    from models.enums import CreatorUserRole
    from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom

    service, owner, variable_id, opened = scope
    file_id = str(uuid4())
    historical = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "type": "document",
        "transfer_method": "local_file",
        "related_id": file_id,
        "tenant_id": "spoofed",
        "filename": "spoofed.txt",
    }
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, tenant_id="tenant-1", name="canonical.txt"))
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == owner.id))
        assert workflow is not None
        workflow.graph = json.dumps({"nodes": [{"id": "node", "data": {"type": "llm"}}], "edges": []})
        variable = session.get(WorkflowDraftVariable, variable_id)
        assert variable is not None
        variable.value_type = SegmentType.ARRAY_FILE
        variable.value = "[]"
        variable.node_execution_id = "execution"
        session.add(
            WorkflowNodeExecutionModel(
                id="execution",
                tenant_id=CONTEXT.active_workspace_id,
                app_id=owner.id,
                workflow_id=workflow.id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
                index=1,
                node_id="node",
                node_type="llm",
                title="LLM",
                outputs=json.dumps({"answer": [historical]}),
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=CONTEXT.account_id,
            )
        )
    restored = service.reset(CONTEXT, owner, variable_id)
    assert restored is not None
    response = WorkflowDraftVariableResponse.model_validate(restored).model_dump(mode="json")
    assert response["value"][0]["filename"] == "canonical.txt"
    assert "tenant_id" not in response["value"][0]
    current = service.get(CONTEXT, owner, variable_id)
    assert current.value is not None
    assert current.value.value[0].filename == "canonical.txt"
    assert all(not session.in_transaction() for session in opened)
