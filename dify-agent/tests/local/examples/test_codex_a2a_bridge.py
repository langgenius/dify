from __future__ import annotations

import asyncio
import importlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr


PROJECT_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_ROOT = PROJECT_ROOT / "examples" / "dify_agent"
FAKE_CODEX = Path(__file__).parent / "fixtures" / "fake_codex.py"
THREAD_ID = "019fd670-b2b8-78d3-bfde-c871345d9981"


@pytest.fixture
def bridge_modules(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    monkeypatch.syspath_prepend(str(EXAMPLES_ROOT))
    return SimpleNamespace(
        app=importlib.import_module("dify_agent_examples.codex_a2a_bridge.app"),
        entrypoint=importlib.import_module("dify_agent_examples.codex_a2a_bridge.__main__"),
        models=importlib.import_module("dify_agent_examples.codex_a2a_bridge.models"),
        runtime=importlib.import_module("dify_agent_examples.codex_a2a_bridge.runtime"),
        settings=importlib.import_module("dify_agent_examples.codex_a2a_bridge.settings"),
    )


def create_settings(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    api_token: SecretStr | None = None,
    bind_host: str = "127.0.0.1",
    public_url: str = "http://127.0.0.1:8765",
    allow_insecure_public_url: bool = False,
    streaming_enabled: bool = True,
) -> tuple[Any, Path, Path]:
    workspace = tmp_path / "allowed-workspace"
    workspace.mkdir(exist_ok=True)
    log_path = tmp_path / "fake-codex.jsonl"
    monkeypatch.setenv("FAKE_CODEX_LOG", str(log_path))
    settings = bridge_modules.settings.CodexBridgeSettings(
        workspace_root=workspace,
        bind_host=bind_host,
        public_url=public_url,
        allow_insecure_public_url=allow_insecure_public_url,
        streaming_enabled=streaming_enabled,
        codex_executable=str(FAKE_CODEX),
        model=None,
        reasoning_effort=None,
        sandbox_mode="read-only",
        cancel_grace_seconds=0.2,
        api_token=api_token,
    )
    return settings, workspace.resolve(), log_path


def request_payload(
    *,
    message_id: str,
    text: str,
    context_id: str | None = None,
    return_immediately: bool = False,
) -> dict[str, object]:
    message: dict[str, object] = {
        "messageId": message_id,
        "role": "ROLE_USER",
        "parts": [{"text": text}],
    }
    if context_id is not None:
        message["contextId"] = context_id
    return {
        "message": message,
        "configuration": {"returnImmediately": return_immediately},
    }


def test_entrypoint_reads_bridge_token_once_from_dedicated_fd_and_closes_it(
    bridge_modules: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read_fd, write_fd = os.pipe()
    os.write(write_fd, b"fd-only-token")
    os.close(write_fd)
    monkeypatch.delenv("DIFY_BYOA_CODEX_API_TOKEN", raising=False)
    monkeypatch.setenv("DIFY_BYOA_CODEX_API_TOKEN_FD", str(read_fd))

    token = bridge_modules.entrypoint._api_token_from_env()

    assert token is not None
    assert token.get_secret_value() == "fd-only-token"
    with pytest.raises(OSError):
        os.fstat(read_fd)


def test_parser_projects_real_codex_jsonl_without_arbitrary_payloads(bridge_modules: SimpleNamespace) -> None:
    parse = bridge_modules.runtime.parse_codex_json_line

    started = parse('{"type":"thread.started","thread_id":"019fd670-b2b8-78d3-bfde-c871345d9981"}')
    message = parse('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"BRIDGE_PROBE"}}')
    command = parse(
        '{"type":"item.completed","item":{"id":"cmd","type":"command_execution",'
        '"command":"printenv SECRET","aggregated_output":"SHOULD_NOT_LEAK"}}'
    )
    completed = parse(
        '{"type":"turn.completed","usage":{"input_tokens":18321,"cached_input_tokens":2432,'
        '"output_tokens":30,"reasoning_output_tokens":20}}'
    )

    assert started.thread_id == THREAD_ID
    assert message.agent_text == "BRIDGE_PROBE"
    assert message.item_id == "item_0"
    assert command.event_type == "item.completed.command_execution"
    assert command.agent_text is None
    assert "SHOULD_NOT_LEAK" not in repr(command)
    assert completed.turn_completed is True
    assert completed.usage == {
        "inputTokens": 18321,
        "cachedInputTokens": 2432,
        "outputTokens": 30,
        "reasoningOutputTokens": 20,
    }


def test_runtime_fixes_cwd_and_resumes_thread_by_context(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, workspace, log_path = create_settings(bridge_modules, tmp_path, monkeypatch)
    monkeypatch.setenv("DIFY_BYOA_CODEX_API_TOKEN", "must-not-reach-codex")

    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        runtime = bridge_modules.runtime.CodexA2ARuntime(settings)
        first_request = bridge_modules.models.SendMessageRequest.model_validate(
            {
                **request_payload(message_id="message-1", text="FIRST", context_id="context-1"),
                "cwd": "/",
                "metadata": {"cwd": "/private/should-not-be-used"},
            }
        )
        first, created = await runtime.start(first_request)
        assert created is True
        await asyncio.wait_for(first.done.wait(), timeout=5)

        duplicate, duplicate_created = await runtime.start(first_request)
        assert duplicate is first
        assert duplicate_created is False

        second_request = bridge_modules.models.SendMessageRequest.model_validate(
            request_payload(message_id="message-2", text="SECOND", context_id="context-1")
        )
        second, created = await runtime.start(second_request)
        assert created is True
        await asyncio.wait_for(second.done.wait(), timeout=5)
        first_task = first.to_dict()
        second_task = second.to_dict()
        await runtime.shutdown()
        return first_task, second_task

    first_task, second_task = asyncio.run(scenario())
    calls = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]

    assert first_task["status"]["state"] == "TASK_STATE_COMPLETED"
    assert first_task["metadata"]["codexThreadId"] == THREAD_ID
    assert first_task["metadata"]["codexUsage"]["inputTokens"] == 12
    assert first_task["artifacts"][0]["parts"][0]["text"] == "CODEX:FIRST"
    assert second_task["artifacts"][0]["parts"][0]["text"] == "RESUMED:SECOND"
    assert len(calls) == 2
    assert all(call["bridge_token_present"] is False for call in calls)
    assert calls[0]["cwd"] == str(workspace)
    assert calls[1]["cwd"] == str(workspace)
    first_cwd_index = calls[0]["argv"].index("-C") + 1
    assert calls[0]["argv"][first_cwd_index] == str(workspace)
    assert "resume" in calls[1]["argv"]
    assert THREAD_ID in calls[1]["argv"]
    assert "/private/should-not-be-used" not in json.dumps(calls)
    assert "/private/should-not-be-used" not in json.dumps(first_task)


def test_runtime_does_not_expose_command_output_or_cli_error(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, _workspace, _log_path = create_settings(bridge_modules, tmp_path, monkeypatch)

    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        runtime = bridge_modules.runtime.CodexA2ARuntime(settings)
        command_request = bridge_modules.models.SendMessageRequest.model_validate(
            request_payload(message_id="command-message", text="COMMAND")
        )
        command_task, _ = await runtime.start(command_request)
        await asyncio.wait_for(command_task.done.wait(), timeout=5)

        failure_request = bridge_modules.models.SendMessageRequest.model_validate(
            request_payload(message_id="failure-message", text="FAIL")
        )
        failure_task, _ = await runtime.start(failure_request)
        await asyncio.wait_for(failure_task.done.wait(), timeout=5)
        result = command_task.to_dict(), failure_task.to_dict()
        await runtime.shutdown()
        return result

    command_task, failure_task = asyncio.run(scenario())
    serialized = json.dumps([command_task, failure_task])

    assert "item.completed.command_execution" in command_task["metadata"]["codexEventTypes"]
    assert "SHOULD_NOT_LEAK" not in serialized
    assert failure_task["status"]["state"] == "TASK_STATE_FAILED"
    assert failure_task["status"]["message"]["parts"][0]["text"] == "Codex turn failed"


def test_non_loopback_bind_requires_bearer_token(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError, match="API_TOKEN is required"):
        create_settings(
            bridge_modules,
            tmp_path,
            monkeypatch,
            bind_host="0.0.0.0",
        )

    secured_settings, _workspace, _log_path = create_settings(
        bridge_modules,
        tmp_path,
        monkeypatch,
        bind_host="::",
        api_token=SecretStr("local-token"),
    )
    assert secured_settings.bind_host == "::"


def test_public_url_beyond_loopback_requires_bearer_token(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError, match="API_TOKEN is required"):
        create_settings(
            bridge_modules,
            tmp_path,
            monkeypatch,
            public_url="https://local-codex.example.com",
        )

    secured_settings, _workspace, _log_path = create_settings(
        bridge_modules,
        tmp_path,
        monkeypatch,
        api_token=SecretStr("local-token"),
        public_url="https://local-codex.example.com",
    )
    assert secured_settings.public_url == "https://local-codex.example.com"


def test_public_url_beyond_loopback_requires_https_without_explicit_development_override(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValueError, match="must use HTTPS"):
        create_settings(
            bridge_modules,
            tmp_path,
            monkeypatch,
            api_token=SecretStr("local-token"),
            public_url="http://host.docker.internal:8765",
        )

    development_settings, _workspace, _log_path = create_settings(
        bridge_modules,
        tmp_path,
        monkeypatch,
        api_token=SecretStr("local-token"),
        public_url="http://host.docker.internal:8765",
        allow_insecure_public_url=True,
    )
    assert development_settings.allow_insecure_public_url is True


def test_long_artifact_is_streamed_as_bounded_utf8_json_chunks(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, _workspace, _log_path = create_settings(bridge_modules, tmp_path, monkeypatch)

    async def scenario() -> tuple[dict[str, Any], list[dict[str, Any]]]:
        runtime = bridge_modules.runtime.CodexA2ARuntime(settings)
        request = bridge_modules.models.SendMessageRequest.model_validate(
            request_payload(message_id="long-message", text="LONG")
        )
        record, _ = await runtime.start(request)
        await asyncio.wait_for(record.done.wait(), timeout=10)
        result = record.to_dict(), list(record.events)
        await runtime.shutdown()
        return result

    task, events = asyncio.run(scenario())
    artifact_events = [event for event in events if "artifactUpdate" in event]

    assert task["status"]["state"] == "TASK_STATE_COMPLETED"
    assert len(artifact_events) > 1
    assert artifact_events[0]["artifactUpdate"]["append"] is False
    assert artifact_events[0]["artifactUpdate"]["lastChunk"] is False
    assert all(event["artifactUpdate"]["append"] is True for event in artifact_events[1:])
    assert artifact_events[-1]["artifactUpdate"]["lastChunk"] is True
    assert all(
        len(json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        < bridge_modules.runtime.A2A_SSE_EVENT_MAX_BYTES
        for event in artifact_events
    )
    streamed_text = "".join(event["artifactUpdate"]["artifact"]["parts"][0]["text"] for event in artifact_events)
    assert streamed_text == task["artifacts"][0]["parts"][0]["text"]


def test_http_json_agent_card_send_stream_get_and_cancel(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, _workspace, _log_path = create_settings(bridge_modules, tmp_path, monkeypatch)
    app = bridge_modules.app.create_app(settings)

    with TestClient(app) as client:
        card_response = client.get("/.well-known/agent-card.json")
        assert card_response.status_code == 200
        assert card_response.headers["content-type"].startswith("application/a2a+json")
        card = card_response.json()
        assert card["supportedInterfaces"] == [
            {
                "url": "http://127.0.0.1:8765",
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ]
        assert card["capabilities"]["streaming"] is True
        assert card["securitySchemes"] == {}
        assert card["securityRequirements"] == []

        bad_version = client.post(
            "/message:send",
            headers={"A2A-Version": "0.3"},
            json=request_payload(message_id="bad-version", text="NOPE"),
        )
        assert bad_version.status_code == 400
        assert bad_version.headers["content-type"].startswith("application/a2a+json")
        assert bad_version.json()["error"]["status"] == "FAILED_PRECONDITION"
        assert bad_version.json()["error"]["details"][0]["reason"] == "VERSION_NOT_SUPPORTED"

        send_response = client.post(
            "/message:send",
            headers={"A2A-Version": "1.0"},
            json=request_payload(message_id="http-send", text="HELLO"),
        )
        assert send_response.status_code == 200
        assert send_response.headers["content-type"].startswith("application/a2a+json")
        task = send_response.json()["task"]
        assert task["status"]["state"] == "TASK_STATE_COMPLETED"
        assert task["metadata"]["codexThreadId"] == THREAD_ID

        get_response = client.get(f"/tasks/{task['id']}?historyLength=1")
        assert get_response.status_code == 200
        assert get_response.json()["id"] == task["id"]
        assert len(get_response.json()["history"]) == 1

        completed_cancel = client.post(f"/tasks/{task['id']}:cancel")
        assert completed_cancel.status_code == 400
        assert completed_cancel.json()["error"]["status"] == "FAILED_PRECONDITION"
        assert completed_cancel.json()["error"]["details"][0]["reason"] == "TASK_NOT_CANCELABLE"

        unsupported_input = client.post(
            "/message:send",
            json={
                "message": {
                    "messageId": "unsupported-input",
                    "role": "ROLE_USER",
                    "parts": [{"data": {"command": "NOPE"}}],
                }
            },
        )
        assert unsupported_input.status_code == 400
        assert unsupported_input.json()["error"]["details"][0]["reason"] == "CONTENT_TYPE_NOT_SUPPORTED"

        with client.stream(
            "POST",
            "/message:stream",
            json=request_payload(message_id="http-stream", text="STREAM"),
        ) as stream_response:
            stream_body = "".join(stream_response.iter_text())
        events = [json.loads(line.removeprefix("data: ")) for line in stream_body.splitlines() if line]
        assert stream_response.status_code == 200
        assert stream_response.headers["content-type"].startswith("text/event-stream")
        assert "task" in events[0]
        assert any("artifactUpdate" in event for event in events)
        assert events[-1]["statusUpdate"]["status"]["state"] == "TASK_STATE_COMPLETED"
        assert events[-1]["statusUpdate"]["metadata"]["codexThreadId"] == THREAD_ID

        subscribable = client.post(
            "/message:send",
            json=request_payload(message_id="http-subscribe", text="SUBSCRIBE", return_immediately=True),
        ).json()["task"]
        with client.stream("GET", f"/tasks/{subscribable['id']}:subscribe") as subscribe_response:
            subscribe_body = "".join(subscribe_response.iter_text())
        subscribe_events = [json.loads(line.removeprefix("data: ")) for line in subscribe_body.splitlines() if line]
        assert subscribe_response.status_code == 200
        assert subscribe_events[0]["task"]["id"] == subscribable["id"]
        assert subscribe_events[-1]["statusUpdate"]["status"]["state"] == "TASK_STATE_COMPLETED"

        terminal_subscription = client.get(f"/tasks/{subscribable['id']}:subscribe")
        assert terminal_subscription.status_code == 400
        assert terminal_subscription.json()["error"]["details"][0]["reason"] == "UNSUPPORTED_OPERATION"

        submitted = client.post(
            "/message:send",
            json=request_payload(message_id="http-cancel", text="WAIT", return_immediately=True),
        ).json()["task"]
        cancel_response = client.post(f"/tasks/{submitted['id']}:cancel")
        assert cancel_response.status_code == 200
        assert cancel_response.json()["status"]["state"] == "TASK_STATE_CANCELED"


def test_agent_card_can_disable_streaming_for_buffering_relays(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, _workspace, _log_path = create_settings(
        bridge_modules,
        tmp_path,
        monkeypatch,
        streaming_enabled=False,
    )

    with TestClient(bridge_modules.app.create_app(settings)) as client:
        card = client.get("/.well-known/agent-card.json").json()

    assert card["capabilities"]["streaming"] is False


def test_optional_bearer_token_is_advertised_and_enforced(
    bridge_modules: SimpleNamespace,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, _workspace, _log_path = create_settings(
        bridge_modules,
        tmp_path,
        monkeypatch,
        api_token=SecretStr("test-token"),
    )

    with TestClient(bridge_modules.app.create_app(settings)) as client:
        card = client.get("/.well-known/agent-card.json").json()
        assert card["securitySchemes"]["bearerAuth"]["httpAuthSecurityScheme"]["scheme"] == "Bearer"
        assert card["securityRequirements"] == [{"schemes": {"bearerAuth": {"list": []}}}]
        unauthorized = client.post(
            "/message:send",
            json=request_payload(message_id="unauthorized", text="NOPE"),
        )
        assert unauthorized.status_code == 401
        assert unauthorized.headers["www-authenticate"] == "Bearer"
        assert unauthorized.headers["content-type"].startswith("application/a2a+json")
        assert unauthorized.json()["error"]["status"] == "UNAUTHENTICATED"

        authorized = client.post(
            "/message:send",
            headers={"Authorization": "Bearer test-token"},
            json=request_payload(message_id="authorized", text="OK"),
        )
        assert authorized.status_code == 200
        assert authorized.json()["task"]["status"]["state"] == "TASK_STATE_COMPLETED"
