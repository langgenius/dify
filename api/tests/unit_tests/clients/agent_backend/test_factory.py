"""Regression for #38283: when AGENT_BACKEND_BASE_URL is unset, node_factory
was raising `ValueError("base_url is required")` inside Agent App
invocation. The factory now falls back to the deterministic fake client
with a WARNING log so operators still see what a real backend would
return while they stand one up."""

from __future__ import annotations

import logging

import pytest

from clients.agent_backend.factory import create_agent_backend_run_client


def test_use_fake_true_returns_fake_even_when_base_url_set() -> None:
    from clients.agent_backend.fake_client import FakeAgentBackendRunClient

    client = create_agent_backend_run_client(
        base_url="http://real.example",
        api_token="token",
        use_fake=True,
    )
    assert isinstance(client, FakeAgentBackendRunClient)


def test_use_fake_false_with_base_url_returns_real_client() -> None:
    client = create_agent_backend_run_client(
        base_url="http://real.example",
        api_token="token",
        use_fake=False,
    )
    # Real client wraps the dify_agent `Client`; the fake path would
    # have raised on `isinstance(client, FakeAgentBackendRunClient)`.
    from clients.agent_backend.client import DifyAgentBackendRunClient

    assert isinstance(client, DifyAgentBackendRunClient)


def test_use_fake_false_no_base_url_falls_back_to_fake_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Regression for #38283 — the operator hasn't deployed an Agent
    backend runtime yet, and the workflow would otherwise crash with the
    cryptic `base_url is required` ValueError. Now we silently fall
    back to the fake client and log at WARNING so it's visible."""
    from clients.agent_backend.fake_client import FakeAgentBackendRunClient

    with caplog.at_level(logging.WARNING, logger="clients.agent_backend.factory"):
        client = create_agent_backend_run_client(
            base_url=None,
            api_token=None,
            use_fake=False,
        )

    assert isinstance(client, FakeAgentBackendRunClient)
    assert any("AGENT_BACKEND_BASE_URL is not configured" in record.getMessage() for record in caplog.records)


def test_use_fake_false_empty_string_base_url_falls_back_to_fake(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Empty string base_url is treated the same as None — no point
    making a request to a URL with empty host."""
    from clients.agent_backend.fake_client import FakeAgentBackendRunClient

    with caplog.at_level(logging.WARNING, logger="clients.agent_backend.factory"):
        client = create_agent_backend_run_client(
            base_url="",
            api_token=None,
            use_fake=False,
        )

    assert isinstance(client, FakeAgentBackendRunClient)


def test_use_fake_false_no_base_url_no_warning_when_use_fake_already_on(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When the operator already opted into fake mode, we don't need
    the warning — the log is for the unexpected misconfiguration."""

    with caplog.at_level(logging.WARNING, logger="clients.agent_backend.factory"):
        create_agent_backend_run_client(
            base_url=None,
            api_token=None,
            use_fake=True,
        )

    assert not any("AGENT_BACKEND_BASE_URL is not configured" in record.getMessage() for record in caplog.records)
