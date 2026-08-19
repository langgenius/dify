"""Unit tests for record_layer0_verdict — merge L0 verdict into AuthContext cache."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from libs.oauth_bearer import record_layer0_verdict


@pytest.fixture
def mock_redis():
    return MagicMock()


@patch("libs.oauth_bearer.redis_client")
def test_no_op_when_cache_entry_missing(mock_redis):
    mock_redis.get.return_value = None
    record_layer0_verdict("h1", "t1", True)
    mock_redis.setex.assert_not_called()


@patch("libs.oauth_bearer.redis_client")
def test_no_op_when_cache_entry_invalid_marker(mock_redis):
    mock_redis.get.return_value = b"invalid"
    record_layer0_verdict("h1", "t1", True)
    mock_redis.setex.assert_not_called()


@patch("libs.oauth_bearer.redis_client")
def test_no_op_when_json_malformed(mock_redis):
    mock_redis.get.return_value = b"not json"
    record_layer0_verdict("h1", "t1", True)
    mock_redis.setex.assert_not_called()


@patch("libs.oauth_bearer.redis_client")
def test_no_op_when_ttl_expired(mock_redis):
    mock_redis.get.return_value = json.dumps(
        {
            "subject_email": "e",
            "subject_issuer": None,
            "account_id": None,
            "token_id": "tid",
            "expires_at": None,
        }
    ).encode()
    mock_redis.ttl.return_value = -1
    record_layer0_verdict("h1", "t1", True)
    mock_redis.setex.assert_not_called()


@patch("libs.oauth_bearer.redis_client")
def test_merges_new_tenant_verdict(mock_redis):
    mock_redis.get.return_value = json.dumps(
        {
            "subject_email": "e",
            "subject_issuer": None,
            "account_id": None,
            "token_id": "tid",
            "expires_at": None,
            "verified_tenants": {"t0": True},
        }
    ).encode()
    mock_redis.ttl.return_value = 42

    record_layer0_verdict("h1", "t1", False)

    mock_redis.setex.assert_called_once()
    args = mock_redis.setex.call_args
    assert args.args[0] == "auth:token:h1"
    assert args.args[1] == 42  # remaining TTL preserved
    written = json.loads(args.args[2])
    assert written["verified_tenants"] == {"t0": True, "t1": False}


@patch("libs.oauth_bearer.redis_client")
def test_merges_when_field_absent_from_legacy_entry(mock_redis):
    """Backward compat: legacy cache entry without verified_tenants field."""
    mock_redis.get.return_value = json.dumps(
        {
            "subject_email": "e",
            "subject_issuer": None,
            "account_id": None,
            "token_id": "tid",
            "expires_at": None,
        }
    ).encode()
    mock_redis.ttl.return_value = 42
    record_layer0_verdict("h1", "t1", True)
    written = json.loads(mock_redis.setex.call_args.args[2])
    assert written["verified_tenants"] == {"t1": True}
