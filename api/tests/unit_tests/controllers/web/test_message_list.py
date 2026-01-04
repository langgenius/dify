"""Unit tests for controllers.web.message message list mapping."""

from __future__ import annotations

import builtins
from datetime import datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.views import MethodView

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
        stub.__file__ = "controllers/web/__init__.py"
        stub.__path__ = ["controllers/web"]
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


def test_message_list_mapping(app: Flask) -> None:
    conversation_id = str(uuid4())
    message_id = str(uuid4())

    created_at = datetime(2024, 1, 1, 12, 0, 0)
    resource_created_at = datetime(2024, 1, 1, 13, 0, 0)
    thought_created_at = datetime(2024, 1, 1, 14, 0, 0)

    retriever_resource_obj = SimpleNamespace(
        id="res-obj",
        message_id=message_id,
        position=2,
        dataset_id="ds-1",
        dataset_name="dataset",
        document_id="doc-1",
        document_name="document",
        data_source_type="file",
        segment_id="seg-1",
        score=0.9,
        hit_count=1,
        word_count=10,
        segment_position=0,
        index_node_hash="hash",
        content="content",
        created_at=resource_created_at,
    )

    agent_thought = SimpleNamespace(
        id="thought-1",
        chain_id=None,
        message_chain_id="chain-1",
        message_id=message_id,
        position=1,
        thought="thinking",
        tool="tool",
        tool_labels={"label": "value"},
        tool_input="{}",
        created_at=thought_created_at,
        observation="observed",
        files=["file-a"],
    )

    message_file_obj = SimpleNamespace(
        id="file-obj",
        filename="b.txt",
        type="file",
        url=None,
        mime_type=None,
        size=None,
        transfer_method="local",
        belongs_to=None,
        upload_file_id=None,
    )

    message = SimpleNamespace(
        id=message_id,
        conversation_id=conversation_id,
        parent_message_id=None,
        inputs={"foo": "bar"},
        query="hello",
        re_sign_file_url_answer="answer",
        user_feedback=SimpleNamespace(rating="like"),
        retriever_resources=[
            {"id": "res-dict", "message_id": message_id, "position": 1},
            retriever_resource_obj,
        ],
        created_at=created_at,
        agent_thoughts=[agent_thought],
        message_files=[
            {"id": "file-dict", "filename": "a.txt", "type": "file", "transfer_method": "local"},
            message_file_obj,
        ],
        status="success",
        error=None,
        message_metadata_dict={"meta": "value"},
    )

    pagination = SimpleNamespace(limit=20, has_more=False, data=[message])
    app_model = SimpleNamespace(mode="chat")
    end_user = SimpleNamespace()

    with (
        patch.object(message_module.MessageService, "pagination_by_first_id", return_value=pagination) as mock_page,
        app.test_request_context(f"/messages?conversation_id={conversation_id}&limit=20"),
    ):
        response = MessageListApi().get(app_model, end_user)

    mock_page.assert_called_once_with(app_model, end_user, conversation_id, None, 20)
    assert response["limit"] == 20
    assert response["has_more"] is False
    assert len(response["data"]) == 1

    item = response["data"][0]
    assert item["id"] == message_id
    assert item["conversation_id"] == conversation_id
    assert item["inputs"] == {"foo": "bar"}
    assert item["answer"] == "answer"
    assert item["feedback"]["rating"] == "like"
    assert item["metadata"] == {"meta": "value"}
    assert item["created_at"] == int(created_at.timestamp())

    assert item["retriever_resources"][0]["id"] == "res-dict"
    assert item["retriever_resources"][1]["id"] == "res-obj"
    assert item["retriever_resources"][1]["created_at"] == int(resource_created_at.timestamp())

    assert item["agent_thoughts"][0]["chain_id"] == "chain-1"
    assert item["agent_thoughts"][0]["created_at"] == int(thought_created_at.timestamp())

    assert item["message_files"][0]["id"] == "file-dict"
    assert item["message_files"][1]["id"] == "file-obj"
