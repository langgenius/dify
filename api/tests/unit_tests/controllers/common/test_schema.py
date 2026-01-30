from unittest.mock import MagicMock, patch
import pytest

from enum import StrEnum
from pydantic import BaseModel
from flask_restx import Namespace

from controllers.common.schema import (
    DEFAULT_REF_TEMPLATE_SWAGGER_2_0,
    register_schema_model,
    register_schema_models,
    get_or_create_model,
    register_enum_models,
)


class UserModel(BaseModel):
    id: int
    name: str


class ProductModel(BaseModel):
    id: int
    price: float


def test_default_ref_template_value():
    assert DEFAULT_REF_TEMPLATE_SWAGGER_2_0 == "#/definitions/{model}"


def test_register_schema_model_calls_namespace_schema_model():
    namespace = MagicMock(spec=Namespace)

    register_schema_model(namespace, UserModel)

    namespace.schema_model.assert_called_once()

    model_name, schema = namespace.schema_model.call_args.args

    assert model_name == "UserModel"
    assert isinstance(schema, dict)
    assert "properties" in schema


def test_register_schema_model_passes_schema_from_pydantic():
    namespace = MagicMock(spec=Namespace)

    register_schema_model(namespace, UserModel)

    schema = namespace.schema_model.call_args.args[1]

    expected_schema = UserModel.model_json_schema(
        ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0
    )

    assert schema == expected_schema


def test_register_schema_models_registers_multiple_models():
    namespace = MagicMock(spec=Namespace)

    register_schema_models(namespace, UserModel, ProductModel)

    assert namespace.schema_model.call_count == 2

    called_names = [call.args[0] for call in namespace.schema_model.call_args_list]
    assert called_names == ["UserModel", "ProductModel"]


def test_register_schema_models_calls_register_schema_model(monkeypatch):
    namespace = MagicMock(spec=Namespace)

    calls = []

    def fake_register(ns, model):
        calls.append((ns, model))

    monkeypatch.setattr(
        "controllers.common.schema.register_schema_model",
        fake_register,
    )

    register_schema_models(namespace, UserModel, ProductModel)

    assert calls == [
        (namespace, UserModel),
        (namespace, ProductModel),
    ]


class StatusEnum(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class PriorityEnum(StrEnum):
    HIGH = "high"
    LOW = "low"


def test_get_or_create_model_returns_existing_model():
    with patch("controllers.common.schema.console_ns") as mock_console_ns:
        existing_model = MagicMock()
        mock_console_ns.models = {"TestModel": existing_model}

        result = get_or_create_model("TestModel", {"key": "value"})

        assert result == existing_model
        mock_console_ns.model.assert_not_called()


@patch("controllers.common.schema.console_ns")
def test_get_or_create_model_creates_new_model_when_not_exists(mock_console_ns):
    mock_console_ns.models = {}
    new_model = MagicMock()
    mock_console_ns.model.return_value = new_model
    field_def = {"name": {"type": "string"}}

    result = get_or_create_model("NewModel", field_def)

    assert result == new_model
    mock_console_ns.model.assert_called_once_with("NewModel", field_def)


@patch("controllers.common.schema.console_ns")
def test_get_or_create_model_does_not_call_model_if_exists(mock_console_ns):
    existing_model = MagicMock()
    mock_console_ns.models = {"ExistingModel": existing_model}

    result = get_or_create_model("ExistingModel", {"key": "value"})

    assert result == existing_model
    mock_console_ns.model.assert_not_called()


def test_register_enum_models_registers_single_enum():
    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum)

    namespace.schema_model.assert_called_once()

    model_name, schema = namespace.schema_model.call_args.args

    assert model_name == "StatusEnum"
    assert isinstance(schema, dict)


def test_register_enum_models_registers_multiple_enums():
    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum, PriorityEnum)

    assert namespace.schema_model.call_count == 2

    called_names = [call.args[0] for call in namespace.schema_model.call_args_list]
    assert called_names == ["StatusEnum", "PriorityEnum"]


def test_register_enum_models_uses_correct_ref_template():
    namespace = MagicMock(spec=Namespace)

    register_enum_models(namespace, StatusEnum)

    schema = namespace.schema_model.call_args.args[1]

    # Verify the schema contains enum values
    assert "enum" in schema or "anyOf" in schema