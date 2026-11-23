from __future__ import annotations

import asyncio
import importlib
from functools import partial
from pathlib import Path
from types import ModuleType

import httpx
import pytest

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
