# Completion WorkflowEntry Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Completion's direct LLM runner with a runtime-only workflow graph executed by `WorkflowEntry`, while keeping the existing Completion API, SSE, blocking response, and Message persistence behavior.

**Architecture:** Add a graph builder and runner under `core.app.apps.completion`. The new runner builds an in-memory graph, calls `WorkflowEntry.run()`, and converts GraphOn events into legacy message queue events consumed by `EasyUIBasedGenerateTaskPipeline`. Existing Message persistence stays in the task pipeline; no workflow persistence layer is attached.

**Tech Stack:** Python 3.12, Flask app context, SQLAlchemy models, GraphOn `WorkflowEntry` / `GraphEngine`, Pydantic queue entities, pytest, pytest-mock.

---

## File Structure

- Modify: `api/services/workflow/workflow_converter.py`
  - Extract a side-effect-free graph construction method that returns graph config without creating `Workflow`.
- Create: `api/core/app/apps/completion/runtime_workflow_builder.py`
  - Build a runtime-only Completion graph using the converter extraction.
- Create: `api/core/app/apps/completion/graph_event_adapter.py`
  - Convert GraphOn events into legacy Completion queue events.
- Create: `api/core/app/apps/completion/workflow_runner.py`
  - New Completion runner that calls `WorkflowEntry`.
- Modify: `api/core/app/apps/completion/app_generator.py`
  - Replace `CompletionAppRunner` with `CompletionWorkflowRunner`.
- Modify: `api/core/app/entities/queue_entities.py`
  - Add optional saved prompt payload to `QueueMessageEndEvent`.
- Modify: `api/core/app/entities/task_entities.py`
  - Add optional saved prompt override to `EasyUITaskState`.
- Modify: `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`
  - Persist saved prompt override when GraphOn provides already-serialized prompts.
- Modify: `api/services/app_task_service.py`
  - Send GraphEngine stop command for graph-backed Completion tasks.
- Delete: `api/core/app/apps/completion/app_runner.py`
  - Remove the old direct Completion runner after generator wiring and tests are updated.
- Modify tests under:
  - `api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py`
  - `api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py`
  - `api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py`
  - `api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py`
  - `api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py`
  - `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`
  - `api/tests/unit_tests/services/test_app_task_service.py`

---

### Task 1: Extract Side-Effect-Free Workflow Graph Construction

**Files:**
- Modify: `api/services/workflow/workflow_converter.py`
- Test: `api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py`

- [ ] **Step 1: Write failing tests for graph-only conversion**

Append these tests to `api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py`:

```python
def test_build_graph_from_app_config_for_completion_does_not_create_workflow(
    converter: WorkflowConverter,
    mocker: MockerFixture,
) -> None:
    app_model = MagicMock()
    app_model.id = "app"
    app_model.tenant_id = "tenant"
    app_model.mode = AppMode.COMPLETION
    app_config = mocker.MagicMock()
    app_config.variables = []
    app_config.external_data_variables = []
    app_config.dataset = None
    app_config.model = _build_model_config(mode=LLMMode.CHAT)
    app_config.prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="Hello",
    )
    app_config.additional_features = None
    app_config.app_model_config_dict = {
        "text_to_speech": {"enabled": False},
        "file_upload": {"enabled": False},
        "sensitive_word_avoidance": {"enabled": False},
    }

    session_add = mocker.patch.object(db.session, "add")
    session_commit = mocker.patch.object(db.session, "commit")

    result = converter.build_graph_from_app_config(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
    )

    assert [node["id"] for node in result.graph["nodes"]] == ["start", "llm", "end"]
    assert result.features == {
        "text_to_speech": {"enabled": False},
        "file_upload": {"enabled": False},
        "sensitive_word_avoidance": {"enabled": False},
    }
    session_add.assert_not_called()
    session_commit.assert_not_called()


def test_build_graph_from_app_config_preserves_api_based_variable_nodes(
    converter: WorkflowConverter,
    mocker: MockerFixture,
) -> None:
    app_model = MagicMock()
    app_model.id = "app"
    app_model.tenant_id = "tenant"
    app_model.mode = AppMode.COMPLETION
    app_config = mocker.MagicMock()
    app_config.variables = [VariableEntity(variable="city", label="City", type=VariableEntityType.TEXT_INPUT)]
    app_config.external_data_variables = [
        ExternalDataVariableEntity(
            variable="weather",
            type="api",
            config={"api_based_extension_id": "api_based_extension_id"},
        )
    ]
    app_config.dataset = None
    app_config.model = _build_model_config(mode=LLMMode.CHAT)
    app_config.prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="Weather: {{weather}}",
    )
    app_config.additional_features = None
    app_config.app_model_config_dict = {}

    mocker.patch.object(
        converter,
        "_get_api_based_extension",
        return_value=mocker.MagicMock(
            name="Weather API",
            api_endpoint="https://example.com/weather",
            api_key="encrypted-token",
        ),
    )
    mocker.patch("services.workflow.workflow_converter.encrypter.decrypt_token", return_value="plain-token")

    result = converter.build_graph_from_app_config(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
    )

    assert [node["data"]["type"] for node in result.graph["nodes"]] == [
        BuiltinNodeTypes.START,
        BuiltinNodeTypes.HTTP_REQUEST,
        BuiltinNodeTypes.CODE,
        BuiltinNodeTypes.LLM,
        BuiltinNodeTypes.END,
    ]
    llm_node = next(node for node in result.graph["nodes"] if node["id"] == "llm")
    assert "{{#code_1.result#}}" in llm_node["data"]["prompt_template"]["text"]
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py::test_build_graph_from_app_config_for_completion_does_not_create_workflow \
  api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py::test_build_graph_from_app_config_preserves_api_based_variable_nodes -q
```

Expected: both tests fail because `WorkflowConverter.build_graph_from_app_config` does not exist.

- [ ] **Step 3: Add graph result type and extraction method**

Modify `api/services/workflow/workflow_converter.py`:

```python
from dataclasses import dataclass
```

Add near `WorkflowGraph`:

```python
@dataclass(frozen=True, slots=True)
class WorkflowGraphBuildResult:
    graph: WorkflowGraph
    features: dict[str, Any]
```

Add this method to `WorkflowConverter`:

```python
    def build_graph_from_app_config(
        self,
        *,
        app_model: App,
        app_config: EasyUIBasedAppConfig,
        target_app_mode: AppMode,
    ) -> WorkflowGraphBuildResult:
        graph: WorkflowGraph = {"nodes": [], "edges": []}
        start_node = self._convert_to_start_node(variables=app_config.variables)
        graph["nodes"].append(start_node)

        external_data_variable_node_mapping: dict[str, str] = {}
        if app_config.external_data_variables:
            http_request_nodes, external_data_variable_node_mapping = self._convert_to_http_request_node(
                app_model=app_model,
                variables=app_config.variables,
                external_data_variables=app_config.external_data_variables,
            )
            for http_request_node in http_request_nodes:
                graph = self._append_node(graph, http_request_node)

        if app_config.dataset:
            knowledge_retrieval_node = self._convert_to_knowledge_retrieval_node(
                new_app_mode=target_app_mode,
                dataset_config=app_config.dataset,
                model_config=app_config.model,
            )
            if knowledge_retrieval_node:
                graph = self._append_node(graph, knowledge_retrieval_node)

        llm_node = self._convert_to_llm_node(
            original_app_mode=AppMode.value_of(app_model.mode),
            new_app_mode=target_app_mode,
            graph=graph,
            model_config=app_config.model,
            prompt_template=app_config.prompt_template,
            file_upload=app_config.additional_features.file_upload if app_config.additional_features else None,
            external_data_variable_node_mapping=external_data_variable_node_mapping,
        )
        graph = self._append_node(graph, llm_node)

        app_model_config_dict = app_config.app_model_config_dict
        if target_app_mode == AppMode.WORKFLOW:
            graph = self._append_node(graph, self._convert_to_end_node())
            features = {
                "text_to_speech": app_model_config_dict.get("text_to_speech"),
                "file_upload": app_model_config_dict.get("file_upload"),
                "sensitive_word_avoidance": app_model_config_dict.get("sensitive_word_avoidance"),
            }
        else:
            graph = self._append_node(graph, self._convert_to_answer_node())
            features = {
                "opening_statement": app_model_config_dict.get("opening_statement"),
                "suggested_questions": app_model_config_dict.get("suggested_questions"),
                "suggested_questions_after_answer": app_model_config_dict.get("suggested_questions_after_answer"),
                "speech_to_text": app_model_config_dict.get("speech_to_text"),
                "text_to_speech": app_model_config_dict.get("text_to_speech"),
                "file_upload": app_model_config_dict.get("file_upload"),
                "sensitive_word_avoidance": app_model_config_dict.get("sensitive_word_avoidance"),
                "retriever_resource": app_model_config_dict.get("retriever_resource"),
            }

        return WorkflowGraphBuildResult(graph=graph, features=features)
```

- [ ] **Step 4: Rewrite persisted conversion to use extraction**

In `convert_app_model_config_to_workflow`, replace the graph-building block with:

```python
        build_result = self.build_graph_from_app_config(
            app_model=app_model,
            app_config=app_config,
            target_app_mode=new_app_mode,
        )
        graph = build_result.graph
        features = build_result.features
```

Keep the existing `Workflow(...)`, `db.session.add(workflow)`, and `db.session.commit()` code unchanged after that.

- [ ] **Step 5: Run converter tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/services/workflow/workflow_converter.py api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py
git commit -m "refactor(workflow): extract graph-only app conversion"
```

---

### Task 2: Add Saved Prompt Compatibility for GraphOn LLM Results

**Files:**
- Modify: `api/core/app/entities/queue_entities.py`
- Modify: `api/core/app/entities/task_entities.py`
- Modify: `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`
- Test: `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`

- [ ] **Step 1: Write failing test for saved prompt override**

Append to `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`:

```python
def test_message_end_uses_saved_prompt_override_when_present(mocker: MockerFixture) -> None:
    pipeline, _ = _make_pipeline(
        entity_cls=CompletionAppGenerateEntity,
        app_mode=AppMode.COMPLETION,
        stream=True,
    )
    saved_prompt = [{"role": "user", "text": "serialized by graphon"}]
    llm_result = LLMResult(
        model="model",
        prompt_messages=[],
        message=AssistantPromptMessage(content="answer"),
        usage=LLMUsage.empty_usage(),
    )
    pipeline._task_state.llm_result = llm_result
    pipeline._task_state.saved_prompt = saved_prompt
    prompt_saver = mocker.patch(
        "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.PromptMessageUtil.prompt_messages_to_prompt_for_saving",
        return_value=[{"role": "user", "text": "computed"}],
    )
    session = Mock()
    message_obj = _make_message()
    conversation_obj = _make_conversation(AppMode.COMPLETION)
    session.scalar.side_effect = [message_obj, conversation_obj]

    pipeline._save_message(session=session)

    assert message_obj.message == saved_prompt
    prompt_saver.assert_not_called()
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py::test_message_end_uses_saved_prompt_override_when_present -q
```

Expected: FAIL because `QueueMessageEndEvent` has no `saved_prompt`.

- [ ] **Step 3: Add queue field and task state field**

Modify `QueueMessageEndEvent` in `api/core/app/entities/queue_entities.py`:

```python
class QueueMessageEndEvent(AppQueueEvent):
    event: QueueEvent = QueueEvent.MESSAGE_END
    llm_result: LLMResult | None = None
    saved_prompt: Sequence[Mapping[str, Any]] | None = None
```

Modify `EasyUITaskState` in `api/core/app/entities/task_entities.py`:

```python
class EasyUITaskState(TaskState):
    llm_result: LLMResult
    saved_prompt: Sequence[Mapping[str, Any]] | None = None
```

- [ ] **Step 4: Store override from end event**

In `EasyUIBasedGenerateTaskPipeline._process_stream_response`, update the `QueueMessageEndEvent` branch:

```python
                    if isinstance(event, QueueMessageEndEvent):
                        if event.llm_result:
                            self._task_state.llm_result = event.llm_result
                        if event.saved_prompt is not None:
                            self._task_state.saved_prompt = event.saved_prompt
```

- [ ] **Step 5: Use override in `_save_message`**

Replace the `saved_prompt = ...` assignment in `_save_message` with:

```python
        saved_prompt = self._task_state.saved_prompt
        if saved_prompt is None:
            saved_prompt = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                self._model_config.mode, self._task_state.llm_result.prompt_messages
            )
```

- [ ] **Step 6: Run task pipeline tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  api/core/app/entities/queue_entities.py \
  api/core/app/entities/task_entities.py \
  api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py
git commit -m "feat(completion): allow saved prompt on message end"
```

---

### Task 3: Add Runtime Completion Workflow Builder

**Files:**
- Create: `api/core/app/apps/completion/runtime_workflow_builder.py`
- Test: `api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py`

- [ ] **Step 1: Write failing builder tests**

Create `api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py`:

```python
from unittest.mock import MagicMock

from core.app.apps.completion.runtime_workflow_builder import RuntimeCompletionWorkflowBuilder
from models.model import App, AppMode


def test_builder_returns_runtime_graph_without_workflow_record(mocker):
    app_model = MagicMock(spec=App)
    app_model.mode = AppMode.COMPLETION
    app_config = MagicMock()
    build_result = MagicMock(graph={"nodes": [{"id": "start"}], "edges": []})
    converter = mocker.patch(
        "core.app.apps.completion.runtime_workflow_builder.WorkflowConverter",
        return_value=MagicMock(build_graph_from_app_config=MagicMock(return_value=build_result)),
    )

    result = RuntimeCompletionWorkflowBuilder().build(app_model=app_model, app_config=app_config)

    assert result.workflow_id.startswith("completion-runtime-")
    assert result.root_node_id == "start"
    assert result.graph_dict == {"nodes": [{"id": "start"}], "edges": []}
    converter.return_value.build_graph_from_app_config.assert_called_once_with(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
    )
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py -q
```

Expected: FAIL because the builder module does not exist.

- [ ] **Step 3: Implement builder**

Create `api/core/app/apps/completion/runtime_workflow_builder.py`:

```python
from dataclasses import dataclass
from uuid import uuid4

from core.app.apps.completion.app_config_manager import CompletionAppConfig
from models.model import App, AppMode
from services.workflow.workflow_converter import WorkflowConverter


@dataclass(frozen=True, slots=True)
class RuntimeCompletionWorkflow:
    workflow_id: str
    root_node_id: str
    graph_dict: dict


class RuntimeCompletionWorkflowBuilder:
    def __init__(self, workflow_converter: WorkflowConverter | None = None) -> None:
        self._workflow_converter = workflow_converter or WorkflowConverter()

    def build(self, *, app_model: App, app_config: CompletionAppConfig) -> RuntimeCompletionWorkflow:
        build_result = self._workflow_converter.build_graph_from_app_config(
            app_model=app_model,
            app_config=app_config,
            target_app_mode=AppMode.WORKFLOW,
        )
        return RuntimeCompletionWorkflow(
            workflow_id=f"completion-runtime-{uuid4()}",
            root_node_id="start",
            graph_dict=dict(build_result.graph),
        )
```

- [ ] **Step 4: Run builder test**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  api/core/app/apps/completion/runtime_workflow_builder.py \
  api/tests/unit_tests/core/app/apps/completion/test_completion_runtime_workflow_builder.py
git commit -m "feat(completion): add runtime workflow builder"
```

---

### Task 4: Add GraphOn Event to Completion Queue Adapter

**Files:**
- Create: `api/core/app/apps/completion/graph_event_adapter.py`
- Test: `api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py`

- [ ] **Step 1: Write failing adapter tests**

Create `api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py`:

```python
from unittest.mock import MagicMock

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.completion.graph_event_adapter import CompletionGraphEventAdapter
from core.app.entities.queue_entities import QueueErrorEvent, QueueLLMChunkEvent, QueueMessageEndEvent, QueueStopEvent
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_events import GraphRunAbortedEvent, GraphRunFailedEvent, GraphRunSucceededEvent, NodeRunStreamChunkEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult


def _adapter():
    queue_manager = MagicMock()
    entity = MagicMock()
    entity.model_conf.model = "model"
    return CompletionGraphEventAdapter(application_generate_entity=entity, queue_manager=queue_manager), queue_manager


def test_stream_chunk_event_publishes_llm_chunk():
    adapter, queue_manager = _adapter()

    adapter.handle_event(
        NodeRunStreamChunkEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            selector=["llm", "text"],
            chunk="hello",
        )
    )

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueLLMChunkEvent)
    assert event.chunk.delta.message.content == "hello"
    assert queue_manager.publish.call_args.args[1] == PublishFrom.APPLICATION_MANAGER


def test_llm_success_then_graph_success_publishes_message_end_with_saved_prompt():
    adapter, queue_manager = _adapter()
    usage = LLMUsage.empty_usage()
    adapter.handle_event(
        NodeRunSucceededEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            start_at=MagicMock(),
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": "final"},
                process_data={"prompts": [{"role": "user", "text": "saved prompt"}]},
                llm_usage=usage,
            ),
        )
    )

    adapter.handle_event(GraphRunSucceededEvent(outputs={"result": "final"}))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueMessageEndEvent)
    assert event.llm_result.message.content == "final"
    assert event.llm_result.usage is usage
    assert event.saved_prompt == [{"role": "user", "text": "saved prompt"}]


def test_failed_graph_publishes_error():
    adapter, queue_manager = _adapter()

    adapter.handle_event(GraphRunFailedEvent(error="boom"))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueErrorEvent)
    assert str(event.error) == "boom"


def test_user_abort_publishes_legacy_stop():
    adapter, queue_manager = _adapter()

    adapter.handle_event(GraphRunAbortedEvent(reason="Stopped by user."))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueStopEvent)
    assert event.stopped_by == QueueStopEvent.StopBy.USER_MANUAL
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py -q
```

Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement adapter**

Create `api/core/app/apps/completion/graph_event_adapter.py`:

```python
from collections.abc import Mapping, Sequence
from typing import Any

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
)
from core.rag.entities import RetrievalSourceMetadata
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage


class CompletionGraphEventAdapter:
    def __init__(
        self,
        *,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._answer = ""
        self._usage = LLMUsage.empty_usage()
        self._saved_prompt: Sequence[Mapping[str, Any]] | None = None

    def handle_event(self, event: GraphEngineEvent) -> None:
        match event:
            case NodeRunStreamChunkEvent():
                self._handle_stream_chunk(event)
            case NodeRunRetrieverResourceEvent():
                self._queue_manager.publish(
                    QueueRetrieverResourcesEvent(
                        retriever_resources=[
                            RetrievalSourceMetadata.model_validate(resource)
                            for resource in event.retriever_resources
                        ],
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    ),
                    PublishFrom.APPLICATION_MANAGER,
                )
            case NodeRunSucceededEvent():
                self._handle_node_succeeded(event)
            case NodeRunFailedEvent() | NodeRunExceptionEvent():
                self._queue_manager.publish(
                    QueueErrorEvent(error=ValueError(event.error or event.node_run_result.error or "Node failed")),
                    PublishFrom.APPLICATION_MANAGER,
                )
            case GraphRunSucceededEvent():
                self._publish_message_end()
            case GraphRunFailedEvent():
                self._queue_manager.publish(QueueErrorEvent(error=ValueError(event.error)), PublishFrom.APPLICATION_MANAGER)
            case GraphRunAbortedEvent():
                if event.reason and "user" in event.reason.lower():
                    self._queue_manager.publish(
                        QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL),
                        PublishFrom.APPLICATION_MANAGER,
                    )
                else:
                    self._queue_manager.publish(
                        QueueErrorEvent(error=ValueError(event.reason or "Graph execution aborted")),
                        PublishFrom.APPLICATION_MANAGER,
                    )

    def _handle_stream_chunk(self, event: NodeRunStreamChunkEvent) -> None:
        if event.selector and list(event.selector)[:2] != ["llm", "text"]:
            return
        self._answer += event.chunk
        self._queue_manager.publish(
            QueueLLMChunkEvent(
                chunk=LLMResultChunk(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=[],
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=event.chunk),
                    ),
                )
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _handle_node_succeeded(self, event: NodeRunSucceededEvent) -> None:
        if event.node_type != BuiltinNodeTypes.LLM and event.node_id != "llm":
            return
        result = event.node_run_result
        text = result.outputs.get("text")
        if isinstance(text, str):
            self._answer = text
        self._usage = result.llm_usage
        prompts = result.process_data.get("prompts")
        if isinstance(prompts, list):
            self._saved_prompt = prompts

    def _publish_message_end(self) -> None:
        self._queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=[],
                    message=AssistantPromptMessage(content=self._answer),
                    usage=self._usage,
                ),
                saved_prompt=self._saved_prompt,
            ),
            PublishFrom.APPLICATION_MANAGER,
        )
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  api/core/app/apps/completion/graph_event_adapter.py \
  api/tests/unit_tests/core/app/apps/completion/test_graph_event_adapter.py
git commit -m "feat(completion): adapt graph events to legacy queue"
```

---

### Task 5: Add Completion Workflow Runner

**Files:**
- Create: `api/core/app/apps/completion/workflow_runner.py`
- Test: `api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py`

- [ ] **Step 1: Write failing runner test**

Create `api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py`:

```python
from unittest.mock import MagicMock

from core.app.apps.completion.workflow_runner import CompletionWorkflowRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom


def test_runner_builds_workflow_entry_and_adapts_events(mocker):
    app = MagicMock(id="app", tenant_id="tenant")
    app_config = MagicMock(app_id="app", tenant_id="tenant")
    entity = MagicMock()
    entity.app_config = app_config
    entity.user_id = "user"
    entity.invoke_from = InvokeFrom.SERVICE_API
    entity.task_id = "task"
    entity.call_depth = 0
    entity.inputs = {"name": "Ada"}
    entity.files = []
    entity.extras = {"trace_session_id": "trace"}

    message = MagicMock(id="message")
    queue_manager = MagicMock()
    runtime_workflow = MagicMock(
        workflow_id="completion-runtime-1",
        root_node_id="start",
        graph_dict={"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []},
    )
    builder = MagicMock(build=MagicMock(return_value=runtime_workflow))
    graph = MagicMock()
    adapter = MagicMock()
    adapter_class = mocker.patch(
        "core.app.apps.completion.workflow_runner.CompletionGraphEventAdapter",
        return_value=adapter,
    )
    workflow_entry = MagicMock()
    workflow_entry.run.return_value = iter(["event"])
    workflow_entry_class = mocker.patch(
        "core.app.apps.completion.workflow_runner.WorkflowEntry",
        return_value=workflow_entry,
    )
    mocker.patch("core.app.apps.completion.workflow_runner.Graph.init", return_value=graph)
    mocker.patch("core.app.apps.completion.workflow_runner.RedisChannel")
    mocker.patch("core.app.apps.completion.workflow_runner.redis_client")
    mocker.patch("core.app.apps.completion.workflow_runner.build_system_variables", return_value={})
    mocker.patch("core.app.apps.completion.workflow_runner.build_bootstrap_variables", return_value=[])
    mocker.patch("core.app.apps.completion.workflow_runner.add_variables_to_pool")
    mocker.patch("core.app.apps.completion.workflow_runner.add_node_inputs_to_pool")
    mocker.patch("core.app.apps.completion.workflow_runner.DifyNodeFactory.from_graph_init_context")
    runner = CompletionWorkflowRunner(runtime_workflow_builder=builder)
    mocker.patch.object(runner, "_get_app", return_value=app)
    mocker.patch.object(runner, "_run_input_moderation", return_value=False)

    runner.run(application_generate_entity=entity, queue_manager=queue_manager, message=message)

    builder.build.assert_called_once_with(app_model=app, app_config=app_config)
    workflow_entry_class.assert_called_once()
    assert workflow_entry_class.call_args.kwargs["workflow_id"] == "completion-runtime-1"
    assert workflow_entry_class.call_args.kwargs["user_from"] == UserFrom.END_USER
    adapter_class.assert_called_once_with(application_generate_entity=entity, queue_manager=queue_manager)
    adapter.handle_event.assert_called_once_with("event")
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py -q
```

Expected: FAIL because `workflow_runner.py` does not exist.

- [ ] **Step 3: Implement runner**

Create `api/core/app/apps/completion/workflow_runner.py`:

```python
import time
from typing import cast

from sqlalchemy import select

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.graph_event_adapter import CompletionGraphEventAdapter
from core.app.apps.completion.runtime_workflow_builder import RuntimeCompletionWorkflowBuilder
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyGraphInitContext, DifyNodeFactory
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.graph import Graph
from graphon.graph_engine.command_channels import RedisChannel
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from graphon.runtime import GraphRuntimeState, VariablePool
from models.model import App, Message


class CompletionWorkflowRunner(AppRunner):
    def __init__(self, runtime_workflow_builder: RuntimeCompletionWorkflowBuilder | None = None) -> None:
        self._runtime_workflow_builder = runtime_workflow_builder or RuntimeCompletionWorkflowBuilder()

    def run(
        self,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
        message: Message,
    ) -> None:
        app_config = cast(CompletionAppConfig, application_generate_entity.app_config)
        app_record = self._get_app(app_config.app_id)

        if self._run_input_moderation(
            app_record=app_record,
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            message=message,
        ):
            return

        runtime_workflow = self._runtime_workflow_builder.build(app_model=app_record, app_config=app_config)
        variable_pool = VariablePool()
        system_inputs = build_system_variables(
            files=application_generate_entity.files,
            user_id=application_generate_entity.user_id,
            app_id=app_config.app_id,
            timestamp=int(time.time()),
            workflow_id=runtime_workflow.workflow_id,
            workflow_execution_id=application_generate_entity.task_id,
        )
        add_variables_to_pool(variable_pool, build_bootstrap_variables(system_variables=system_inputs, environment_variables=[]))
        add_node_inputs_to_pool(variable_pool, node_id=runtime_workflow.root_node_id, inputs=application_generate_entity.inputs)

        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
        user_from = UserFrom.ACCOUNT if application_generate_entity.invoke_from.runs_as_account() else UserFrom.END_USER
        run_context = build_dify_run_context(
            tenant_id=app_config.tenant_id,
            app_id=app_config.app_id,
            user_id=application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=application_generate_entity.invoke_from,
            trace_session_id=application_generate_entity.extras.get("trace_session_id"),
        )
        graph_init_context = DifyGraphInitContext(
            workflow_id=runtime_workflow.workflow_id,
            graph_config=runtime_workflow.graph_dict,
            run_context=run_context,
            call_depth=0,
        )
        node_factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=graph_init_context,
            graph_runtime_state=graph_runtime_state,
        )
        graph = Graph.init(
            graph_config=runtime_workflow.graph_dict,
            node_factory=node_factory,
            root_node_id=runtime_workflow.root_node_id,
        )

        queue_manager.graph_runtime_state = graph_runtime_state
        channel_key = f"workflow:{application_generate_entity.task_id}:commands"
        command_channel = RedisChannel(redis_client, channel_key)
        workflow_entry = WorkflowEntry(
            tenant_id=app_config.tenant_id,
            app_id=app_config.app_id,
            workflow_id=runtime_workflow.workflow_id,
            graph_config=runtime_workflow.graph_dict,
            graph=graph,
            user_id=application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=application_generate_entity.invoke_from,
            call_depth=0,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
        )
        adapter = CompletionGraphEventAdapter(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
        )
        for event in workflow_entry.run():
            adapter.handle_event(event)

    def _get_app(self, app_id: str) -> App:
        app_record = db.session.scalar(select(App).where(App.id == app_id))
        if not app_record:
            raise ValueError("App not found")
        return app_record

    def _run_input_moderation(
        self,
        *,
        app_record: App,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
        message: Message,
    ) -> bool:
        app_config = cast(CompletionAppConfig, application_generate_entity.app_config)
        image_detail_config = (
            application_generate_entity.file_upload_config.image_config.detail
            if application_generate_entity.file_upload_config and application_generate_entity.file_upload_config.image_config
            else ImagePromptMessageContent.DETAIL.LOW
        )
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=application_generate_entity.model_conf,
            prompt_template_entity=app_config.prompt_template,
            inputs=application_generate_entity.inputs,
            files=application_generate_entity.files,
            query=application_generate_entity.query,
            image_detail_config=image_detail_config,
        )
        try:
            self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_config.tenant_id,
                app_generate_entity=application_generate_entity,
                inputs=application_generate_entity.inputs,
                query=application_generate_entity.query or "",
                message_id=message.id,
            )
        except Exception as exc:
            self.direct_output(
                queue_manager=queue_manager,
                app_generate_entity=application_generate_entity,
                prompt_messages=prompt_messages,
                text=str(exc),
                stream=application_generate_entity.stream,
            )
            return True
        return False
```

- [ ] **Step 4: Run runner tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  api/core/app/apps/completion/workflow_runner.py \
  api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py
git commit -m "feat(completion): run completion through workflow entry"
```

---

### Task 6: Wire Generator and Stop Service

**Files:**
- Modify: `api/core/app/apps/completion/app_generator.py`
- Modify: `api/services/app_task_service.py`
- Test: `api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py`
- Test: `api/tests/unit_tests/services/test_app_task_service.py`

- [ ] **Step 1: Update generator test to expect new runner**

In `api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py`, update the worker test patch:

```python
runner_instance = MagicMock()
runner_instance.run.side_effect = error
mocker.patch.object(module, "CompletionWorkflowRunner", return_value=runner_instance)
```

Replace assertions that refer to `CompletionAppRunner` with `CompletionWorkflowRunner`.

- [ ] **Step 2: Add stop service test**

Append to `api/tests/unit_tests/services/test_app_task_service.py`:

```python
def test_stop_task_sends_graph_command_for_completion(mocker):
    stop_flag = mocker.patch("services.app_task_service.AppQueueManager.set_stop_flag")
    manager = mocker.patch("services.app_task_service.GraphEngineManager").return_value

    AppTaskService.stop_task(
        task_id="task",
        invoke_from=InvokeFrom.WEB_APP,
        user_id="user",
        app_mode=AppMode.COMPLETION,
    )

    stop_flag.assert_called_once_with("task", InvokeFrom.WEB_APP, "user")
    manager.send_stop_command.assert_called_once_with("task")
```

- [ ] **Step 3: Run tests and confirm failures**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py::TestCompletionAppGenerator::test_generate_worker_error_handling \
  api/tests/unit_tests/services/test_app_task_service.py::test_stop_task_sends_graph_command_for_completion -q
```

Expected: generator test fails until import/wiring changes; stop service test fails until `AppMode.COMPLETION` is included.

- [ ] **Step 4: Wire generator**

Modify `api/core/app/apps/completion/app_generator.py`:

```python
from core.app.apps.completion.workflow_runner import CompletionWorkflowRunner
```

Remove:

```python
from core.app.apps.completion.app_runner import CompletionAppRunner
```

Replace worker runner creation:

```python
runner = CompletionWorkflowRunner()
runner.run(
    application_generate_entity=application_generate_entity,
    queue_manager=queue_manager,
    message=message,
)
```

- [ ] **Step 5: Wire stop service**

Modify `api/services/app_task_service.py`:

```python
if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.COMPLETION):
    GraphEngineManager(redis_client).send_stop_command(task_id)
```

- [ ] **Step 6: Run wiring tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py \
  api/tests/unit_tests/services/test_app_task_service.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  api/core/app/apps/completion/app_generator.py \
  api/services/app_task_service.py \
  api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py \
  api/tests/unit_tests/services/test_app_task_service.py
git commit -m "feat(completion): wire workflow entry runner"
```

---

### Task 7: Remove Old Completion Runner and Update Runner Tests

**Files:**
- Delete: `api/core/app/apps/completion/app_runner.py`
- Modify: `api/tests/unit_tests/core/app/apps/completion/test_app_runner.py`

- [ ] **Step 1: Replace old runner tests with compatibility tests**

Replace `api/tests/unit_tests/core/app/apps/completion/test_app_runner.py` content with:

```python
from unittest.mock import MagicMock

from core.app.apps.completion.workflow_runner import CompletionWorkflowRunner
from core.moderation.base import ModerationError


def test_workflow_runner_direct_outputs_on_input_moderation(mocker):
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    app_record = MagicMock(id="app", tenant_id="tenant")
    app_config = MagicMock(app_id="app", tenant_id="tenant")
    entity = MagicMock(app_config=app_config, inputs={}, query="query", files=[], stream=True)
    message = MagicMock(id="message")
    queue_manager = MagicMock()
    runner.organize_prompt_messages = MagicMock(return_value=(["prompt"], None))
    runner.moderation_for_inputs = MagicMock(side_effect=ModerationError("blocked"))
    runner.direct_output = MagicMock()

    stopped = runner._run_input_moderation(
        app_record=app_record,
        application_generate_entity=entity,
        queue_manager=queue_manager,
        message=message,
    )

    assert stopped is True
    runner.direct_output.assert_called_once()
```

- [ ] **Step 2: Run test and confirm it passes before delete**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/completion/test_app_runner.py -q
```

Expected: PASS.

- [ ] **Step 3: Delete old runner**

Run:

```bash
rm api/core/app/apps/completion/app_runner.py
```

- [ ] **Step 4: Verify no imports remain**

Run:

```bash
rg "completion\\.app_runner|CompletionAppRunner" api
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A api/core/app/apps/completion api/tests/unit_tests/core/app/apps/completion/test_app_runner.py
git commit -m "refactor(completion): remove legacy completion runner"
```

---

### Task 8: Add Persistence and Response Compatibility Tests

**Files:**
- Test: `api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py`
- Test: `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`

- [ ] **Step 1: Add no-workflow-persistence runner test**

Append to `api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py`:

```python
def test_runner_does_not_attach_workflow_persistence_layer(mocker):
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    entity = MagicMock()
    entity.app_config.app_id = "app"
    entity.app_config.tenant_id = "tenant"
    entity.user_id = "user"
    entity.invoke_from = InvokeFrom.SERVICE_API
    entity.task_id = "task"
    entity.inputs = {}
    entity.files = []
    entity.extras = {}
    queue_manager = MagicMock()
    message = MagicMock(id="message")
    mocker.patch.object(runner, "_get_app", return_value=MagicMock(id="app", tenant_id="tenant"))
    mocker.patch.object(runner, "_run_input_moderation", return_value=False)
    mocker.patch("core.app.apps.completion.workflow_runner.Graph.init", return_value=MagicMock())
    mocker.patch("core.app.apps.completion.workflow_runner.RedisChannel")
    mocker.patch("core.app.apps.completion.workflow_runner.redis_client")
    mocker.patch("core.app.apps.completion.workflow_runner.build_system_variables", return_value={})
    mocker.patch("core.app.apps.completion.workflow_runner.build_bootstrap_variables", return_value=[])
    mocker.patch("core.app.apps.completion.workflow_runner.add_variables_to_pool")
    mocker.patch("core.app.apps.completion.workflow_runner.add_node_inputs_to_pool")
    mocker.patch("core.app.apps.completion.workflow_runner.DifyNodeFactory.from_graph_init_context")
    workflow_entry = mocker.patch("core.app.apps.completion.workflow_runner.WorkflowEntry").return_value
    workflow_entry.run.return_value = iter([])

    runner.run(application_generate_entity=entity, queue_manager=queue_manager, message=message)

    layer_calls = workflow_entry.graph_engine.layer.call_args_list
    assert all("WorkflowPersistenceLayer" not in repr(call.args[0]) for call in layer_calls)
```

- [ ] **Step 2: Add message persistence compatibility test**

Append to `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`:

```python
def test_graph_backed_message_end_persists_answer_usage_and_metadata(mocker: MockerFixture) -> None:
    pipeline, _ = _make_pipeline(
        entity_cls=CompletionAppGenerateEntity,
        app_mode=AppMode.COMPLETION,
        stream=True,
    )
    usage = LLMUsage.empty_usage()
    usage.prompt_tokens = 3
    usage.completion_tokens = 4
    llm_result = LLMResult(
        model="model",
        prompt_messages=[],
        message=AssistantPromptMessage(content="final answer"),
        usage=usage,
    )
    pipeline._task_state.llm_result = llm_result
    pipeline._task_state.saved_prompt = [{"role": "user", "text": "prompt"}]
    session = Mock()
    message_obj = _make_message()
    conversation_obj = _make_conversation(AppMode.COMPLETION)
    session.scalar.side_effect = [message_obj, conversation_obj]

    pipeline._save_message(session=session)

    assert message_obj.message == [{"role": "user", "text": "prompt"}]
    assert message_obj.answer == "final answer"
    assert message_obj.message_tokens == 3
    assert message_obj.answer_tokens == 4
    assert message_obj.message_metadata
```

- [ ] **Step 3: Run compatibility tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add \
  api/tests/unit_tests/core/app/apps/completion/test_workflow_runner.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py
git commit -m "test(completion): cover graph backed message compatibility"
```

---

### Task 9: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused Completion tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/completion \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline.py \
  api/tests/unit_tests/services/workflow/test_workflow_converter_additional.py \
  api/tests/unit_tests/services/test_app_task_service.py -q
```

Expected: PASS.

- [ ] **Step 2: Run type and lint checks for touched backend files**

Run:

```bash
uv run --project api ruff check \
  api/core/app/apps/completion \
  api/core/app/entities/queue_entities.py \
  api/core/app/entities/task_entities.py \
  api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py \
  api/services/workflow/workflow_converter.py \
  api/services/app_task_service.py
```

Expected: PASS.

- [ ] **Step 3: Confirm old runner is gone and workflow persistence is not referenced**

Run:

```bash
rg "CompletionAppRunner|WorkflowPersistenceLayer" api/core/app/apps/completion api/core/app/apps/completion.py api/core/app/apps/completion 2>/dev/null
```

Expected: no `CompletionAppRunner`; no `WorkflowPersistenceLayer` under Completion app code.

- [ ] **Step 4: Commit final cleanup if needed**

If Step 2 or Step 3 required formatting or import cleanup, commit only those edits:

```bash
git add -A api/core/app/apps/completion api/core/app/entities api/core/app/task_pipeline api/services api/tests
git commit -m "chore(completion): clean up workflow entry migration"
```

Expected: commit is created only when there are cleanup changes.

---

## Self-Review

- Spec coverage:
  - Runtime-only graph: Task 1 and Task 3.
  - Direct `WorkflowEntry` usage: Task 5.
  - Legacy queue event adapter: Task 4.
  - Existing Message persistence retained: Task 2 and Task 8.
  - No workflow persistence: Task 5 and Task 8.
  - Stop behavior: Task 6.
  - Old runner removal: Task 7.
- Placeholder scan:
  - The plan avoids open-ended implementation markers and provides concrete files, commands, and expected outcomes.
- Type consistency:
  - `QueueMessageEndEvent.saved_prompt` flows into `EasyUITaskState.saved_prompt`.
  - `RuntimeCompletionWorkflowBuilder.build()` returns `RuntimeCompletionWorkflow`.
  - `CompletionWorkflowRunner` consumes `RuntimeCompletionWorkflow` and `CompletionGraphEventAdapter`.
