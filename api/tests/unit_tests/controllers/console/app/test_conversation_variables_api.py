from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from controllers.console.app import conversation_variables as conversation_variables_module
from factories import variable_factory
from graphon.variables.types import SegmentType
from models import ConversationVariable


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
def test_get_conversation_variables_returns_paginated_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = unwrap(api.get)

    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "var-1",
            "name": "my_var",
            "value_type": SegmentType.STRING,
            "value": "value",
            "description": "desc",
        }
    )
    row = ConversationVariable.from_variable(app_id="app-1", conversation_id="conv-1", variable=variable)
    row.created_at = created_at
    row.updated_at = updated_at
    sqlite_session.add(row)
    sqlite_session.commit()
    sqlite_session.expire(row)
    expected_created_at = int(row.created_at.timestamp())
    expected_updated_at = int(row.updated_at.timestamp())
    monkeypatch.setattr(conversation_variables_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context(
        "/console/api/apps/app-1/conversation-variables",
        method="GET",
        query_string={"conversation_id": "conv-1"},
    ):
        response = method(api, app_model=SimpleNamespace(id="app-1"))

    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["total"] == 1
    assert response["has_more"] is False
    assert response["data"][0]["id"] == "var-1"
    assert response["data"][0]["created_at"] == expected_created_at
    assert response["data"][0]["updated_at"] == expected_updated_at


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
def test_get_conversation_variables_normalizes_value_type_and_value(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = unwrap(api.get)

    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "var-2",
            "name": "my_var_2",
            "value_type": SegmentType.INTEGER,
            "value": 42,
            "description": "",
        }
    )
    sqlite_session.add(ConversationVariable.from_variable(app_id="app-1", conversation_id="conv-1", variable=variable))
    sqlite_session.commit()
    monkeypatch.setattr(conversation_variables_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context(
        "/console/api/apps/app-1/conversation-variables",
        method="GET",
        query_string={"conversation_id": "conv-1"},
    ):
        response = method(api, app_model=SimpleNamespace(id="app-1"))

    assert response["data"][0]["value_type"] == "number"
    assert response["data"][0]["value"] == "42"


def test_get_conversation_variables_requires_conversation_id(app) -> None:
    api = conversation_variables_module.ConversationVariablesApi()
    method = unwrap(api.get)

    with app.test_request_context("/console/api/apps/app-1/conversation-variables", method="GET"):
        with pytest.raises(ValidationError):
            method(api, app_model=SimpleNamespace(id="app-1"))
