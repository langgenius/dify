from dify_agent.server.settings import ServerSettings


def test_server_settings_reads_shellctl_entrypoint_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", "http://shellctl.example")

    settings = ServerSettings()

    assert settings.shellctl_entrypoint == "http://shellctl.example"
