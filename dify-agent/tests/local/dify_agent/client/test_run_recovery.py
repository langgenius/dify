"""SDK transports are deterministic HTTPX fixtures, not network qualification."""

import asyncio
import json

import httpx
import pytest

from dify_agent.client import Client, DifyAgentHTTPError, DifyAgentTimeoutError
from dify_agent.protocol.run_recovery import LookupRunRequest
from dify_agent.protocol.schemas import CreateRunRequest


@pytest.mark.parametrize("sync", [False, True])
def test_lookup_after_lost_create_ack_is_one_read_post_with_no_create_retry(sync):
    calls = []

    def transport(request):
        calls.append((request.method, request.url.path, json.loads(request.content)))
        if request.url.path == "/runs":
            raise httpx.ReadTimeout("accepted before lost ACK", request=request)
        return httpx.Response(200, json={"run_id": "original", "status": "running"})

    request = CreateRunRequest(composition={"layers": []}, idempotency_key="key")
    selection = LookupRunRequest(idempotency_key="key", request_digest="a" * 64)
    if sync:
        with httpx.Client(transport=httpx.MockTransport(transport)) as http:
            client = Client(base_url="http://agent", sync_http_client=http)
            with pytest.raises(DifyAgentTimeoutError):
                client.create_run_sync(request)
            result = client.lookup_run_sync(selection)
    else:

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
                client = Client(base_url="http://agent", async_http_client=http)
                with pytest.raises(DifyAgentTimeoutError):
                    await client.create_run(request)
                return await client.lookup_run(selection)

        result = asyncio.run(exercise())
    assert result.run_id == "original"
    assert [(m, p) for m, p, _ in calls] == [("POST", "/runs"), ("POST", "/runs/lookup")]
    assert calls[1][2] == {"idempotency_key": "key", "request_digest": "a" * 64}


@pytest.mark.parametrize("status", [404, 409, 500])
def test_lookup_errors_never_fall_back_to_create(status):
    calls = []

    def transport(request):
        calls.append(request.url.path)
        return httpx.Response(status, json={"detail": "unavailable"})

    with httpx.Client(transport=httpx.MockTransport(transport)) as http:
        client = Client(base_url="http://agent", sync_http_client=http)
        with pytest.raises(DifyAgentHTTPError) as error:
            client.lookup_run_sync(LookupRunRequest(idempotency_key="key", request_digest="a" * 64))
        assert error.value.status_code == status
    assert calls == ["/runs/lookup"]
