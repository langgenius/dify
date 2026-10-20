"""Persisted debug files use the invocation's tenant and injected database."""

import json
from typing import NoReturn
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.db import session_factory
from core.workflow.file_reference import build_file_reference
from extensions.application_services.workflow_variables import build_workflow_variable_service
from extensions.ext_database import db
from graphon.nodes import BuiltinNodeTypes
from graphon.variables import SegmentType, StringSegment
from models.dataset import Pipeline
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowKind, WorkflowType
from services.workflow.variable_service import WorkflowVariableService
from tests.unit_tests.model_factories import make_account, make_app, make_upload_file, make_workflow


@pytest.fixture(autouse=True)
def _provide_app_context() -> None:
    """Loading through injected dependencies must not need a Flask context."""


@pytest.fixture(params=["app", "pipeline", "snippet"])
def runtime_scope(
    request: pytest.FixtureRequest,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[WorkflowVariableService, Workflow]:
    owner_id = str(uuid4())
    kind = request.param
    workflow = make_workflow(
        app_id=owner_id,
        workflow_type={
            "app": WorkflowType.WORKFLOW,
            "pipeline": WorkflowType.RAG_PIPELINE,
            "snippet": WorkflowType.SNIPPET,
        }[kind],
        kind=WorkflowKind.SNIPPET if kind == "snippet" else WorkflowKind.STANDARD,
    )
    with sqlite_session_factory.begin() as session:
        session.add(workflow)
        if kind == "app":
            session.add(make_app(app_id=owner_id))
        elif kind == "pipeline":
            pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="", created_by="account-1")
            pipeline.id = owner_id
            session.add(pipeline)
        else:
            session.add(CustomizedSnippet(id=owner_id, tenant_id="tenant-1", name="Snippet"))

    def reject_global(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("Runtime variables accessed a global database or inspected a remote file")

    monkeypatch.setattr(db, "session", reject_global)
    monkeypatch.setattr(type(db), "engine", property(reject_global))
    monkeypatch.setattr(session_factory, "create_session", reject_global)
    monkeypatch.setattr(session_factory, "get_session_maker", reject_global)
    monkeypatch.setattr("factories.file_factory.builders.get_remote_file_info", reject_global)
    return build_workflow_variable_service(database_client=sqlite_session_factory), workflow


def _persist_file_variable(
    sessions: sessionmaker[Session], workflow: Workflow, value_type: SegmentType, value: object
) -> None:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=workflow.app_id,
        user_id="account-1",
        node_id="node",
        name="file",
        value=StringSegment(value="placeholder"),
        node_execution_id=str(uuid4()),
    )
    variable.value_type = value_type
    variable.value = json.dumps(value)
    with sessions.begin() as session:
        session.add(variable)


@pytest.mark.parametrize("value_type", [SegmentType.FILE, SegmentType.ARRAY_FILE])
@pytest.mark.parametrize("reference_field", ["reference", "related_id"])
def test_load_file_variables_restores_canonical_metadata(
    runtime_scope: tuple[WorkflowVariableService, Workflow],
    sqlite_session_factory: sessionmaker[Session],
    value_type: SegmentType,
    reference_field: str,
) -> None:
    variables, workflow = runtime_scope
    upload = make_upload_file(file_id=str(uuid4()), name="canonical.txt", key="canonical/key", size=42)
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    mapping = {
        "dify_model_identity": "__dify__file__",
        "type": "document",
        "transfer_method": "local_file",
        reference_field: build_file_reference(record_id=upload.id) if reference_field == "reference" else upload.id,
        "tenant_id": "untrusted-tenant",
        "filename": "stale.txt",
        "storage_key": "untrusted/key",
        "size": 1,
    }
    _persist_file_variable(
        sqlite_session_factory, workflow, value_type, [mapping] if value_type == SegmentType.ARRAY_FILE else mapping
    )
    loaded = variables.workflow_loader(workflow, "account-1").load_variables([["node", "file"]])
    assert len(loaded) == 1
    assert loaded[0].selector == ["node", "file"]
    files = loaded[0].value if value_type == SegmentType.ARRAY_FILE else [loaded[0].value]
    assert len(files) == 1
    assert (files[0].filename, files[0].storage_key, files[0].size) == ("canonical.txt", "canonical/key", 42)
    assert files[0].reference == build_file_reference(record_id=upload.id)


@pytest.mark.parametrize("value_type", [SegmentType.FILE, SegmentType.ARRAY_FILE])
def test_load_file_variables_rejects_another_tenants_upload(
    runtime_scope: tuple[WorkflowVariableService, Workflow],
    sqlite_session_factory: sessionmaker[Session],
    value_type: SegmentType,
) -> None:
    variables, workflow = runtime_scope
    upload = make_upload_file(file_id=str(uuid4()), tenant_id="other-tenant")
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    mapping = {
        "type": "document",
        "transfer_method": "local_file",
        "upload_file_id": upload.id,
        "tenant_id": upload.tenant_id,
    }
    _persist_file_variable(
        sqlite_session_factory, workflow, value_type, [mapping] if value_type == SegmentType.ARRAY_FILE else mapping
    )
    with pytest.raises(ValueError, match="Invalid upload file"):
        variables.workflow_loader(workflow, "account-1").load_variables([["node", "file"]])


@pytest.mark.parametrize("value_type", [SegmentType.FILE, SegmentType.ARRAY_FILE])
def test_load_external_file_does_not_fetch_it_again(
    runtime_scope: tuple[WorkflowVariableService, Workflow],
    sqlite_session_factory: sessionmaker[Session],
    value_type: SegmentType,
) -> None:
    variables, workflow = runtime_scope
    mapping = {
        "type": "document",
        "transfer_method": "remote_url",
        "url": "https://example.com/document.txt",
        "filename": "document.txt",
        "mime_type": "text/plain",
        "size": 12,
    }
    _persist_file_variable(
        sqlite_session_factory, workflow, value_type, [mapping] if value_type == SegmentType.ARRAY_FILE else mapping
    )
    loaded = variables.workflow_loader(workflow, "account-1").load_variables([["node", "file"]])
    file = loaded[0].value[0] if value_type == SegmentType.ARRAY_FILE else loaded[0].value
    assert (file.remote_url, file.filename, file.size) == (mapping["url"], "document.txt", 12)


def test_load_empty_file_array(
    runtime_scope: tuple[WorkflowVariableService, Workflow], sqlite_session_factory: sessionmaker[Session]
) -> None:
    variables, workflow = runtime_scope
    _persist_file_variable(sqlite_session_factory, workflow, SegmentType.ARRAY_FILE, [])
    loaded = variables.workflow_loader(workflow, "account-1").load_variables([["node", "file"]])
    assert loaded[0].value == []


def test_start_node_files_round_trip_through_injected_gateway(
    runtime_scope: tuple[WorkflowVariableService, Workflow], sqlite_session_factory: sessionmaker[Session]
) -> None:
    variables, workflow = runtime_scope
    upload = make_upload_file(file_id=str(uuid4()), name="start.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    saver = variables.saver_factory(workflow.tenant_id, make_account())(
        workflow.app_id, "start", BuiltinNodeTypes.START, str(uuid4())
    )
    saver.save(
        process_data=None,
        outputs={
            "sys.files": [
                {
                    "type": "document",
                    "transfer_method": "local_file",
                    "reference": build_file_reference(record_id=upload.id),
                }
            ]
        },
    )
    loaded = variables.workflow_loader(workflow, "account-1").load_variables([["sys", "files"]])
    assert [file.filename for file in loaded[0].value] == ["start.txt"]
