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


class TestWorkflowDraftVariableService:
    """Integration tests for WorkflowDraftVariableService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        # WorkflowDraftVariableService doesn't have external dependencies that need mocking
        return {}

    def _create_test_app(self, db_session_with_containers, mock_external_service_dependencies, fake=None):
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
        )
        from extensions.ext_database import db

        db.session.add(workflow)
        db.session.commit()
        return workflow

    def _create_test_variable(
        self, db_session_with_containers, app_id, node_id, name, value, variable_type="conversation", fake=None
    ):
        fake = fake or Faker()
        if variable_type == "conversation":
            variable = WorkflowDraftVariable.new_conversation_variable(
                app_id=app_id,
                name=name,
                value=value,
                description=fake.text(max_nb_chars=20),
            )
        elif variable_type == "system":
            variable = WorkflowDraftVariable.new_sys_variable(
                app_id=app_id,
                name=name,
                value=value,
                node_execution_id=fake.uuid4(),
                editable=True,
            )
        else:  # node variable
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
        fake = Faker()
        non_existent_id = fake.uuid4()
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_variable = service.get_variable(non_existent_id)
        assert retrieved_variable is None

    def test_get_draft_variables_by_selectors_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
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
            db_session_with_containers, app.id, "test_node_1", "var3", var3_value, "node", fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        for i in range(5):
            test_value = StringSegment(value=fake.numerify("value##"))
            self._create_test_variable(
                db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, fake.word(), test_value, fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        node_id = fake.word()
        var1_value = StringSegment(value=fake.word())
        var2_value = StringSegment(value=fake.word())
        var3_value = StringSegment(value=fake.word())
        self._create_test_variable(db_session_with_containers, app.id, node_id, "var1", var1_value, "node", fake=fake)
        self._create_test_variable(db_session_with_containers, app.id, node_id, "var2", var3_value, "node", fake=fake)
        self._create_test_variable(
            db_session_with_containers, app.id, "other_node", "var3", var2_value, "node", fake=fake
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
            db_session_with_containers, app.id, SYSTEM_VARIABLE_NODE_ID, "sys_var", sys_var_value, "system", fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        for i in range(3):
            test_value = StringSegment(value=fake.numerify("value##"))
            self._create_test_variable(
                db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, fake.word(), test_value, fake=fake
            )
        other_app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        other_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers, other_app.id, CONVERSATION_VARIABLE_NODE_ID, fake.word(), other_value, fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        node_id = fake.word()
        for i in range(2):
            test_value = StringSegment(value=fake.numerify("node_value##"))
            self._create_test_variable(
                db_session_with_containers, app.id, node_id, fake.word(), test_value, "node", fake=fake
            )
        other_node_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers, app.id, "other_node", fake.word(), other_node_value, "node", fake=fake
        )
        conv_value = StringSegment(value=fake.word())
        self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, fake.word(), conv_value, fake=fake
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
            "system",
            fake=fake,
        )
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_id = service._get_conversation_id_from_draft_variable(app.id)
        assert retrieved_conv_id == conversation_id

    def test_get_conversation_id_from_draft_variable_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_id = service._get_conversation_id_from_draft_variable(app.id)
        assert retrieved_conv_id is None

    def test_list_system_variables_success(self, db_session_with_containers, mock_external_service_dependencies):
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        sys_var1_value = StringSegment(value=fake.word())
        sys_var2_value = StringSegment(value=fake.word())
        sys_var1 = self._create_test_variable(
            db_session_with_containers, app.id, SYSTEM_VARIABLE_NODE_ID, "sys_var1", sys_var1_value, "system", fake=fake
        )
        sys_var2 = self._create_test_variable(
            db_session_with_containers, app.id, SYSTEM_VARIABLE_NODE_ID, "sys_var2", sys_var2_value, "system", fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        test_value = StringSegment(value=fake.word())
        conv_var = self._create_test_variable(
            db_session_with_containers, app.id, CONVERSATION_VARIABLE_NODE_ID, "test_conv_var", test_value, fake=fake
        )
        sys_var = self._create_test_variable(
            db_session_with_containers, app.id, SYSTEM_VARIABLE_NODE_ID, "test_sys_var", test_value, "system", fake=fake
        )
        node_var = self._create_test_variable(
            db_session_with_containers, app.id, "test_node", "test_node_var", test_value, "node", fake=fake
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
        fake = Faker()
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, fake=fake)
        service = WorkflowDraftVariableService(db_session_with_containers)
        retrieved_conv_var = service.get_conversation_variable(app.id, "non_existent_conv_var")
        assert retrieved_conv_var is None
        retrieved_sys_var = service.get_system_variable(app.id, "non_existent_sys_var")
        assert retrieved_sys_var is None
        retrieved_node_var = service.get_node_variable(app.id, "test_node", "non_existent_node_var")
        assert retrieved_node_var is None
