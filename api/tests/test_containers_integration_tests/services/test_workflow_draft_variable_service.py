import pytest
from faker import Faker

from core.variables.segments import StringSegment
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from models import App, Workflow
from models.enums import DraftVariableType
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import (
    UpdateNotSupportedError,
    WorkflowDraftVariableService,
)


def _get_random_variable_name(fake: Faker):
    return "".join(fake.random_letters(length=10))


class TestWorkflowDraftVariableService:
    """
    Comprehensive integration tests for WorkflowDraftVariableService using testcontainers.

    This test class covers all major functionality of the WorkflowDraftVariableService:
    - CRUD operations for workflow draft variables (Create, Read, Update, Delete)
    - Variable listing and filtering by type (conversation, system, node)
    - Variable updates and resets with proper validation
    - Variable deletion operations at different scopes
    - Special functionality like prefill and conversation ID retrieval
    - Error handling for various edge cases and invalid operations

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """
        Mock setup for external service dependencies.

        WorkflowDraftVariableService doesn't have external dependencies that need mocking,
        so this fixture returns an empty dictionary to maintain consistency with other test classes.
        This ensures the test structure remains consistent across different service test files.
        """
        # WorkflowDraftVariableService doesn't have external dependencies that need mocking
        return {}

    def _create_test_app(self, db_session_with_containers, mock_external_service_dependencies, fake=None):
        """
        Helper method to create a test app with realistic data for testing.

        This method creates a complete App instance with all required fields populated
        using Faker for generating realistic test data. The app is configured for
        workflow mode to support workflow draft variable testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies (unused in this service)
            fake: Faker instance for generating test data, creates new instance if not provided

        Returns:
            App: Created test app instance with all required fields populated
        """
        fake = fake or Faker()
        app = App()
        app.id = fake.uuid4()
        app.tenant_id = fake.uuid4()
        app.name = fake.company()
        app.description = fake.text()
        app.mode = "workflow"
        app.icon_type = "emoji"
        app.icon = "🤖"
        app.icon_background = "#FFEAD5"
        app.enable_site = True
        app.enable_api = True
        app.created_by = fake.uuid4()
        app.updated_by = app.created_by

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()
        return app

    def _create_test_workflow(self, db_session_with_containers, app, fake=None):
        """
        Helper method to create a test workflow associated with an app.

        This method creates a Workflow instance using the proper factory method
        to ensure all required fields are set correctly. The workflow is configured
        as a draft version with basic graph structure for testing workflow variables.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: The app to associate the workflow with
            fake: Faker instance for generating test data, creates new instance if not provided

        Returns:
            Workflow: Created test workflow instance with proper configuration
        """
        fake = fake or Faker()
        workflow = Workflow.new(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features="{}",
            created_by=app.created_by,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        from extensions.ext_database import db

        db.session.add(workflow)
        db.session.commit()
        return workflow

    def _create_test_variable(
        self,
        db_session_with_containers,
        app_id,
        node_id,
        name,
        value,
        variable_type: DraftVariableType = DraftVariableType.CONVERSATION,
        fake=None,
    ):
        """
        Helper method to create a test workflow draft variable with proper configuration.

        This method creates different types of variables (conversation, system, node) using
        the appropriate factory methods to ensure proper initialization. Each variable type
        has specific requirements and this method handles the creation logic for all types.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app_id: ID of the app to associate the variable with
            node_id: ID of the node (or special constants like CONVERSATION_VARIABLE_NODE_ID)
            name: Name of the variable for identification
            value: StringSegment value for the variable content
            variable_type: Type of variable ("conversation", "system", "node") determining creation method
            fake: Faker instance for generating test data, creates new instance if not provided

        Returns:
            WorkflowDraftVariable: Created test variable instance with proper type configuration
        """
        fake = fake or Faker()
        if variable_type == "conversation":
            # Create conversation variable using the appropriate factory method
            variable = WorkflowDraftVariable.new_conversation_variable(
                app_id=app_id,
                name=name,
                value=value,
                description=fake.text(max_nb_chars=20),
            )
        elif variable_type == "system":
            # Create system variable with editable flag and execution context
            variable = WorkflowDraftVariable.new_sys_variable(
                app_id=app_id,
                name=name,
                value=value,
                node_execution_id=fake.uuid4(),
                editable=True,
            )
        else:  # node variable
            # Create node variable with visibility and editability settings
            variable = WorkflowDraftVariable.new_node_variable(
                app_id=app_id,
                node_id=node_id,
                name=name,
                value=value,
                node_execution_id=fake.uuid4(),
                visible=True,
                editable=True,
            )
        from extensions.ext_database import db

        db.session.add(variable)
        db.session.commit()
        return variable

    def test_get_variable_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting a single variable by ID successfully.

        This test verifies that the service can retrieve a specific variable
        by its ID and that the returned variable contains the correct data.
        It ensures the basic CRUD read operation works correctly for workflow draft variables.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        test_value = StringSegment(value=fake.word())
        variable = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "test_var", test_value, fake=fake
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_variable = service.get_variable(variable.id)
        assert retrieved_variable is not None
        assert retrieved_variable.id == variable.id
        assert retrieved_variable.name == "test_var"
        assert retrieved_variable.app_id == app.id
        assert retrieved_variable.get_value().value == test_value.value

    def test_get_variable_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting a variable that doesn't exist.

        This test verifies that the service returns None when trying to
        retrieve a variable with a non-existent ID. This ensures proper
        handling of missing data scenarios.
        """
        fake = Faker()
        non_existent_id = fake.uuid4()
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_variable = service.get_variable(non_existent_id)
        assert retrieved_variable is None

    def test_get_draft_variables_by_selectors_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting variables by selectors successfully.

        This test verifies that the service can retrieve multiple variables
        using selector pairs (node_id, variable_name) and returns the correct
        variables for each selector. This is useful for bulk variable retrieval
        operations in workflow execution contexts.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        var1_value = StringSegment(value=fake.word())
        var2_value = StringSegment(value=fake.word())
        var3_value = StringSegment(value=fake.word())
        var1 = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "var1", var1_value, fake=fake
        )
        var2 = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "var2", var2_value, fake=fake
        )
        var3 = self._create_test_variable(
            db_session_with_containers,
            app.id,
            "test_node_1",
            "var3",
            var3_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        selectors = [
            [CONVERSATION_VARIABLE_NODE_ID, "var1"],
            [CONVERSATION_VARIABLE_NODE_ID, "var2"],
            ["test_node_1", "var3"],
        ]
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_variables = service.get_draft_variables_by_selectors(app.id, selectors)
        assert len(retrieved_variables) == 3
        var_names = [var.name for var in retrieved_variables]
        assert "var1" in var_names
        assert "var2" in var_names
        assert "var3" in var_names
        for var in retrieved_variables:
            if var.name == "var1":
                assert var.get_value().value == var1_value.value
            elif var.name == "var2":
                assert var.get_value().value == var2_value.value
            elif var.name == "var3":
                assert var.get_value().value == var3_value.value

    def test_list_variables_without_values_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test listing variables without values successfully with pagination.

        This test verifies that the service can list variables with pagination
        and that the returned variables don't include their values (for performance).
        This is important for scenarios where only variable metadata is needed
        without loading the actual content.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        for i in range(5):
            test_value = StringSegment(value=fake.numerify("value######"))
            self._create_test_variable(
                db_session_with_containers,
                app.id,
                CONVERSATION_VARIABLE_NODE_ID,
                _get_random_variable_name(fake),
                test_value,
                fake=fake,
            )
        service = WorkflowDraftVariableService(db_session_with_containers)
        result = service.list_variables_without_values(app.id, page=1, limit=3)
        assert result.total == 5
        assert len(result.variables) == 3
        assert result.variables[0].created_at >= result.variables[1].created_at
        assert result.variables[1].created_at >= result.variables[2].created_at
        for var in result.variables:
            assert var.name is not None
            assert var.app_id == app.id

    def test_list_node_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test listing variables for a specific node successfully.

        This test verifies that the service can filter and return only
        variables associated with a specific node ID. This is crucial for
        workflow execution where variables need to be scoped to specific nodes.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        node_id = fake.word()
        var1_value = StringSegment(value=fake.word())
        var2_value = StringSegment(value=fake.word())
        var3_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            node_id,
            "var1",
            var1_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            node_id,
            "var2",
            var3_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            "other_node",
            "var3",
            var2_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        result = service.list_node_variables(app.id, node_id)
        assert len(result.variables) == 2
        for var in result.variables:
            assert var.node_id == node_id
            assert var.app_id == app.id
        var_names = [var.name for var in result.variables]
        assert "var1" in var_names
        assert "var2" in var_names
        assert "var3" not in var_names

    def test_list_conversation_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test listing conversation variables successfully.

        This test verifies that the service can filter and return only
        conversation variables, excluding system and node variables.
        Conversation variables are user-facing variables that can be
        modified during conversation flows.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        conv_var1_value = StringSegment(value=fake.word())
        conv_var2_value = StringSegment(value=fake.word())
        conv_var1 = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "conv_var1", conv_var1_value, fake=fake
        )
        conv_var2 = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "conv_var2", conv_var2_value, fake=fake
        )
        sys_var_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            SYSTEM_VARIABLE_NODE_ID,
            "sys_var",
            sys_var_value,
            variable_type=DraftVariableType.SYS,
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        result = service.list_conversation_variables(app.id)
        assert len(result.variables) == 2
        for var in result.variables:
            assert var.node_id == CONVERSATION_VARIABLE_NODE_ID
            assert var.app_id == app.id
            assert var.get_variable_type() == DraftVariableType.CONVERSATION
        var_names = [var.name for var in result.variables]
        assert "conv_var1" in var_names
        assert "conv_var2" in var_names
        assert "sys_var" not in var_names

    def test_update_variable_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating a variable's name and value successfully.

        This test verifies that the service can update both the name and value
        of an editable variable and that the changes are persisted correctly.
        It also checks that the last_edited_at timestamp is updated appropriately.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        original_value = StringSegment(value=fake.word())
        new_value = StringSegment(value=fake.word())
        variable = self._create_test_variable(
            db_session_with_containers,
            app.id,
            CONVERSATION_VARIABLE_NODE_ID,
            "original_name",
            original_value,
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        updated_variable = service.update_variable(variable, name="new_name", value=new_value)
        assert updated_variable.name == "new_name"
        assert updated_variable.get_value().value == new_value.value
        assert updated_variable.last_edited_at is not None
        from extensions.ext_database import db

        db.session.refresh(variable)
        assert variable.name == "new_name"
        assert variable.get_value().value == new_value.value
        assert variable.last_edited_at is not None

    def test_update_variable_not_editable(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that updating a non-editable variable raises an exception.

        This test verifies that the service properly prevents updates to
        variables that are not marked as editable. This is important for
        maintaining data integrity and preventing unauthorized modifications
        to system-controlled variables.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        original_value = StringSegment(value=fake.word())
        new_value = StringSegment(value=fake.word())
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=app.id,
            name=fake.word(),  # This is typically not editable
            value=original_value,
            node_execution_id=fake.uuid4(),
            editable=False,  # Set as non-editable
        )
        from extensions.ext_database import db

        db.session.add(variable)
        db.session.commit()
        service = WorkflowDraftVariableService(db_session_with_containers)
        with pytest.raises(UpdateNotSupportedError) as exc_info:
            service.update_variable(variable, name="new_name", value=new_value)
        assert "variable not support updating" in str(exc_info.value)
        assert variable.id in str(exc_info.value)

    def test_reset_conversation_variable_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test resetting conversation variable successfully.

        This test verifies that the service can reset a conversation variable
        to its default value and clear the last_edited_at timestamp.
        This functionality is useful for reverting user modifications
        back to the original workflow configuration.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, fake=fake)
        from core.variables.variables import StringVariable

        conv_var = StringVariable(
            id=fake.uuid4(),
            name="test_conv_var",
            value="default_value",
            selector=[CONVERSATION_VARIABLE_NODE_ID, "test_conv_var"],
        )
        workflow.conversation_variables = [conv_var]
        from extensions.ext_database import db

        db.session.commit()
        modified_value = StringSegment(value=fake.word())
        variable = self._create_test_variable(
            db_session_with_containers,
            app.id,
            CONVERSATION_VARIABLE_NODE_ID,
            "test_conv_var",
            modified_value,
            fake=fake,
        )
        variable.last_edited_at = fake.date_time()
        db.session.commit()
        service = WorkflowDraftVariableService(db_session_with_containers)
        reset_variable = service.reset_variable(workflow, variable)
        assert reset_variable is not None
        assert reset_variable.get_value().value == "default_value"
        assert reset_variable.last_edited_at is None
        db.session.refresh(variable)
        assert variable.get_value().value == "default_value"
        assert variable.last_edited_at is None

    def test_delete_variable_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test deleting a single variable successfully.

        This test verifies that the service can delete a specific variable
        and that it's properly removed from the database. It ensures that
        the deletion operation is atomic and complete.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        test_value = StringSegment(value=fake.word())
        variable = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "test_var", test_value, fake=fake
        )
        from extensions.ext_database import db

        assert db.session.query(WorkflowDraftVariable).filter_by(id=variable.id).first() is not None
        service = WorkflowDraftVariableService(db_session_with_containers)
        service.delete_variable(variable)
        assert db.session.query(WorkflowDraftVariable).filter_by(id=variable.id).first() is None

    def test_delete_workflow_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test deleting all variables for a workflow successfully.

        This test verifies that the service can delete all variables
        associated with a specific app/workflow. This is useful for
        cleanup operations when workflows are deleted or reset.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        for i in range(3):
            test_value = StringSegment(value=fake.numerify("value######"))
            self._create_test_variable(
                db_session_with_containers,
                app.id,
                CONVERSATION_VARIABLE_NODE_ID,
                _get_random_variable_name(fake),
                test_value,
                fake=fake,
            )
        other_app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        other_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers,
            other_app.id,
            CONVERSATION_VARIABLE_NODE_ID,
            _get_random_variable_name(fake),
            other_value,
            fake=fake,
        )
        from extensions.ext_database import db

        app_variables = db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id).all()
        other_app_variables = db.session.query(WorkflowDraftVariable).filter_by(app_id=other_app.id).all()
        assert len(app_variables) == 3
        assert len(other_app_variables) == 1
        service = WorkflowDraftVariableService(db_session_with_containers)
        service.delete_workflow_variables(app.id)
        app_variables_after = db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id).all()
        other_app_variables_after = db.session.query(WorkflowDraftVariable).filter_by(app_id=other_app.id).all()
        assert len(app_variables_after) == 0
        assert len(other_app_variables_after) == 1

    def test_delete_node_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test deleting all variables for a specific node successfully.

        This test verifies that the service can delete all variables
        associated with a specific node while preserving variables
        for other nodes and conversation variables. This is important
        for node-specific cleanup operations in workflow management.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        node_id = fake.word()
        for i in range(2):
            test_value = StringSegment(value=fake.numerify("node_value######"))
            self._create_test_variable(
                db_session_with_containers,
                app.id,
                node_id,
                _get_random_variable_name(fake),
                test_value,
                variable_type=DraftVariableType.NODE,
                fake=fake,
            )
        other_node_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            "other_node",
            _get_random_variable_name(fake),
            other_node_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        conv_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            CONVERSATION_VARIABLE_NODE_ID,
            _get_random_variable_name(fake),
            conv_value,
            fake=fake,
        )
        from extensions.ext_database import db

        target_node_variables = db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id, node_id=node_id).all()
        other_node_variables = (
            db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id, node_id="other_node").all()
        )
        conv_variables = (
            db.session.query(WorkflowDraftVariable)
            .filter_by(app_id=app.id, node_id=CONVERSATION_VARIABLE_NODE_ID)
            .all()
        )
        assert len(target_node_variables) == 2
        assert len(other_node_variables) == 1
        assert len(conv_variables) == 1
        service = WorkflowDraftVariableService(db_session_with_containers)
        service.delete_node_variables(app.id, node_id)
        target_node_variables_after = (
            db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id, node_id=node_id).all()
        )
        other_node_variables_after = (
            db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id, node_id="other_node").all()
        )
        conv_variables_after = (
            db.session.query(WorkflowDraftVariable)
            .filter_by(app_id=app.id, node_id=CONVERSATION_VARIABLE_NODE_ID)
            .all()
        )
        assert len(target_node_variables_after) == 0
        assert len(other_node_variables_after) == 1
        assert len(conv_variables_after) == 1

    def test_prefill_conversation_variable_default_values_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test prefill conversation variable default values successfully.

        This test verifies that the service can automatically create
        conversation variables with default values based on the workflow
        configuration when none exist. This is important for initializing
        workflow variables with proper defaults from the workflow definition.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        workflow = self._create_test_workflow(db_session_with_containers, app, fake=fake)
        from core.variables.variables import StringVariable

        conv_var1 = StringVariable(
            id=fake.uuid4(),
            name="conv_var1",
            value="default_value1",
            selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_var1"],
        )
        conv_var2 = StringVariable(
            id=fake.uuid4(),
            name="conv_var2",
            value="default_value2",
            selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_var2"],
        )
        workflow.conversation_variables = [conv_var1, conv_var2]
        from extensions.ext_database import db

        db.session.commit()
        service = WorkflowDraftVariableService(db_session_with_containers)
        service.prefill_conversation_variable_default_values(workflow)
        draft_variables = (
            db.session.query(WorkflowDraftVariable)
            .filter_by(app_id=app.id, node_id=CONVERSATION_VARIABLE_NODE_ID)
            .all()
        )
        assert len(draft_variables) == 2
        var_names = [var.name for var in draft_variables]
        assert "conv_var1" in var_names
        assert "conv_var2" in var_names
        for var in draft_variables:
            assert var.app_id == app.id
            assert var.node_id == CONVERSATION_VARIABLE_NODE_ID
            assert var.editable is True
            assert var.get_variable_type() == DraftVariableType.CONVERSATION

    def test_get_conversation_id_from_draft_variable_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting conversation ID from draft variable successfully.

        This test verifies that the service can extract the conversation ID
        from a system variable named "conversation_id". This is important
        for maintaining conversation context across workflow executions.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        conversation_id = fake.uuid4()
        conv_id_value = StringSegment(value=conversation_id)
        self._create_test_variable(
            db_session_with_containers,
            app.id,
            SYSTEM_VARIABLE_NODE_ID,
            "conversation_id",
            conv_id_value,
            variable_type=DraftVariableType.SYS,
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_id = service._get_conversation_id_from_draft_variable(app.id)
        assert retrieved_conv_id == conversation_id

    def test_get_conversation_id_from_draft_variable_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting conversation ID when it doesn't exist.

        This test verifies that the service returns None when no
        conversation_id variable exists for the app. This ensures
        proper handling of missing conversation context scenarios.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_id = service._get_conversation_id_from_draft_variable(app.id)
        assert retrieved_conv_id is None

    def test_list_system_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test listing system variables successfully.

        This test verifies that the service can filter and return only
        system variables, excluding conversation and node variables.
        System variables are internal variables used by the workflow
        engine for maintaining state and context.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        sys_var1_value = StringSegment(value=fake.word())
        sys_var2_value = StringSegment(value=fake.word())
        sys_var1 = self._create_test_variable(
            db_session_with_containers,
            app.id,
            SYSTEM_VARIABLE_NODE_ID,
            "sys_var1",
            sys_var1_value,
            variable_type=DraftVariableType.SYS,
            fake=fake,
        )
        sys_var2 = self._create_test_variable(
            db_session_with_containers,
            app.id,
            SYSTEM_VARIABLE_NODE_ID,
            "sys_var2",
            sys_var2_value,
            variable_type=DraftVariableType.SYS,
            fake=fake,
        )
        conv_var_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "conv_var", conv_var_value, fake=fake
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        result = service.list_system_variables(app.id)
        assert len(result.variables) == 2
        for var in result.variables:
            assert var.node_id == SYSTEM_VARIABLE_NODE_ID
            assert var.app_id == app.id
            assert var.get_variable_type() == DraftVariableType.SYS
        var_names = [var.name for var in result.variables]
        assert "sys_var1" in var_names
        assert "sys_var2" in var_names
        assert "conv_var" not in var_names

    def test_get_variable_by_name_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting variables by name successfully for different types.

        This test verifies that the service can retrieve variables by name
        for different variable types (conversation, system, node). This
        functionality is important for variable lookup operations during
        workflow execution and user interactions.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        test_value = StringSegment(value=fake.word())
        conv_var = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "test_conv_var", test_value, fake=fake
        )
        sys_var = self._create_test_variable(
            db_session_with_containers,
            app.id,
            SYSTEM_VARIABLE_NODE_ID,
            "test_sys_var",
            test_value,
            variable_type=DraftVariableType.SYS,
            fake=fake,
        )
        node_var = self._create_test_variable(
            db_session_with_containers,
            app.id,
            "test_node",
            "test_node_var",
            test_value,
            variable_type=DraftVariableType.NODE,
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_var = service.get_conversation_variable(app.id, "test_conv_var")
        assert retrieved_conv_var is not None
        assert retrieved_conv_var.name == "test_conv_var"
        assert retrieved_conv_var.node_id == CONVERSATION_VARIABLE_NODE_ID
        retrieved_sys_var = service.get_system_variable(app.id, "test_sys_var")
        assert retrieved_sys_var is not None
        assert retrieved_sys_var.name == "test_sys_var"
        assert retrieved_sys_var.node_id == SYSTEM_VARIABLE_NODE_ID
        retrieved_node_var = service.get_node_variable(app.id, "test_node", "test_node_var")
        assert retrieved_node_var is not None
        assert retrieved_node_var.name == "test_node_var"
        assert retrieved_node_var.node_id == "test_node"

    def test_get_variable_by_name_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting variables by name when they don't exist.

        This test verifies that the service returns None when trying to
        retrieve variables by name that don't exist. This ensures proper
        handling of missing variable scenarios for all variable types.
        """
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_var = service.get_conversation_variable(app.id, "non_existent_conv_var")
        assert retrieved_conv_var is None
        retrieved_sys_var = service.get_system_variable(app.id, "non_existent_sys_var")
        assert retrieved_sys_var is None
        retrieved_node_var = service.get_node_variable(app.id, "test_node", "non_existent_node_var")
        assert retrieved_node_var is None
