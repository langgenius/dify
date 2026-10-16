"""Public tracing operations keep credentials and policy in one transaction."""

import json
from dataclasses import dataclass

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import App, TraceAppConfig
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import (
    AppTracingConfigConflictError,
    AppTracingConfigNotFoundError,
    AppTracingConfigRecord,
    AppTracingConfigService,
    AppTracingConfigVerificationFailedError,
)
from services.entities.app_entities import AppTraceSettings

CONTEXT = RequestContext("request", None, "account", "tenant")


@dataclass
class Case:
    sessions: sessionmaker[Session]
    store: SQLAlchemyAppTracingConfigRepository
    service: AppTracingConfigService
    gateway: OpsTraceManagerGateway
    reader: ConsoleAppRepository

    def policy(self) -> AppTraceSettings:
        return self.reader.get_trace(CONTEXT, "app")

    def config(self, provider: str = "langfuse") -> AppTracingConfigRecord | None:
        return self.store.get(workspace_id="tenant", app_id="app", tracing_provider=provider)


@pytest.fixture
def case(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Case:
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id="app",
                tenant_id="tenant",
                name="Trace",
                mode="workflow",
                enable_site=False,
                enable_api=False,
                tracing=json.dumps(
                    {"enabled": False, "tracing_provider": None, "capture_content": True, "capture_agent": False}
                ),
            )
        )
    gateway = OpsTraceManagerGateway()

    def prepare(*, tracing_config: dict[str, object], **_: object) -> dict[str, object]:
        return dict(tracing_config)

    monkeypatch.setattr(gateway, "prepare_new_config", prepare)
    monkeypatch.setattr(gateway, "prepare_updated_config", prepare)
    monkeypatch.setattr(gateway, "validate_saved_config", lambda **_: None)
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    return Case(
        sqlite_session_factory,
        store,
        AppTracingConfigService(configs=store, provider=gateway),
        gateway,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
    )


@pytest.mark.parametrize("activate", [False, True])
def test_create_and_update_preserve_capture_and_explicit_activation(case: Case, activate: bool) -> None:
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"}, activate=activate)
    assert case.policy() == AppTraceSettings(activate, "langfuse" if activate else None, True, False)
    case.service.update(CONTEXT, "app", "langfuse", {"secret": "updated"}, activate=True)
    assert case.policy() == AppTraceSettings(True, "langfuse", True, False)
    record = case.config()
    assert record is not None
    assert record.tracing_config == {"secret": "updated"}


def test_save_activation_uses_capture_policy_changed_during_vendor_validation(
    case: Case, monkeypatch: pytest.MonkeyPatch
) -> None:
    def prepare(**_: object) -> dict[str, object]:
        case.service.set_trace(CONTEXT, "app", AppTraceSettings(False, None, False, True))
        return {"secret": "validated"}

    monkeypatch.setattr(case.gateway, "prepare_new_config", prepare)
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "input"}, activate=True)
    assert case.policy() == AppTraceSettings(True, "langfuse", False, True)


@pytest.mark.parametrize("operation", ["create", "update", "delete"])
def test_transaction_failure_rolls_back_credentials_and_policy(case: Case, operation: str) -> None:
    if operation != "create":
        case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"}, activate=True)
    before_policy, before_record = case.policy(), case.config()

    def fail_commit(session: Session) -> None:
        session.flush()
        raise RuntimeError("commit failed")

    event.listen(case.sessions, "before_commit", fail_commit)
    try:

        def mutate() -> None:
            if operation == "delete":
                case.service.delete(CONTEXT, "app", "langfuse")
            elif operation == "create":
                case.service.create(CONTEXT, "app", "langfuse", {"secret": "new"}, activate=True)
            else:
                case.service.update(CONTEXT, "app", "langfuse", {"secret": "new"}, activate=True)

        with pytest.raises(RuntimeError, match="commit failed"):
            mutate()
    finally:
        event.remove(case.sessions, "before_commit", fail_commit)
    assert case.policy() == before_policy
    assert case.config() == before_record


@pytest.mark.parametrize("enabled", [False, True])
def test_delete_current_clears_selection_but_other_provider_preserves_policy(case: Case, enabled: bool) -> None:
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "selected"}, activate=True)
    case.service.create(CONTEXT, "app", "langsmith", {"secret": "other"})
    policy = AppTraceSettings(enabled, "langfuse", True, False)
    case.service.set_trace(CONTEXT, "app", policy)
    case.service.delete(CONTEXT, "app", "langsmith")
    assert case.policy() == policy
    case.service.delete(CONTEXT, "app", "langfuse")
    assert case.policy() == AppTraceSettings(False, None, True, False)
    assert case.config() is None


def test_validation_failure_writes_neither_config_nor_policy(case: Case, monkeypatch: pytest.MonkeyPatch) -> None:
    def reject(**_: object) -> dict[str, object]:
        raise AppTracingConfigVerificationFailedError

    monkeypatch.setattr(case.gateway, "prepare_new_config", reject)
    with pytest.raises(AppTracingConfigVerificationFailedError):
        case.service.create(CONTEXT, "app", "langfuse", {"secret": "bad"}, activate=True)
    assert case.config() is None
    assert case.policy() == AppTraceSettings(False, None, True, False)


@pytest.mark.parametrize("state", ["missing", "empty", "inactive"])
def test_enable_requires_usable_owned_config(case: Case, state: str) -> None:
    if state != "missing":
        case.service.create(CONTEXT, "app", "langfuse", {} if state == "empty" else {"secret": "valid"})
        if state == "inactive":
            with case.sessions.begin() as session:
                record = session.scalar(select(TraceAppConfig))
                assert record is not None
                record.is_active = False
    with pytest.raises(AppTracingConfigNotFoundError):
        case.service.set_trace(CONTEXT, "app", AppTraceSettings(True, "langfuse"))
    assert case.policy() == AppTraceSettings(False, None, True, False)


def test_update_rejects_credentials_replaced_while_validation_was_in_flight(
    case: Case, monkeypatch: pytest.MonkeyPatch
) -> None:
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"})

    def prepare(**_: object) -> dict[str, object]:
        current = case.config()
        assert current is not None
        case.store.update(
            workspace_id="tenant",
            app_id="app",
            tracing_provider="langfuse",
            tracing_config={"secret": "concurrent"},
            expected=current,
        )
        return {"secret": "stale"}

    monkeypatch.setattr(case.gateway, "prepare_updated_config", prepare)
    with pytest.raises(AppTracingConfigConflictError):
        case.service.update(CONTEXT, "app", "langfuse", {"secret": "masked"}, activate=True)
    saved = case.config()
    assert saved is not None
    assert saved.tracing_config == {"secret": "concurrent"}
    assert case.policy() == AppTraceSettings(False, None, True, False)


def test_enable_rejects_configuration_deleted_during_validation(case: Case, monkeypatch: pytest.MonkeyPatch) -> None:
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"})

    def validate(**_: object) -> None:
        case.service.delete(CONTEXT, "app", "langfuse")

    monkeypatch.setattr(case.gateway, "validate_saved_config", validate)
    with pytest.raises(AppTracingConfigConflictError):
        case.service.set_trace(CONTEXT, "app", AppTraceSettings(True, "langfuse"))
    assert case.policy() == AppTraceSettings(False, None, True, False)


@pytest.mark.parametrize("recreate", [False, True])
def test_patch_rejects_configuration_deleted_during_validation(
    case: Case, monkeypatch: pytest.MonkeyPatch, recreate: bool
) -> None:
    case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"})

    def prepare(**_: object) -> dict[str, object]:
        case.service.delete(CONTEXT, "app", "langfuse")
        if recreate:
            case.service.create(CONTEXT, "app", "langfuse", {"secret": "original"})
        return {"secret": "stale"}

    monkeypatch.setattr(case.gateway, "prepare_updated_config", prepare)
    with pytest.raises(AppTracingConfigConflictError):
        case.service.update(CONTEXT, "app", "langfuse", {"secret": "masked"}, activate=True)
    assert case.policy() == AppTraceSettings(False, None, True, False)
    saved = case.config()
    if recreate:
        assert saved is not None
        assert saved.tracing_config == {"secret": "original"}
    else:
        assert saved is None
