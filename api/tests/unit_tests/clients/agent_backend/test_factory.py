import pytest

from clients.agent_backend.factory import create_agent_backend_run_client


def test_missing_base_url_raises_helpful_error():
    """When AGENT_BACKEND_BASE_URL is not set, the error should mention the
    environment variable and suggest alternatives (issue #39161)."""
    with pytest.raises(ValueError) as exc_info:
        create_agent_backend_run_client(base_url=None)

    message = str(exc_info.value)
    # The error must mention the env var name so users know what to set.
    assert "AGENT_BACKEND_BASE_URL" in message
    # The error should hint at the classic Agent app as an alternative.
    assert "agent-chat" in message


def test_use_fake_does_not_require_base_url():
    """The fake client path should not raise even when base_url is None."""
    client = create_agent_backend_run_client(use_fake=True, base_url=None)
    assert client is not None