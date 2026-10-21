"""Builder dataclass mapping keeps SQL defaults and identity allocation at INSERT."""

import dataclasses
import inspect
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from models import dify_builder, dify_builder_native_tests
from models.base import TypeBase

MODELS = tuple(
    model
    for module in (dify_builder, dify_builder_native_tests)
    for model in vars(module).values()
    if isinstance(model, type) and model.__module__ == module.__name__ and hasattr(model, "__table__")
)


def _table(model: type[TypeBase]) -> sa.Table:
    table = sa.inspect(model).local_table
    assert isinstance(table, sa.Table)
    return table


def _new[T: TypeBase](model: type[T], values: dict[str, object]) -> T:
    # SQL metadata supplies heterogeneous constructor fields for each real model.
    return cast(Callable[..., T], model)(**values)


@pytest.mark.parametrize("model", MODELS, ids=lambda model: model.__name__)
def test_builder_models_have_explicit_keyword_only_dataclass_constructors(model: type[TypeBase]) -> None:
    assert issubclass(model, TypeBase)
    assert dataclasses.is_dataclass(model)
    parameters = inspect.signature(model).parameters
    assert parameters
    assert all(parameter.kind == inspect.Parameter.KEYWORD_ONLY for parameter in parameters.values())
    assert all(field.init for field in dataclasses.fields(model))


def _values(model: type[TypeBase]) -> dict[str, object]:
    """Valid required values; omit every SQL/Python default and nullable field."""
    overrides: dict[str, object] = {
        "state": "prepared" if model is dify_builder.DifyBuilderExecutionRequest else "running",
        "kind": "context",
        "decision": "approved",
        "outcome": "unknown",
        "category": "configuration",
        "dispatch_index": 1,
    }
    if model is dify_builder.DifyBuilderRealCallConsent:
        overrides["state"] = "prepared"
    elif model is dify_builder_native_tests.NativeEffectOperation:
        overrides["state"] = "pending"
    elif model is dify_builder_native_tests.NativeDispatch:
        overrides["state"] = "queued"
    values: dict[str, object] = {}
    value: object
    for column in _table(model).columns:
        if column.nullable or column.default is not None or column.server_default is not None:
            continue
        if column.name in overrides:
            value = overrides[column.name]
        elif isinstance(column.type, sa.JSON):
            value = list[object]() if column.name in {"pending_ids", "resolution"} else dict[str, object]()
        elif isinstance(column.type, sa.Boolean):
            value = False
        elif isinstance(column.type, sa.Integer):
            value = 0
        elif isinstance(column.type, sa.DateTime):
            value = datetime.now(UTC)
        else:
            value = str(uuid4())
        values[column.name] = value
    return values


@pytest.mark.parametrize("model", MODELS, ids=lambda model: model.__name__)
def test_builder_insert_lifecycle_keeps_server_defaults_and_caller_ids(model: type[TypeBase]) -> None:
    engine = sa.create_engine("sqlite://")
    try:
        _table(model).create(engine)
        row = _new(model, _values(model))
        generated_id = _table(model).columns.get("id")
        if generated_id is not None and generated_id.default is not None:
            assert sa.inspect(row).attrs.id.value is None
        for name in ("created_at", "updated_at"):
            if name in _table(model).columns:
                assert sa.inspect(row).attrs[name].value is None
        with Session(engine) as session:
            session.add(row)
            session.flush()
            identity = sa.inspect(row).identity
            assert identity is not None
            assert all(identity)
            for name in ("created_at", "updated_at"):
                if name in _table(model).columns:
                    assert isinstance(sa.inspect(row).attrs[name].value, datetime)
            if model is dify_builder.DifyBuilderSession:
                assert sa.inspect(row).attrs.version.value == 1
            session.commit()
            assert session.get(model, identity) is row
            if generated_id is not None:
                supplied = str(uuid4())
                second = _new(model, {**_values(model), "id": supplied})
                session.add(second)
                session.flush()
                assert sa.inspect(second).attrs.id.value == supplied
    finally:
        engine.dispose()


def test_execution_request_observations_have_independent_constructor_defaults() -> None:
    first = _new(dify_builder.DifyBuilderExecutionRequest, _values(dify_builder.DifyBuilderExecutionRequest))
    second = _new(dify_builder.DifyBuilderExecutionRequest, _values(dify_builder.DifyBuilderExecutionRequest))
    first.observations.append({"event": "started"})
    assert second.observations == []


@pytest.mark.parametrize("model", MODELS, ids=lambda model: model.__name__)
def test_builder_rows_keep_orm_identity_equality_and_hashing(model: type[TypeBase]) -> None:
    values = _values(model)
    first, second = _new(model, values), _new(model, values)
    assert first == first
    assert first != second
    assert len({first, second}) == 2
