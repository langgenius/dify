import httpx
import pytest

from core.helper import ssrf_proxy
from libs.rasket import RasketClient


@pytest.mark.parametrize("status_code", [200, 202, 400, 401, 403, 429, 500])
def test_rasket_http_status_and_no_retries(monkeypatch: pytest.MonkeyPatch, status_code: int) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code, json={"id": "email-id"})

    payload = {"from": "sender@example.com", "to": "user@example.com", "subject": "Hi", "html": "<b>Hi</b>"}
    original = payload.copy()
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _ssl_verify_enabled: client)
        rasket = RasketClient(api_key="rk_test_key")
        if status_code >= 400:
            with pytest.raises(httpx.HTTPStatusError) as exc:
                rasket.send(payload)
            assert exc.value.response.status_code == status_code
        else:
            rasket.send(payload)
    assert len(requests) == 1
    assert payload == original


def test_rasket_timeout_propagates_without_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise httpx.ReadTimeout("timeout", request=request)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _ssl_verify_enabled: client)
        with pytest.raises(httpx.ReadTimeout, match="timeout"):
            RasketClient(api_key="rk_test_key").send(
                {"from": "sender@example.com", "to": "user@example.com", "subject": "Hi", "html": "<b>Hi</b>"}
            )
    assert len(requests) == 1
    assert requests[0].extensions["timeout"] == {"connect": 10, "read": 10, "write": 10, "pool": 10}
