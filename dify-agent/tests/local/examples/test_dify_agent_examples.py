from __future__ import annotations

import asyncio
import importlib
from functools import partial
from pathlib import Path
from types import ModuleType
from unittest.mock import create_autospec

import httpx
import pytest

from dify_agent.protocol import (
    CreateRunResponse,
    RunEventsResponse,
    RunStatusResponse,
    RunSucceededEvent,
    RunSucceededEventData,
    SessionSnapshot,
)
from tests.local.dify_agent.adapters.llm._test_support import build_stream_response, single_text_chunk


PROJECT_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def pydantic_ai_example(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> ModuleType:
    monkeypatch.syspath_prepend(str(PROJECT_ROOT / "examples" / "dify_agent"))
    example = importlib.import_module("dify_agent_examples.run_pydantic_ai_agent")
    monkeypatch.setattr(example, "PROJECT_ROOT", tmp_path)
    return example


@pytest.fixture
def example_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    settings = {
        "DIFY_AGENT_INNER_API_URL": "https://dify-api.example.test",
        "DIFY_AGENT_INNER_API_KEY": "inner-secret",
        "DIFY_AGENT_TENANT_ID": "tenant-1",
        "DIFY_AGENT_USER_ID": "user-1",
        "DIFY_AGENT_APP_ID": "app-1",
        "DIFY_AGENT_PLUGIN_ID": "langgenius/openai",
        "DIFY_AGENT_PROVIDER": "openai",
        "DIFY_AGENT_MODEL_NAME": "gpt-test",
    }
    for name in (*settings, "DIFY_INNER_API_URL", "DIFY_INNER_API_KEY"):
        # Register absent keys for cleanup too, since the dotenv loader can add them.
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)
    return settings


@pytest.fixture
def gateway_requests(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return build_stream_response(*single_text_chunk("done"))

    monkeypatch.setattr(httpx, "AsyncClient", partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)))
    return requests


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


def test_pydantic_ai_example_loads_inner_api_settings(
    pydantic_ai_example: ModuleType,
    example_env: dict[str, str],
    tmp_path: Path,
    gateway_requests: list[httpx.Request],
) -> None:
    (tmp_path / ".env").write_text(
        "".join(f"{name}={value}\n" for name, value in example_env.items()), encoding="utf-8"
    )

    asyncio.run(pydantic_ai_example.main())

    assert len(gateway_requests) == 1
    request = gateway_requests[0]
    assert request.url == f"{example_env['DIFY_AGENT_INNER_API_URL']}/inner/api/agent/llm/invoke"
    assert request.headers["X-Inner-Api-Key"] == example_env["DIFY_AGENT_INNER_API_KEY"]


@pytest.mark.parametrize(
    ("missing_name", "legacy_setting"),
    [
        pytest.param("DIFY_AGENT_INNER_API_URL", {}, id="missing-url"),
        pytest.param("DIFY_AGENT_INNER_API_KEY", {}, id="missing-key"),
        pytest.param(
            "DIFY_AGENT_INNER_API_URL", {"DIFY_INNER_API_URL": "https://legacy-api.example.test"}, id="legacy-url"
        ),
        pytest.param("DIFY_AGENT_INNER_API_KEY", {"DIFY_INNER_API_KEY": "legacy-secret"}, id="legacy-key"),
    ],
)
def test_pydantic_ai_example_requires_documented_inner_api_settings(
    pydantic_ai_example: ModuleType,
    example_env: dict[str, str],
    tmp_path: Path,
    gateway_requests: list[httpx.Request],
    missing_name: str,
    legacy_setting: dict[str, str],
) -> None:
    del example_env[missing_name]
    example_env.update(legacy_setting)
    (tmp_path / ".env").write_text(
        "".join(f"{name}={value}\n" for name, value in example_env.items()), encoding="utf-8"
    )

    with pytest.raises(RuntimeError, match=f"^Missing required environment variable: {missing_name}$"):
        asyncio.run(pydantic_ai_example.main())

    assert gateway_requests == []
