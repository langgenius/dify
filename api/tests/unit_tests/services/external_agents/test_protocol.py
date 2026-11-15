"""Keep consumer-owned BYOA profile values free from infrastructure imports."""

import ast
from pathlib import Path

import pytest


@pytest.mark.parametrize("module", ["protocol", "io_contracts", "file_profile", "output_mapping"])
def test_profile_values_and_mapping_do_not_import_runtime_infrastructure(module: str) -> None:
    api = Path(__file__).resolve().parents[4]
    source = api / "services" / "external_agents" / f"{module}.py"
    forbidden = {
        "core",
        "configs",
        "extensions",
        "models",
        "repositories",
        "providers",
        "controllers",
        "flask",
        "sqlalchemy",
        "celery",
        "tasks",
    }
    imported = set()
    for node in ast.walk(ast.parse(source.read_text())):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            imported.add(node.module.split(".")[0])
    assert imported.isdisjoint(forbidden)
