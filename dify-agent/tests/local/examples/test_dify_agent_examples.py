from __future__ import annotations

import asyncio
import importlib
from pathlib import Path
from unittest.mock import create_autospec

import pytest

from dify_agent.protocol import (
    CreateRunResponse,
    RunEventsResponse,
    RunStatusResponse,
    RunSucceededEvent,
    RunSucceededEventData,
    SessionSnapshot,
)


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def test_dify_agent_examples_are_importable_from_repo_checkout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.syspath_prepend(str(PROJECT_ROOT / "examples" / "dify_agent"))

    for module_name in [
        "dify_agent_examples.run_pydantic_ai_agent",
        "dify_agent_examples.run_server_consumer",
        "dify_agent_examples.run_server_sse_consumer",
        "dify_agent_examples.run_server_sync_client",
    ]:
        importlib.import_module(module_name)


@pytest.mark.parametrize(
    "module_name",
    ["run_server_consumer", "run_server_sync_client", "run_server_sse_consumer"],
)
@pytest.mark.parametrize(
    ("token", "expected_headers"),
    [
        pytest.param(None, None, id="unset"),
        pytest.param("   ", None, id="blank"),
        pytest.param("test-token", {"Authorization": "Bearer test-token"}, id="token"),
        pytest.param(" \ttest-token \n", {"Authorization": "Bearer test-token"}, id="padded-token"),
    ],
)
def test_server_examples_configure_client(
    monkeypatch: pytest.MonkeyPatch, module_name: str, token: str | None, expected_headers: dict[str, str] | None
) -> None:
    monkeypatch.syspath_prepend(str(PROJECT_ROOT / "examples" / "dify_agent"))
    module = importlib.import_module(f"dify_agent_examples.{module_name}")
    if token is None:
        monkeypatch.delenv("DIFY_AGENT_API_TOKEN", raising=False)
    else:
        monkeypatch.setenv("DIFY_AGENT_API_TOKEN", token)

    client_factory = create_autospec(module.Client, spec_set=True)
    monkeypatch.setattr(module, "Client", client_factory)
    client = client_factory.return_value
    client.__enter__.return_value = client
    client.__aenter__.return_value = client

    run = CreateRunResponse(run_id="test-run", status="running")
    terminal_event = RunSucceededEvent(
        run_id=run.run_id,
        data=RunSucceededEventData(output="done", session_snapshot=SessionSnapshot(layers={})),
    )
    client.create_run.return_value = run
    client.create_run_sync.return_value = run
    # A terminal event on the first page lets polling finish before sleeping.
    client.get_events.return_value = RunEventsResponse(run_id=run.run_id, events=[terminal_event])
    client.stream_events.return_value.__aiter__.return_value = [terminal_event]
    client.wait_run_sync.return_value = RunStatusResponse(
        run_id=run.run_id,
        status="succeeded",
        created_at=terminal_event.created_at,
        updated_at=terminal_event.created_at,
    )

    if module_name == "run_server_sync_client":
        module.main()
        client.__enter__.assert_called_once_with()
        client.__exit__.assert_called_once_with(None, None, None)
    else:
        asyncio.run(module.main())
        client.__aenter__.assert_awaited_once_with()
        client.__aexit__.assert_awaited_once_with(None, None, None)

    client_factory.assert_called_once()
    options = client_factory.call_args.kwargs
    assert options["base_url"] == module.API_BASE_URL
    if expected_headers is None:
        assert options["headers"] is None
    else:
        assert options["headers"] == expected_headers
    if module_name == "run_server_sse_consumer":
        assert options["stream_timeout"] is None
