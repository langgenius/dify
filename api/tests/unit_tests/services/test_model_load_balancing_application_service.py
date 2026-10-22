"""Workspace propagation and session ownership of the Console compatibility boundary."""

from typing import override
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from services.model_load_balancing_adapters import ModelLoadBalancingOperations
from services.model_load_balancing_application_service import (
    LoadBalancingConfigSummary,
    LoadBalancingOperations,
    ModelLoadBalancingApplicationService,
)
from services.model_load_balancing_service import ModelLoadBalancingService


@pytest.mark.parametrize("workspace", ["workspace-a", "workspace-b"])
def test_application_uses_the_admitted_workspace(workspace: str) -> None:
    operations = create_autospec(LoadBalancingOperations, instance=True)
    service = ModelLoadBalancingApplicationService(operations=operations)
    context = RequestContext("request", None, "account", workspace)
    common: dict[str, str] = {"provider": "openai", "model": "gpt-4", "model_type": "llm"}
    service.validate_credentials(context, **common, credentials={"api_key": "secret"}, config_id="config")
    operations.validate.assert_called_once_with(
        tenant_id=workspace,
        **common,
        credentials={"api_key": "secret"},
        config_id="config",
    )
    operations.get_configs.return_value = (False, list[LoadBalancingConfigSummary]())
    assert service.get_configs(context, **common, config_from="predefined-model") == (False, [])
    operations.get_configs.assert_called_once_with(tenant_id=workspace, **common, config_from="predefined-model")
    service.update_configs(context, **common, configs=[{"id": "config"}], config_from="", enabled=True)
    operations.update_configs.assert_called_once_with(
        tenant_id=workspace,
        **common,
        configs=[{"id": "config"}],
        config_from="",
        enabled=True,
    )


class TrackedSession(Session):
    closed = False

    @override
    def close(self) -> None:
        super().close()
        self.closed = True


@pytest.mark.parametrize(
    ("operation", "enabled"), [("validate", True), ("get", True), ("update", True), ("update", False)]
)
@pytest.mark.parametrize("fails", [False, True])
def test_adapter_closes_sessions_without_changing_legacy_commits(operation: str, enabled: bool, fails: bool) -> None:
    engine = create_engine("sqlite://")
    factory = sessionmaker[Session](engine, class_=TrackedSession)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE probe (value INTEGER)"))
    sessions: list[TrackedSession] = []
    legacy = create_autospec(ModelLoadBalancingService, instance=True)

    def run_legacy(**kwargs: object) -> tuple[bool, list[LoadBalancingConfigSummary]]:
        session = kwargs["session"]
        assert isinstance(session, TrackedSession)
        sessions.append(session)
        session.execute(text("INSERT INTO probe VALUES (1)"))
        if operation != "validate":
            # The existing service, including get_configs, may commit itself.
            session.commit()
        if fails:
            session.execute(text("INSERT INTO probe VALUES (2)"))
            raise ValueError("legacy failure")
        return False, []

    legacy.validate_load_balancing_credentials.side_effect = run_legacy
    legacy.get_load_balancing_configs.side_effect = run_legacy
    legacy.update_load_balancing_configs.side_effect = run_legacy

    def check_session_closed(**_kwargs: object) -> None:
        assert sessions[0].closed

    legacy.enable_model_load_balancing.side_effect = check_session_closed
    legacy.disable_model_load_balancing.side_effect = check_session_closed
    adapter = ModelLoadBalancingOperations(session_factory=factory)
    common: dict[str, str] = {"tenant_id": "workspace", "provider": "openai", "model": "gpt-4", "model_type": "llm"}

    def invoke() -> None:
        if operation == "validate":
            adapter.validate(**common, credentials={}, config_id=None)
        elif operation == "get":
            assert adapter.get_configs(**common, config_from="") == (False, [])
        else:
            adapter.update_configs(**common, configs=[], config_from="", enabled=enabled)

    with patch("services.model_load_balancing_adapters.ModelLoadBalancingService", return_value=legacy):
        if fails:
            with pytest.raises(ValueError, match="legacy failure"):
                invoke()
        else:
            invoke()
    assert len(sessions) == 1
    assert sessions[0].closed
    assert not sessions[0].in_transaction()
    with factory() as session:
        assert list(session.scalars(text("SELECT value FROM probe"))) == ([] if operation == "validate" else [1])
    if operation == "update" and not fails:
        selected = legacy.enable_model_load_balancing if enabled else legacy.disable_model_load_balancing
        selected.assert_called_once_with(**common)
    else:
        legacy.enable_model_load_balancing.assert_not_called()
        legacy.disable_model_load_balancing.assert_not_called()
    engine.dispose()


def test_validation_does_not_mutate_the_request_credentials() -> None:
    engine = create_engine("sqlite://")
    factory = sessionmaker(engine)
    adapter = ModelLoadBalancingOperations(session_factory=factory)
    credentials = {"api_key": "[__HIDDEN__]"}

    def validate(**kwargs: object) -> None:
        received = kwargs["credentials"]
        assert isinstance(received, dict)
        received["api_key"] = "encrypted"

    with patch.object(ModelLoadBalancingService, "validate_load_balancing_credentials", side_effect=validate):
        adapter.validate(
            tenant_id="workspace",
            provider="openai",
            model="gpt-4",
            model_type="llm",
            credentials=credentials,
            config_id="config",
        )
    assert credentials == {"api_key": "[__HIDDEN__]"}
    engine.dispose()
