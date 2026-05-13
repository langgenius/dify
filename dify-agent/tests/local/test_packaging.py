from __future__ import annotations

import tomllib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]

CLIENT_SHARED_DTO_DEPENDENCIES = {
    "httpx>=0.28.1",
    "pydantic>=2.13.3",
    "pydantic-ai-slim>=1.85.1",
    "typing-extensions>=4.12.2",
}

SERVER_RUNTIME_DEPENDENCIES = {
    "fastapi>=0.136.0",
    "graphon~=0.2.2",
    "jsonschema>=4.23.0",
    "pydantic-ai-slim[anthropic,google,openai]>=1.85.1",
    "pydantic-settings>=2.12.0",
    "redis>=5",
    "uvicorn[standard]>=0.38.0",
}


def _read_pyproject():
    return tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def test_project_dependencies_split_client_and_server_requirements() -> None:
    pyproject = _read_pyproject()
    project = pyproject["project"]

    assert set(project["dependencies"]) == CLIENT_SHARED_DTO_DEPENDENCIES
    assert set(project["optional-dependencies"]["server"]) == SERVER_RUNTIME_DEPENDENCIES


def test_default_package_discovery_excludes_example_packages() -> None:
    pyproject = _read_pyproject()
    find_config = pyproject["tool"]["setuptools"]["packages"]["find"]

    assert find_config["where"] == ["src"]
    assert "agenton_examples*" not in find_config["include"]
    assert "dify_agent_examples*" not in find_config["include"]
