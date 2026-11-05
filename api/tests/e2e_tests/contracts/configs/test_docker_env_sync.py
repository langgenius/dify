"""Upgrades must preserve overrides omitted from the minimal Docker template."""

import subprocess
import sys
from pathlib import Path

import pytest
from dotenv import dotenv_values

_DOCKER = Path(__file__).resolve().parents[5] / "docker"


@pytest.mark.parametrize("script", ["dify-env-sync.py", "dify-env-sync.sh"])
@pytest.mark.parametrize(
    "existing",
    [
        None,
        "",
        "# Local settings\nCOMPOSE_PROFILES=mysql,qdrant\n"
        "OPS_TRACE_QUEUE=custom_trace_queue\nREDIS_PASSWORD='space # $ = value'\n"
        "MULTILINE='first line\nsecond=line'\nEMPTY=\nLITERAL='$(touch unexpected)'",
    ],
)
def test_sync_preserves_local_overrides(tmp_path: Path, script: str, existing: str | None) -> None:
    (tmp_path / ".env.example").write_text(
        "# Deployment inputs\nCOMPOSE_PROFILES=postgresql,weaviate\nNEW_INPUT=value\n"
    )
    env_file = tmp_path / ".env"
    if existing is not None:
        env_file.write_text(existing)
        env_file.chmod(0o600)

    command = [sys.executable if script.endswith(".py") else "bash", str(_DOCKER / script)]
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    updated = env_file.read_text()
    if existing is not None:
        assert updated.startswith(existing)
        assert env_file.stat().st_mode & 0o777 == 0o600
        assert next((tmp_path / "env-backup").iterdir()).read_text() == existing
    values = dotenv_values(env_file, interpolate=False)
    assert values["NEW_INPUT"] == "value"
    if existing:
        assert values["COMPOSE_PROFILES"] == "mysql,qdrant"
        assert values["OPS_TRACE_QUEUE"] == "custom_trace_queue"
        assert values["REDIS_PASSWORD"] == "space # $ = value"
        assert values["MULTILINE"] == "first line\nsecond=line"
        assert values["EMPTY"] == ""
        assert values["LITERAL"] == "$(touch unexpected)"
    else:
        assert values["COMPOSE_PROFILES"] == "postgresql,weaviate"
    assert not (tmp_path / "unexpected").exists()

    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert env_file.read_text() == updated
