from collections.abc import Callable, Iterator, Mapping
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from controllers.common import session as controller_session
from controllers.web import bp, wraps
from core.plugin.impl.oauth import OAuthHandler
from enums import DeploymentEdition
from extensions import ext_application_services
from models.end_user_connection import AppConnection, SessionConnection
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import WorkflowRun
from services.app_generate_service import AppGenerateService
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.conversation import ConversationConnectionService
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
    ConnectionSecretUnavailableError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.execution import ConnectionExecutionService
from services.end_user_connections.preflight import ConnectionPreflightService
from services.workflow_service import WorkflowService
from tasks.app_generate.workflow_execute_task import AppExecutionParams
from tests.helpers.end_user_api_key import ConnectionHarness, TestProviders, make_harness, plugin_provider


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> ConnectionHarness:
    return make_harness(sqlite_session_factory)


@pytest.fixture(params=[("/api/workflows/run", AppMode.WORKFLOW), ("/api/chat-messages", AppMode.ADVANCED_CHAT)])
def client(
    request: pytest.FixtureRequest, harness: ConnectionHarness, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[FlaskClient, str]]:
    path, mode = request.param
    with harness.sessions.begin() as session:
        app = session.get(App, harness.context.app_id)
        assert app is not None
        app.mode = mode

    def identity() -> tuple[App, EndUser]:
        with harness.sessions() as session:
            app = session.get(App, harness.context.app_id)
            user = session.get(EndUser, harness.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(controller_session.session_factory, "create_session", harness.sessions)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as http:
        yield http, path


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ConnectionConfigurationError(), 400, "connection_configuration_invalid"),
        (ConnectionConflictError(), 409, "connection_conflict"),
        (ConnectionInvalidCredentialsError(), 400, "connection_credentials_invalid"),
        (ConnectionRequiredError(), 400, "connection_required"),
        (ConnectionNotFoundError(), 404, "connection_not_found"),
        (ConnectionWorkflowChangedError(), 409, "workflow_changed"),
        (ConnectionReauthorizationRequiredError(), 409, "connection_reauthorization_required"),
        (ConnectionCheckUnavailableError(), 503, "credential_check_unavailable"),
        (ConnectionSecretUnavailableError(), 503, "connection_credentials_unavailable"),
        (ConnectionIdentityError(), 401, "unauthorized"),
    ],
)
def test_connection_errors_are_served_with_documented_contract(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status: int,
    code: str,
) -> None:
    def fail(**_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(AppGenerateService, "generate", fail)
    http, path = client
    response = http.post(
        path, json={"inputs": {}, "query": "hello", "workflow_id": harness.workflow_id, "connections": {}}
    )
    assert response.status_code == status
    assert response.get_json()["code"] == code


def test_identity_fields_are_not_forwarded_as_request_authority(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def generate(*, args: Mapping[str, object], **_kwargs: object) -> dict[str, str]:
        captured.update(args)
        return {"result": "ok"}

    monkeypatch.setattr(AppGenerateService, "generate", generate)
    http, path = client
    selected = str(uuid4())
    response = http.post(
        path,
        json={
            "inputs": {},
            "query": "hello",
            "workflow_id": harness.workflow_id,
            "connections": {"tool-1": selected},
            "tenant_id": "foreign",
            "account_id": "foreign",
            "connection_context": {"identity": "foreign"},
        },
    )
    assert response.status_code == 200
    assert captured["workflow_id"] == harness.workflow_id
    assert captured["connections"] == {"tool-1": selected}
    assert not {"tenant_id", "account_id", "connection_context"} & captured.keys()


@pytest.fixture
def real_execution_gate(
    harness: ConnectionHarness,
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
    config_overrides: Callable[..., None],
) -> None:
    workflow_service = WorkflowService(session_maker=harness.sessions)
    monkeypatch.setattr("services.app_generate_service.WorkflowService", lambda: workflow_service)
    providers = TestProviders(harness.auth, plugin_provider(harness.context.tenant_id))
    preflight = ConnectionPreflightService(
        connections=harness.repository,
        checks=harness.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.repository,
            providers=providers,
            oauth=PluginConnectionOAuthGateway(
                clients=harness.repository,
                providers=providers,
                handler=OAuthHandler(),
                auth=harness.auth,
            ),
        ),
    )
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: SimpleNamespace(
            end_user_connection_execution=ConnectionExecutionService(preflight=preflight),
            conversation_connections=ConversationConnectionService(store=harness.repository),
        ),
    )
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, PUBSUB_REDIS_CHANNEL_TYPE="streams")
    rate_limit = mocker.patch("services.app_generate_service.RateLimit")
    rate_limit.gen_request_key.return_value = "request"
    rate_limit.return_value.enter.return_value = "request"
    rate_limit.return_value.generate.side_effect = lambda response, *_args, **_kwargs: response


@pytest.mark.usefixtures("real_execution_gate")
@pytest.mark.parametrize("response_mode", ["blocking", "streaming"])
@pytest.mark.parametrize(
    ("selection", "status", "code"),
    [
        ("omitted", 400, "connection_required"),
        ("empty", 400, "connection_required"),
        ("null", 400, "connection_required"),
        ("invalid", 400, "connection_credentials_invalid"),
        ("temporarily_unavailable", 503, "credential_check_unavailable"),
        ("stale", 409, "workflow_changed"),
        ("extra", 400, "connection_configuration_invalid"),
        ("missing", 404, "connection_not_found"),
    ],
)
def test_real_gate_rejects_before_run_creation_or_enqueue(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    mocker: MockerFixture,
    response_mode: str,
    selection: str,
    status: int,
    code: str,
) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())
    harness.auth.calls.clear()
    if selection in {"invalid", "temporarily_unavailable"}:
        harness.auth.result = CredentialCheckResult.model_validate(
            {
                "status": selection,
                "reason_code": None,
                "retryable": False,
                "checked_at": 1,
            }
        )
    payload: dict[str, object] = {
        "inputs": {},
        "query": "hello",
        "workflow_id": harness.workflow_id,
        "response_mode": response_mode,
    }
    choices: dict[str, str | None] = {"tool-1": connection.id}
    match selection:
        case "empty":
            choices = {}
        case "null":
            choices["tool-1"] = None
        case "missing":
            choices["tool-1"] = str(uuid4())
        case "extra":
            choices["unused-node"] = connection.id
        case "stale":
            payload["workflow_id"] = str(uuid4())
    if selection != "omitted":
        payload["connections"] = choices
    params = mocker.spy(AppExecutionParams, "new")
    subscribe = mocker.spy(AppGenerateService, "_build_streaming_task_on_subscribe")
    enqueue = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
    workflow = mocker.patch("services.app_generate_service.WorkflowAppGenerator.generate")
    chat = mocker.patch("services.app_generate_service.AdvancedChatAppGenerator.generate")
    http, path = client
    response = http.post(path, json=payload)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    for effect in (params, subscribe, enqueue, workflow, chat):
        effect.assert_not_called()
    with harness.sessions() as session:
        for model in (WorkflowRun, Conversation, Message, AppConnection, SessionConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(model)) == 0


@pytest.mark.usefixtures("real_execution_gate")
def test_ready_selection_is_checked_before_serializing_the_queued_context(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    mocker: MockerFixture,
) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())
    harness.auth.calls.clear()
    enqueue = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
    retrieve = mocker.patch(
        "services.app_generate_service.MessageBasedAppGenerator.retrieve_events", return_value=iter(())
    )
    http, path = client
    response = http.post(
        path,
        json={
            "inputs": {},
            "query": "hello",
            "response_mode": "streaming",
            "workflow_id": harness.workflow_id,
            "connections": {"tool-1": connection.id},
        },
    )
    assert response.status_code == 200
    assert len(harness.auth.calls) == 1
    enqueue.assert_not_called()
    retrieve.call_args.kwargs["on_subscribe"]()
    enqueue.assert_called_once()
    params = AppExecutionParams.model_validate_json(enqueue.call_args.args[0])
    assert params.connection_context is not None
    assert params.workflow_id == harness.workflow_id
    assert params.connection_context.selections[0].connection_id == connection.id
    assert "original-secret" not in enqueue.call_args.args[0]


@pytest.mark.usefixtures("real_execution_gate")
@pytest.mark.parametrize("selection", ["omitted", "null", "empty", "node-null"])
def test_only_chatflow_omission_restores_last_conversation_choices(
    client: tuple[FlaskClient, str], harness: ConnectionHarness, mocker: MockerFixture, selection: str
) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())
    with harness.sessions.begin() as session:
        conversation = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Chat",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=harness.context.end_user_id,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
    params = mocker.spy(AppExecutionParams, "new")
    mocker.patch("services.app_generate_service.MessageBasedAppGenerator.retrieve_events", return_value=iter(()))
    enqueue = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
    http, path = client
    payload: dict[str, object] = {
        "inputs": {},
        "query": "hello",
        "response_mode": "streaming",
        "workflow_id": harness.workflow_id,
        "conversation_id": conversation_id,
        "connections": {"tool-1": connection.id},
    }
    assert http.post(path, json=payload).status_code == 200
    params.reset_mock()
    payload.pop("connections")
    if selection != "omitted":
        explicit_choices: dict[str, dict[str, str | None] | None] = {
            "null": None,
            "empty": {},
            "node-null": {"tool-1": None},
        }
        payload["connections"] = explicit_choices[selection]
    response = http.post(path, json=payload)
    if path == "/api/chat-messages" and selection == "omitted":
        assert response.status_code == 200
        params.assert_called_once()
        assert params.call_args.kwargs["connection_context"].selections[0].connection_id == connection.id
    else:
        assert response.status_code == 400
        assert response.get_json()["code"] == "connection_required"
        params.assert_not_called()
    enqueue.assert_not_called()
