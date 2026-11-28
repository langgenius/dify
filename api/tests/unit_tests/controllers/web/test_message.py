"""End-user Agent thoughts keep authoritative outcomes across SSE and history.

GET uses the real Web/Service Resources, JWT/app-token admission, application
services, SQLite repositories and response DTOs. SSE starts at real native event
DTOs and follows Recorder -> SQL -> EasyUI serializer -> simple/full converter
-> compact SSE. It does not claim a POST generation/model/daemon round trip.
The existing pipeline entity fixture supplies unused model configuration; the
unit harness's Redis cache is mocked. No response serializer or query service
is replaced. Friendly labels enter through the Recorder's real prepared-map port.
"""

import asyncio
import json
from collections.abc import Generator, Iterator
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pytest
from dify_agent.layers.tool_call_limits import ToolCallLimitGuard
from dify_agent.protocol.schemas import PydanticAIStreamRunEvent, RunCancelledEvent, RunCancelledEventData, RunEvent
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.protocol.tool_call_limits import (
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_VALIDATION_FAILED_METADATA_KEY,
    ToolCallLimitMetadata,
)
from dify_agent.runtime.tool_call_limits import InMemoryToolCallLimitStore
from flask import Blueprint, Flask
from flask.testing import FlaskClient
from pydantic import JsonValue
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartStartEvent,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
)
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from clients.agent_backend.event_adapter import (
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendStreamInternalEvent,
)
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from controllers.service_api.app.message import MessageListApi as ServiceMessageListApi
from controllers.web.message import MessageListApi as WebMessageListApi
from core.app.apps.agent_app.app_generator import AgentAppGenerator
from core.app.apps.agent_app.app_runner import _AgentProcessRecorder
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, DifyRunContext, InvokeFrom, UserFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent
from core.app.entities.task_entities import ChatbotAppStreamResponse, MessageEndStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.tools.entities.common_entities import I18nObject
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import DifyLoginManager
from libs.external_api import ExternalApi
from libs.helper import compact_generate_response
from libs.passport import PassportService
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import AgentSoulConfig
from models.engine import db
from models.enums import ApiTokenType, ConversationFromSource, CreatorUserRole, EndUserType
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import (
    ApiToken,
    App,
    AppMode,
    Conversation,
    CustomizeTokenStrategy,
    EndUser,
    Message,
    MessageAgentThought,
    Site,
)
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.core.app.apps.agent_app.test_app_runner import _FakeQueueManager
from tests.unit_tests.core.app.task_pipeline.test_easy_ui_based_generate_task_pipeline import _make_entity

_RUN = "end-user-native-run"
_OPERATION = '["plugin","langgenius/github/github","search"]'
_PRIVATE = "provider-credential-must-never-be-returned"
_LABEL = I18nObject(en_US="Search repositories", zh_Hans="搜索仓库", ja_JP="リポジトリ検索")


@dataclass(frozen=True)
class EndUserHistory:
    application: Flask
    client: FlaskClient
    sessions: sessionmaker[Session]
    app: App
    user: EndUser
    other_user: EndUser
    conversation: Conversation
    foreign_conversation: Conversation
    message: Message
    surface: str
    site_code: str
    api_token: str

    @property
    def invoke_from(self) -> InvokeFrom:
        """Given the fixture surface, return its production converter selection."""
        return InvokeFrom.WEB_APP if self.surface == "web" else InvokeFrom.SERVICE_API

    def history(
        self, *, user: EndUser | None = None, conversation_id: str | None = None, authenticated: bool = True
    ) -> TestResponse:
        """Read the real GET route; never replace admission or response serialization."""
        actor = user or self.user
        query = {"conversation_id": conversation_id or self.conversation.id, "user": actor.session_id}
        headers: dict[str, str] = {}
        if authenticated:
            if self.surface == "web":
                headers = {
                    HEADER_NAME_APP_CODE: self.site_code,
                    HEADER_NAME_PASSPORT: PassportService().issue(
                        {"app_id": self.app.id, "app_code": self.site_code, "end_user_id": actor.id}
                    ),
                }
            else:
                headers = {"Authorization": f"Bearer {self.api_token}"}
        path = "/api/messages" if self.surface == "web" else "/v1/messages"
        return self.client.get(path, query_string=query, headers=headers)


def _conversation(app: App, user: EndUser) -> Conversation:
    """Build a conversation with explicit app/end-user ownership for persistence."""
    return Conversation(
        app_id=app.id,
        mode=AppMode.AGENT,
        name="Agent conversation",
        _inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=user.id,
        from_account_id=None,
    )


@pytest.fixture(params=["web", "service"])
def history(
    request: pytest.FixtureRequest,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
) -> Iterator[EndUserHistory]:
    """Persist a published Agent and two actors; yield real authenticated GET routes.

    Both app databases share the unit fixture's isolated SQLite file. Teardown
    removes only this Flask app's session/engine; no shared service is contacted.
    """
    assert request.param in {"web", "service"}
    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        SECRET_KEY="agent-end-user-contract-secret-at-least-32-bytes",
        RBAC_ENABLED=False,
    ):
        application = Flask(__name__)
        application.config.update(
            TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url), RESTX_ERROR_404_HELP=False
        )
        db.init_app(application)
        application.extensions["application_services"] = account_application_services
        DifyLoginManager().init_app(application)
        for name, prefix, resource in [
            ("agent_web_history", "/api", WebMessageListApi),
            ("agent_service_history", "/v1", ServiceMessageListApi),
        ]:
            blueprint = Blueprint(name, __name__, url_prefix=prefix)
            ExternalApi(blueprint).add_resource(resource, "/messages")
            application.register_blueprint(blueprint)
        with sqlite_session_factory.begin() as session:
            tenant = Tenant(name="Agent workspace")
            account = Account(name="Owner", email=f"agent-{uuid4()}@example.test")
            session.add_all([tenant, account])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                )
            )
            app = App(
                tenant_id=tenant.id,
                name="Published Agent",
                mode=AppMode.AGENT,
                enable_site=True,
                enable_api=True,
                max_active_requests=0,
            )
            session.add(app)
            session.flush()
            agent = Agent(
                tenant_id=tenant.id,
                name="Agent",
                app_id=app.id,
                source=AgentSource.AGENT_APP,
                scope=AgentScope.ROSTER,
                created_by=account.id,
            )
            session.add(agent)
            session.flush()
            snapshot = AgentConfigSnapshot(
                tenant_id=tenant.id, agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
            )
            session.add(snapshot)
            session.flush()
            agent.active_config_snapshot_id = snapshot.id
            session.add(
                AgentConfigRevision(
                    tenant_id=tenant.id,
                    agent_id=agent.id,
                    current_snapshot_id=snapshot.id,
                    revision=1,
                    operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                )
            )
            site_code = f"agent-{uuid4().hex}"
            session.add(
                Site(
                    app_id=app.id,
                    code=site_code,
                    title="Agent",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                )
            )
            user_type = EndUserType.BROWSER if request.param == "web" else EndUserType.SERVICE_API
            user = EndUser(
                tenant_id=tenant.id,
                app_id=app.id,
                type=user_type,
                session_id="allowed-user",
                external_user_id="allowed-user",
            )
            other_user = EndUser(
                tenant_id=tenant.id,
                app_id=app.id,
                type=user_type,
                session_id="other-user",
                external_user_id="other-user",
            )
            session.add_all([user, other_user])
            session.flush()
            conversation, foreign = _conversation(app, user), _conversation(app, other_user)
            session.add_all([conversation, foreign])
            session.flush()
            message = Message(
                app_id=app.id,
                conversation_id=conversation.id,
                app_mode=AppMode.AGENT,
                _inputs={},
                query="Find repositories",
                message="",
                answer="",
                message_tokens=0,
                answer_tokens=0,
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                total_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                from_end_user_id=user.id,
                invoke_from=ModelInvokeFrom.WEB_APP if request.param == "web" else ModelInvokeFrom.SERVICE_API,
            )
            api_token = f"app-{uuid4().hex}"
            session.add_all(
                [message, ApiToken(type=ApiTokenType.APP, app_id=app.id, tenant_id=tenant.id, token=api_token)]
            )
            session.flush()
        with application.app_context():
            try:
                yield EndUserHistory(
                    application,
                    application.test_client(),
                    sqlite_session_factory,
                    app,
                    user,
                    other_user,
                    conversation,
                    foreign,
                    message,
                    request.param,
                    site_code,
                    api_token,
                )
            finally:
                db.session.remove()
                db.engine.dispose()


def _deliver(recorder: _AgentProcessRecorder, event: RunEvent) -> None:
    """Adapt a real native public event and apply it through the real Recorder."""
    internal = AgentBackendRunEventAdapter().adapt(event)
    for item in internal:
        assert isinstance(item, AgentBackendStreamInternalEvent)
        recorder.handle_stream_event(item)


def _record(history: EndUserHistory, scenario: str, *, stop_before_terminal: bool = False) -> list[MessageAgentThought]:
    """Persist supplied native outcomes with live memory reservations and labels.

    No provider executes here. The event is the test's boundary input; all API
    recording, SQL, terminal enrichment and label serialization remain real.
    """
    # The existing stopped-queue fixture controls only notification delivery;
    # its terminal metadata still uses the real Recorder and SQL transaction.
    stopped_queue = _FakeQueueManager(reject_when_stopped=True) if stop_before_terminal else None
    queue = stopped_queue or MessageBasedAppQueueManager(
        "task", history.user.id, history.invoke_from, history.conversation.id, AppMode.AGENT, history.message.id
    )
    labels = {"search": _LABEL.to_dict()}
    recorder = _AgentProcessRecorder(
        dify_context=DifyRunContext(
            tenant_id=history.app.tenant_id,
            app_id=history.app.id,
            user_id=history.user.id,
            user_from=UserFrom.END_USER,
            invoke_from=history.invoke_from,
        ),
        message_id=history.message.id,
        queue_manager=queue,
        tool_labels=labels,
    )
    _deliver(
        recorder,
        PydanticAIStreamRunEvent(
            run_id=_RUN, data=PartStartEvent(index=0, part=ThinkingPart(content="Reviewing the available tools."))
        ),
    )
    if scenario == "legacy":
        db.session.add(
            MessageAgentThought(
                message_id=history.message.id,
                position=2,
                thought="",
                tool="search",
                tool_labels_str=json.dumps({"search": _LABEL.to_dict()}),
                tool_meta_str=json.dumps({"provider_private": _PRIVATE}),
                observation="legacy observation",
                created_by_role=CreatorUserRole.END_USER,
                created_by=history.user.id,
            )
        )
        db.session.commit()
    else:
        counter = InMemoryToolCallLimitStore()
        guard = ToolCallLimitGuard(_OPERATION, 3)
        count = 4 if scenario == "cap" else 1
        for index in range(count):
            reservation = None
            call_id = f"call-{index + 1}"
            _deliver(
                recorder,
                PydanticAIStreamRunEvent(
                    run_id=_RUN,
                    data=FunctionToolCallEvent(
                        part=ToolCallPart(tool_name="search", tool_call_id=call_id, args={"query": "public query"})
                    ),
                ),
            )
            if scenario not in {"validation", "unlimited"}:
                reservation = asyncio.run(
                    counter.reserve(run_id=_RUN, tool_identity=_OPERATION, tool_call_id=call_id, limit=3)
                )
            if scenario == "cancel":
                if stopped_queue is not None:
                    stopped_queue.request_stop()
                terminal = RunCancelledEvent(
                    run_id=_RUN,
                    data=RunCancelledEventData(reason="user_stop", session_snapshot=SessionSnapshot()),
                    tool_call_limits=counter.seal(),
                )
                adapted = AgentBackendRunEventAdapter().adapt(terminal)
                assert len(adapted) == 1
                assert isinstance(adapted[0], AgentBackendRunCancelledInternalEvent)
                recorder.finish(adapted[0])
            else:
                metadata: dict[str, JsonValue] = {"provider_private": {"credential": _PRIVATE}}
                if scenario == "validation":
                    metadata[TOOL_VALIDATION_FAILED_METADATA_KEY] = True
                elif scenario != "unlimited":
                    assert reservation is not None
                    returned = (
                        guard.denied(reservation)
                        if not reservation.allowed
                        else guard.result(reservation, "public observation", failed=scenario == "failure")
                    )
                    assert isinstance(returned.metadata, dict)
                    metadata.update(returned.metadata)
                observation = (
                    "query is required"
                    if scenario == "validation"
                    else "provider request failed"
                    if scenario == "failure"
                    else "public observation"
                )
                _deliver(
                    recorder,
                    PydanticAIStreamRunEvent(
                        run_id=_RUN,
                        data=FunctionToolResultEvent(
                            part=ToolReturnPart(
                                tool_name="search", tool_call_id=call_id, content=observation, metadata=metadata
                            )
                        ),
                    ),
                )
    rows = list(
        db.session.scalars(
            select(MessageAgentThought)
            .where(MessageAgentThought.message_id == history.message.id)
            .order_by(MessageAgentThought.position)
        )
    )
    for row in rows:
        metadata = row.tool_meta
        assert isinstance(metadata, dict)
        row.tool_meta_str = json.dumps({**metadata, "provider_private": {"credential": _PRIVATE}})
    db.session.commit()
    return rows


def _sse(history: EndUserHistory, rows: list[MessageAgentThought]) -> list[dict[str, JsonValue]]:
    """Serialize committed rows through the real EasyUI/converter/compact chain.

    The borrowed entity fixture only supplies unrelated model configuration;
    SQL reads, thought DTOs, converter selection and SSE encoding are unchanged.
    """
    entity = _make_entity(ChatAppGenerateEntity, AppMode.AGENT)
    entity.invoke_from = history.invoke_from
    queue = MessageBasedAppQueueManager(
        "task", history.user.id, history.invoke_from, history.conversation.id, AppMode.AGENT, history.message.id
    )
    pipeline = EasyUIBasedGenerateTaskPipeline(entity, queue, history.conversation, history.message, stream=True)

    def chunks() -> Generator[ChatbotAppStreamResponse]:
        """Yield real SQL-backed thought DTOs and a metadata filtering sentinel."""
        for row in rows:
            thought = pipeline._agent_thought_to_stream_response(QueueAgentThoughtEvent(agent_thought_id=row.id))
            assert thought is not None
            yield ChatbotAppStreamResponse(
                stream_response=thought,
                conversation_id=history.conversation.id,
                message_id=history.message.id,
                created_at=1,
            )
        yield ChatbotAppStreamResponse(
            stream_response=MessageEndStreamResponse(
                task_id="task", id=history.message.id, metadata={"usage": {"total_tokens": 5}}
            ),
            conversation_id=history.conversation.id,
            message_id=history.message.id,
            created_at=1,
        )

    converted = AgentAppGenerateResponseConverter.convert(response=chunks(), invoke_from=history.invoke_from)
    wire = AgentAppGenerator.convert_to_event_stream(converted)
    with history.application.test_request_context("/chat-messages"):
        response = compact_generate_response(wire)
        assert response.mimetype == "text/event-stream"
        body = response.get_data(as_text=True)
    assert _PRIVATE not in body
    assert "provider_private" not in body
    assert "tool_meta" not in body
    return [json.loads(frame.removeprefix("data: ")) for frame in body.split("\n\n") if frame.startswith("data: ")]


@pytest.mark.parametrize("scenario", ["cap", "failure", "cancel", "validation", "unlimited", "legacy"])
def test_agent_outcomes_labels_and_privacy_survive_end_user_sse_and_history(
    history: EndUserHistory, scenario: str
) -> None:
    """Given native outcomes, preserve authoritative facts in both public surfaces."""
    rows = _record(history, scenario)
    frames = _sse(history, rows)
    thoughts = [frame for frame in frames if frame["event"] == "agent_thought"]
    target = thoughts[-1]
    assert target["tool_labels"] == {"search": _LABEL.to_dict()}
    assert thoughts[0]["thought"] == "Reviewing the available tools."
    assert "tool_activity" not in thoughts[0]
    end_metadata = frames[-1]["metadata"]
    assert isinstance(end_metadata, dict)
    assert ("usage" in end_metadata) == (history.surface == "service")
    response = history.history()
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["data"]) == 1
    stored = body["data"][0]["agent_thoughts"]
    assert len(stored) == len(thoughts)
    assert stored[-1]["tool_labels"] == target["tool_labels"]
    assert stored[-1].get("tool_activity") == target.get("tool_activity")
    serialized = json.dumps(body)
    assert _PRIVATE not in serialized
    assert "provider_private" not in serialized
    assert "tool_meta" not in serialized
    if scenario == "legacy":
        assert "tool_activity" not in target
    else:
        activity = target["tool_activity"]
        assert isinstance(activity, dict)
        assert (
            activity["status"]
            == {
                "cap": "not_executed",
                "failure": "failed",
                "cancel": "cancelled",
                "validation": "failed",
                "unlimited": "succeeded",
            }[scenario]
        )
        quota = activity["call_limit"]
        if scenario in {"validation", "unlimited"}:
            assert quota is None
        else:
            assert isinstance(quota, dict)
            assert quota["used"] == (3 if scenario == "cap" else 1)
            assert quota["limit"] == 3
            assert (
                quota["execution_status"]
                == {"cap": "not_executed", "failure": "executed", "cancel": "unconfirmed"}[scenario]
            )
            assert quota["reason"] == ("call_limit_reached" if scenario == "cap" else None)
        if scenario in {"cap", "failure", "cancel", "validation"}:
            assert activity["error"]


def test_message_history_admission_and_end_user_isolation(history: EndUserHistory) -> None:
    """Reject absent credentials and another actor/conversation without leaking data."""
    _record(history, "cap")
    assert history.history(authenticated=False).status_code == 401
    assert history.history(user=history.other_user).status_code == 404
    assert history.history(conversation_id=history.foreign_conversation.id).status_code == 404
    assert history.history().status_code == 200


def test_history_freezes_labels_limits_and_per_call_usage_after_changed_configuration_replay(
    history: EndUserHistory,
) -> None:
    """A completed call's persisted label/limit/ordinal survives a changed replay.

    The current prepared label and incoming limit deliberately differ. The same
    native identity must reuse its row, and history must read its original data.
    """
    rows = _record(history, "cap")
    original_ids = [row.id for row in rows]
    queue = MessageBasedAppQueueManager(
        "replay-task", history.user.id, history.invoke_from, history.conversation.id, AppMode.AGENT, history.message.id
    )
    recorder = _AgentProcessRecorder(
        dify_context=DifyRunContext(
            tenant_id=history.app.tenant_id,
            app_id=history.app.id,
            user_id=history.user.id,
            user_from=UserFrom.END_USER,
            invoke_from=history.invoke_from,
        ),
        message_id=history.message.id,
        queue_manager=queue,
        tool_labels={"search": I18nObject(en_US="Renamed current tool", zh_Hans="已改名").to_dict()},
    )
    _deliver(
        recorder,
        PydanticAIStreamRunEvent(
            run_id=_RUN,
            data=FunctionToolResultEvent(
                part=ToolReturnPart(
                    tool_name="search",
                    tool_call_id="call-1",
                    content="late changed result",
                    metadata={
                        TOOL_CALL_LIMIT_METADATA_KEY: ToolCallLimitMetadata(
                            tool_identity=_OPERATION, limit=99, used=1, execution_status="executed"
                        ).model_dump(mode="json")
                    },
                )
            ),
        ),
    )
    response = history.history()
    assert response.status_code == 200
    stored = response.get_json()["data"][0]["agent_thoughts"]
    assert [thought["id"] for thought in stored] == original_ids
    tools = [thought for thought in stored if thought["tool"]]
    assert [thought["tool_activity"]["call_limit"]["used"] for thought in tools] == [1, 2, 3, 3]
    assert all(thought["tool_activity"]["call_limit"]["limit"] == 3 for thought in tools)
    assert all(thought["tool_labels"] == {"search": _LABEL.to_dict()} for thought in tools)
    assert tools[0]["observation"] == "public observation"


def test_stopped_consumer_cannot_drop_cancelled_unconfirmed_history(history: EndUserHistory) -> None:
    """When notifications stop, terminal reservation facts remain queryable by the owner.

    This deliberately asserts the GET recovery contract, not delivery of a final
    SSE frame after a browser has already stopped consuming its stream.
    """
    _record(history, "cancel", stop_before_terminal=True)
    response = history.history()
    assert response.status_code == 200
    target = response.get_json()["data"][0]["agent_thoughts"][-1]
    activity = target["tool_activity"]
    assert activity["status"] == "cancelled"
    assert activity["call_limit"]["execution_status"] == "unconfirmed"
    assert activity["call_limit"]["used"] == 1
    assert activity["call_limit"]["limit"] == 3
    assert activity["call_limit"]["reason"] is None
    assert target["tool_labels"] == {"search": _LABEL.to_dict()}
