"""end user constructors tests."""

import ast
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[3]


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
                uses_end_user_service_type_parameter = (
                    source_path.relative_to(API_ROOT) == Path("services/end_user_service.py")
                    and isinstance(value, ast.Name)
                    and value.id == "type"
                )
                if not (uses_end_user_type_member or uses_end_user_service_type_parameter):
                    violations.append(f"{source_path.relative_to(API_ROOT)}:{node.lineno}")

    assert violations == []
