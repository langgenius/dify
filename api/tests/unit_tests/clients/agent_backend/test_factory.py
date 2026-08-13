from unittest.mock import patch

import pytest

from clients.agent_backend.factory import create_agent_backend_client


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
def test_create_agent_backend_client_forwards_authentication(client_cls, api_token, headers) -> None:
    create_agent_backend_client(base_url="http://agent-backend", api_token=api_token)

    client_cls.assert_called_once_with(
        base_url="http://agent-backend",
        stream_timeout=30,
        headers=headers,
    )
