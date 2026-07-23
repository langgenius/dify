from unittest.mock import MagicMock
from uuid import UUID

import pytest

from controllers.console.agent import app_helpers


def test_resolve_agent_app_model_reuses_caller_session(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    app = MagicMock()
    service = MagicMock()
    service.get_agent_app_model.return_value = app
    service_factory = MagicMock(return_value=service)
    monkeypatch.setattr(app_helpers, "AgentRosterService", service_factory)

    result = app_helpers.resolve_agent_app_model(
        session=session,
        tenant_id="tenant-1",
        agent_id=UUID("00000000-0000-0000-0000-000000000001"),
    )

    assert result is app
    service_factory.assert_called_once_with(session)
    service.get_agent_app_model.assert_called_once_with(
        tenant_id="tenant-1",
        agent_id="00000000-0000-0000-0000-000000000001",
    )


def test_resolve_agent_runtime_app_model_reuses_caller_session(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    app = MagicMock()
    service = MagicMock()
    service.get_agent_runtime_app_model.return_value = app
    service_factory = MagicMock(return_value=service)
    monkeypatch.setattr(app_helpers, "AgentRosterService", service_factory)

    result = app_helpers.resolve_agent_runtime_app_model(
        session=session,
        tenant_id="tenant-1",
        agent_id=UUID("00000000-0000-0000-0000-000000000001"),
    )

    assert result is app
    service_factory.assert_called_once_with(session)
    service.get_agent_runtime_app_model.assert_called_once_with(
        tenant_id="tenant-1",
        agent_id="00000000-0000-0000-0000-000000000001",
    )
