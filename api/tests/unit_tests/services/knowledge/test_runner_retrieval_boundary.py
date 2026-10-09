"""Chat and Completion release retrieval reads before model and HTTP calls."""

import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, NoReturn, Self, override
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.app_config.entities import DatasetEntity, DatasetRetrieveConfigEntity, ModelConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.chat.app_config_manager import ChatAppConfig
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.entities.app_invoke_entities import (
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.queue_entities import AppQueueEvent
from core.db import session_factory
from core.model_manager import ModelManager
from core.tools.entities.tool_entities import ToolInvokeMessage
from extensions.application_services.retrieval import build_dataset_retrieval
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelFeature
from models.annotation_reply import AnnotationReply
from models.base import TypeBase
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetQuery,
    Document,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message
from repositories.app.generation_repository import AppGenerationRepository
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from services.app.generation.adapters.chat_runner import ChatAppRunner
from services.app.generation.adapters.completion_runner import CompletionAppRunner
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.knowledge.external.service import ExternalDatasetService
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.dataset_retrieval import DatasetRetrieval
from services.tools.dataset.tool import DatasetRetrieverTool
from tests.unit_tests.model_factories import make_dataset


@dataclass
class Queue(AppQueueManager):
    events: list[AppQueueEvent] = field(default_factory=list)

    @override
    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
        self.events.append(event)

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        del pub_from
        self.events.append(event)


class NoAnnotations:
    def query(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply | None:
        del tenant_id, app_id, message_id, query, user_id, from_source
        return None


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, "agent-tool"])
@pytest.mark.parametrize("strategy", ["single", "multiple"])
def test_runner_releases_connections_during_metadata_and_external_retrieval(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode | Literal["agent-tool"],
    strategy: Literal["single", "multiple"],
) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'retrieval.db'}",
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=0,
    )
    pool = engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(engine)  # Production default: expire_on_commit=True.
    tables = [
        TypeBase.metadata.tables[model.__tablename__]
        for model in (
            Dataset,
            Document,
            DatasetMetadata,
            DatasetQuery,
            ExternalKnowledgeApis,
            ExternalKnowledgeBindings,
        )
    ]
    TypeBase.metadata.create_all(
        engine,
        tables=tables,
    )
    tenant_id, dataset_id, user_id, app_id = [str(uuid4()) for _ in range(4)]
    with sessions.begin() as session:
        dataset = make_dataset(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=user_id,
            provider="external",
            indexing_technique="high_quality",
        )
        dataset.retrieval_model = {"top_k": 3}
        api = ExternalKnowledgeApis(
            name="External",
            description="",
            tenant_id=tenant_id,
            created_by=user_id,
            settings=json.dumps({"endpoint": "https://knowledge.example", "api_key": "secret"}),
            updated_by=None,
        )
        session.add_all([dataset, api])
        session.flush()
        session.add_all(
            [
                ExternalKnowledgeBindings(
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    external_knowledge_api_id=api.id,
                    external_knowledge_id="collection",
                    created_by=user_id,
                ),
                DatasetMetadata(
                    tenant_id=tenant_id, dataset_id=dataset_id, name="category", type="string", created_by=user_id
                ),
            ]
        )
    calls: list[str] = []

    def no_global_database(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("retrieval used the global database")

    monkeypatch.setattr(session_factory, "create_session", no_global_database)

    @dataclass
    class Schema:
        features: list[ModelFeature] = field(default_factory=list)

    class Model:
        model_name = "model"
        credentials: dict[str, object] = {}
        provider_model_bundle = object()

        @property
        def model_type_instance(self) -> Self:
            return self

        def get_model_schema(self, **_kwargs: object) -> Schema:
            return Schema()

        def get_model_instance(self, **_kwargs: object) -> Self:
            return self

        def invoke_llm(self, **_kwargs: object) -> Iterator[LLMResultChunk]:
            assert pool.checkedout() == 0
            calls.append("metadata-model")
            yield LLMResultChunk(
                model="model",
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=json.dumps(
                            {
                                "metadata_map": [
                                    {
                                        "metadata_field_name": "category",
                                        "metadata_field_value": "docs",
                                        "comparison_operator": "is",
                                    }
                                ]
                            }
                        )
                    ),
                    usage=LLMUsage.empty_usage(),
                ),
            )

    model = Model()
    model_config = ModelConfigWithCredentialsEntity.model_construct(
        provider="provider",
        model="model",
        mode="chat",
        provider_model_bundle=model.provider_model_bundle,
        credentials={},
        parameters={},
        stop=[],
        model_schema=Schema(),
    )
    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: model)
    monkeypatch.setattr(DatasetRetrieval, "_fetch_model_config", lambda *_args, **_kwargs: (model, model_config))

    def metadata_prompt(_self: DatasetRetrieval, **kwargs: object) -> tuple[list[object], list[object]]:
        assert kwargs["metadata_fields"] == ["category"]  # A real database read happened before model I/O.
        return [], []

    monkeypatch.setattr(DatasetRetrieval, "_get_prompt_template", metadata_prompt)

    class Router:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def invoke(self, *_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
            assert pool.checkedout() == 0
            calls.append("router")
            return dataset_id, LLMUsage.empty_usage()

    monkeypatch.setattr("services.knowledge.retrieval.dataset_retrieval.ReactMultiDatasetRouter", Router)

    def external_request(request: ExternalKnowledgeApiSetting, _files: dict[str, object] | None) -> httpx.Response:
        assert pool.checkedout() == 0
        assert request.url == "https://knowledge.example/retrieval"
        assert request.headers is not None
        assert request.params is not None
        assert request.headers["Authorization"] == "Bearer secret"
        metadata_condition = request.params["metadata_condition"]
        assert isinstance(metadata_condition, Mapping)
        conditions = metadata_condition["conditions"]
        assert isinstance(conditions, list)
        condition = conditions[0]
        assert isinstance(condition, Mapping)
        assert condition["value"] == "docs"
        calls.append("external-knowledge")
        return httpx.Response(
            200, json={"records": [{"content": "retrieved context", "title": "Docs", "score": 0.9, "metadata": {}}]}
        )

    monkeypatch.setattr(ExternalDatasetService, "process_external_api", external_request)
    config_type = ChatAppConfig if mode == AppMode.CHAT else CompletionAppConfig
    config = config_type.model_construct(
        tenant_id=tenant_id,
        app_id=app_id,
        app_mode=mode,
        app_model_config_dict={},
        prompt_template=None,
        dataset=DatasetEntity(
            dataset_ids=[dataset_id],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=strategy,
                top_k=3,
                reranking_enabled=False,
                metadata_filtering_mode="automatic",
                metadata_model_config=ModelConfig(provider="provider", name="model", mode="chat"),
            ),
        ),
    )
    entity_type = ChatAppGenerateEntity if mode == AppMode.CHAT else CompletionAppGenerateEntity
    entity = entity_type.model_construct(
        task_id="task",
        app_config=config,
        model_conf=model_config,
        inputs={},
        files=[],
        user_id=user_id,
        query="question",
        invoke_from=InvokeFrom.DEBUGGER,
        stream=False,
    )
    runner_type = ChatAppRunner if mode == AppMode.CHAT else CompletionAppRunner
    runner = runner_type(records=AppGenerationRepository(sessions), retrieval=build_dataset_retrieval(sessions))
    prompts: list[str | None] = []

    def organize_prompt(**kwargs: object) -> tuple[list[object], list[object]]:
        context = kwargs.get("context")
        assert context is None or isinstance(context, str)
        prompts.append(context)
        return [], []

    monkeypatch.setattr(runner, "organize_prompt_messages", organize_prompt)
    monkeypatch.setattr(runner, "moderation_for_inputs", lambda **_kwargs: (None, {}, "question"))
    # Stop after retrieval and prompt preparation; the assertions cover all retrieval I/O.
    monkeypatch.setattr(runner, "check_hosting_moderation", lambda **_kwargs: True)
    queue = Queue()
    app = App(id=app_id, tenant_id=tenant_id, mode=mode)
    message = Message(id=str(uuid4()))
    try:
        with Flask(__name__).app_context():
            if mode == "agent-tool":
                assert config.dataset is not None
                tools = DatasetRetrieverTool.get_dataset_tools(
                    records=KnowledgeRetrievalRepository(sessions),
                    retrieval=build_dataset_retrieval(sessions),
                    tenant_id=tenant_id,
                    app_id=app_id,
                    dataset_ids=[dataset_id],
                    retrieve_config=config.dataset.retrieve_config,
                    return_resource=True,
                    invoke_from=InvokeFrom.DEBUGGER,
                    hit_callback=DatasetIndexToolCallbackHandler(queue),
                    user_id=user_id,
                    inputs={},
                )
                with sessions() as tool_session:
                    tool_message = list(
                        tools[0].invoke(
                            session=tool_session,
                            user_id=user_id,
                            tool_parameters={"query": "question"},
                        )
                    )[0]
                assert isinstance(tool_message.message, ToolInvokeMessage.TextMessage)
                prompts.append(tool_message.message.text)
            elif mode == AppMode.CHAT:
                assert isinstance(runner, ChatAppRunner)
                assert isinstance(entity, ChatAppGenerateEntity)
                runner.run(entity, queue, Conversation(), message, app, NoAnnotations())
            else:
                assert isinstance(runner, CompletionAppRunner)
                assert isinstance(entity, CompletionAppGenerateEntity)
                runner.run(entity, queue, message, app)
        assert calls == [
            "metadata-model",
            *(["router"] if strategy == "single" and mode != "agent-tool" else []),
            "external-knowledge",
        ]
        assert prompts[-1] == "retrieved context"
        assert len(queue.events) == 1
        with sessions() as session:
            audit = session.scalar(select(DatasetQuery))
            assert audit is not None
            assert audit.dataset_id == dataset_id
            assert audit.source_app_id == app_id
        assert pool.checkedout() == 0
    finally:
        engine.dispose()
