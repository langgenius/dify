from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from controllers.console.app import conversation_variables as conversation_variables_module


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


class _DummyValueType:
    def exposed_type(self):
        return SimpleNamespace(value="number")


class _DummyVariable:
    def __init__(self, *, value_type, value):
        self._value_type = value_type
        self._value = value

    def model_dump(self):
        return {
            "id": "var-1",
            "name": "v1",
            "value_type": self._value_type,
            "value": self._value,
            "description": "desc",
        }


class _DummyRow:
    def __init__(self, *, value_type, value):
        self.created_at = datetime(2024, 1, 1, 1, 2, 3, tzinfo=UTC)
        self.updated_at = datetime(2024, 1, 2, 1, 2, 3, tzinfo=UTC)
        self._variable = _DummyVariable(value_type=value_type, value=value)

    def to_variable(self):
        return self._variable


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self, _stmt):
        return SimpleNamespace(all=lambda: self._rows)


class _FakeSessionMaker:
    def __init__(self, rows):
        self._rows = rows

    def begin(self):
        rows = self._rows

        class _Ctx:
            def __enter__(self):
                return _FakeSession(rows)

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()


def test_conversation_variables_get_serializes_value_type_and_value(app, monkeypatch):
    api = conversation_variables_module.ConversationVariablesApi()
    method = _unwrap(api.get)

    rows = [
        _DummyRow(value_type=_DummyValueType(), value=123),
        _DummyRow(value_type="string", value="abc"),
    ]
    monkeypatch.setattr(
        conversation_variables_module,
        "sessionmaker",
        lambda *_args, **_kwargs: _FakeSessionMaker(rows),
    )
    monkeypatch.setattr(conversation_variables_module, "db", SimpleNamespace(engine=object()))

    with app.test_request_context(
        "/console/api/apps/app-1/conversation-variables",
        query_string={"conversation_id": "conv-1"},
    ):
        response = method(app_model=SimpleNamespace(id="app-1"))

    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["total"] == 2
    assert response["has_more"] is False
    assert response["data"][0]["value_type"] == "number"
    assert response["data"][0]["value"] == "123"
    assert response["data"][1]["value_type"] == "string"
    assert response["data"][1]["value"] == "abc"
    assert isinstance(response["data"][0]["created_at"], int)
    assert isinstance(response["data"][0]["updated_at"], int)
