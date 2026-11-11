"""Repositories must initialize without application services being imported first."""

import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    "module",
    [
        "repositories.workflow.definition_repository",
        "repositories.agent.creation_repository",
        "repositories.agent.workflow_binding_repository",
    ],
)
def test_repository_imports_in_a_fresh_process(module: str) -> None:
    result = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=Path(__file__).resolve().parents[4],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
