from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.apps.completion.workflow_runner import CompletionWorkflowRunner, ModeratedCompletionInputs
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.moderation.base import ModerationError
from core.workflow.node_runtime import DIFY_BEFORE_LLM_INVOKE_KEY
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.model import AppMode
from models.provider import ProviderType


def _entity() -> SimpleNamespace:
    return SimpleNamespace(
        app_config=SimpleNamespace(app_id="app", tenant_id="tenant", prompt_template=MagicMock()),
        model_conf=SimpleNamespace(model="model"),
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
        task_id="task",
        call_depth=2,
        inputs={"name": "Ada"},
        query="question",
        files=[],
        file_upload_config=None,
        extras={"trace_session_id": "trace"},
        stream=True,
        trace_manager=None,
    )


def test_runner_builds_workflow_entry_and_adapts_events(monkeypatch) -> None:
    from core.app.apps.completion import workflow_runner as module

    app = SimpleNamespace(id="app", tenant_id="tenant", mode=AppMode.COMPLETION)
    entity = _entity()
    message = SimpleNamespace(id="message", conversation_id="conv")
    queue_manager = SimpleNamespace(graph_runtime_state=None)
    runtime_workflow = SimpleNamespace(
        workflow_id="completion-runtime-1",
        root_node_id="start",
        graph_dict={"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []},
    )
    builder = MagicMock(build=MagicMock(return_value=runtime_workflow))
    graph = MagicMock()
    adapter = MagicMock()
    workflow_entry = MagicMock()
    workflow_entry.run.return_value = iter(["event"])

    init_graph = MagicMock(return_value=graph)
    workflow_entry_class = MagicMock(return_value=workflow_entry)
    adapter_class = MagicMock(return_value=adapter)
    build_system_variables = MagicMock(return_value=["sys"])
    build_bootstrap_variables = MagicMock(return_value=["boot"])
    add_variables_to_pool = MagicMock()
    add_node_inputs_to_pool = MagicMock()

    monkeypatch.setattr(module, "init_graph", init_graph)
    monkeypatch.setattr(module, "WorkflowEntry", workflow_entry_class)
    monkeypatch.setattr(module, "CompletionGraphEventAdapter", adapter_class)
    monkeypatch.setattr(module, "RedisChannel", MagicMock())
    monkeypatch.setattr(module, "redis_client", MagicMock())
    monkeypatch.setattr(module, "build_system_variables", build_system_variables)
    monkeypatch.setattr(module, "build_bootstrap_variables", build_bootstrap_variables)
    monkeypatch.setattr(module, "add_variables_to_pool", add_variables_to_pool)
    monkeypatch.setattr(module, "add_node_inputs_to_pool", add_node_inputs_to_pool)

    runner = CompletionWorkflowRunner(runtime_workflow_builder=builder)
    monkeypatch.setattr(runner, "_get_app", MagicMock(return_value=app))
    hosting_hook = MagicMock()
    build_hosting_hook = MagicMock(return_value=hosting_hook)
    monkeypatch.setattr(runner, "_should_check_hosting_moderation", MagicMock(return_value=True))
    monkeypatch.setattr(runner, "_build_hosting_moderation_hook", build_hosting_hook)
    monkeypatch.setattr(
        runner,
        "_run_input_moderation",
        MagicMock(return_value=ModeratedCompletionInputs(stopped=False, inputs={"name": "Grace"}, query="moderated")),
    )

    runner.run(application_generate_entity=entity, queue_manager=queue_manager, message=message)

    builder.build.assert_called_once_with(app_model=app, app_config=entity.app_config)
    add_node_inputs_to_pool.assert_called_once()
    assert add_node_inputs_to_pool.call_args.kwargs["node_id"] == "start"
    assert add_node_inputs_to_pool.call_args.kwargs["inputs"] == {"name": "Grace"}
    build_system_variables.assert_called_once()
    assert build_system_variables.call_args.kwargs["query"] == "moderated"
    assert build_system_variables.call_args.kwargs["conversation_id"] == "conv"
    workflow_entry_class.assert_called_once()
    assert workflow_entry_class.call_args.kwargs["workflow_id"] == "completion-runtime-1"
    assert workflow_entry_class.call_args.kwargs["user_from"] == UserFrom.END_USER
    assert workflow_entry_class.call_args.kwargs["call_depth"] == 2
    build_hosting_hook.assert_called_once_with(
        application_generate_entity=entity,
        queue_manager=queue_manager,
    )
    init_graph.assert_called_once()
    assert init_graph.call_args.kwargs["app_id"] == "app"
    assert init_graph.call_args.kwargs["graph_config"] == runtime_workflow.graph_dict
    assert init_graph.call_args.kwargs["root_node_id"] == "start"
    assert init_graph.call_args.kwargs["call_depth"] == 2
    assert init_graph.call_args.kwargs["extra_context"][DIFY_BEFORE_LLM_INVOKE_KEY] is hosting_hook
    workflow_entry.graph_engine.layer.assert_not_called()
    adapter_class.assert_called_once_with(application_generate_entity=entity, queue_manager=queue_manager)
    adapter.handle_event.assert_called_once_with("event")


def test_runner_returns_when_input_moderation_stops(monkeypatch) -> None:
    app = SimpleNamespace(id="app", tenant_id="tenant", mode=AppMode.COMPLETION)
    entity = _entity()
    builder = MagicMock()
    runner = CompletionWorkflowRunner(runtime_workflow_builder=builder)
    monkeypatch.setattr(runner, "_get_app", MagicMock(return_value=app))
    monkeypatch.setattr(
        runner,
        "_run_input_moderation",
        MagicMock(return_value=ModeratedCompletionInputs(stopped=True, inputs={}, query="")),
    )

    runner.run(
        application_generate_entity=entity,
        queue_manager=MagicMock(),
        message=SimpleNamespace(id="message"),
    )

    builder.build.assert_not_called()


def test_runner_get_app_raises_when_record_is_missing(monkeypatch) -> None:
    from core.app.apps.completion import workflow_runner as module

    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    monkeypatch.setattr(module.db.session, "scalar", MagicMock(return_value=None))

    with pytest.raises(ValueError, match="App not found"):
        runner._get_app("missing-app")


def test_runner_get_app_returns_record(monkeypatch) -> None:
    from core.app.apps.completion import workflow_runner as module

    app = SimpleNamespace(id="app")
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    monkeypatch.setattr(module.db.session, "scalar", MagicMock(return_value=app))

    assert runner._get_app("app") is app


def test_runner_direct_outputs_on_input_moderation() -> None:
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    app_record = SimpleNamespace(id="app", tenant_id="tenant")
    entity = _entity()
    message = SimpleNamespace(id="message")
    queue_manager = MagicMock()
    runner.organize_prompt_messages = MagicMock(return_value=(["prompt"], None))
    runner.moderation_for_inputs = MagicMock(side_effect=ModerationError("blocked"))
    runner.direct_output = MagicMock()

    result = runner._run_input_moderation(
        app_record=app_record,
        application_generate_entity=entity,
        queue_manager=queue_manager,
        message=message,
    )

    assert result.stopped is True
    assert result.inputs == {"name": "Ada"}
    assert result.query == "question"
    runner.direct_output.assert_called_once()


def test_runner_returns_moderated_inputs_when_input_moderation_passes() -> None:
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    app_record = SimpleNamespace(id="app", tenant_id="tenant")
    entity = _entity()
    message = SimpleNamespace(id="message")
    runner.organize_prompt_messages = MagicMock(return_value=(["prompt"], None))
    runner.moderation_for_inputs = MagicMock(return_value=(None, {"name": "Grace"}, "moderated query"))

    result = runner._run_input_moderation(
        app_record=app_record,
        application_generate_entity=entity,
        queue_manager=MagicMock(),
        message=message,
    )

    assert result == ModeratedCompletionInputs(stopped=False, inputs={"name": "Grace"}, query="moderated query")


def test_runner_hosting_moderation_hook_uses_final_prompt() -> None:
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    entity = _entity()
    queue_manager = MagicMock()
    runner.check_hosting_moderation = MagicMock(return_value=True)

    hook = runner._build_hosting_moderation_hook(
        application_generate_entity=entity,
        queue_manager=queue_manager,
    )

    with pytest.raises(GenerateTaskStoppedError):
        hook(["final prompt"])

    runner.check_hosting_moderation.assert_called_once_with(
        application_generate_entity=entity,
        queue_manager=queue_manager,
        prompt_messages=["final prompt"],
    )


def test_runner_should_not_check_hosting_moderation_when_config_is_disabled(monkeypatch) -> None:
    from core.app.apps.completion import workflow_runner as module

    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    monkeypatch.setattr(
        module,
        "hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=False),
            provider_map={},
        ),
    )

    assert runner._should_check_hosting_moderation(_entity()) is False


def test_runner_should_check_hosting_moderation_for_system_provider(monkeypatch) -> None:
    from core.app.apps.completion import workflow_runner as module

    entity = _entity()
    entity.model_conf = SimpleNamespace(
        provider="openai",
        provider_model_bundle=SimpleNamespace(
            configuration=SimpleNamespace(using_provider_type=ProviderType.SYSTEM),
        ),
    )
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    monkeypatch.setattr(
        module,
        "hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers=["openai"]),
            provider_map={
                f"{module.DEFAULT_PLUGIN_ID}/openai/openai": SimpleNamespace(
                    enabled=True,
                    credentials={"api_key": "secret"},
                )
            },
        ),
    )

    assert runner._should_check_hosting_moderation(entity) is True


def test_runner_resolves_account_user_from() -> None:
    entity = _entity()
    entity.invoke_from = InvokeFrom.EXPLORE

    assert CompletionWorkflowRunner._resolve_user_from(entity) == UserFrom.ACCOUNT


def test_runner_resolves_configured_image_detail() -> None:
    entity = _entity()
    entity.file_upload_config = SimpleNamespace(
        image_config=SimpleNamespace(detail=ImagePromptMessageContent.DETAIL.HIGH),
    )

    assert CompletionWorkflowRunner._resolve_image_detail_config(entity) == ImagePromptMessageContent.DETAIL.HIGH
