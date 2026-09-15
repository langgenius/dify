"""Auxiliary operations capture their actual model/tool/retrieval results."""

from collections.abc import Generator
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import override
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, EasyUIBasedAppGenerateEntity, InvokeFrom
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelInstance, ModelManager
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.tools.tool_engine import ToolEngine
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset
from models.model import AppMode, Conversation, Message, MessageFile
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue


@pytest.fixture
def capture() -> tuple[MessageTraceRecorder, RecordingQueue]:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), actor_id=str(uuid4()), operation_id=str(uuid4()))
    queue = RecordingQueue()
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="recording", config_id=str(uuid4())
    )
    return MessageTraceRecorder(source, queue, (settings,)), queue


@pytest.mark.parametrize(
    "instructions", ["m" * 100_000 + "MODEL_END", ["item"] * 300], ids=["supported", "collection-limit"]
)
def test_message_pipeline_owns_model_parameters_before_runtime_mutation(
    capture: tuple[MessageTraceRecorder, RecordingQueue], instructions: str | list[str]
) -> None:
    recorder, queue = capture
    message_id, conversation_id = str(uuid4()), str(uuid4())
    recorder.bind_message(message_id, conversation_id)
    entity = Mock(spec=ChatAppGenerateEntity)
    entity.trace_recorder = recorder
    entity.app_config = SimpleNamespace(sensitive_word_avoidance=None)
    entity.model_conf = SimpleNamespace(model="chat-model", parameters={"instructions": instructions})
    entity.invoke_from = InvokeFrom.SERVICE_API
    EasyUIBasedGenerateTaskPipeline(
        application_generate_entity=entity,
        queue_manager=Mock(spec=AppQueueManager),
        conversation=Conversation(id=conversation_id, mode=AppMode.CHAT),
        message=Message(id=message_id, created_at=datetime.now(UTC)),
        stream=True,
    )
    entity.model_conf.parameters["instructions"] = "changed after capture"
    recorder.finish_message_trace(
        {
            "message_id": message_id,
            "conversation_id": conversation_id,
            "model_name": "chat-model",
            "outputs": "done",
        },
        include_llm=True,
    )
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert trace.complete == isinstance(instructions, str)
    assert len(trace.spans) == 2
    for span in trace.spans:
        parameters = span.attributes["model_parameters"]
        assert isinstance(parameters, dict)
        if trace.complete:
            assert parameters["instructions"] == instructions
        else:
            assert parameters["instructions"] != instructions
        assert parameters["instructions"] != "changed after capture"


@pytest.mark.parametrize("fails", [False, True])
def test_suggestions_capture_the_actual_prompt_model_usage_and_error(
    capture: tuple[MessageTraceRecorder, RecordingQueue], monkeypatch: pytest.MonkeyPatch, fails: bool
) -> None:
    recorder, queue = capture
    model = Mock(spec=ModelInstance)
    model.provider = "suggestion-provider"
    model.model_name = "suggestion-model"
    response = LLMResult(
        model=model.model_name,
        message=AssistantPromptMessage(content='["What happened next?"]'),
        usage=LLMUsage.empty_usage().model_copy(
            update={"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10, "total_price": Decimal("0.002")}
        ),
    )
    model.invoke_llm.side_effect = RuntimeError("provider unavailable") if fails else None
    model.invoke_llm.return_value = response
    manager = Mock(spec=ModelManager)
    manager.get_model_instance.return_value = model
    for_tenant = Mock(return_value=manager)
    monkeypatch.setattr(ModelManager, "for_tenant", for_tenant)

    questions = LLMGenerator.generate_suggested_questions_after_answer(
        recorder.source.tenant_id,
        "User: Tell me a story.\nAssistant: Once upon a time.",
        instruction_prompt="Ask one relevant follow-up question.",
        model_config={
            "provider": model.provider,
            "name": model.model_name,
            "completion_params": {"max_tokens": 64, "temperature": 0.2, "stop": ["STOP"]},
        },
        trace_recorder=recorder,
    )

    for_tenant.assert_called_once_with(tenant_id=recorder.source.tenant_id)
    manager.get_model_instance.assert_called_once_with(
        tenant_id=recorder.source.tenant_id, model_type=ModelType.LLM, provider=model.provider, model=model.model_name
    )
    assert len(queue.items) == 1
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    span = trace.spans[0]
    actual_prompt = model.invoke_llm.call_args.kwargs["prompt_messages"][0].content
    assert "Once upon a time." in actual_prompt
    assert "Ask one relevant follow-up question." in actual_prompt
    assert isinstance(span.inputs, list)
    assert isinstance(span.inputs[0], dict)
    assert span.inputs[0]["content"] == actual_prompt
    assert span.attributes["model_name"] == model.model_name
    assert span.attributes["model_provider"] == model.provider
    assert span.attributes["model_parameters"] == {"max_tokens": 64, "temperature": 0.2}
    assert span.attributes["operation_type"] == "suggested_question"
    assert trace.source.tenant_id == recorder.source.tenant_id
    assert trace.source.actor_id == recorder.source.actor_id
    assert span.started_at is not None
    assert span.ended_at is not None
    assert span.ended_at >= span.started_at
    if fails:
        assert questions == []
        assert span.outputs == []
        assert span.status == "error"
        assert span.error == "RuntimeError"
        assert span.usage == {}
    else:
        assert questions == ["What happened next?"]
        assert span.outputs == ["What happened next?"]
        assert span.status == "ok"
        assert span.usage["total_tokens"] == 10
        assert span.usage["total_price"] == "0.002"


class DocumentTool(Tool):
    received_parameters: dict[str, object]
    failure: bool = False

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, object],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        self.received_parameters = deepcopy(tool_parameters)
        tool_parameters["query"] = "changed after capture"
        if self.failure:
            raise RuntimeError("tool unavailable")
        yield ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK,
            message=ToolInvokeMessage.TextMessage(text="https://files.example/report.pdf?signature=private"),
            meta={"mime_type": "application/pdf"},
        )


@pytest.mark.parametrize("sqlite_session", [(MessageFile,)], indirect=True)
@pytest.mark.parametrize("fails", [False, True])
@pytest.mark.parametrize("query", ["documents", "q" * 100_000 + "INPUT_END"])
def test_tool_captures_effective_arguments_and_file_urls(
    capture: tuple[MessageTraceRecorder, RecordingQueue],
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    fails: bool,
    query: str,
) -> None:
    recorder, queue = capture
    assert recorder.source.actor_id is not None
    tool = DocumentTool(
        entity=ToolEntity(
            identity=ToolIdentity(
                author="author", name="documents", label=I18nObject(en_US="Documents"), provider="documents-provider"
            ),
            parameters=[
                ToolParameter.get_simple_instance(
                    name="limit", llm_description="Limit", typ=ToolParameter.ToolParameterType.NUMBER, required=False
                )
            ],
        ),
        runtime=ToolRuntime(
            tenant_id=recorder.source.tenant_id,
            invoke_from=InvokeFrom.DEBUGGER,
            runtime_parameters={"limit": "7", "api_key": "runtime-secret"},
        ),
    )
    tool.failure = fails
    message = Message(
        id=str(uuid4()),
        app_id=recorder.source.app_id,
        conversation_id=str(uuid4()),
        from_account_id=recorder.source.actor_id,
        app_mode=AppMode.CHAT,
    )
    recorder.bind_message(message.id, message.conversation_id)
    monkeypatch.setattr("core.tools.tool_engine.db", SimpleNamespace(engine=sqlite_engine))
    output, file_ids, _ = ToolEngine.agent_invoke(
        sqlite_session,
        tool,
        {"limit": "2", "query": query},
        recorder.source.actor_id,
        recorder.source.tenant_id,
        message,
        InvokeFrom.DEBUGGER,
        DifyAgentCallbackHandler(),
        trace_recorder=recorder,
        app_id=message.app_id,
        conversation_id=message.conversation_id,
        message_id=message.id,
    )
    recorder.finish_message_trace(
        {"message_id": message.id, "conversation_id": message.conversation_id, "inputs": [], "outputs": "answer"}
    )

    assert tool.received_parameters["limit"] == 7
    assert tool.received_parameters["api_key"] == "runtime-secret"
    assert len(queue.items) == 1
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    span = next(span for span in trace.spans if span.span_type == "tool")
    assert span.inputs == {"limit": 7, "query": query}
    assert span.attributes["tool_parameters"] == span.inputs
    assert span.attributes["original_inputs"] == {"limit": "2", "query": query}
    assert trace.complete
    assert queue.reserved == 0
    assert "runtime-secret" not in queue.items[0].trace_json.decode()
    assert "signature=private" not in queue.items[0].trace_json.decode()
    assert span.status == ("error" if fails else "ok")
    assert trace.source.actor_id == message.from_account_id
    assert trace.source.message_id == message.id
    if fails:
        assert file_ids == []
        assert "tool unavailable" in output
    else:
        assert span.attributes["files"] == [
            {"mimetype": "application/pdf", "url": "https://files.example/report.pdf", "file_var": None}
        ]
        assert span.attributes["message_file_ids"] == file_ids
        assert len(file_ids) == 1
        saved_file = sqlite_session.get(MessageFile, file_ids[0])
        assert saved_file is not None
        assert saved_file.message_id == message.id
        assert saved_file.created_by == recorder.source.actor_id


def test_empty_multi_retrieval_preserves_each_dataset_model(
    capture: tuple[MessageTraceRecorder, RecordingQueue], monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder, queue = capture
    assert recorder.source.app_id is not None
    assert recorder.source.actor_id is not None
    entity = Mock(spec=EasyUIBasedAppGenerateEntity)
    entity.app_config = Mock(app_id=recorder.source.app_id, app_mode=AppMode.CHAT)
    entity.trace_recorder = recorder
    retrieval = DatasetRetrieval(entity)
    datasets = [
        Dataset(
            id=str(uuid4()),
            tenant_id=recorder.source.tenant_id,
            name=f"Dataset {index}",
            indexing_technique="high_quality",
            embedding_model=f"embedding-{index}",
            embedding_model_provider=f"provider-{index}",
        )
        for index in range(2)
    ]
    worker = Mock()
    monkeypatch.setattr(retrieval, "_multiple_retrieve_thread", worker)
    monkeypatch.setattr(retrieval, "_on_query", Mock())
    with Flask(__name__).app_context():
        result = retrieval.multiple_retrieve(
            app_id=recorder.source.app_id,
            tenant_id=recorder.source.tenant_id,
            user_id=recorder.source.actor_id,
            user_from="account",
            available_datasets=datasets,
            query="rewritten query",
            top_k=5,
            score_threshold=0.0,
            reranking_enable=True,
            reranking_mode="reranking_model",
            reranking_model={"reranking_provider_name": "reranker", "reranking_model_name": "rerank-model"},
        )

    assert result == []
    worker.assert_called_once()
    assert worker.call_args.kwargs["tenant_id"] == recorder.source.tenant_id
    assert len(queue.items) == 1
    span = CompletedTrace.model_validate_json(queue.items[0].trace_json).spans[0]
    assert span.inputs == "rewritten query"
    assert span.outputs == {"documents": []}
    assert span.attributes["dataset_models"] == {
        dataset.id: {
            "dataset_name": dataset.name,
            "embedding_model": dataset.embedding_model,
            "embedding_model_provider": dataset.embedding_model_provider,
        }
        for dataset in datasets
    }
    assert "embedding_model" not in span.attributes
    assert "rerank_model_name" not in span.attributes
