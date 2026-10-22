"""Local PostgreSQL + signed Console: use action transport for native controls."""

import json
import os
from pathlib import Path

import pytest
from werkzeug.test import TestResponse

from controllers.console.dify_builder_fields import (
    DifyBuilderCommandFinishedEventData,
    DifyBuilderCommandFinishedEventResponse,
    DifyBuilderSessionViewResponse,
    DifyBuilderStreamEventResponse,
    DifyBuilderSubmitActionPayload,
)
from core.dify_builder.models import Actor, DifyBuilderContext
from core.dify_builder.state import PcState
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderSessionCommit
from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.serde import context_to_dict
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.test_actions import BuilderTestActions
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import RuntimeDeliveryCase
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    ConsoleCase,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    console_case as console_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    continuation_case as continuation_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    ledger_case as ledger_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    no_live as no_live,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_console_api import (
    pending_console as pending_console,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_runtime import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_runtime import (
    runtime_case as runtime_case,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

type ActionConsole = tuple[ConsoleCase, DifyBuilderService, str, str]


@pytest.fixture
def action_console(pending_console: ConsoleCase, monkeypatch: pytest.MonkeyPatch) -> ActionConsole:
    from controllers.console import dify_builder as controller

    c = pending_console
    with c.factory() as sql:
        request = sql.get(DifyBuilderExecutionRequest, c.ref.request_id)
        assert request is not None
        sid, input_id = request.session_id, request.test_input_id
    repo = SqlDifyBuilderRepository(c.factory)
    with c.factory.begin() as sql:
        owner = sql.get(DifyBuilderSession, sid)
        assert owner is not None
        owner.current_state = str(PcState.BUILD_AWAIT_REPAIR)
        sql.add(
            DifyBuilderSessionCommit(
                session_id=sid,
                version=owner.version,
                state=str(PcState.BUILD_AWAIT_REPAIR),
                actor="",
                context=context_to_dict(DifyBuilderContext(test_input_ref=input_id)),
            )
        )

    def native_commands(*, actor: Actor) -> ProfiledNativeTestCommands:
        return ProfiledNativeTestCommands(
            sessions=c.factory,
            actor=actor,
            legacy_factory=lambda: c.api,
            confirmed_factory=lambda: pytest.fail("synthetic HTTP fixture must retain its runtime profile"),
        )

    service = DifyBuilderService(
        repo,
        FakeSessionLock(),
        lambda *_: pytest.fail("native control started a new Builder run"),
        get_app_revision_fn=lambda *_: "fixture-revision",
        test_actions=BuilderTestActions(c.factory, native_commands),
    )
    monkeypatch.setattr(controller, "build_service", lambda: service)
    return c, service, sid, c.url.removesuffix("/native-tests")


def _view(c: ConsoleCase, base: str) -> DifyBuilderSessionViewResponse:
    response = c.client.get(base)
    assert response.status_code == 200, response.get_json()
    return DifyBuilderSessionViewResponse.model_validate(response.get_json())


def _finished(response: TestResponse) -> DifyBuilderCommandFinishedEventData:
    for line in response.get_data(as_text=True).splitlines():
        if line.startswith("data: "):
            event = DifyBuilderStreamEventResponse.model_validate_json(line.removeprefix("data: ")).root
            if isinstance(event, DifyBuilderCommandFinishedEventResponse):
                return event.data
    pytest.fail("Existing action transport did not finish its command")


def _evidence(name: str, value: object) -> None:
    directory = os.getenv("DIFY_BUILDER_ACTION_EVIDENCE_DIR")
    if directory:
        out = Path(directory)
        out.mkdir(parents=True, exist_ok=True)
        text = json.dumps(value, ensure_ascii=False, indent=2)
        for forbidden in ("secret-value", "context_digest", "permit_id", "input_digest", "Authorization"):
            assert forbidden not in text
        (out / f"{name}.json").write_text(text + "\n")


def _control(
    c: ConsoleCase, base: str, kind: str, identity: str
) -> tuple[DifyBuilderSubmitActionPayload, DifyBuilderCommandFinishedEventData]:
    current = _view(c, base)
    action = next(a for a in current.actions if a.id == kind)
    body = DifyBuilderSubmitActionPayload(
        action_id="confirm",
        client_action_id=identity,
        payload={"option_id": kind, **action.payload},
        base_version=current.version,
        base_app_revision="fixture-revision",
    )
    response = c.client.post(base + "/actions", json=body.model_dump())
    assert response.status_code == 200, response.get_data(as_text=True)
    result = _finished(response)
    _evidence(
        identity,
        {
            "request": body.model_dump(mode="json"),
            "http_status": response.status_code,
            "command_finished": result.model_dump(mode="json"),
            "business_calls": c.ledger.dispatched_attempt_count(),
        },
    )
    return body, result


def test_confirm_and_refresh_use_only_existing_session_action_transport(action_console: ActionConsole) -> None:
    c, service, sid, base = action_console
    before = _view(c, base)
    assert before.test_execution is not None
    assert before.test_execution.request_id == c.ref.request_id
    assert before.test_execution.pending[0].decision_status == "awaiting_decision"
    body, result = _control(c, base, "confirm_test_operation", "one-approval")
    assert result.test_execution is not None
    assert result.test_execution.pending[0].decision == "confirm"
    assert c.ledger.dispatched_attempt_count() == 0
    again = c.client.post(base + "/actions", json=body.model_dump())
    assert again.status_code == 200
    refreshed = _view(c, base)
    assert refreshed.test_execution is not None
    assert refreshed.test_execution.pending[0].decision == "confirm"
    assert len(service.get_conversation_page(sid, c.ledger.actor, limit=20).data) == 1
    assert c.ledger.dispatched_attempt_count() == 0
    _evidence(
        "confirm-refresh",
        {
            "before": before.model_dump(mode="json"),
            "after": refreshed.model_dump(mode="json"),
            "duplicate_http_status": again.status_code,
            "business_calls": c.ledger.dispatched_attempt_count(),
        },
    )


def test_action_transport_rejects_foreign_scope_without_dispatch(action_console: ActionConsole) -> None:
    c, _, _, base = action_console
    view = _view(c, base)
    assert view.test_execution is not None
    pending = view.test_execution.pending[0]
    response = c.client.post(
        base + "/actions",
        json={
            "action_id": "confirm_test_operation",
            "base_version": view.version,
            "base_app_revision": "fixture-revision",
            "payload": {
                "request_id": c.ref.request_id,
                "pending_operation_id": pending.pending_operation_id,
                "pending_version": pending.version,
                "scope_digest": "f" * 64,
            },
        },
    )
    assert response.status_code == 409, response.get_data(as_text=True)
    assert c.ledger.dispatched_attempt_count() == 0
    _evidence("stale-scope", {"http_status": response.status_code, "error": response.get_json(), "business_calls": 0})


def test_action_transport_still_requires_console_login_and_csrf(action_console: ActionConsole) -> None:
    c, _, _, base = action_console
    login = c.client.post(base + "/actions", json={}, headers={"Authorization": ""})
    csrf = c.client.post(base + "/actions", json={}, headers={"X-CSRF-Token": ""})
    assert login.status_code == 401
    assert csrf.status_code == 401
    assert c.ledger.dispatched_attempt_count() == 0
    _evidence(
        "authentication", {"missing_login": login.status_code, "missing_csrf": csrf.status_code, "business_calls": 0}
    )


def test_native_resume_through_choice_reuses_one_durable_dispatch(action_console: ActionConsole) -> None:
    from sqlalchemy import func, select

    from models.dify_builder_native_tests import NativeDispatch

    c, _, _, base = action_console
    _control(c, base, "confirm_test_operation", "confirm-1")
    body, result = _control(c, base, "resume_test", "resume-1")
    assert result.test_execution is not None
    assert result.test_execution.request_id == c.ref.request_id
    assert result.run_status == "processing"
    assert c.client.post(base + "/actions", json=body.model_dump()).status_code == 200
    with c.factory() as sql:
        dispatches = sql.scalar(
            select(func.count()).select_from(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)
        )
        assert dispatches == 1
    assert c.ledger.dispatched_attempt_count() == 0
    _evidence(
        "resume-replay",
        {
            "receipt": result.model_dump(mode="json"),
            "durable_dispatches": dispatches,
            "business_calls": c.ledger.dispatched_attempt_count(),
        },
    )


def test_native_cancel_through_choice_does_not_claim_external_rollback(action_console: ActionConsole) -> None:
    c, _, _, base = action_console
    body, result = _control(c, base, "cancel_test", "cancel-1")
    assert result.test_execution is not None
    assert result.test_execution.cancellation is not None
    assert result.test_execution.cancellation.status == "cancelling"
    assert result.test_execution.outcome is None
    assert c.client.post(base + "/actions", json=body.model_dump()).status_code == 200
    assert c.ledger.dispatched_attempt_count() == 0


@pytest.mark.parametrize("runtime_case", ["root", "loop", "iteration"], indirect=True)
def test_action_controls_complete_real_graphon_run_without_repeated_http(
    runtime_case: RuntimeDeliveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Actual Graphon/SQL/checkpoints; only outbound HTTP and queue are synthetic.

    The existing qualified fixture admits the initial run. This test covers
    the entire subsequent wait -> action approval/resume -> terminal boundary.
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
    from controllers.console import dify_builder as controller
    from controllers.console import wraps
    from libs.passport import PassportService
    from libs.token import _real_cookie_name, generate_csrf_token
    from models.account import Account, AccountStatus
    from models.model import DifySetup
    from models.workflow import WorkflowRun
    from services.entities.feature_entities import FeatureModel
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_runtime import (
        delivery,
        execute,
        published_callback,
    )

    c = runtime_case
    first = c.published[0]
    waiting = execute(c, delivery(c, first), first)
    assert waiting is not None
    assert waiting.status == "waiting"
    assert c.sends == []
    with c.factory.begin() as sql:
        account = sql.get(Account, c.actor.account_id)
        assert account is not None
        account.status = AccountStatus.ACTIVE
        if sql.scalar(select(DifySetup).limit(1)) is None:
            sql.add(DifySetup(version="builder-action-ci"))

    def commands(*, actor: Actor) -> ProfiledNativeTestCommands:
        return ProfiledNativeTestCommands(
            sessions=c.factory,
            actor=actor,
            legacy_factory=lambda: c.api,
            confirmed_factory=lambda: pytest.fail("fixture must retain its admitted profile"),
        )

    service = DifyBuilderService(
        SqlDifyBuilderRepository(c.factory),
        FakeSessionLock(),
        lambda *_: pytest.fail("control action must not enqueue a fresh run"),
        get_app_revision_fn=lambda *_: "fixture-revision",
        test_actions=BuilderTestActions(c.factory, commands),
    )
    monkeypatch.setattr(controller, "build_service", lambda: service)
    monkeypatch.setattr(
        controller.FeatureService, "get_features", lambda _tenant: FeatureModel(dify_builder_enabled=True)
    )
    wraps._is_setup_completed.reset_success()
    client = c.app.test_client()
    token = PassportService().issue({"user_id": c.actor.account_id, "exp": int(datetime.now(UTC).timestamp()) + 600})
    csrf = generate_csrf_token(c.actor.account_id)
    client.set_cookie(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN), csrf)
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    client.environ_base[f"HTTP_{HEADER_NAME_CSRF_TOKEN.upper().replace('-', '_')}"] = csrf
    base = f"/console/api/dify-builder/sessions/{c.session_id}"
    trace: list[dict[str, object]] = []
    try:
        completed = waiting
        for index in range(5):
            response = client.get(base)
            assert response.status_code == 200
            current = DifyBuilderSessionViewResponse.model_validate(response.get_json())
            receipt = current.test_execution
            assert receipt is not None
            assert receipt.request_id == c.request_id
            if receipt.status == "terminal":
                break
            kind = (
                "confirm_test_operation"
                if any(action.id == "confirm_test_operation" for action in current.actions)
                else "resume_test"
            )
            selected = next(action for action in current.actions if action.id == kind)
            body = {
                "action_id": "confirm",
                "payload": {"option_id": kind, **selected.payload},
                "client_action_id": f"actual-{index}",
                "base_version": current.version,
                "base_app_revision": "fixture-revision",
            }
            command = client.post(base + "/actions", json=body)
            assert command.status_code == 200, command.get_data(as_text=True)
            settled = _finished(command)
            before_replay = len(c.sends)
            assert client.post(base + "/actions", json=body).status_code == 200
            assert len(c.sends) == before_replay
            trace.append({"action": body, "result": settled.model_dump(mode="json"), "http_calls": len(c.sends)})
            if kind == "resume_test":
                # Deliver the existing durable outbox, never call another start.
                c.api.lifecycle.publish_pending(publish=published_callback(c))
                message = c.published[-1]
                owner = delivery(c, message)
                completed = execute(c, owner, message)
                assert completed is not None
                assert execute(c, owner, message) is None
        assert completed.status == "completed"
        assert completed.native_status == "succeeded"
        assert completed.native_run_id == waiting.native_run_id
        assert len(c.sends) == (2 if c.kind == "iteration" else 1)
        final_response = client.get(base)
        final = DifyBuilderSessionViewResponse.model_validate(final_response.get_json())
        assert final.test_execution is not None
        assert final.test_execution.status == "terminal"
        assert final.test_execution.native_run_id == waiting.native_run_id
        with c.factory() as sql:
            run = sql.get(WorkflowRun, waiting.native_run_id)
            assert run is not None
            assert run.status == "succeeded"
        _evidence(
            f"actual-graphon-{c.kind}",
            {
                "steps": trace,
                "final": final.model_dump(mode="json"),
                "http_calls": len(c.sends),
                "same_native_run": True,
                "outbound_transport": "synthetic, no external network",
            },
        )
    finally:
        wraps._is_setup_completed.reset_success()
