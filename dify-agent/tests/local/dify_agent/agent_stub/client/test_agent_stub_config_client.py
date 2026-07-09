from __future__ import annotations

import json

import httpx
import pytest

from dify_agent.agent_stub.client._agent_stub import (
    request_agent_stub_config_env_update_sync,
    request_agent_stub_config_file_pull_sync,
    request_agent_stub_config_manifest_sync,
    request_agent_stub_config_note_update_sync,
    request_agent_stub_config_push_sync,
    request_agent_stub_config_skill_inspect_sync,
    request_agent_stub_config_skill_pull_sync,
)
from dify_agent.agent_stub.client._agent_stub_http import (
    request_agent_stub_config_env_update_http_sync,
    request_agent_stub_config_file_pull_http_sync,
    request_agent_stub_config_manifest_http_sync,
    request_agent_stub_config_note_update_http_sync,
    request_agent_stub_config_push_http_sync,
    request_agent_stub_config_skill_inspect_http_sync,
    request_agent_stub_config_skill_pull_http_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubClientError, AgentStubHTTPError, AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConfigPushRequest


def _manifest_payload() -> dict[str, object]:
    return {
        "agent_id": "agent-1",
        "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
        "skills": {"items": [{"name": "alpha", "description": "Alpha skill"}]},
        "files": {"items": [{"name": "guide.txt"}]},
        "env_keys": ["API_KEY"],
        "note": "Use carefully.",
    }


def test_config_manifest_sync_normalizes_url_and_uses_http_transport() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/manifest"
        assert request.headers["Authorization"] == "Bearer test-jwe"
        return httpx.Response(200, json=_manifest_payload())

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_agent_stub_config_manifest_sync(
            url="https://agent.example.com/agent-stub/",
            auth_jwe="test-jwe",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.agent_id == "agent-1"


@pytest.mark.parametrize(
    ("func", "kwargs"),
    [
        (request_agent_stub_config_manifest_sync, {}),
        (request_agent_stub_config_skill_pull_sync, {"name": "alpha"}),
        (request_agent_stub_config_skill_inspect_sync, {"name": "alpha"}),
        (request_agent_stub_config_file_pull_sync, {"name": "guide.txt"}),
        (request_agent_stub_config_push_sync, {"request": AgentStubConfigPushRequest(note="hello")}),
        (request_agent_stub_config_env_update_sync, {"env_text": "API_KEY=value\n"}),
        (request_agent_stub_config_note_update_sync, {"note": "hello"}),
    ],
)
def test_config_sync_entrypoints_reject_grpc_urls(func, kwargs: dict[str, object]) -> None:
    with pytest.raises(AgentStubValidationError, match="require an HTTP Agent Stub URL"):
        func(
            url="grpc://agent.example.com:9091",
            auth_jwe="test-jwe",
            **kwargs,
        )


def test_request_agent_stub_config_manifest_http_sync_gets_manifest() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/manifest"
        assert request.headers["Authorization"] == "Bearer test-jwe"
        return httpx.Response(200, json=_manifest_payload())

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_agent_stub_config_manifest_http_sync(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.agent_id == "agent-1"
    assert response.config_version.kind == "build_draft"


def test_request_agent_stub_config_skill_pull_http_sync_returns_binary_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/skills/alpha/pull"
        return httpx.Response(200, content=b"zip-bytes")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = request_agent_stub_config_skill_pull_http_sync(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            name="alpha",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload == b"zip-bytes"


def test_request_agent_stub_config_skill_inspect_http_sync_returns_json_dict() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/skills/alpha/inspect"
        return httpx.Response(200, json={"name": "alpha", "files": ["SKILL.md"]})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = request_agent_stub_config_skill_inspect_http_sync(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            name="alpha",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload == {"name": "alpha", "files": ["SKILL.md"]}


def test_request_agent_stub_config_file_pull_http_sync_returns_binary_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/files/guide.txt/pull"
        return httpx.Response(200, content=b"file-bytes")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = request_agent_stub_config_file_pull_http_sync(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            name="guide.txt",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload == b"file-bytes"


def test_request_agent_stub_config_push_http_sync_posts_json_and_validates_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/agent-stub/config/push"
        assert json.loads(request.content) == {"note": "hello"}
        return httpx.Response(200, json=_manifest_payload())

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_agent_stub_config_push_http_sync(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            request=AgentStubConfigPushRequest(note="hello"),
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.note == "Use carefully."


@pytest.mark.parametrize(
    ("func", "kwargs", "expected_path", "expected_body", "expected_response"),
    [
        (
            request_agent_stub_config_env_update_http_sync,
            {"env_text": "API_KEY=value\n"},
            "https://agent.example.com/agent-stub/config/env",
            {"env_text": "API_KEY=value\n"},
            {"env_keys": ["API_KEY"]},
        ),
        (
            request_agent_stub_config_note_update_http_sync,
            {"note": "hello"},
            "https://agent.example.com/agent-stub/config/note",
            {"note": "hello"},
            {"note": "hello"},
        ),
    ],
)
def test_config_update_http_entrypoints_round_trip_json(
    func,
    kwargs: dict[str, object],
    expected_path: str,
    expected_body: dict[str, object],
    expected_response: dict[str, object],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == expected_path
        assert json.loads(request.content) == expected_body
        return httpx.Response(200, json=expected_response)

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = func(
            base_url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            sync_http_client=http_client,
            **kwargs,
        )
    finally:
        http_client.close()

    assert payload == expected_response


@pytest.mark.parametrize(
    ("func", "kwargs", "response", "expected_error", "expected_match"),
    [
        (
            request_agent_stub_config_manifest_http_sync,
            {},
            httpx.Response(401, json={"detail": "denied"}),
            AgentStubHTTPError,
            "401",
        ),
        (
            request_agent_stub_config_manifest_http_sync,
            {},
            httpx.Response(200, text="not-json", headers={"Content-Type": "application/json"}),
            AgentStubClientError,
            "invalid JSON",
        ),
        (
            request_agent_stub_config_push_http_sync,
            {"request": AgentStubConfigPushRequest(note="hello")},
            httpx.Response(200, json={"bad": "shape"}),
            AgentStubValidationError,
            "config push response",
        ),
        (
            request_agent_stub_config_skill_pull_http_sync,
            {"name": "alpha"},
            httpx.Response(404, json={"detail": "missing"}),
            AgentStubHTTPError,
            "404",
        ),
        (
            request_agent_stub_config_skill_inspect_http_sync,
            {"name": "alpha"},
            httpx.Response(200, json=["bad"]),
            AgentStubValidationError,
            "config skill inspect response",
        ),
        (
            request_agent_stub_config_file_pull_http_sync,
            {"name": "guide.txt"},
            httpx.Response(404, json={"detail": "missing"}),
            AgentStubHTTPError,
            "404",
        ),
        (
            request_agent_stub_config_env_update_http_sync,
            {"env_text": "API_KEY=value\n"},
            httpx.Response(200, json=["bad"]),
            AgentStubValidationError,
            "config env update response",
        ),
        (
            request_agent_stub_config_note_update_http_sync,
            {"note": "hello"},
            httpx.Response(200, text="not-json", headers={"Content-Type": "application/json"}),
            AgentStubClientError,
            "invalid JSON",
        ),
    ],
)
def test_config_http_entrypoints_map_http_json_and_validation_errors(
    func,
    kwargs: dict[str, object],
    response: httpx.Response,
    expected_error: type[Exception],
    expected_match: str,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return response

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(expected_error, match=expected_match):
            func(
                base_url="https://agent.example.com/agent-stub",
                auth_jwe="test-jwe",
                sync_http_client=http_client,
                **kwargs,
            )
    finally:
        http_client.close()
