"""Owner HTTP boundary tests: synthetic responses are not A7 acceptance."""

from time import monotonic

import httpx
import pytest


def test_scope_http_owner_closes_response_and_disables_redirects_and_retries(
    monkeypatch,
):
    from services.dify_builder.native_testing.sandbox import scope_client as module

    seen = []
    response = httpx.Response(200, content=b'{"status":"destroyed"}')

    def request(method, url, **kwargs):
        seen.append((method, url, kwargs))
        return response

    monkeypatch.setattr(module.ssrf_proxy, "make_request", request)
    monkeypatch.setattr(
        module, "sensitive_http_telemetry", __import__("contextlib").nullcontext
    )
    owner = module.CodeOriginHttp(
        endpoint="http://scope.internal:9000",
        scope_id="code_" + "a" * 32,
        generation=1,
        token="secret",
        deadline=monotonic() + 1,
        max_bytes=100,
    )
    result = owner.request(
        module.CodeHttpRequest("DELETE", "/v1/test-scopes/code_" + "a" * 32, b"")
    )
    assert result == (200, b'{"status":"destroyed"}')
    assert response.is_closed
    assert seen[0][2]["max_retries"] == 0
    assert seen[0][2]["follow_redirects"] is False
    assert seen[0][2]["stream_response"] is True


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.test/v1/jobs",
        "/v1/jobs",
        "/v1/test-scopes/code_" + "b" * 32,
        "/v1/test-scopes/code_" + "a" * 32 + "/jobs/../other",
    ],
)
def test_scope_http_owner_refuses_alternate_paths_before_io(path, monkeypatch):
    from services.dify_builder.native_testing.sandbox import scope_client as module

    def forbidden(*args, **kwargs):
        pytest.fail("unexpected outbound request")

    monkeypatch.setattr(module.ssrf_proxy, "make_request", forbidden)
    owner = module.CodeOriginHttp(
        endpoint="http://scope.internal:9000",
        scope_id="code_" + "a" * 32,
        generation=1,
        token="secret",
        deadline=monotonic() + 1,
        max_bytes=100,
    )
    with pytest.raises(ValueError):
        owner.request(module.CodeHttpRequest("GET", path, b""))
