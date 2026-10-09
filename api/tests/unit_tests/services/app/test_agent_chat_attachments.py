"""Agent Chat reads image metadata through its injected database before accessing storage."""

import contextvars
from collections.abc import Iterator
from dataclasses import dataclass
from typing import cast
from unittest.mock import create_autospec
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine, Table, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.agent.entities import AgentEntity
from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.db import session_factory
from core.model_manager import ModelInstance
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolInvokeMeta
from extensions.ext_database import db
from graphon.file import File, file_manager
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelFeature
from models.annotation_reply import AnnotationReplies
from models.base import TypeBase
from models.model import App, Conversation, Message, MessageAgentThought, MessageFile, UploadFile
from repositories.app.generation_repository import AppGenerationRepository
from services.agent.chat.function_call_runner import FunctionCallAgentRunner
from services.agent.chat.ports import AgentDatasetTools, AgentToolInvoker
from services.app.generation.adapters import agent_chat as worker_module
from services.app.generation.adapters.agent_chat import AgentChatAppGenerator
from services.app.generation.ports import AgentMessageRecords
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.tools.dataset.tool import DatasetRetrieverTool, DatasetToolRetrieval
from services.tools.tool_engine import ToolEngine
from tests.unit_tests.core.agent.test_base_agent_runner import (
    _app_config,
    _app_generate,
    _conversation,
    _message,
    _tool_entity,
)
from tests.unit_tests.model_factories import make_app, make_upload_file


@dataclass
class LLM:
    def get_model_schema(self, _name: str, _credentials: dict[str, object] | None) -> AIModelEntity:
        return AIModelEntity.model_construct(features=[ModelFeature.VISION])


@dataclass
class Model:
    model_type_instance: LLM
    model_name: str = "model"
    credentials: dict[str, object] | None = None


@pytest.fixture(params=[False, True], ids=["retain-after-commit", "expire-after-commit"])
def agent_database(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[sessionmaker[Session], AppGenerationRepository, Engine]]:
    engine = create_engine("sqlite://", poolclass=QueuePool)
    TypeBase.metadata.create_all(
        engine,
        tables=[
            cast(Table, model.__table__)
            for model in (App, Conversation, Message, MessageAgentThought, MessageFile, UploadFile)
        ],
    )
    assert isinstance(request.param, bool)
    sessions = sessionmaker(engine, expire_on_commit=request.param)
    with sessions.begin() as session:
        session.add_all([make_app(app_id="app1", tenant_id="tenant"), _conversation(), _message()])

    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Agent Chat accessed a global database")

    monkeypatch.setattr(session_factory, "create_session", forbidden)
    monkeypatch.setattr(session_factory, "get_session_maker", forbidden)
    monkeypatch.setattr(db, "session", forbidden)
    monkeypatch.setattr(type(db), "engine", property(forbidden))
    try:
        yield sessions, AppGenerationRepository(sessions), engine
    finally:
        engine.dispose()


def test_dataset_images_are_owned_ordered_and_materialized_before_storage(
    agent_database: tuple[sessionmaker[Session], AppGenerationRepository, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions, records, engine = agent_database
    ids = [str(uuid4()) for _ in range(5)]
    with sessions.begin() as session:
        session.add_all(
            [
                make_upload_file(
                    file_id=ids[0],
                    tenant_id="tenant",
                    name="first.png",
                    extension="png",
                    mime_type="image/png",
                    key="first",
                ),
                make_upload_file(
                    file_id=ids[1],
                    tenant_id="tenant",
                    name="second.png",
                    extension="png",
                    mime_type="image/png",
                    key="second",
                ),
                make_upload_file(
                    file_id=ids[2], tenant_id="foreign", extension="png", mime_type="image/png", key="foreign"
                ),
                make_upload_file(file_id=ids[3], tenant_id="tenant", mime_type="text/plain"),
            ]
        )
    config = _app_config()
    runner = FunctionCallAgentRunner(
        records=records,
        dataset_tools=lambda **_kwargs: [],
        tool_invoker=create_autospec(AgentToolInvoker, instance=True, spec_set=True),
        tenant_id="tenant",
        application_generate_entity=_app_generate(app_config=config),
        conversation=_conversation(),
        app_config=config,
        model_config=ModelConfigWithCredentialsEntity.model_construct(),
        config=AgentEntity(provider="provider", model="model", strategy=AgentEntity.Strategy.FUNCTION_CALLING),
        queue_manager=create_autospec(AppQueueManager, instance=True, spec_set=True),
        message=_message(),
        user_id="user",
        model_instance=cast(ModelInstance, Model(LLM())),
    )
    reads = []

    class FileRuntime:
        multimodal_send_format = "base64"

        def load_file_bytes(self, *, file: File) -> bytes:
            assert isinstance(engine.pool, QueuePool)
            assert engine.pool.checkedout() == 0
            reads.append(file.filename)
            return b"image bytes"

    monkeypatch.setattr(file_manager, "get_workflow_file_runtime", FileRuntime)

    class Retrieval:
        def retrieve_dataset(
            self,
            *,
            tenant_id: str,
            app_id: str,
            user_id: str,
            dataset_id: str,
            query: str,
            config: DatasetRetrieveConfigEntity,
            top_k: int,
            inputs: dict[str, object],
            invoke_from: InvokeFrom,
            return_resource: bool,
            hit_callback: DatasetIndexToolCallbackHandler,
        ) -> str:
            del tenant_id, app_id, user_id, dataset_id, config, top_k
            del inputs, invoke_from, return_resource, hit_callback
            assert isinstance(engine.pool, QueuePool)
            assert engine.pool.checkedout() == 0
            return query

    tool = DatasetRetrieverTool(
        entity=_tool_entity("dataset"),
        runtime=ToolRuntime(tenant_id="tenant"),
        retrieval=cast(DatasetToolRetrieval, Retrieval()),
        dataset_id="dataset",
        config=DatasetRetrieveConfigEntity(retrieve_strategy="single"),
        top_k=2,
        inputs={},
        invoke_from=InvokeFrom.DEBUGGER,
        return_resource=False,
        hit_callback=create_autospec(DatasetIndexToolCallbackHandler, instance=True, spec_set=True),
        app_id="app1",
    )
    response = "\n".join(f"![image](/files/{id}/file-preview)" for id in [ids[1], ids[0], *ids])
    with sessions() as tool_session:
        text, files, meta = ToolEngine.agent_invoke(
            session=tool_session,
            records=records,
            tool=tool,
            tool_parameters={"query": response},
            user_id="user",
            tenant_id="tenant",
            message=_message(),
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=runner.agent_callback,
        )
    assert files == []
    assert isinstance(meta, ToolInvokeMeta)
    assert meta.error is None
    contents = runner._build_dataset_tool_image_contents(text, tool)
    assert reads == ["second.png", "first.png"]
    assert all(
        isinstance(content, ImagePromptMessageContent) and content.base64_data == "aW1hZ2UgYnl0ZXM="
        for content in contents
    )
    assert isinstance(engine.pool, QueuePool)
    assert engine.pool.checkedout() == 0


def test_worker_passes_records_and_dataset_factory_without_opening_session(
    agent_database: tuple[sessionmaker[Session], AppGenerationRepository, Engine],
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    annotation_replies: AnnotationReplies,
) -> None:
    _, records, engine = agent_database
    calls: list[str] = []
    expected_records = records
    expected_tool_invoker = create_autospec(AgentToolInvoker, instance=True, spec_set=True)

    def datasets(**_kwargs: object) -> list[Tool]:
        return []

    class Runner:
        def __init__(
            self, *, records: AgentMessageRecords, dataset_tools: AgentDatasetTools, tool_invoker: AgentToolInvoker
        ) -> None:
            assert records is expected_records
            assert dataset_tools is datasets
            assert tool_invoker is expected_tool_invoker

        def run(self, application_generate_entity: AgentChatAppGenerateEntity, **kwargs: object) -> None:
            assert "session" not in kwargs
            assert isinstance(engine.pool, QueuePool)
            assert engine.pool.checkedout() == 0
            calls.append(application_generate_entity.task_id)

    monkeypatch.setattr(worker_module, "AgentChatAppRunner", Runner)
    generator = AgentChatAppGenerator(
        dataset_tools=datasets,
        tool_invoker=expected_tool_invoker,
        records=records,
        annotations=annotation_replies,
    )
    entity = AgentChatAppGenerateEntity.model_construct(task_id="task", app_config=_app_config())
    generator._generate_worker(
        app,
        contextvars.copy_context(),
        entity,
        create_autospec(AppQueueManager, instance=True, spec_set=True),
        "conv1",
        "msg_current",
    )
    assert calls == ["task"]
