from __future__ import annotations

import tomllib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]

CLIENT_SHARED_DTO_DEPENDENCIES = {
    "httpx==0.28.1",
    "pydantic>=2.12.5,<2.13",
    "pydantic-ai-slim>=1.85.1,<2.0.0",
    "typer>=0.16.1,<0.17",
    "typing-extensions>=4.12.2,<5.0.0",
}

SERVER_RUNTIME_DEPENDENCIES = {
    "fastapi==0.136.0",
    "graphon==0.2.2",
    "jsonschema>=4.23.0,<5.0.0",
    "jwcrypto>=1.5.6,<2",
    "pydantic-ai-slim[anthropic,google,openai]>=1.85.1,<2.0.0",
    "pydantic-settings>=2.12.0,<3.0.0",
    "redis>=7.4.0,<8.0.0",
    "shell-session-manager==2.2.0",
    "uvicorn[standard]==0.46.0",
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


def test_project_declares_console_script_and_shellctl_docker_version() -> None:
    pyproject = _read_pyproject()
    scripts = pyproject["project"]["scripts"]
    dockerfile = (PROJECT_ROOT / "docker" / "shellctl" / "Dockerfile").read_text(encoding="utf-8")

    assert scripts["dify-agent"] == "dify_agent.agent_stub.cli.main:main"
    assert scripts["dify-agent-stub-server"] == "dify_agent.agent_stub.server.cli:main"
    assert "shell-session-manager==2.2.0" in dockerfile
