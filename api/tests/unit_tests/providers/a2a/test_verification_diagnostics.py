"""Verify-only refinements cannot change runtime retries or expose peer data."""

import ssl

import httpx
import pytest

from core.tools.errors import ToolSSRFError
from providers.a2a.gateway import A2AGateway
from providers.a2a.transport import BoundedTransport, TransportDiagnostic, TransportError
from services.external_agents.protocol import BearerAuth, ConnectionSpec, GatewayError, NoAuth
from tests.unit_tests.providers.a2a import test_https_fixture as https_fixtures
from tests.unit_tests.providers.a2a.test_gateway import card, connection, gateway, response, send_request
from tests.unit_tests.providers.a2a.test_https_fixture import HTTPSFixture, VerifiedHTTPSRequester

https_fixture = https_fixtures.https_fixture


@pytest.mark.parametrize(
    ("challenge", "expected"),
    [
        ('Bearer error="invalid_token"', "token_invalid_or_expired"),
        ('bearer realm="test, realm", error=invalid_token', "token_invalid_or_expired"),
        ("", None),
        ('Basic realm="invalid_token"', None),
        ('Bearer error="insufficient_scope"', None),
        ('Bearer error="invalid_token", Basic realm="test"', None),
        ('Bearer error="invalid_token", error="invalid_token"', None),
        ('Bearer error="invalid_token",', None),
        ('Bearer error="invalid_token" trailing', None),
    ],
)
def test_bearer_rejection_requires_an_unambiguous_standard_challenge(challenge: str, expected: str | None) -> None:
    adapter, egress = gateway([response({"error": "invalid_token"}, status=401, **{"www-authenticate": challenge})])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection(BearerAuth("private-token")))
    assert caught.value.code == "authentication_failed"
    assert caught.value.verification_subreason == expected
    assert len(egress.requests) == 1
    assert egress.requests[0][0] == "GET"


def test_forbidden_is_access_denial_even_with_a_bearer_invalid_token_header() -> None:
    adapter, _ = gateway([response({}, status=403, **{"www-authenticate": 'Bearer error="invalid_token"'})])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection(BearerAuth("private-token")))
    assert caught.value.verification_subreason == "access_denied"


@pytest.mark.parametrize(
    ("kind", "expected"), [("bearer", "authentication_required"), ("basic", "unsupported_authentication")]
)
def test_valid_card_can_explain_missing_or_unsupported_authentication(kind: str, expected: str) -> None:
    document = card()
    document["securitySchemes"] = {"auth": {"httpAuthSecurityScheme": {"scheme": kind}}}
    document["securityRequirements"] = [{"schemes": {"auth": {"list": list[str]()}}}]
    adapter, egress = gateway([response(document)])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection())
    assert caught.value.code == "authentication_incompatible"
    assert caught.value.verification_subreason == expected
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    ("binding", "version", "expected"),
    [("HTTP+JSON", "0.3", "unsupported_protocol_version"), ("gRPC", "1.0", "unsupported_transport")],
)
def test_protocol_version_and_transport_remain_distinct(binding: str, version: str, expected: str) -> None:
    document = card()
    document["supportedInterfaces"] = [
        {"url": connection().endpoint, "protocolBinding": binding, "protocolVersion": version}
    ]
    adapter, _ = gateway([response(document)])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection())
    assert caught.value.code == "profile_unsupported"
    assert caught.value.verification_subreason == expected


@pytest.mark.parametrize("failure", ["missing", "gone", "redirect", "html", "invalid_json"])
def test_discovery_and_protected_card_failures_do_not_blame_the_same_endpoint(failure: str) -> None:
    status = {"missing": 404, "gone": 410, "redirect": 302}.get(failure, 200)
    reply = (
        httpx.Response(200, content=b"not-json", headers={"content-type": "application/json"})
        if failure == "invalid_json"
        else response({}, status=status, content_type="text/html" if failure == "html" else "application/json")
    )
    adapter, _ = gateway([reply])
    with pytest.raises(GatewayError) as discovery:
        adapter.verify(connection())
    assert discovery.value.verification_subreason == "invalid_a2a_endpoint"
    adapter, egress = gateway([response(card(extended=True)), reply])
    with pytest.raises(GatewayError) as protected:
        adapter.verify(connection())
    assert protected.value.code in {"invalid_agent_card", "invalid_content_type"}
    assert protected.value.verification_subreason is None
    assert [row[0] for row in egress.requests] == ["GET", "GET"]


def test_card_errors_are_bounded_static_paths_without_peer_values_or_dynamic_keys() -> None:
    marker = "private-peer-marker"
    document = card()
    document["name"] = {marker: marker}
    document["supportedInterfaces"] = [dict[str, object]() for _ in range(20)]
    document["securitySchemes"] = {marker: marker}
    document[marker] = marker
    adapter, _ = gateway([response(document)])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection(BearerAuth(marker)))
    error = caught.value
    assert error.verification_subreason == "agent_card_field_invalid"
    assert len(error.card_errors) == 10
    assert error.card_errors[0].path == "name"
    assert error.card_errors[0].code == "invalid"
    assert error.card_errors[1].path == "supportedInterfaces[0].url"
    assert marker not in repr(error.card_errors)
    assert all(item.code in {"missing", "invalid"} for item in error.card_errors)


def test_peer_chosen_extra_field_alone_cannot_become_a_displayable_card_path() -> None:
    document = card()
    document["private-peer-marker"] = "private-value"
    adapter, _ = gateway([response(document)])
    with pytest.raises(GatewayError) as caught:
        adapter.verify(connection())
    assert caught.value.code == "invalid_agent_card"
    assert caught.value.verification_subreason is None
    assert caught.value.card_errors == ()


class FailingRequester:
    """Raise one controlled outbound exception without synthesizing a response."""

    def __init__(self, error: Exception) -> None:
        self.error = error
        self.calls = 0

    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        """Require one request; record it and fail without retaining URL/headers."""
        assert method in {"GET", "POST"}
        assert url.startswith("https://")
        assert kwargs["ssl_verify"] is True
        self.calls += 1
        raise self.error


@pytest.mark.parametrize("failure", ["timeout", "certificate", "network", "ssrf", "untyped_tls_text"])
def test_typed_transport_diagnostics_do_not_change_runtime_codes_or_retry_semantics(failure: str) -> None:
    marker = "private-peer-marker"
    error: Exception
    if failure == "timeout":
        error = httpx.ReadTimeout(marker)
    elif failure == "ssrf":
        error = ToolSSRFError(marker)
    else:
        error = httpx.ConnectError(marker if failure != "untyped_tls_text" else "CERTIFICATE_VERIFY_FAILED timeout")
        if failure == "certificate":
            error.__cause__ = ssl.SSLCertVerificationError(1, marker)
    diagnostic = {"timeout": TransportDiagnostic.TIMEOUT, "certificate": TransportDiagnostic.TLS_CERTIFICATE}.get(
        failure
    )
    requester = FailingRequester(error)
    transport = BoundedTransport(requester)
    with pytest.raises(TransportError) as caught:
        transport.request("GET", connection().endpoint, headers={}, body=None, timeout_seconds=1, max_bytes=10)
    assert caught.value.code == "network_failure"
    assert caught.value.diagnostic == diagnostic
    adapter = A2AGateway(transport)
    with pytest.raises(GatewayError) as verified:
        adapter.verify(connection())
    assert verified.value.code == "network_failure"
    assert verified.value.verification_subreason == {"timeout": "connection_timeout", "certificate": "tls_error"}.get(
        failure
    )
    with pytest.raises(GatewayError) as sent:
        adapter.send(connection(), send_request(), streaming=False)
    assert sent.value.code == "network_failure"
    assert sent.value.submission_unknown
    assert not sent.value.retryable
    assert sent.value.verification_subreason is None
    with pytest.raises(GatewayError) as queried:
        adapter.get_task(connection(), "task-1")
    assert queried.value.code == "network_failure"
    assert queried.value.retryable
    assert queried.value.verification_subreason is None
    assert requester.calls == 4
    assert marker not in str(verified.value)


def test_real_untrusted_tls_certificate_is_refined_without_disabling_verification(https_fixture: HTTPSFixture) -> None:
    state, _, _ = https_fixture
    with httpx.Client(trust_env=False) as client:
        adapter = A2AGateway(BoundedTransport(VerifiedHTTPSRequester(client)))
        with pytest.raises(GatewayError) as caught:
            adapter.verify(ConnectionSpec(endpoint=state.public_url, authentication=NoAuth()))
    assert caught.value.code == "network_failure"
    assert caught.value.verification_subreason == "tls_error"
    assert all(count == 0 for count in state.counts.values())
