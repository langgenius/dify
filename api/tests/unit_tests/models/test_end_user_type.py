import ast
import inspect
from pathlib import Path

import pytest
from sqlalchemy.engine.default import DefaultDialect

from models.enums import EndUserType
from models.model import EndUser
from models.types import EnumText
from services.app_scoped_end_user_service import AppScopedEndUserService

API_ROOT = Path(__file__).resolve().parents[3]


def test_end_user_type_covers_persisted_creation_values():
    assert {member.value for member in EndUserType} == {
        "browser",
        "mcp",
        "openapi",
        "service-api",
        "trigger",
    }


def test_end_user_type_is_plain_persisted_value_enum():
    assert not hasattr(EndUserType, "from_invoke_from")


def test_end_user_type_accepts_legacy_service_api_value():
    # Legacy rows stored the service-api type with an underscore before it was
    # normalized to the hyphenated value; loading them must not raise. See #38201.
    assert EndUserType("service_api") is EndUserType.SERVICE_API
    assert EndUserType("service-api") is EndUserType.SERVICE_API


def test_end_user_type_still_rejects_unknown_values():
    with pytest.raises(ValueError):
        EndUserType("not-a-real-end-user-type")


def test_enum_text_deserializes_legacy_service_api_value():
    # Exercises the actual column load path that raised for unmigrated rows.
    column_type = EnumText(EndUserType)
    assert column_type.process_result_value("service_api", DefaultDialect()) is EndUserType.SERVICE_API


def test_end_user_service_creation_methods_accept_end_user_type():
    get_or_create_type = inspect.signature(AppScopedEndUserService.get_or_create_end_user_by_type).parameters["type"]
    assert get_or_create_type.annotation is EndUserType
    assert inspect.signature(AppScopedEndUserService.create_end_user_batch).parameters["type"].annotation is EndUserType


def test_end_user_service_callers_pass_end_user_type():
    violations: list[str] = []
    method_names = {"get_or_create_end_user_by_type", "create_end_user_batch"}
    checked_calls = 0

    for source_path in API_ROOT.rglob("*.py"):
        if "tests" in source_path.parts or ".venv" in source_path.parts:
            continue

        tree = ast.parse(source_path.read_text(), filename=str(source_path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Attribute) or node.func.attr not in method_names:
                continue
            checked_calls += 1

            type_arg = next((keyword.value for keyword in node.keywords if keyword.arg == "type"), None)
            if type_arg is None and node.args:
                type_arg = node.args[0]

            if not (
                isinstance(type_arg, ast.Attribute)
                and isinstance(type_arg.value, ast.Name)
                and type_arg.value.id == "EndUserType"
            ):
                violations.append(f"{source_path.relative_to(API_ROOT)}:{node.lineno}")

    assert checked_calls > 0
    assert violations == []


def test_end_user_type_column_uses_enum_text():
    column_type = EndUser.__table__.c.type.type

    assert isinstance(column_type, EnumText)
    assert column_type._enum_class is EndUserType


def test_production_end_user_constructors_use_end_user_type_enum():
    violations: list[str] = []

    for source_path in API_ROOT.rglob("*.py"):
        if "tests" in source_path.parts or ".venv" in source_path.parts:
            continue

        tree = ast.parse(source_path.read_text(), filename=str(source_path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Name) or node.func.id != "EndUser":
                continue

            for keyword in node.keywords:
                if keyword.arg != "type":
                    continue
                value = keyword.value
                uses_end_user_type_member = (
                    isinstance(value, ast.Attribute)
                    and isinstance(value.value, ast.Name)
                    and value.value.id == "EndUserType"
                )
                uses_end_user_type_conversion = (
                    isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "EndUserType"
                )
                if not (uses_end_user_type_member or uses_end_user_type_conversion):
                    violations.append(f"{source_path.relative_to(API_ROOT)}:{node.lineno}")

    assert violations == []
