"""Unit tests for PaginationEnvelope generic Pydantic model."""

from __future__ import annotations

from pydantic import BaseModel

from controllers.openapi._models import PaginationEnvelope


class _Row(BaseModel):
    id: str
    name: str


def test_envelope_basic_fields():
    env = PaginationEnvelope[_Row](page=1, limit=20, total=42, has_more=True, data=[_Row(id="a", name="A")])
    dumped = env.model_dump(mode="json")
    assert dumped == {
        "page": 1,
        "limit": 20,
        "total": 42,
        "has_more": True,
        "data": [{"id": "a", "name": "A"}],
    }


def test_envelope_empty_data_no_more():
    env = PaginationEnvelope[_Row](page=1, limit=20, total=0, has_more=False, data=[])
    assert env.model_dump(mode="json")["data"] == []
    assert env.model_dump(mode="json")["has_more"] is False


def test_envelope_has_more_true_when_total_exceeds_page_window():
    env = PaginationEnvelope[_Row].build(page=1, limit=20, total=42, items=[_Row(id="a", name="A")])
    assert env.has_more is True


def test_envelope_has_more_false_when_total_within_page_window():
    env = PaginationEnvelope[_Row].build(page=2, limit=20, total=22, items=[_Row(id="a", name="A")])
    assert env.has_more is False


def test_envelope_has_more_false_for_last_page():
    env = PaginationEnvelope[_Row].build(page=3, limit=20, total=42, items=[_Row(id="a", name="A")])
    assert env.has_more is False


def test_max_page_limit_is_200():
    from controllers.openapi._models import MAX_PAGE_LIMIT

    assert MAX_PAGE_LIMIT == 200


def test_envelope_uses_pep695_generics():
    """Verify the class uses PEP 695 native generic syntax (not legacy Generic[T])."""
    from controllers.openapi._models import PaginationEnvelope

    # PEP 695 syntax populates __type_params__; the legacy Generic[T] form does not.
    assert PaginationEnvelope.__type_params__, "expected PEP 695 native generic syntax"

    fields = PaginationEnvelope.model_fields
    assert {"page", "limit", "total", "has_more", "data"} <= set(fields)


def test_app_info_response_dump_matches_spec():
    from controllers.openapi._models import AppInfoResponse

    obj = AppInfoResponse(
        id="app1",
        name="X",
        description="d",
        mode="chat",
        author="alice",
        tags=[{"name": "prod"}],
    )
    assert obj.model_dump(mode="json") == {
        "id": "app1",
        "name": "X",
        "description": "d",
        "mode": "chat",
        "author": "alice",
        "tags": [{"name": "prod"}],
    }


def test_app_describe_response_nests_info_and_parameters():
    from controllers.openapi._models import AppDescribeInfo, AppDescribeResponse

    info = AppDescribeInfo(
        id="app1",
        name="X",
        mode="chat",
        description=None,
        tags=[],
        author=None,
        updated_at="2026-05-05T00:00:00+00:00",
        service_api_enabled=True,
    )
    obj = AppDescribeResponse(info=info, parameters={"opening_statement": None})
    dumped = obj.model_dump(mode="json")
    assert dumped["info"]["service_api_enabled"] is True
    assert dumped["parameters"]["opening_statement"] is None


def test_response_models_dump_per_mode():
    from controllers.openapi._models import (
        ChatMessageResponse,
        CompletionMessageResponse,
        WorkflowRunData,
        WorkflowRunResponse,
    )

    chat = ChatMessageResponse(
        event="message",
        task_id="t1",
        id="m1",
        message_id="m1",
        conversation_id="c1",
        mode="chat",
        answer="hi",
        created_at=0,
    )
    assert chat.model_dump(mode="json")["mode"] == "chat"
    wf = WorkflowRunResponse(
        workflow_run_id="r1",
        task_id="t1",
        data=WorkflowRunData(id="r1", workflow_id="w1", status="succeeded"),
    )
    assert wf.model_dump(mode="json")["data"]["status"] == "succeeded"
    assert wf.model_dump(mode="json")["mode"] == "workflow"
    comp = CompletionMessageResponse(
        event="message",
        task_id="t2",
        id="m2",
        message_id="m2",
        mode="completion",
        answer="ok",
        created_at=0,
    )
    assert comp.model_dump(mode="json")["mode"] == "completion"
