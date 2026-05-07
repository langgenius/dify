from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from controllers.console.app import conversation_variables as conversation_variables_module
from graphon.variables.types import SegmentType


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def test_get_conversation_variables_returns_paginated_response(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = _unwrap(api.get)

    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    row = SimpleNamespace(
        created_at=created_at,
        updated_at=updated_at,
        to_variable=lambda: SimpleNamespace(
            model_dump=lambda: {
                "id": "var-1",
                "name": "my_var",
                "value_type": "string",
                "value": "value",
                "description": "desc",
            }
        ),
    )
    session = SimpleNamespace(scalars=lambda _stmt: SimpleNamespace(all=lambda: [row]))
    monkeypatch.setattr(conversation_variables_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        conversation_variables_module,
        "sessionmaker",
        lambda *_args, **_kwargs: SimpleNamespace(begin=lambda: nullcontext(session)),
    )

    with app.test_request_context(
        "/console/api/apps/app-1/conversation-variables",
        method="GET",
        query_string={"conversation_id": "conv-1"},
    ):
        response = method(app_model=SimpleNamespace(id="app-1"))

    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["total"] == 1
    assert response["has_more"] is False
    assert response["data"][0]["id"] == "var-1"
    assert response["data"][0]["created_at"] == int(created_at.timestamp())
    assert response["data"][0]["updated_at"] == int(updated_at.timestamp())


def test_get_conversation_variables_normalizes_value_type_and_value(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = _unwrap(api.get)

    row = SimpleNamespace(
        created_at=None,
        updated_at=None,
        to_variable=lambda: SimpleNamespace(
            model_dump=lambda: {
                "id": "var-2",
                "name": "my_var_2",
                "value_type": SegmentType.INTEGER,
                "value": 42,
                "description": None,
            }
        ),
    )
    session = SimpleNamespace(scalars=lambda _stmt: SimpleNamespace(all=lambda: [row]))
    monkeypatch.setattr(conversation_variables_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        conversation_variables_module,
        "sessionmaker",
        lambda *_args, **_kwargs: SimpleNamespace(begin=lambda: nullcontext(session)),
    )

    with app.test_request_context(
        "/console/api/apps/app-1/conversation-variables",
        method="GET",
        query_string={"conversation_id": "conv-1"},
    ):
        response = method(app_model=SimpleNamespace(id="app-1"))

    assert response["data"][0]["value_type"] == "number"
    assert response["data"][0]["value"] == "42"


def test_get_conversation_variables_requires_conversation_id(app) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = _unwrap(api.get)

    with app.test_request_context("/console/api/apps/app-1/conversation-variables", method="GET"):
        with pytest.raises(ValidationError):
            method(app_model=SimpleNamespace(id="app-1"))
