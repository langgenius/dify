"""Exercise provider snapshots through the real host parsing and runtime boundaries."""

import json
from collections.abc import Generator, Iterator
from types import SimpleNamespace

import pytest
from pydantic import JsonValue
from pytest_mock import MockerFixture

from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import RequestInvokeLLM
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from models.account import Tenant


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(
    "opaque_body",
    [
        {
            "anthropic_content": [
                {"type": "thinking", "thinking": "summary", "signature": "original signature"},
                {"type": "tool_use", "id": "call-1", "name": "tool", "input": {"value": 9007199254740993}},
            ]
        },
        {
            "responses_output": [
                {"type": "reasoning", "id": "rs-1", "encrypted_content": "encrypted"},
                {"type": "message", "id": "msg-1", "phase": "commentary", "content": []},
            ]
        },
        {},
    ],
)
def test_replay_survives_daemon_json_runtime_and_backwards_request(
    mocker: MockerFixture, stream: bool, opaque_body: dict[str, JsonValue]
) -> None:
    client = PluginModelClient()
    # Stub only the wire transport. PluginDaemonBasicResponse parsing, runtime
    # normalization and both backwards-invocation branches execute unchanged.

    def frames() -> Iterator[str]:
        for message in [
            {"role": "assistant", "content": "answer", "opaque_body": opaque_body},
            {"role": "assistant", "content": ""},
        ]:
            yield json.dumps(
                {
                    "code": 0,
                    "message": "",
                    "data": {
                        "model": "model",
                        "delta": {"index": 0, "message": message},
                    },
                }
            )

    transport = mocker.patch.object(client, "_stream_request", side_effect=lambda *_args: frames())
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client, plugin_service=PluginService)
    bound_model = SimpleNamespace(
        invoke_llm=lambda **kwargs: runtime.invoke_llm(
            provider="langgenius/provider/provider", model="model", credentials={}, **kwargs
        )
    )
    mocker.patch.object(PluginModelBackwardsInvocation, "_get_bound_model_instance", return_value=bound_model)
    prompt_messages: list[dict[str, object]] = [{"role": "user", "content": "query"}]
    request = {
        "provider": "langgenius/provider/provider",
        "model": "model",
        "mode": "chat",
        "stream": stream,
        "prompt_messages": prompt_messages,
    }
    payload = RequestInvokeLLM.model_validate_json(json.dumps(request))
    tenant = Tenant(name="Replay")
    tenant.id = "tenant"
    result = PluginModelBackwardsInvocation.invoke_llm("user", tenant, payload)
    assert isinstance(result, Generator)
    chunks = list(result)
    assistant = next(chunk.delta.message for chunk in chunks if chunk.delta.message.opaque_body is not None)
    assert assistant.opaque_body == opaque_body
    assert all(chunk.prompt_messages == [] for chunk in chunks)

    # Cross the actual backwards request parser, then the outgoing provider JSON encoder.
    prompt_messages.append(assistant.model_dump(mode="json"))
    replay = RequestInvokeLLM.model_validate_json(json.dumps(request))
    result = PluginModelBackwardsInvocation.invoke_llm("user", tenant, replay)
    assert isinstance(result, Generator)
    list(result)
    outgoing = transport.call_args.args[4]
    assert outgoing["data"]["prompt_messages"][-1]["opaque_body"] == opaque_body
