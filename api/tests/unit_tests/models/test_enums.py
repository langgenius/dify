import ast
import inspect
import os
from functools import cache
from pathlib import Path

import pytest

from models.enums import CreatorUserRole, EndUserType
from models.model import EndUser
from models.types import EnumText
from services.app_scoped_end_user_service import AppScopedEndUserService

API_ROOT = Path(__file__).resolve().parents[3]


@cache
def _production_calls() -> tuple[tuple[Path, ast.Call], ...]:
    """Every call expression in the API's production sources, with its path relative to ``API_ROOT``.

    Parsed once for all source-scanning tests; ``tests`` and ``.venv`` directories are pruned
    during the walk instead of being traversed and filtered afterwards.
    """
    calls: list[tuple[Path, ast.Call]] = []
    for directory, subdirectories, filenames in os.walk(API_ROOT):
        subdirectories[:] = [name for name in subdirectories if name not in {"tests", ".venv"}]
        for filename in filenames:
            if filename.endswith(".py"):
                source_path = Path(directory) / filename
                tree = ast.parse(source_path.read_text(), filename=str(source_path))
                relative_path = source_path.relative_to(API_ROOT)
                calls.extend((relative_path, node) for node in ast.walk(tree) if isinstance(node, ast.Call))
    return tuple(calls)


def test_end_user_type_covers_persisted_creation_values() -> None:
    assert {member.value for member in EndUserType} == {
        "app-deploy",
        "browser",
        "mcp",
        "openapi",
        "service-api",
        "trigger",
    }


def test_end_user_type_is_plain_persisted_value_enum() -> None:
    assert not hasattr(EndUserType, "from_invoke_from")


def test_end_user_type_rejects_legacy_service_api_value() -> None:
    with pytest.raises(ValueError, match="'service_api' is not a valid EndUserType"):
        EndUserType("service_api")

    assert EndUserType("service-api") is EndUserType.SERVICE_API


def test_end_user_type_still_rejects_unknown_values() -> None:
    with pytest.raises(ValueError, match="'not\\-a\\-real\\-end\\-user\\-type' is not a valid EndUserType"):
        EndUserType("not-a-real-end-user-type")


def test_end_user_service_creation_methods_accept_end_user_type() -> None:
    get_or_create_type = inspect.signature(AppScopedEndUserService.get_or_create_end_user_by_type).parameters["type"]
    assert get_or_create_type.annotation is EndUserType
    assert inspect.signature(AppScopedEndUserService.create_end_user_batch).parameters["type"].annotation is EndUserType


def test_end_user_service_callers_pass_end_user_type() -> None:
    violations: list[str] = []
    method_names = {"get_or_create_end_user_by_type", "create_end_user_batch"}
    checked_calls = 0

    for relative_path, node in _production_calls():
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
            violations.append(f"{relative_path}:{node.lineno}")

    assert checked_calls > 0
    assert violations == []


def test_end_user_type_column_uses_enum_text() -> None:
    column_type = EndUser.__table__.c.type.type

    assert isinstance(column_type, EnumText)
    assert column_type._enum_class is EndUserType


def test_production_end_user_constructors_use_end_user_type_enum() -> None:
    violations: list[str] = []

    for relative_path, node in _production_calls():
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
                violations.append(f"{relative_path}:{node.lineno}")

    assert violations == []


def test_creator_user_role_missing_maps_hyphen_to_enum() -> None:
    # given an alias with hyphen
    value = "end-user"

    # when converting to enum (invokes StrEnum._missing_ override)
    role = CreatorUserRole(value)

    # then it should map to END_USER
    assert role is CreatorUserRole.END_USER


def test_creator_user_role_missing_raises_for_unknown() -> None:
    with pytest.raises(ValueError, match="'unknown' is not a valid CreatorUserRole"):
        CreatorUserRole("unknown")
