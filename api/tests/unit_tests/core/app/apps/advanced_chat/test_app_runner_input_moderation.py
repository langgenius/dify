from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

import core.app.apps.advanced_chat.app_runner as module
from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueStopEvent
from core.moderation.base import ModerationError

MINIMAL_GRAPH = {
    "nodes": [
        {
            "id": "start",
            "data": {
                "type": "start",
                "title": "Start",
            },
        }
    ],
    "edges": [],
}


@pytest.fixture
def build_runner():
    """Construct a minimal AdvancedChatAppRunner with heavy dependencies mocked."""
    app_id = str(uuid4())
    workflow_id = str(uuid4())

    # Mocks for constructor args
    mock_queue_manager = MagicMock()

    mock_conversation = MagicMock()
    mock_conversation.id = str(uuid4())
    mock_conversation.app_id = app_id

    mock_message = MagicMock()
    mock_message.id = str(uuid4())

    mock_workflow = MagicMock()
    mock_workflow.id = workflow_id
    mock_workflow.tenant_id = str(uuid4())
    mock_workflow.app_id = app_id
    mock_workflow.type = "chat"
    mock_workflow.graph_dict = MINIMAL_GRAPH
    mock_workflow.environment_variables = []

    mock_app_config = MagicMock()
    mock_app_config.app_id = app_id
    mock_app_config.workflow_id = workflow_id
    mock_app_config.tenant_id = str(uuid4())

    gen = MagicMock(spec=AdvancedChatAppGenerateEntity)
    gen.app_config = mock_app_config
    gen.inputs = {"q": "raw"}
    gen.query = "raw-query"
    gen.files = []
    gen.user_id = str(uuid4())
    gen.invoke_from = InvokeFrom.SERVICE_API
    gen.workflow_run_id = str(uuid4())
    gen.task_id = str(uuid4())
    gen.call_depth = 0
    gen.single_iteration_run = None
    gen.single_loop_run = None
    gen.extras = {}
    gen.trace_manager = None

    runner = AdvancedChatAppRunner(
        application_generate_entity=gen,
        queue_manager=mock_queue_manager,
        conversation=mock_conversation,
        message=mock_message,
        dialogue_count=1,
        variable_loader=MagicMock(),
        workflow=mock_workflow,
        system_user_id=str(uuid4()),
        app=MagicMock(),
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    return runner


def _patch_common_run_deps(runner: AdvancedChatAppRunner):
    """Context manager that patches common heavy deps used by run()."""
    # create_session() returns a context manager whose body yields a session that
    # supports both scalar() (app record lookup) and begin()/scalars().all()
    # (conversation variable initialization).
    mock_session = MagicMock()
    mock_session.scalar.return_value = MagicMock()
    mock_session.scalars.return_value.all.return_value = []

    session_context = MagicMock()
    session_context.__enter__.return_value = mock_session
    session_context.__exit__.return_value = False
    mock_session.begin.return_value.__enter__.return_value = mock_session
    mock_session.begin.return_value.__exit__.return_value = False

    return patch.multiple(
        "core.app.apps.advanced_chat.app_runner",
        create_session=MagicMock(return_value=session_context),
        select=MagicMock(),
        session_factory=MagicMock(get_session_maker=MagicMock(return_value=MagicMock())),
        RedisChannel=MagicMock(),
        redis_client=MagicMock(),
        WorkflowEntry=MagicMock(**{"return_value.run.return_value": iter([])}),
        GraphRuntimeState=MagicMock(),
    )


def test_handle_input_moderation_stops_on_moderation_error(build_runner):
    runner = build_runner

    # moderation_for_inputs raises ModerationError -> should stop and emit stop event
    with (
        patch.object(runner, "moderation_for_inputs", side_effect=ModerationError("blocked")),
        patch.object(runner, "_complete_with_stream_output") as mock_complete,
    ):
        stop, new_inputs, new_query = runner.handle_input_moderation(
            app_record=MagicMock(),
            app_generate_entity=runner.application_generate_entity,
            inputs={"k": "v"},
            query="hello",
            message_id="mid",
        )

        assert stop is True
        # inputs/query should be unchanged on error path
        assert new_inputs == {"k": "v"}
        assert new_query == "hello"
        # ensure stopped_by reason is INPUT_MODERATION
        assert mock_complete.called
        args, kwargs = mock_complete.call_args
        assert kwargs.get("stopped_by") == QueueStopEvent.StopBy.INPUT_MODERATION


def test_run_applies_overridden_inputs_and_query_from_moderation(build_runner):
    runner = build_runner

    overridden_inputs = {"q": "sanitized"}
    overridden_query = "sanitized-query"

    with (
        _patch_common_run_deps(runner),
        patch.object(
            runner,
            "moderation_for_inputs",
            return_value=(True, overridden_inputs, overridden_query),
        ) as mock_moderate,
        patch.object(runner, "handle_annotation_reply", return_value=False) as mock_anno,
        patch.object(runner, "_init_graph", return_value=MagicMock()) as mock_init_graph,
    ):
        runner.run()

        # moderation called with original values
        mock_moderate.assert_called_once()

        # application_generate_entity should be updated to overridden values
        assert runner.application_generate_entity.inputs == overridden_inputs
        assert runner.application_generate_entity.query == overridden_query

        # annotation reply should use the new query
        mock_anno.assert_called()
        assert mock_anno.call_args.kwargs.get("query") == overridden_query

        # since not stopped, graph initialization should proceed
        assert mock_init_graph.called


def test_run_returns_early_when_direct_output_via_handle_input_moderation(build_runner):
    runner = build_runner

    with (
        _patch_common_run_deps(runner),
        # Simulate handle_input_moderation signalling to stop
        patch.object(
            runner,
            "handle_input_moderation",
            return_value=(True, runner.application_generate_entity.inputs, runner.application_generate_entity.query),
        ) as mock_handle,
        patch.object(runner, "_init_graph") as mock_init_graph,
        patch.object(runner, "handle_annotation_reply") as mock_anno,
    ):
        runner.run()

        mock_handle.assert_called_once()
        # Ensure no further steps executed
        mock_anno.assert_not_called()
        mock_init_graph.assert_not_called()


def test_run_closes_scoped_session_before_workflow_run(build_runner):
    runner = build_runner
    events = []

    mock_session = MagicMock()
    mock_session.scalar.return_value = MagicMock()
    session_context = MagicMock()
    session_context.__enter__.return_value = mock_session
    session_context.__exit__.return_value = False

    workflow_entry = MagicMock()

    def run_workflow():
        events.append("run")
        return iter([])

    workflow_entry.run.side_effect = run_workflow

    with (
        patch.object(module, "create_session", return_value=session_context),
        patch.object(module, "session_factory", MagicMock(get_session_maker=MagicMock(return_value=MagicMock()))),
        patch.object(module, "RedisChannel"),
        patch.object(module, "redis_client"),
        patch.object(module, "WorkflowEntry", return_value=workflow_entry),
        patch.object(module.db.session, "close", side_effect=lambda: events.append("close")),
        patch.object(
            runner,
            "handle_input_moderation",
            return_value=(False, runner.application_generate_entity.inputs, runner.application_generate_entity.query),
        ),
        patch.object(runner, "handle_annotation_reply", return_value=False),
        patch.object(runner, "_initialize_conversation_variables", return_value=[]),
        patch.object(runner, "_init_graph", return_value=MagicMock()),
    ):
        runner.run()

    assert events == ["close", "run"]
