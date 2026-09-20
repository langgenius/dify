"""end user service types tests."""

import ast
import inspect
from pathlib import Path

from models.enums import EndUserType
from services.end_user_service import EndUserService

API_ROOT = Path(__file__).resolve().parents[3]


def test_end_user_service_creation_methods_accept_end_user_type():
    assert inspect.signature(EndUserService.get_or_create_end_user_by_type).parameters["type"].annotation is EndUserType
    assert inspect.signature(EndUserService.create_end_user_batch).parameters["type"].annotation is EndUserType


def test_end_user_service_callers_pass_end_user_type():
    violations: list[str] = []
    method_names = {"get_or_create_end_user_by_type", "create_end_user_batch"}

    for source_path in API_ROOT.rglob("*.py"):
        if "tests" in source_path.parts or ".venv" in source_path.parts:
            continue

        tree = ast.parse(source_path.read_text(), filename=str(source_path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Attribute) or node.func.attr not in method_names:
                continue
            if not isinstance(node.func.value, ast.Name) or node.func.value.id != "EndUserService":
                continue

            type_arg = next((keyword.value for keyword in node.keywords if keyword.arg == "type"), None)
            if type_arg is None and node.args:
                type_arg = node.args[0]

            if not (
                isinstance(type_arg, ast.Attribute)
                and isinstance(type_arg.value, ast.Name)
                and type_arg.value.id == "EndUserType"
            ):
                violations.append(f"{source_path.relative_to(API_ROOT)}:{node.lineno}")

    assert violations == []
