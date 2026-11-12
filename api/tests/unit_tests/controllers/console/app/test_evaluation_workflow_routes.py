"""Request contracts for evaluator publication and workflow kind conversion."""

from datetime import datetime
from inspect import unwrap

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import HTTPException

from controllers.console.app import workflow as workflow_module
from enums import WorkflowKind
from models.model import AppMode
from services.errors.app import WorkflowNotFoundError
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app


def _service(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> WorkflowService:
    service = WorkflowService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)
    return service


def test_publish_evaluation_workflow_route_forwards_marking_and_returns_timestamp(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(sqlite_session, monkeypatch)
    account = make_account()
    target_app = make_app(mode=AppMode.WORKFLOW)
    calls: list[dict[str, object]] = []

    def publish(**kwargs: object) -> datetime:
        calls.append(kwargs)
        return datetime(2026, 11, 13)

    monkeypatch.setattr(service, "publish_evaluation_workflow_for_app", publish)
    api = workflow_module.EvaluationPublishedWorkflowApi()
    with app.test_request_context("/apps/app-1/workflows/publish/evaluation", method="POST"):
        response = unwrap(api.post)(
            api,
            workflow_module.PublishWorkflowPayload(marked_name="Evaluator", marked_comment="Quality checks"),
            account,
            target_app,
        )

    assert calls == [
        {
            "app_model": target_app,
            "account": account,
            "marked_name": "Evaluator",
            "marked_comment": "Quality checks",
        }
    ]
    assert response["result"] == "success"
    assert isinstance(response["created_at"], int)


def test_publish_evaluation_workflow_route_rejects_invalid_draft(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(sqlite_session, monkeypatch)

    def invalid_draft(**_kwargs: object) -> None:
        raise ValueError("draft has no evaluator outputs")

    monkeypatch.setattr(service, "publish_evaluation_workflow_for_app", invalid_draft)
    api = workflow_module.EvaluationPublishedWorkflowApi()
    with app.test_request_context("/apps/app-1/workflows/publish/evaluation", method="POST"):
        with pytest.raises(HTTPException, match="draft has no evaluator outputs") as exc_info:
            unwrap(api.post)(
                api, workflow_module.PublishWorkflowPayload(), make_account(), make_app(mode=AppMode.WORKFLOW)
            )

    assert exc_info.value.code == 400


def test_convert_workflow_kind_route_maps_query_and_response(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(sqlite_session, monkeypatch)
    account = make_account()
    target_app = make_app(mode=AppMode.WORKFLOW)
    selected: list[WorkflowKind] = []

    def convert(**kwargs: object) -> tuple[str, str, str, datetime]:
        kind = kwargs["target_kind"]
        assert isinstance(kind, WorkflowKind)
        selected.append(kind)
        assert kwargs["app_model"] is target_app
        assert kwargs["account"] is account
        return "workflow-1", "workflow", kind.value, datetime(2026, 11, 13)

    monkeypatch.setattr(service, "convert_published_workflow_kind_for_app", convert)
    api = workflow_module.WorkflowKindConvertApi()
    with app.test_request_context("/apps/app-1/workflows/convert-type?target_type=evaluation", method="POST"):
        response = unwrap(api.post)(api, account, target_app)

    assert selected == [WorkflowKind.EVALUATION]
    assert response["workflow_id"] == "workflow-1"
    assert response["kind"] == "evaluation"
    assert isinstance(response["updated_at"], int)


def test_convert_workflow_kind_route_selects_standard_kind(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(sqlite_session, monkeypatch)
    selected: list[WorkflowKind] = []

    def convert(**kwargs: object) -> tuple[str, str, str, datetime]:
        kind = kwargs["target_kind"]
        assert isinstance(kind, WorkflowKind)
        selected.append(kind)
        return "workflow-1", "workflow", kind.value, datetime(2026, 11, 13)

    monkeypatch.setattr(service, "convert_published_workflow_kind_for_app", convert)
    api = workflow_module.WorkflowKindConvertApi()
    with app.test_request_context("/apps/app-1/workflows/convert-type?target_type=workflow", method="POST"):
        response = unwrap(api.post)(api, make_account(), make_app(mode=AppMode.WORKFLOW))

    assert selected == [WorkflowKind.STANDARD]
    assert response["kind"] == "standard"


@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (WorkflowNotFoundError("missing workflow"), 404),
        (ValueError("invalid workflow"), 400),
    ],
)
def test_convert_workflow_kind_route_maps_service_errors(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, error: Exception, status_code: int
) -> None:
    service = _service(sqlite_session, monkeypatch)

    def fail_convert(**_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(service, "convert_published_workflow_kind_for_app", fail_convert)
    api = workflow_module.WorkflowKindConvertApi()
    with app.test_request_context("/apps/app-1/workflows/convert-type?target_type=workflow", method="POST"):
        with pytest.raises(HTTPException) as exc_info:
            unwrap(api.post)(api, make_account(), make_app(mode=AppMode.WORKFLOW))

    assert exc_info.value.code == status_code
