"""Real draft snapshot conflicts use the Console HTTP error contract."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from inspect import unwrap
from typing import Concatenate

import pytest
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Api, Resource
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import api as console_api
from controllers.console.app import workflow_draft_variable as controller
from controllers.console.app import workflow_variable_admission as admission
from controllers.console.wraps import model_validate
from graphon.variables import StringVariable
from machinery.context import RequestContext
from models.model import AppMode
from models.workflow import Workflow
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.console_variable_service import ConsoleWorkflowVariableService
from services.workflow.contracts import WorkflowOwner
from services.workflow.variable_contracts import DraftVariableContext
from tests.unit_tests.model_factories import make_account, make_app, make_workflow


@pytest.mark.parametrize("concurrent_writes", [1, 2, 3])
@pytest.mark.parametrize("delete", [False, True])
def test_environment_patch_rebases_with_bounded_retries(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    console_workflow_variables: ConsoleWorkflowVariableService,
    concurrent_writes: int,
    delete: bool,
) -> None:
    account, app = make_account(), make_app(mode=AppMode.ADVANCED_CHAT)
    workflow = make_workflow()
    target = StringVariable(id="target", name="target", value="before")
    workflow.environment_variables = [target]
    with sqlite_session_factory.begin() as session:
        session.add_all([account, app, workflow])
    context = RequestContext("request", None, account.id, app.tenant_id)
    service = console_workflow_variables
    read = service._definitions.variable_context
    reads = 0

    def interleave(context: RequestContext, owner: WorkflowOwner, *, include_draft: bool) -> DraftVariableContext:
        nonlocal reads
        snapshot = read(context, owner, include_draft=include_draft)
        reads += 1
        if reads <= concurrent_writes:
            with sqlite_session_factory.begin() as session:
                current = session.get(Workflow, workflow.id)
                assert current is not None
                current.environment_variables = [target, StringVariable(id="other", name="other", value=str(reads))]
        return snapshot

    monkeypatch.setattr(service._definitions, "variable_context", interleave)

    def patch() -> None:
        service.update_environment(
            context,
            app.id,
            [] if delete else [target.model_copy(update={"value": "after"}).model_dump(mode="json")],
            deleted_ids=[target.id] if delete else [],
        )

    if concurrent_writes == 3:
        with pytest.raises(WorkflowHashNotEqualError):
            patch()
    else:
        patch()
    assert reads == min(3, concurrent_writes + 1)
    with sqlite_session_factory() as session:
        saved = session.get(Workflow, workflow.id)
        assert saved is not None
        values = {variable.id: variable.value for variable in saved.environment_variables}
        assert values["other"] == str(concurrent_writes)
        if concurrent_writes == 3:
            assert values["target"] == "before"
        elif delete:
            assert "target" not in values
        else:
            assert values["target"] == "after"


@pytest.mark.parametrize("operation", ["conversation", "environment-replace", "environment-patch"])
@pytest.mark.parametrize(
    "concurrent_change", [None, "canvas", "features", "conversation", "environment", "same-variable"]
)
def test_variable_update_conflict_uses_production_http_error_mapping(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    console_workflow_variables: ConsoleWorkflowVariableService,
    operation: str,
    concurrent_change: str | None,
) -> None:
    account = make_account()
    app_model = make_app(mode=AppMode.ADVANCED_CHAT)
    with sqlite_session_factory.begin() as session:
        session.add_all([account, app_model, make_workflow()])
    context = RequestContext("request", None, account.id, app_model.tenant_id)
    service = console_workflow_variables
    read_snapshot = service._definitions.variable_context

    def read_before_concurrent_commit(
        context: RequestContext, owner: WorkflowOwner, *, include_draft: bool
    ) -> DraftVariableContext:
        snapshot = read_snapshot(context, owner, include_draft=include_draft)
        workflow_snapshot = snapshot.snapshot
        assert workflow_snapshot is not None
        if concurrent_change is not None:
            # Commit a second editor's update after the read and before the
            # original request reaches the repository's snapshot comparison.
            with sqlite_session_factory.begin() as session:
                current = session.get(Workflow, workflow_snapshot.id)
                assert current is not None
                if concurrent_change == "canvas":
                    current.graph = json.dumps({"nodes": [], "edges": [], "viewport": {"zoom": 2}})
                elif concurrent_change == "features":
                    current.features = '{"file_upload": {"enabled": true}}'
                elif concurrent_change == "conversation":
                    current.conversation_variables = [StringVariable(id="other", name="saved", value="concurrent edit")]
                else:
                    current.environment_variables = [
                        StringVariable(
                            id="variable-1" if concurrent_change == "same-variable" else "other",
                            name="saved",
                            value="concurrent edit",
                        )
                    ]
        return snapshot

    monkeypatch.setattr(service._definitions, "variable_context", read_before_concurrent_commit)

    @dataclass
    class Services:
        console_workflow_variables: ConsoleWorkflowVariableService

    monkeypatch.setattr(controller, "application_services", lambda: Services(service))

    def account_admission[T, **P, R](
        **_kwargs: object,
    ) -> Callable[[Callable[Concatenate[T, RequestContext, P], R]], Callable[Concatenate[T, P], R]]:
        def decorate(
            view: Callable[Concatenate[T, RequestContext, P], R],
        ) -> Callable[Concatenate[T, P], R]:
            def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
                return view(self, context, *args, **kwargs)

            return admitted

        return decorate

    monkeypatch.setattr(admission, "console_account_admission", account_admission)
    variable = {"id": "variable-1", "name": "requested", "value_type": "string", "value": "new value"}
    if operation == "conversation":
        endpoint = controller.ConversationVariableCollectionApi()
        payload_type = controller.ConversationVariableUpdatePayload
        payload = {"conversation_variables": [variable]}
    else:
        endpoint = controller.EnvironmentVariableCollectionApi()
        payload_type = controller.EnvironmentVariableUpdatePayload
        payload = {"environment_variables": [variable], "patch": operation == "environment-patch"}

    app = Flask(__name__)
    api = Api(app, doc=False)
    api.error_handlers = console_api.error_handlers.copy()

    mapped_post = admission.console_variable_admission("app")(model_validate(payload_type)(unwrap(endpoint.post)))

    class Endpoint(Resource):
        def post(self) -> ResponseReturnValue:
            # Admission is pre-supplied; keep the actual controller method,
            # service, repository and production exception-handler ordering.
            return mapped_post(endpoint, app_model.id)

    api.add_resource(Endpoint, "/variables")
    response = app.test_client().post("/variables", json=payload)
    conflicts = (operation == "conversation" and concurrent_change == "conversation") or (
        operation != "conversation"
        and (
            concurrent_change == "same-variable"
            or (operation == "environment-replace" and concurrent_change == "environment")
        )
    )
    if not conflicts:
        assert response.status_code == 200
        assert response.json == {"result": "success"}
    else:
        assert response.status_code == 409
        assert response.json == {
            "code": "draft_workflow_not_sync",
            "message": "Workflow graph might have been modified, please refresh and resubmit.",
            "status": 409,
        }
    with sqlite_session_factory() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == app_model.id))
        assert workflow is not None
        requested_values = (
            workflow.conversation_variables if operation == "conversation" else workflow.environment_variables
        )
        if not conflicts:
            assert ("requested", "new value") in [(value.name, value.value) for value in requested_values]
        else:
            assert all(value.name != "requested" for value in requested_values)
        if concurrent_change == "canvas":
            assert workflow.graph_dict["viewport"] == {"zoom": 2}
        elif concurrent_change == "features":
            assert workflow.features_dict == {"file_upload": {"enabled": True}}
        elif concurrent_change == "conversation":
            assert [(value.name, value.value) for value in workflow.conversation_variables] == [
                ("saved", "concurrent edit")
            ]
        elif concurrent_change in ("environment", "same-variable"):
            assert ("saved", "concurrent edit") in [
                (value.name, value.value) for value in workflow.environment_variables
            ]
