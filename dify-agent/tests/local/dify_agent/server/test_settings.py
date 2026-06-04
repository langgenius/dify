from pathlib import Path

import pytest

from dify_agent.server.settings import ServerSettings


def test_server_settings_reads_shellctl_entrypoint_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", "http://shellctl.example")

    settings = ServerSettings()

    assert settings.shellctl_entrypoint == "http://shellctl.example"


def test_server_settings_reads_shellctl_auth_token_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", "shell-secret")

    settings = ServerSettings()

    assert settings.shellctl_auth_token == "shell-secret"


def test_server_settings_defaults_shellctl_auth_token_to_none(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.shellctl_auth_token is None
