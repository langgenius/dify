"""Native read wrapper errors are normalized without expanding ordinary clients."""

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest
from httpx import Request, Response
from pytest_mock import MockerFixture

from clients.agent_backend.client import DifyAgentBackendRunClient
from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError


def checkpoint_request() -> ReadNativeCheckpointRequest:
    return ReadNativeCheckpointRequest.model_validate(
        {
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "req",
                "invocation_id": "inv",
                "context_digest": "a" * 64,
            },
            "expected_generation": 7,
            "waiting_event_id": "123-1",
            "config_ref": "cfg",
            "config_digest": "b" * 64,
        }
    )


@pytest.mark.parametrize("failure", ["http", "timeout"])
def test_native_wrapper_normalizes_real_http_client_errors(failure: str) -> None:
    selection = checkpoint_request()
    attempts: list[Request] = []

    def handler(request: Request) -> Response:
        attempts.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("sensitive-canary", request=request)
        return httpx.Response(409, json={"private": "sensitive-canary"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with Client(base_url="http://synthetic.invalid", sync_http_client=http) as sdk:
            wrapper = DifyAgentBackendRunClient(sdk)
            with pytest.raises(AgentBackendTransportError if failure == "timeout" else AgentBackendHTTPError) as caught:
                wrapper.read_native_checkpoint("run-1", selection)
    assert "sensitive-canary" not in str(caught.value)
    assert len(attempts) == 1


def test_private_wrapper_redacts_validation_details_from_adapter_errors(mocker: MockerFixture) -> None:
    from dify_agent.client import DifyAgentValidationError

    from clients.agent_backend.errors import AgentBackendValidationError

    with Client(base_url="http://synthetic.invalid") as sdk:
        read = mocker.patch.object(
            sdk,
            "read_native_checkpoint_sync",
            side_effect=DifyAgentValidationError({"input": "private-canary"}),
        )
        request = checkpoint_request()
        with pytest.raises(AgentBackendValidationError) as caught:
            DifyAgentBackendRunClient(sdk).read_native_checkpoint("run-1", request)
        read.assert_called_once_with("run-1", request)
    assert "private-canary" not in str(caught.value.detail)
