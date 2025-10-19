"""Test conversation variable handling in AdvancedChatAppRunner."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

from sqlalchemy.orm import Session

from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.variables import SegmentType
from factories import variable_factory
from models import ConversationVariable, Workflow


class TestAdvancedChatAppRunnerConversationVariables:
    """Test that AdvancedChatAppRunner correctly handles conversation variables."""

    def test_missing_conversation_variables_are_added(self):
        """Test that new conversation variables added to workflow are created for existing conversations."""
        # Setup
        app_id = str(uuid4())
        conversation_id = str(uuid4())
        workflow_id = str(uuid4())

        # Create workflow with two conversation variables
        workflow_vars = [
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var1",
                    "name": "existing_var",
                    "value_type": SegmentType.STRING,
                    "value": "default1",
                }
            ),
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var2",
                    "name": "new_var",
                    "value_type": SegmentType.STRING,
                    "value": "default2",
                }
            ),
        ]

        # Mock workflow with conversation variables
        mock_workflow = MagicMock(spec=Workflow)
        mock_workflow.conversation_variables = workflow_vars
        mock_workflow.tenant_id = str(uuid4())
        mock_workflow.app_id = app_id
        mock_workflow.id = workflow_id
        mock_workflow.type = "chat"
        mock_workflow.graph_dict = {}
        mock_workflow.environment_variables = []

        # Create existing conversation variable (only var1 exists in DB)
        existing_db_var = MagicMock(spec=ConversationVariable)
        existing_db_var.id = "var1"
        existing_db_var.app_id = app_id
        existing_db_var.conversation_id = conversation_id
        existing_db_var.to_variable = MagicMock(return_value=workflow_vars[0])

        # Mock conversation and message
        mock_conversation = MagicMock()
        mock_conversation.app_id = app_id
        mock_conversation.id = conversation_id

        mock_message = MagicMock()
        mock_message.id = str(uuid4())

        # Mock app config
        mock_app_config = MagicMock()
        mock_app_config.app_id = app_id
        mock_app_config.workflow_id = workflow_id
        mock_app_config.tenant_id = str(uuid4())

        # Mock app generate entity
        mock_app_generate_entity = MagicMock(spec=AdvancedChatAppGenerateEntity)
        mock_app_generate_entity.app_config = mock_app_config
        mock_app_generate_entity.inputs = {}
        mock_app_generate_entity.query = "test query"
        mock_app_generate_entity.files = []
        mock_app_generate_entity.user_id = str(uuid4())
        mock_app_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        mock_app_generate_entity.workflow_run_id = str(uuid4())
        mock_app_generate_entity.task_id = str(uuid4())
        mock_app_generate_entity.call_depth = 0
        mock_app_generate_entity.single_iteration_run = None
        mock_app_generate_entity.single_loop_run = None
        mock_app_generate_entity.trace_manager = None

        # Create runner
        runner = AdvancedChatAppRunner(
            application_generate_entity=mock_app_generate_entity,
            queue_manager=MagicMock(),
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

        # Mock database session
        mock_session = MagicMock(spec=Session)

        # First query returns only existing variable
        mock_scalars_result = MagicMock()
        mock_scalars_result.all.return_value = [existing_db_var]
        mock_session.scalars.return_value = mock_scalars_result

        # Track what gets added to session
        added_items = []

        def track_add_all(items):
            added_items.extend(items)

        mock_session.add_all.side_effect = track_add_all

        # Patch the necessary components
        with (
            patch("core.app.apps.advanced_chat.app_runner.Session") as mock_session_class,
            patch("core.app.apps.advanced_chat.app_runner.select") as mock_select,
            patch("core.app.apps.advanced_chat.app_runner.db") as mock_db,
            patch.object(runner, "_init_graph") as mock_init_graph,
            patch.object(runner, "handle_input_moderation", return_value=False),
            patch.object(runner, "handle_annotation_reply", return_value=False),
            patch("core.app.apps.advanced_chat.app_runner.WorkflowEntry") as mock_workflow_entry_class,
            patch("core.app.apps.advanced_chat.app_runner.GraphRuntimeState") as mock_graph_runtime_state_class,
            patch("core.app.apps.advanced_chat.app_runner.redis_client") as mock_redis_client,
            patch("core.app.apps.advanced_chat.app_runner.RedisChannel") as mock_redis_channel_class,
        ):
            # Setup mocks
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_db.session.query.return_value.where.return_value.first.return_value = MagicMock()  # App exists
            mock_db.engine = MagicMock()

            # Mock GraphRuntimeState to accept the variable pool
            mock_graph_runtime_state_class.return_value = MagicMock()

            # Mock graph initialization
            mock_init_graph.return_value = MagicMock()

            # Mock workflow entry
            mock_workflow_entry = MagicMock()
            mock_workflow_entry.run.return_value = iter([])  # Empty generator
            mock_workflow_entry_class.return_value = mock_workflow_entry

            # Run the method
            runner.run()

            # Verify that the missing variable was added
            assert len(added_items) == 1, "Should have added exactly one missing variable"

            # Check that the added item is the missing variable (var2)
            added_var = added_items[0]
            assert hasattr(added_var, "id"), "Added item should be a ConversationVariable"
            # Note: Since we're mocking ConversationVariable.from_variable,
            # we can't directly check the id, but we can verify add_all was called
            assert mock_session.add_all.called, "Session add_all should have been called"
            assert mock_session.commit.called, "Session commit should have been called"

    def test_no_variables_creates_all(self):
        """Test that all conversation variables are created when none exist in DB."""
        # Setup
        app_id = str(uuid4())
        conversation_id = str(uuid4())
        workflow_id = str(uuid4())

        # Create workflow with conversation variables
        workflow_vars = [
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var1",
                    "name": "var1",
                    "value_type": SegmentType.STRING,
                    "value": "default1",
                }
            ),
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var2",
                    "name": "var2",
                    "value_type": SegmentType.STRING,
                    "value": "default2",
                }
            ),
        ]

        # Mock workflow
        mock_workflow = MagicMock(spec=Workflow)
        mock_workflow.conversation_variables = workflow_vars
        mock_workflow.tenant_id = str(uuid4())
        mock_workflow.app_id = app_id
        mock_workflow.id = workflow_id
        mock_workflow.type = "chat"
        mock_workflow.graph_dict = {}
        mock_workflow.environment_variables = []

        # Mock conversation and message
        mock_conversation = MagicMock()
        mock_conversation.app_id = app_id
        mock_conversation.id = conversation_id

        mock_message = MagicMock()
        mock_message.id = str(uuid4())

        # Mock app config
        mock_app_config = MagicMock()
        mock_app_config.app_id = app_id
        mock_app_config.workflow_id = workflow_id
        mock_app_config.tenant_id = str(uuid4())

        # Mock app generate entity
        mock_app_generate_entity = MagicMock(spec=AdvancedChatAppGenerateEntity)
        mock_app_generate_entity.app_config = mock_app_config
        mock_app_generate_entity.inputs = {}
        mock_app_generate_entity.query = "test query"
        mock_app_generate_entity.files = []
        mock_app_generate_entity.user_id = str(uuid4())
        mock_app_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        mock_app_generate_entity.workflow_run_id = str(uuid4())
        mock_app_generate_entity.task_id = str(uuid4())
        mock_app_generate_entity.call_depth = 0
        mock_app_generate_entity.single_iteration_run = None
        mock_app_generate_entity.single_loop_run = None
        mock_app_generate_entity.trace_manager = None

        # Create runner
        runner = AdvancedChatAppRunner(
            application_generate_entity=mock_app_generate_entity,
            queue_manager=MagicMock(),
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

        # Mock database session
        mock_session = MagicMock(spec=Session)

        # Query returns empty list (no existing variables)
        mock_scalars_result = MagicMock()
        mock_scalars_result.all.return_value = []
        mock_session.scalars.return_value = mock_scalars_result

        # Track what gets added to session
        added_items = []

        def track_add_all(items):
            added_items.extend(items)

        mock_session.add_all.side_effect = track_add_all

        # Patch the necessary components
        with (
            patch("core.app.apps.advanced_chat.app_runner.Session") as mock_session_class,
            patch("core.app.apps.advanced_chat.app_runner.select") as mock_select,
            patch("core.app.apps.advanced_chat.app_runner.db") as mock_db,
            patch.object(runner, "_init_graph") as mock_init_graph,
            patch.object(runner, "handle_input_moderation", return_value=False),
            patch.object(runner, "handle_annotation_reply", return_value=False),
            patch("core.app.apps.advanced_chat.app_runner.WorkflowEntry") as mock_workflow_entry_class,
            patch("core.app.apps.advanced_chat.app_runner.GraphRuntimeState") as mock_graph_runtime_state_class,
            patch("core.app.apps.advanced_chat.app_runner.ConversationVariable") as mock_conv_var_class,
            patch("core.app.apps.advanced_chat.app_runner.redis_client") as mock_redis_client,
            patch("core.app.apps.advanced_chat.app_runner.RedisChannel") as mock_redis_channel_class,
        ):
            # Setup mocks
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_db.session.query.return_value.where.return_value.first.return_value = MagicMock()  # App exists
            mock_db.engine = MagicMock()

            # Mock ConversationVariable.from_variable to return mock objects
            mock_conv_vars = []
            for var in workflow_vars:
                mock_cv = MagicMock()
                mock_cv.id = var.id
                mock_cv.to_variable.return_value = var
                mock_conv_vars.append(mock_cv)

            mock_conv_var_class.from_variable.side_effect = mock_conv_vars

            # Mock GraphRuntimeState to accept the variable pool
            mock_graph_runtime_state_class.return_value = MagicMock()

            # Mock graph initialization
            mock_init_graph.return_value = MagicMock()

            # Mock workflow entry
            mock_workflow_entry = MagicMock()
            mock_workflow_entry.run.return_value = iter([])  # Empty generator
            mock_workflow_entry_class.return_value = mock_workflow_entry

            # Run the method
            runner.run()

            # Verify that all variables were created
            assert len(added_items) == 2, "Should have added both variables"
            assert mock_session.add_all.called, "Session add_all should have been called"
            assert mock_session.commit.called, "Session commit should have been called"

    def test_all_variables_exist_no_changes(self):
        """Test that no changes are made when all variables already exist in DB."""
        # Setup
        app_id = str(uuid4())
        conversation_id = str(uuid4())
        workflow_id = str(uuid4())

        # Create workflow with conversation variables
        workflow_vars = [
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var1",
                    "name": "var1",
                    "value_type": SegmentType.STRING,
                    "value": "default1",
                }
            ),
            variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": "var2",
                    "name": "var2",
                    "value_type": SegmentType.STRING,
                    "value": "default2",
                }
            ),
        ]

        # Mock workflow
        mock_workflow = MagicMock(spec=Workflow)
        mock_workflow.conversation_variables = workflow_vars
        mock_workflow.tenant_id = str(uuid4())
        mock_workflow.app_id = app_id
        mock_workflow.id = workflow_id
        mock_workflow.type = "chat"
        mock_workflow.graph_dict = {}
        mock_workflow.environment_variables = []

        # Create existing conversation variables (both exist in DB)
        existing_db_vars = []
        for var in workflow_vars:
            db_var = MagicMock(spec=ConversationVariable)
            db_var.id = var.id
            db_var.app_id = app_id
            db_var.conversation_id = conversation_id
            db_var.to_variable = MagicMock(return_value=var)
            existing_db_vars.append(db_var)

        # Mock conversation and message
        mock_conversation = MagicMock()
        mock_conversation.app_id = app_id
        mock_conversation.id = conversation_id

        mock_message = MagicMock()
        mock_message.id = str(uuid4())

        # Mock app config
        mock_app_config = MagicMock()
        mock_app_config.app_id = app_id
        mock_app_config.workflow_id = workflow_id
        mock_app_config.tenant_id = str(uuid4())

        # Mock app generate entity
        mock_app_generate_entity = MagicMock(spec=AdvancedChatAppGenerateEntity)
        mock_app_generate_entity.app_config = mock_app_config
        mock_app_generate_entity.inputs = {}
        mock_app_generate_entity.query = "test query"
        mock_app_generate_entity.files = []
        mock_app_generate_entity.user_id = str(uuid4())
        mock_app_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        mock_app_generate_entity.workflow_run_id = str(uuid4())
        mock_app_generate_entity.task_id = str(uuid4())
        mock_app_generate_entity.call_depth = 0
        mock_app_generate_entity.single_iteration_run = None
        mock_app_generate_entity.single_loop_run = None
        mock_app_generate_entity.trace_manager = None

        # Create runner
        runner = AdvancedChatAppRunner(
            application_generate_entity=mock_app_generate_entity,
            queue_manager=MagicMock(),
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

        # Mock database session
        mock_session = MagicMock(spec=Session)

        # Query returns all existing variables
        mock_scalars_result = MagicMock()
        mock_scalars_result.all.return_value = existing_db_vars
        mock_session.scalars.return_value = mock_scalars_result

        # Patch the necessary components
        with (
            patch("core.app.apps.advanced_chat.app_runner.Session") as mock_session_class,
            patch("core.app.apps.advanced_chat.app_runner.select") as mock_select,
            patch("core.app.apps.advanced_chat.app_runner.db") as mock_db,
            patch.object(runner, "_init_graph") as mock_init_graph,
            patch.object(runner, "handle_input_moderation", return_value=False),
            patch.object(runner, "handle_annotation_reply", return_value=False),
            patch("core.app.apps.advanced_chat.app_runner.WorkflowEntry") as mock_workflow_entry_class,
            patch("core.app.apps.advanced_chat.app_runner.GraphRuntimeState") as mock_graph_runtime_state_class,
            patch("core.app.apps.advanced_chat.app_runner.redis_client") as mock_redis_client,
            patch("core.app.apps.advanced_chat.app_runner.RedisChannel") as mock_redis_channel_class,
        ):
            # Setup mocks
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_db.session.query.return_value.where.return_value.first.return_value = MagicMock()  # App exists
            mock_db.engine = MagicMock()

            # Mock GraphRuntimeState to accept the variable pool
            mock_graph_runtime_state_class.return_value = MagicMock()

            # Mock graph initialization
            mock_init_graph.return_value = MagicMock()

            # Mock workflow entry
            mock_workflow_entry = MagicMock()
            mock_workflow_entry.run.return_value = iter([])  # Empty generator
            mock_workflow_entry_class.return_value = mock_workflow_entry

            # Run the method
            runner.run()

            # Verify that no variables were added
            assert not mock_session.add_all.called, "Session add_all should not have been called"
            assert mock_session.commit.called, "Session commit should still be called"
