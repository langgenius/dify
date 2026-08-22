from collections.abc import Callable
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from dify_agent.client import Client

from clients.agent_backend.factory import create_agent_backend_client, create_agent_backend_run_client
from configs import dify_config
from services import agent_app_sandbox_service
from services.agent import home_snapshot_service, workspace_service


@pytest.mark.parametrize(
    ("api_token", "headers"),
    [
        ("secret-token", {"Authorization": "Bearer secret-token"}),
        (" secret-token ", {"Authorization": "Bearer secret-token"}),
        ("  ", None),
        (None, None),
    ],
)
@patch("clients.agent_backend.factory.Client")
def test_create_agent_backend_client_forwards_authentication(
    client_cls: MagicMock,
    api_token: str | None,
    headers: dict[str, str] | None,
) -> None:
    create_agent_backend_client(base_url="http://agent-backend", api_token=api_token)

    client_cls.assert_called_once_with(
        base_url="http://agent-backend",
        stream_timeout=30,
        timeout=30.0,
        binding_file_download_timeout=240,
        headers=headers,
    )


@patch("clients.agent_backend.factory.create_agent_backend_client")
def test_create_agent_backend_run_client_forwards_stream_read_timeout(create_client: MagicMock) -> None:
    create_agent_backend_run_client(
        base_url="http://agent-backend",
        api_token="secret-token",
        stream_read_timeout_seconds=17.5,
    )

    create_client.assert_called_once_with(
        base_url="http://agent-backend",
        api_token="secret-token",
        stream_timeout=17.5,
    )


@pytest.mark.parametrize(
    ("factory", "module", "extra_kwargs"),
    [
        (
            home_snapshot_service.AgentHomeSnapshotService._client,
            home_snapshot_service,
            {"timeout": dify_config.AGENT_BACKEND_HOME_SNAPSHOT_TIMEOUT_SECONDS},
        ),
        (
            workspace_service.AgentWorkspaceService._client,
            workspace_service,
            {"timeout": dify_config.AGENT_BACKEND_HOME_SNAPSHOT_TIMEOUT_SECONDS},
        ),
        (
            agent_app_sandbox_service._default_client_factory,
            agent_app_sandbox_service,
            {"binding_file_download_timeout": 123.5},
        ),
    ],
)
def test_default_agent_backend_clients_forward_authentication(
    monkeypatch: pytest.MonkeyPatch,
    factory: Callable[[], Client],
    module: ModuleType,
    extra_kwargs: dict[str, float],
) -> None:
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BASE_URL", "http://agent-backend")
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_API_TOKEN", "secret-token")
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS", 123.5)
    create_client = MagicMock()
    monkeypatch.setattr(module, "create_agent_backend_client", create_client)

    factory()

    create_client.assert_called_once_with(
        base_url="http://agent-backend",
        api_token="secret-token",
        **extra_kwargs,
    )


def test_missing_base_url_raises_helpful_error() -> None:
    """When AGENT_BACKEND_BASE_URL is not set, the error should mention the
    environment variable and suggest alternatives (issue #39161)."""
    with pytest.raises(ValueError) as exc_info:
        create_agent_backend_run_client(base_url=None)

    message = str(exc_info.value)
    # The error must mention the env var name so users know what to set.
    assert "AGENT_BACKEND_BASE_URL" in message
    # The error should hint at the classic Agent app as an alternative.
    assert "agent-chat" in message


def test_use_fake_does_not_require_base_url() -> None:
    """The fake client path should not raise even when base_url is None."""
    client = create_agent_backend_run_client(use_fake=True, base_url=None)
    assert client is not None
