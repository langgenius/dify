import httpx
from dify_trace_sdk.testing import RecordingEgress, response
from dify_trace_sdk.transports import EgressHttpxTransport, EgressRequestsSession


def test_httpx_transport_routes_sdk_requests_through_egress() -> None:
    egress = RecordingEgress([response(201, {"ok": True})], grpc_target=None)
    with httpx.Client(transport=EgressHttpxTransport(egress)) as client:
        result = client.post("https://api.example.com/v1/items", json={"a": 1})
    assert result.status_code == 201
    assert result.json() == {"ok": True}
    (sent,) = egress.requests
    assert sent.method == "POST"
    assert sent.json() == {"a": 1}


def test_requests_session_routes_sdk_requests_through_egress() -> None:
    egress = RecordingEgress([response(200, {"ok": True})], grpc_target=None)
    session = EgressRequestsSession(egress)
    result = session.post("https://api.example.com/v1/items", json={"a": 1})
    assert result.json() == {"ok": True}
    assert egress.requests[0].url == "https://api.example.com/v1/items"
    assert session.trust_env is False
