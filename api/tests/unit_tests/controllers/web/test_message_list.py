"""Unit tests for controllers.web.message message list mapping."""

from __future__ import annotations

import builtins
import inspect
import json
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import ANY, patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.common.controller_schemas import MessageListQuery
from core.app.entities.app_invoke_entities import InvokeFrom
from core.entities.execution_extra_content import HumanInputContent
from graphon.enums import WorkflowExecutionStatus
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
    WorkflowRunTriggeredFrom,
)
from models.model import (
    App,
    AppMode,
    Conversation,
    EndUser,
    Message,
    MessageAgentThought,
    MessageFeedback,
)
from models.workflow import WorkflowRun, WorkflowType

# Ensure flask_restx.api finds MethodView during import.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _load_controller_module():
    """Import controllers.web.message using a stub package."""

    import importlib
    import importlib.util
    import sys

    parent_module_name = "controllers.web"
    module_name = f"{parent_module_name}.message"

    if parent_module_name not in sys.modules:
        from flask_restx import Namespace

        stub = ModuleType(parent_module_name)
        web_controller_dir = Path(__file__).resolve().parents[4] / "controllers" / "web"
        stub.__file__ = str(web_controller_dir / "__init__.py")
        stub.__path__ = [str(web_controller_dir)]
        stub.__package__ = "controllers"
        stub.__spec__ = importlib.util.spec_from_loader(parent_module_name, loader=None, is_package=True)
        stub.web_ns = Namespace("web", description="Web API", path="/")
        sys.modules[parent_module_name] = stub

    wraps_module_name = f"{parent_module_name}.wraps"
    if wraps_module_name not in sys.modules:
        wraps_stub = ModuleType(wraps_module_name)

        class WebApiResource:
            pass

        wraps_stub.WebApiResource = WebApiResource
        sys.modules[wraps_module_name] = wraps_stub

    return importlib.import_module(module_name)


message_module = _load_controller_module()
MessageListApi = message_module.MessageListApi


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Conversation, EndUser, Message, MessageAgentThought, MessageFeedback, WorkflowRun)],
    indirect=True,
)
@pytest.mark.parametrize("app_mode", [AppMode.ADVANCED_CHAT, AppMode.CHAT])
def test_message_list_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session, app_mode: AppMode) -> None:
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    workflow_run_id = str(uuid4())

    created_at = datetime(2024, 1, 1, 12, 0, 0)
    resource_created_at = datetime(2024, 1, 1, 13, 0, 0)
    thought_created_at = datetime(2024, 1, 1, 14, 0, 0)

    retriever_resource = {
        "id": "res-obj",
        "message_id": message_id,
        "position": 2,
        "dataset_id": "ds-1",
        "dataset_name": "dataset",
        "document_id": "doc-1",
        "document_name": "document",
        "data_source_type": "file",
        "segment_id": "seg-1",
        "score": 0.9,
        "hit_count": 1,
        "word_count": 10,
        "segment_position": 0,
        "index_node_hash": "hash",
        "content": "content",
        "created_at": int(resource_created_at.timestamp()),
    }

    agent_thought = MessageAgentThought(
        message_chain_id="chain-1",
        message_id=message_id,
        position=1,
        created_by_role="end_user",
        created_by="end-user-1",
        thought="thinking",
        tool="tool",
        tool_labels_str=json.dumps({"label": "value"}),
        tool_input="{}",
        observation="observed",
        message_files=json.dumps(["file-a"]),
    )
    agent_thought.id = "thought-1"
    agent_thought.created_at = thought_created_at

    message_files = [
        {"id": "file-dict", "filename": "a.txt", "type": "file", "transfer_method": "local"},
        {"id": "file-obj", "filename": "b.txt", "type": "file", "transfer_method": "local"},
    ]

    app_model = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Chat App",
        mode=app_mode,
        enable_site=False,
        enable_api=False,
    )
    end_user = EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id=app_model.id,
        type=EndUserType.BROWSER,
        name="Web User",
        session_id="session-1",
    )
    conversation = Conversation(
        id=conversation_id,
        app_id=app_model.id,
        mode=app_mode,
        name="Conversation",
        _inputs={},
        status="normal",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    message = Message(
        id=message_id,
        app_id=app_model.id,
        conversation_id=conversation_id,
        parent_message_id=None,
        _inputs={"foo": "bar"},
        query="hello",
        message={},
        answer="answer",
        message_unit_price=0,
        message_price_unit=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        app_mode=app_mode,
        workflow_run_id=workflow_run_id,
        message_metadata=json.dumps(
            {
                "meta": "value",
                "retriever_resources": [
                    {"id": "res-dict", "message_id": message_id, "position": 1},
                    retriever_resource,
                ],
            }
        ),
        created_at=created_at,
        status="normal",
        error=None,
    )
    message.set_extra_contents(
        [
            HumanInputContent(
                workflow_run_id=workflow_run_id,
                submitted=True,
            ).model_dump(mode="json")
        ]
    )
    workflow_run = WorkflowRun(
        id=workflow_run_id,
        tenant_id=app_model.tenant_id,
        app_id=app_model.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by=end_user.id,
        created_at=created_at,
    )
    feedback = MessageFeedback(
        app_id=app_model.id,
        conversation_id=conversation_id,
        message_id=message_id,
        rating=FeedbackRating.LIKE,
        from_source=FeedbackFromSource.USER,
        from_end_user_id=end_user.id,
    )
    sqlite_session.add_all([app_model, end_user, conversation, message, feedback, agent_thought, workflow_run])
    sqlite_session.commit()

    pagination = SimpleNamespace(limit=20, has_more=False, data=[message])

    def message_files_with_session(_self, *, session):
        del session
        return message_files

    monkeypatch.setattr(Message, "message_files_with_session", message_files_with_session)

    with (
        patch.object(message_module.MessageService, "pagination_by_first_id", return_value=pagination) as mock_page,
        patch.object(
            message_module.MessageService,
            "get_running_end_user_workflow_run_ids",
            wraps=message_module.MessageService.get_running_end_user_workflow_run_ids,
        ) as mock_running_workflows,
        patch.object(message_module.db, "session", return_value=sqlite_session),
        app.test_request_context(f"/messages?conversation_id={conversation_id}&limit=20"),
    ):
        query = MessageListQuery.model_validate({"conversation_id": conversation_id, "limit": 20})
        response = inspect.unwrap(MessageListApi.get)(MessageListApi(), query, app_model, end_user)

    mock_page.assert_called_once_with(app_model, end_user, conversation_id, None, 20, session=ANY)
    if app_mode == AppMode.ADVANCED_CHAT:
        mock_running_workflows.assert_called_once()
    else:
        mock_running_workflows.assert_not_called()
    assert response["limit"] == 20
    assert response["has_more"] is False
    assert len(response["data"]) == 1

    item = response["data"][0]
    assert item["id"] == message_id
    assert item["conversation_id"] == conversation_id
    assert item["inputs"] == {"foo": "bar"}
    assert item["answer"] == "answer"
    assert item["feedback"]["rating"] == "like"
    assert item["metadata"]["meta"] == "value"
    assert item["created_at"] == int(created_at.timestamp())

    assert item["retriever_resources"][0]["id"] == "res-dict"
    assert item["retriever_resources"][1]["id"] == "res-obj"
    assert item["retriever_resources"][1]["created_at"] == int(resource_created_at.timestamp())

    assert item["agent_thoughts"][0]["chain_id"] == "chain-1"
    assert item["agent_thoughts"][0]["created_at"] == int(thought_created_at.timestamp())
    assert item["extra_contents"][0]["workflow_run_id"] == message.extra_contents[0]["workflow_run_id"]
    assert item["extra_contents"][0]["submitted"] == message.extra_contents[0]["submitted"]
    assert item["workflow_run_id"] == workflow_run_id
    assert item["workflow_run_is_running"] is (app_mode == AppMode.ADVANCED_CHAT)

    other_workflow_run_id = str(uuid4())
    sqlite_session.add(
        WorkflowRun(
            id=other_workflow_run_id,
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            graph="{}",
            inputs="{}",
            status=WorkflowExecutionStatus.RUNNING,
            outputs="{}",
            error=None,
            elapsed_time=0,
            total_tokens=0,
            total_steps=0,
            created_by_role=CreatorUserRole.END_USER,
            created_by="another-end-user",
            created_at=created_at,
        )
    )
    sqlite_session.commit()
    assert message_module.MessageService.get_running_end_user_workflow_run_ids(
        workflow_run_ids={workflow_run_id, other_workflow_run_id},
        tenant_id=app_model.tenant_id,
        app_id=app_model.id,
        end_user_id=end_user.id,
        session=sqlite_session,
    ) == {workflow_run_id}
    assert (
        message_module.MessageService.get_running_end_user_workflow_run_ids(
            workflow_run_ids=set(),
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            end_user_id=end_user.id,
            session=sqlite_session,
        )
        == set()
    )

    assert item["message_files"][0]["id"] == "file-dict"
    assert item["message_files"][1]["id"] == "file-obj"
