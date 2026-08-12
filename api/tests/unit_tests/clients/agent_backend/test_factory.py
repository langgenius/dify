from __future__ import annotations

import pytest

import clients.agent_backend.factory as factory_module


def test_factory_passes_stream_read_timeout_to_public_client(monkeypatch: pytest.MonkeyPatch) -> None:
    created_clients: list[RecordingPublicClient] = []

    class RecordingPublicClient:
        def __init__(
            self,
            *,
            base_url: str,
            stream_timeout: float,
            headers: dict[str, str],
        ) -> None:
            del base_url, headers
            self.stream_timeout = stream_timeout
            created_clients.append(self)

    monkeypatch.setattr(factory_module, "Client", RecordingPublicClient)

    _ = factory_module.create_agent_backend_run_client(
        base_url="http://agent-backend.example",
        api_token="secret",
        stream_read_timeout_seconds=17.5,
    )

    assert len(created_clients) == 1
    assert created_clients[0].stream_timeout == 17.5
