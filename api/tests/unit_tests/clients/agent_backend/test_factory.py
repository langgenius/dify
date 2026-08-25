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
