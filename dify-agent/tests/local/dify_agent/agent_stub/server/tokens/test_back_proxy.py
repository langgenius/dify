from __future__ import annotations

import base64
import secrets

import pytest

from dify_agent.agent_stub.server.tokens.back_proxy import (
    BACK_PROXY_TOKEN_AUDIENCE,
    BACK_PROXY_TOKEN_ISSUER,
    BACK_PROXY_TOKEN_SCOPE_CONNECT,
    BACK_PROXY_TOKEN_TTL_SECONDS,
    BackProxyTokenCodec,
    BackProxyTokenError,
    decode_server_secret_key,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _codec() -> BackProxyTokenCodec:
    return BackProxyTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        agent_mode="workflow_run",
        invoke_from="service-api",
        trace_id="trace-1",
    )


def test_back_proxy_token_codec_round_trips_execution_context_from_bearer_token() -> None:
    codec = _codec()
    token = codec.encode_connection_token(_execution_context(), session_id="abc12ff", now=1_780_395_720)

    principal = codec.decode_authorization_header(f"Bearer {token}", now=1_780_395_720)

    assert principal.execution_context == _execution_context()
    assert principal.session_id == "abc12ff"
    assert principal.scope == [BACK_PROXY_TOKEN_SCOPE_CONNECT]


def test_back_proxy_token_codec_rejects_expired_tokens() -> None:
    codec = _codec()
    token = codec.encode_connection_token(_execution_context(), now=1_780_395_720)

    with pytest.raises(BackProxyTokenError, match="expired"):
        _ = codec.decode_authorization_header(
            f"Bearer {token}",
            now=1_780_395_720 + BACK_PROXY_TOKEN_TTL_SECONDS + 1,
        )


def test_back_proxy_token_codec_rejects_tokens_before_nbf() -> None:
    codec = _codec()
    claims = codec.build_connection_claims(_execution_context(), now=1_780_395_720)
    token = codec.encode_claims(claims.model_copy(update={"nbf": 1_780_395_721}))

    with pytest.raises(BackProxyTokenError, match="not valid yet"):
        _ = codec.decode_authorization_header(f"Bearer {token}", now=1_780_395_720)


def test_back_proxy_token_codec_rejects_wrong_audience_and_scope() -> None:
    codec = _codec()
    claims = codec.build_connection_claims(_execution_context(), now=1_780_395_720)
    wrong_issuer_token = codec.encode_claims(claims.model_copy(update={"iss": "another-issuer"}))
    wrong_audience_token = codec.encode_claims(claims.model_copy(update={"aud": "another-audience"}))
    wrong_scope_token = codec.encode_claims(claims.model_copy(update={"scope": ["other:scope"]}))

    with pytest.raises(BackProxyTokenError, match=BACK_PROXY_TOKEN_ISSUER):
        _ = codec.decode_authorization_header(f"Bearer {wrong_issuer_token}", now=1_780_395_720)

    with pytest.raises(BackProxyTokenError, match=BACK_PROXY_TOKEN_AUDIENCE):
        _ = codec.decode_authorization_header(f"Bearer {wrong_audience_token}", now=1_780_395_720)

    with pytest.raises(BackProxyTokenError, match=BACK_PROXY_TOKEN_SCOPE_CONNECT):
        _ = codec.decode_authorization_header(f"Bearer {wrong_scope_token}", now=1_780_395_720)


def test_back_proxy_token_codec_rejects_wrong_key_and_malformed_authorization_header() -> None:
    codec = _codec()
    other_codec = _codec()
    token = codec.encode_connection_token(_execution_context(), now=1_780_395_720)

    with pytest.raises(BackProxyTokenError, match="decrypt"):
        _ = other_codec.decode_authorization_header(f"Bearer {token}", now=1_780_395_720)

    with pytest.raises(BackProxyTokenError, match="Bearer"):
        _ = codec.decode_authorization_header(f"Basic {token}", now=1_780_395_720)


def test_back_proxy_token_codec_builds_fixed_server_claims() -> None:
    codec = _codec()

    claims = codec.build_connection_claims(_execution_context(), session_id="abc12ff", now=1_780_395_720)

    assert claims.iss == BACK_PROXY_TOKEN_ISSUER
    assert claims.aud == BACK_PROXY_TOKEN_AUDIENCE
    assert claims.scope == [BACK_PROXY_TOKEN_SCOPE_CONNECT]
    assert claims.exp - claims.iat == BACK_PROXY_TOKEN_TTL_SECONDS
    assert claims.shell is not None
    assert claims.shell.session_id == "abc12ff"


def test_decode_server_secret_key_rejects_padding_quotes_and_invalid_characters() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValueError, match="unpadded base64url"):
        _ = decode_server_secret_key(f'"{secret}"')

    with pytest.raises(ValueError, match="unpadded base64url"):
        _ = decode_server_secret_key(f"{secret}=")

    with pytest.raises(ValueError, match="unpadded base64url"):
        _ = decode_server_secret_key(f"{secret[:-1]}!")
