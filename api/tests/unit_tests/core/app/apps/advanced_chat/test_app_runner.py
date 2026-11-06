import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import services.workflow.execution.adapters.chatflow.app_runner as module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueStopEvent
from core.moderation.base import ModerationError
from factories import variable_factory
from graphon.variables import SegmentType
from models import App as _app_runner_conversation_variables_App
from models import Conversation as _app_runner_conversation_variables_Conversation
from models import ConversationVariable
from models import Message as _app_runner_conversation_variables_Message
from models.annotation_reply import AnnotationReply
from models.enums import ConversationFromSource
from models.model import App as _app_runner_input_moderation_App
from models.model import AppMode, IconType
from models.model import Conversation as _app_runner_input_moderation_Conversation
from models.model import Message as _app_runner_input_moderation_Message
from models.workflow import Workflow, WorkflowType
from repositories.workflow.definition_repository import workflow_snapshot
from services.workflow.execution.adapters.chatflow.app_runner import AdvancedChatAppRunner
from services.workflow.execution.ports import WorkflowRuntime

"""SQLite-backed conversation-variable synchronization tests for AdvancedChatAppRunner."""


APP_ID = "11111111-1111-1111-1111-111111111111"
CONVERSATION_ID = "22222222-2222-2222-2222-222222222222"
OTHER_CONVERSATION_ID = "22222222-2222-2222-2222-222222222223"
VAR_1_ID = "33333333-3333-3333-3333-333333333333"
VAR_2_ID = "33333333-3333-3333-3333-333333333334"


def _variable(variable_id: str, name: str, value: str):
    return variable_factory.build_conversation_variable_from_mapping(
        {
            "id": variable_id,
            "name": name,
            "value_type": SegmentType.STRING,
            "value": value,
        }
    )


def _runner(workflow_variables: list[object], workflow_runtime: WorkflowRuntime) -> AdvancedChatAppRunner:
    workflow = Workflow(
        id="55555555-5555-5555-5555-555555555555",
        tenant_id="66666666-6666-6666-6666-666666666666",
        app_id=APP_ID,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        _features="{}",
        created_by="44444444-4444-4444-4444-444444444444",
    )
    workflow.conversation_variables = workflow_variables
    conversation = _app_runner_conversation_variables_Conversation(id=CONVERSATION_ID, app_id=APP_ID)
    return AdvancedChatAppRunner(
        application_generate_entity=MagicMock(),
        queue_manager=MagicMock(),
        conversation=conversation,
        message=_app_runner_conversation_variables_Message(id="77777777-7777-7777-7777-777777777777"),
        dialogue_count=1,
        variable_loader=MagicMock(),
        workflow=workflow_snapshot(workflow),
        system_user_id="44444444-4444-4444-4444-444444444444",
        app=_app_runner_conversation_variables_App(id=APP_ID, tenant_id=workflow.tenant_id),
        runtime=workflow_runtime,
    )


def _persist_variable(session: Session, *, variable: object, conversation_id: str = CONVERSATION_ID) -> None:
    session.add(
        ConversationVariable.from_variable(
            app_id=APP_ID,
            conversation_id=conversation_id,
            variable=variable,
        )
    )
    session.commit()


def _persist_conversation(session: Session, conversation_id: str = CONVERSATION_ID) -> None:
    session.add(
        _app_runner_conversation_variables_Conversation(
            id=conversation_id,
            app_id=APP_ID,
            mode=AppMode.ADVANCED_CHAT,
            name="Conversation",
            _inputs={},
            from_source=ConversationFromSource.API,
        )
    )
    session.commit()


class TestAppRunnerConversationVariablesCases:
    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
    def test_missing_conversation_variables_are_added(
        sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
    ) -> None:
        existing_variable = _variable(VAR_1_ID, "existing_var", "default1")
        new_variable = _variable(VAR_2_ID, "new_var", "default2")
        _persist_conversation(sqlite_session)
        _persist_conversation(sqlite_session, OTHER_CONVERSATION_ID)
        _persist_variable(sqlite_session, variable=existing_variable)
        _persist_variable(sqlite_session, variable=new_variable, conversation_id=OTHER_CONVERSATION_ID)

        variables = _runner([existing_variable, new_variable], workflow_runtime)._initialize_conversation_variables()

        assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
        persisted = sqlite_session.scalars(
            select(ConversationVariable)
            .where(ConversationVariable.conversation_id == CONVERSATION_ID)
            .order_by(ConversationVariable.id)
        ).all()
        assert [variable.id for variable in persisted] == [VAR_1_ID, VAR_2_ID]

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
    def test_no_variables_creates_all(sqlite_session: Session, *, workflow_runtime: WorkflowRuntime) -> None:
        workflow_variables = [
            _variable(VAR_1_ID, "var1", "default1"),
            _variable(VAR_2_ID, "var2", "default2"),
        ]
        _persist_conversation(sqlite_session)

        variables = _runner(workflow_variables, workflow_runtime)._initialize_conversation_variables()

        assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
        persisted = sqlite_session.scalars(select(ConversationVariable).order_by(ConversationVariable.id)).all()
        assert [variable.id for variable in persisted] == [VAR_1_ID, VAR_2_ID]

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
    def test_all_variables_exist_no_changes(sqlite_session: Session, *, workflow_runtime: WorkflowRuntime) -> None:
        workflow_variables = [
            _variable(VAR_1_ID, "var1", "default1"),
            _variable(VAR_2_ID, "var2", "default2"),
        ]
        _persist_conversation(sqlite_session)
        for variable in workflow_variables:
            _persist_variable(sqlite_session, variable=variable)

        variables = _runner(workflow_variables, workflow_runtime)._initialize_conversation_variables()

        assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
        persisted = sqlite_session.scalars(select(ConversationVariable)).all()
        assert len(persisted) == 2

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
    def test_non_uuid_conversation_variable_is_created_once(
        sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
    ) -> None:
        author_id = "opt-comp-prompt-var"
        variable = _variable(author_id, "optimization_comparison_prompt", "-")
        _persist_conversation(sqlite_session)
        runner = _runner([variable], workflow_runtime)

        first = runner._initialize_conversation_variables()
        second = runner._initialize_conversation_variables()

        expected_row_id = ConversationVariable.storage_id(variable)
        assert variable.id == author_id
        assert [item.id for item in first] == [author_id]
        assert [item.id for item in second] == [author_id]
        persisted = sqlite_session.scalars(select(ConversationVariable)).all()
        assert [row.id for row in persisted] == [expected_row_id]
        assert persisted[0].to_variable().id == author_id


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


def _patch_common_run_deps(runner: AdvancedChatAppRunner):
    """Context manager that patches common heavy deps used by run()."""
    return patch.multiple(
        "services.workflow.execution.adapters.chatflow.app_runner",
        RedisChannel=MagicMock(),
        redis_client=MagicMock(),
        WorkflowEntry=MagicMock(**{"return_value.run.return_value": iter([])}),
        RuntimeState=MagicMock(),
    )


class TestAppRunnerInputModerationCases:
    @staticmethod
    @pytest.fixture
    def build_runner(sqlite_session: Session, *, workflow_runtime: WorkflowRuntime):
        """Construct a minimal AdvancedChatAppRunner with heavy dependencies mocked."""
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        tenant_id = str(uuid4())

        # Mocks for constructor args
        mock_queue_manager = MagicMock()

        conversation = _app_runner_input_moderation_Conversation(
            id=str(uuid4()),
            app_id=app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Test",
            _inputs={},
            from_source=ConversationFromSource.API,
        )
        message = _app_runner_input_moderation_Message(id=str(uuid4()), app_id=app_id, conversation_id=conversation.id)
        workflow = Workflow(
            id=workflow_id,
            tenant_id=tenant_id,
            app_id=app_id,
            type=WorkflowType.CHAT,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(MINIMAL_GRAPH),
            _features="{}",
            created_by=str(uuid4()),
        )

        app_config = WorkflowUIBasedAppConfig(
            app_id=app_id, workflow_id=workflow_id, tenant_id=tenant_id, app_mode=AppMode.ADVANCED_CHAT
        )

        app = _app_runner_input_moderation_App(
            id=app_id,
            tenant_id=tenant_id,
            name="Advanced chat app",
            mode=AppMode.ADVANCED_CHAT,
            icon_type=IconType.EMOJI,
            icon="chat",
            icon_background="#ffffff",
            enable_site=False,
            enable_api=False,
        )
        sqlite_session.add_all([app, conversation])
        sqlite_session.commit()

        gen = AdvancedChatAppGenerateEntity(
            app_config=app_config,
            inputs={"q": "raw"},
            query="raw-query",
            files=[],
            user_id=str(uuid4()),
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_run_id=str(uuid4()),
            task_id=str(uuid4()),
            stream=True,
        )

        runner = AdvancedChatAppRunner(
            application_generate_entity=gen,
            queue_manager=mock_queue_manager,
            conversation=conversation,
            message=message,
            dialogue_count=1,
            variable_loader=MagicMock(),
            workflow=workflow_snapshot(workflow),
            system_user_id=str(uuid4()),
            app=app,
            runtime=workflow_runtime,
        )

        return runner

    @staticmethod
    def test_handle_input_moderation_stops_on_moderation_error(build_runner):
        runner = build_runner

        # moderation_for_inputs raises ModerationError -> should stop and emit stop event
        with (
            patch.object(runner, "moderation_for_inputs", side_effect=ModerationError("blocked")),
            patch.object(runner, "_complete_with_stream_output") as mock_complete,
        ):
            stop, new_inputs, new_query = runner.handle_input_moderation(
                app_record=runner._app,
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

    @staticmethod
    def test_run_applies_overridden_inputs_and_query_from_moderation(build_runner):
        runner = build_runner
        runner.application_generate_entity.call_depth = 5

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
            patch.object(runner._graphs, "build", return_value=MagicMock()) as mock_init_graph,
        ):
            runner.prepare()

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
            assert mock_init_graph.call_args.kwargs["call_depth"] == 5

    @staticmethod
    def test_run_returns_early_when_direct_output_via_handle_input_moderation(build_runner):
        runner = build_runner

        with (
            _patch_common_run_deps(runner),
            # Simulate handle_input_moderation signalling to stop
            patch.object(
                runner,
                "handle_input_moderation",
                return_value=(
                    True,
                    runner.application_generate_entity.inputs,
                    runner.application_generate_entity.query,
                ),
            ) as mock_handle,
            patch.object(runner._graphs, "build") as mock_init_graph,
            patch.object(runner, "handle_annotation_reply") as mock_anno,
        ):
            runner.prepare()

            mock_handle.assert_called_once()
            # Ensure no further steps executed
            mock_anno.assert_not_called()
            mock_init_graph.assert_not_called()

    @staticmethod
    def test_run_publishes_annotation_after_commit(build_runner):
        runner = build_runner
        events: list[str] = []

        def query_annotation(**_kwargs):
            events.append("commit")
            return AnnotationReply(id="annotation-id", content="annotated answer")

        def publish(event):
            if isinstance(event, QueueAnnotationReplyEvent):
                events.append("publish")

        with (
            patch.object(runner, "moderation_for_inputs", return_value=(False, {}, "raw-query")),
            patch.object(runner._runtime.annotation_replies, "query", side_effect=query_annotation),
            patch.object(runner._events, "_publish_event", side_effect=publish),
            patch.object(runner, "_complete_with_stream_output"),
        ):
            assert runner.prepare() is None

        assert events == ["commit", "publish"]

    @staticmethod
    def test_run_closes_scoped_session_before_workflow_run(build_runner):
        runner = build_runner
        events = []

        workflow_entry = MagicMock()

        def initialize_conversation_variables():
            events.append("close")
            return []

        def run_workflow(**kwargs):
            events.append("run")
            return iter([])

        workflow_entry.run.side_effect = run_workflow

        with (
            patch.object(module, "RedisChannel"),
            patch.object(module, "redis_client"),
            patch.object(module, "WorkflowEntry", return_value=workflow_entry),
            patch.object(
                runner,
                "handle_input_moderation",
                return_value=(
                    False,
                    runner.application_generate_entity.inputs,
                    runner.application_generate_entity.query,
                ),
            ),
            patch.object(runner, "handle_annotation_reply", return_value=None),
            patch.object(runner, "_initialize_conversation_variables", side_effect=initialize_conversation_variables),
            patch.object(runner._graphs, "build", return_value=MagicMock()),
        ):
            prepared = runner.prepare()
            assert prepared is not None
            assert events[-1] == "close"
            list(prepared.entry.run())

        assert events[-2:] == ["close", "run"]
