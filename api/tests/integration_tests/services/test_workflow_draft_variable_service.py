import json
import unittest
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from core.variables.segments import StringSegment
from core.variables.types import SegmentType
from core.variables.variables import StringVariable
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes import NodeType
from extensions.ext_database import db
from extensions.ext_storage import storage
from factories.variable_factory import build_segment
from libs import datetime_utils
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowDraftVariableFile, WorkflowNodeExecutionModel
from services.workflow_draft_variable_service import (
    DraftVariableSaver,
    DraftVarLoader,
    VariableResetError,
    WorkflowDraftVariableService,
)


@pytest.mark.usefixtures("flask_req_ctx")
class TestWorkflowDraftVariableService(unittest.TestCase):
    _test_app_id: str
    _session: Session
    _node1_id = "test_node_1"
    _node2_id = "test_node_2"
    _node_exec_id = str(uuid.uuid4())

    def setUp(self):
        self._test_app_id = str(uuid.uuid4())
        self._session: Session = db.session()
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=self._test_app_id,
            name="sys_var",
            value=build_segment("sys_value"),
            node_execution_id=self._node_exec_id,
        )
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=self._test_app_id,
            name="conv_var",
            value=build_segment("conv_value"),
        )
        node2_vars = [
            WorkflowDraftVariable.new_node_variable(
                app_id=self._test_app_id,
                node_id=self._node2_id,
                name="int_var",
                value=build_segment(1),
                visible=False,
                node_execution_id=self._node_exec_id,
            ),
            WorkflowDraftVariable.new_node_variable(
                app_id=self._test_app_id,
                node_id=self._node2_id,
                name="str_var",
                value=build_segment("str_value"),
                visible=True,
                node_execution_id=self._node_exec_id,
            ),
        ]
        node1_var = WorkflowDraftVariable.new_node_variable(
            app_id=self._test_app_id,
            node_id=self._node1_id,
            name="str_var",
            value=build_segment("str_value"),
            visible=True,
            node_execution_id=self._node_exec_id,
        )
        _variables = list(node2_vars)
        _variables.extend(
            [
                node1_var,
                sys_var,
                conv_var,
            ]
        )

        db.session.add_all(_variables)
        db.session.flush()
        self._variable_ids = [v.id for v in _variables]
        self._node1_str_var_id = node1_var.id
        self._sys_var_id = sys_var.id
        self._conv_var_id = conv_var.id
        self._node2_var_ids = [v.id for v in node2_vars]

    def _get_test_srv(self) -> WorkflowDraftVariableService:
        return WorkflowDraftVariableService(session=self._session)

    def tearDown(self):
        self._session.rollback()

    def test_list_variables(self):
        srv = self._get_test_srv()
        var_list = srv.list_variables_without_values(self._test_app_id, page=1, limit=2)
        assert var_list.total == 5
        assert len(var_list.variables) == 2
        page1_var_ids = {v.id for v in var_list.variables}
        assert page1_var_ids.issubset(self._variable_ids)

        var_list_2 = srv.list_variables_without_values(self._test_app_id, page=2, limit=2)
        assert var_list_2.total is None
        assert len(var_list_2.variables) == 2
        page2_var_ids = {v.id for v in var_list_2.variables}
        assert page2_var_ids.isdisjoint(page1_var_ids)
        assert page2_var_ids.issubset(self._variable_ids)

    def test_get_node_variable(self):
        srv = self._get_test_srv()
        node_var = srv.get_node_variable(self._test_app_id, self._node1_id, "str_var")
        assert node_var is not None
        assert node_var.id == self._node1_str_var_id
        assert node_var.name == "str_var"
        assert node_var.get_value() == build_segment("str_value")

    def test_get_system_variable(self):
        srv = self._get_test_srv()
        sys_var = srv.get_system_variable(self._test_app_id, "sys_var")
        assert sys_var is not None
        assert sys_var.id == self._sys_var_id
        assert sys_var.name == "sys_var"
        assert sys_var.get_value() == build_segment("sys_value")

    def test_get_conversation_variable(self):
        srv = self._get_test_srv()
        conv_var = srv.get_conversation_variable(self._test_app_id, "conv_var")
        assert conv_var is not None
        assert conv_var.id == self._conv_var_id
        assert conv_var.name == "conv_var"
        assert conv_var.get_value() == build_segment("conv_value")

    def test_delete_node_variables(self):
        srv = self._get_test_srv()
        srv.delete_node_variables(self._test_app_id, self._node2_id)
        node2_var_count = (
            self._session.query(WorkflowDraftVariable)
            .where(
                WorkflowDraftVariable.app_id == self._test_app_id,
                WorkflowDraftVariable.node_id == self._node2_id,
            )
            .count()
        )
        assert node2_var_count == 0

    def test_delete_variable(self):
        srv = self._get_test_srv()
        node_1_var = (
            self._session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.id == self._node1_str_var_id).one()
        )
        srv.delete_variable(node_1_var)
        exists = bool(
            self._session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.id == self._node1_str_var_id).first()
        )
        assert exists is False

    def test__list_node_variables(self):
        srv = self._get_test_srv()
        node_vars = srv._list_node_variables(self._test_app_id, self._node2_id)
        assert len(node_vars.variables) == 2
        assert {v.id for v in node_vars.variables} == set(self._node2_var_ids)

    def test_get_draft_variables_by_selectors(self):
        srv = self._get_test_srv()
        selectors = [
            [self._node1_id, "str_var"],
            [self._node2_id, "str_var"],
            [self._node2_id, "int_var"],
        ]
        variables = srv.get_draft_variables_by_selectors(self._test_app_id, selectors)
        assert len(variables) == 3
        assert {v.id for v in variables} == {self._node1_str_var_id} | set(self._node2_var_ids)


@pytest.mark.usefixtures("flask_req_ctx")
class TestDraftVariableLoader(unittest.TestCase):
    _test_app_id: str
    _test_tenant_id: str

    _node1_id = "test_loader_node_1"
    _node_exec_id = str(uuid.uuid4())

    # @pytest.fixture
    # def test_app_id(self):
    #     return str(uuid.uuid4())

    # @pytest.fixture
    # def test_tenant_id(self):
    #     return str(uuid.uuid4())

    # @pytest.fixture
    # def session(self):
    #     with Session(bind=db.engine, expire_on_commit=False) as session:
    #         yield session

    # @pytest.fixture
    # def node_var(self, session):
    #     pass

    def setUp(self):
        self._test_app_id = str(uuid.uuid4())
        self._test_tenant_id = str(uuid.uuid4())
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=self._test_app_id,
            name="sys_var",
            value=build_segment("sys_value"),
            node_execution_id=self._node_exec_id,
        )
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=self._test_app_id,
            name="conv_var",
            value=build_segment("conv_value"),
        )
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=self._test_app_id,
            node_id=self._node1_id,
            name="str_var",
            value=build_segment("str_value"),
            visible=True,
            node_execution_id=self._node_exec_id,
        )
        _variables = [
            node_var,
            sys_var,
            conv_var,
        ]

        with Session(bind=db.engine, expire_on_commit=False) as session:
            session.add_all(_variables)
            session.flush()
            session.commit()
        self._variable_ids = [v.id for v in _variables]
        self._node_var_id = node_var.id
        self._sys_var_id = sys_var.id
        self._conv_var_id = conv_var.id

    def tearDown(self):
        with Session(bind=db.engine, expire_on_commit=False) as session:
            session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.app_id == self._test_app_id).delete(
                synchronize_session=False
            )
            session.commit()

    def test_variable_loader_with_empty_selector(self):
        var_loader = DraftVarLoader(engine=db.engine, app_id=self._test_app_id, tenant_id=self._test_tenant_id)
        variables = var_loader.load_variables([])
        assert len(variables) == 0

    def test_variable_loader_with_non_empty_selector(self):
        var_loader = DraftVarLoader(engine=db.engine, app_id=self._test_app_id, tenant_id=self._test_tenant_id)
        variables = var_loader.load_variables(
            [
                [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
                [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
                [self._node1_id, "str_var"],
            ]
        )
        assert len(variables) == 3
        conv_var = next(v for v in variables if v.selector[0] == CONVERSATION_VARIABLE_NODE_ID)
        assert conv_var.id == self._conv_var_id
        sys_var = next(v for v in variables if v.selector[0] == SYSTEM_VARIABLE_NODE_ID)
        assert sys_var.id == self._sys_var_id
        node1_var = next(v for v in variables if v.selector[0] == self._node1_id)
        assert node1_var.id == self._node_var_id

    @pytest.mark.usefixtures("setup_account")
    def test_load_offloaded_variable_string_type_integration(self, setup_account):
        """Test _load_offloaded_variable with string type using DraftVariableSaver for data creation."""

        # Create a large string that will be offloaded
        test_content = "x" * 15000  # Create a string larger than LARGE_VARIABLE_THRESHOLD (10KB)
        large_string_segment = StringSegment(value=test_content)

        node_execution_id = str(uuid.uuid4())

        try:
            with Session(bind=db.engine, expire_on_commit=False) as session:
                # Use DraftVariableSaver to create offloaded variable (this mimics production)
                saver = DraftVariableSaver(
                    session=session,
                    app_id=self._test_app_id,
                    node_id="test_offload_node",
                    node_type=NodeType.LLM,  # Use a real node type
                    node_execution_id=node_execution_id,
                    user=setup_account,
                )

                # Save the variable - this will trigger offloading due to large size
                saver.save(outputs={"offloaded_string_var": large_string_segment})
                session.commit()

                # Now test loading using DraftVarLoader
                var_loader = DraftVarLoader(engine=db.engine, app_id=self._test_app_id, tenant_id=self._test_tenant_id)

                # Load the variable using the standard workflow
                variables = var_loader.load_variables([["test_offload_node", "offloaded_string_var"]])

                # Verify results
                assert len(variables) == 1
                loaded_variable = variables[0]
                assert loaded_variable.name == "offloaded_string_var"
                assert loaded_variable.selector == ["test_offload_node", "offloaded_string_var"]
                assert isinstance(loaded_variable.value, StringSegment)
                assert loaded_variable.value.value == test_content

        finally:
            # Clean up - delete all draft variables for this app
            with Session(bind=db.engine) as session:
                service = WorkflowDraftVariableService(session)
                service.delete_workflow_variables(self._test_app_id)
                session.commit()

    def test_load_offloaded_variable_object_type_integration(self):
        """Test _load_offloaded_variable with object type using real storage and service."""

        # Create a test object
        test_object = {"key1": "value1", "key2": 42, "nested": {"inner": "data"}}
        test_json = json.dumps(test_object, ensure_ascii=False, separators=(",", ":"))
        content_bytes = test_json.encode()

        # Create an upload file record
        upload_file = UploadFile(
            tenant_id=self._test_tenant_id,
            storage_type="local",
            key=f"test_offload_{uuid.uuid4()}.json",
            name="test_offload.json",
            size=len(content_bytes),
            extension="json",
            mime_type="application/json",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
            created_at=datetime_utils.naive_utc_now(),
            used=True,
            used_by=str(uuid.uuid4()),
            used_at=datetime_utils.naive_utc_now(),
        )

        # Store the content in storage
        storage.save(upload_file.key, content_bytes)

        # Create a variable file record
        variable_file = WorkflowDraftVariableFile(
            upload_file_id=upload_file.id,
            value_type=SegmentType.OBJECT,
            tenant_id=self._test_tenant_id,
            app_id=self._test_app_id,
            user_id=str(uuid.uuid4()),
            size=len(content_bytes),
            created_at=datetime_utils.naive_utc_now(),
        )

        try:
            with Session(bind=db.engine, expire_on_commit=False) as session:
                # Add upload file and variable file first to get their IDs
                session.add_all([upload_file, variable_file])
                session.flush()  # This generates the IDs

                # Now create the offloaded draft variable with the correct file_id
                offloaded_var = WorkflowDraftVariable.new_node_variable(
                    app_id=self._test_app_id,
                    node_id="test_offload_node",
                    name="offloaded_object_var",
                    value=build_segment({"truncated": True}),
                    visible=True,
                    node_execution_id=str(uuid.uuid4()),
                )
                offloaded_var.file_id = variable_file.id

                session.add(offloaded_var)
                session.flush()
                session.commit()

                # Use the service method that properly preloads relationships
                service = WorkflowDraftVariableService(session)
                draft_vars = service.get_draft_variables_by_selectors(
                    self._test_app_id, [["test_offload_node", "offloaded_object_var"]]
                )

                assert len(draft_vars) == 1
                loaded_var = draft_vars[0]
                assert loaded_var.is_truncated()

                # Create DraftVarLoader and test loading
                var_loader = DraftVarLoader(engine=db.engine, app_id=self._test_app_id, tenant_id=self._test_tenant_id)

                # Test the _load_offloaded_variable method
                selector_tuple, variable = var_loader._load_offloaded_variable(loaded_var)

                # Verify the results
                assert selector_tuple == ("test_offload_node", "offloaded_object_var")
                assert variable.id == loaded_var.id
                assert variable.name == "offloaded_object_var"
                assert variable.value.value == test_object

        finally:
            # Clean up
            with Session(bind=db.engine) as session:
                # Query and delete by ID to ensure they're tracked in this session
                session.query(WorkflowDraftVariable).filter_by(id=offloaded_var.id).delete()
                session.query(WorkflowDraftVariableFile).filter_by(id=variable_file.id).delete()
                session.query(UploadFile).filter_by(id=upload_file.id).delete()
                session.commit()
            # Clean up storage
            try:
                storage.delete(upload_file.key)
            except Exception:
                pass  # Ignore cleanup failures

    def test_load_variables_with_offloaded_variables_integration(self):
        """Test load_variables method with mix of regular and offloaded variables using real storage."""
        # Create a regular variable (already exists from setUp)
        # Create offloaded variable content
        test_content = "This is offloaded content for integration test"
        content_bytes = test_content.encode()

        # Create upload file record
        upload_file = UploadFile(
            tenant_id=self._test_tenant_id,
            storage_type="local",
            key=f"test_integration_{uuid.uuid4()}.txt",
            name="test_integration.txt",
            size=len(content_bytes),
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
            created_at=datetime_utils.naive_utc_now(),
            used=True,
            used_by=str(uuid.uuid4()),
            used_at=datetime_utils.naive_utc_now(),
        )

        # Store the content
        storage.save(upload_file.key, content_bytes)

        # Create variable file
        variable_file = WorkflowDraftVariableFile(
            upload_file_id=upload_file.id,
            value_type=SegmentType.STRING,
            tenant_id=self._test_tenant_id,
            app_id=self._test_app_id,
            user_id=str(uuid.uuid4()),
            size=len(content_bytes),
            created_at=datetime_utils.naive_utc_now(),
        )

        try:
            with Session(bind=db.engine, expire_on_commit=False) as session:
                # Add upload file and variable file first to get their IDs
                session.add_all([upload_file, variable_file])
                session.flush()  # This generates the IDs

                # Now create the offloaded draft variable with the correct file_id
                offloaded_var = WorkflowDraftVariable.new_node_variable(
                    app_id=self._test_app_id,
                    node_id="test_integration_node",
                    name="offloaded_integration_var",
                    value=build_segment("truncated"),
                    visible=True,
                    node_execution_id=str(uuid.uuid4()),
                )
                offloaded_var.file_id = variable_file.id

                session.add(offloaded_var)
                session.flush()
                session.commit()

                # Test load_variables with both regular and offloaded variables
                # This method should handle the relationship preloading internally
                var_loader = DraftVarLoader(engine=db.engine, app_id=self._test_app_id, tenant_id=self._test_tenant_id)

                variables = var_loader.load_variables(
                    [
                        [SYSTEM_VARIABLE_NODE_ID, "sys_var"],  # Regular variable from setUp
                        ["test_integration_node", "offloaded_integration_var"],  # Offloaded variable
                    ]
                )

                # Verify results
                assert len(variables) == 2

                # Find regular variable
                regular_var = next(v for v in variables if v.selector[0] == SYSTEM_VARIABLE_NODE_ID)
                assert regular_var.id == self._sys_var_id
                assert regular_var.value == "sys_value"

                # Find offloaded variable
                offloaded_loaded_var = next(v for v in variables if v.selector[0] == "test_integration_node")
                assert offloaded_loaded_var.id == offloaded_var.id
                assert offloaded_loaded_var.value == test_content

        finally:
            # Clean up
            with Session(bind=db.engine) as session:
                # Query and delete by ID to ensure they're tracked in this session
                session.query(WorkflowDraftVariable).filter_by(id=offloaded_var.id).delete()
                session.query(WorkflowDraftVariableFile).filter_by(id=variable_file.id).delete()
                session.query(UploadFile).filter_by(id=upload_file.id).delete()
                session.commit()
            # Clean up storage
            try:
                storage.delete(upload_file.key)
            except Exception:
                pass  # Ignore cleanup failures


@pytest.mark.usefixtures("flask_req_ctx")
class TestWorkflowDraftVariableServiceResetVariable(unittest.TestCase):
    """Integration tests for reset_variable functionality using real database"""

    _test_app_id: str
    _test_tenant_id: str
    _test_workflow_id: str
    _session: Session
    _node_id = "test_reset_node"
    _node_exec_id: str
    _workflow_node_exec_id: str

    def setUp(self):
        self._test_app_id = str(uuid.uuid4())
        self._test_tenant_id = str(uuid.uuid4())
        self._test_workflow_id = str(uuid.uuid4())
        self._node_exec_id = str(uuid.uuid4())
        self._workflow_node_exec_id = str(uuid.uuid4())
        self._session: Session = db.session()

        # Create a workflow node execution record with outputs
        # Note: The WorkflowNodeExecutionModel.id should match the node_execution_id in WorkflowDraftVariable
        self._workflow_node_execution = WorkflowNodeExecutionModel(
            id=self._node_exec_id,  # This should match the node_execution_id in the variable
            tenant_id=self._test_tenant_id,
            app_id=self._test_app_id,
            workflow_id=self._test_workflow_id,
            triggered_from="workflow-run",
            workflow_run_id=str(uuid.uuid4()),
            index=1,
            node_execution_id=str(uuid.uuid4()),
            node_id=self._node_id,
            node_type=NodeType.LLM,
            title="Test Node",
            inputs='{"input": "test input"}',
            process_data='{"test_var": "process_value", "other_var": "other_process"}',
            outputs='{"test_var": "output_value", "other_var": "other_output"}',
            status="succeeded",
            elapsed_time=1.5,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
        )

        # Create conversation variables for the workflow
        self._conv_variables = [
            StringVariable(
                id=str(uuid.uuid4()),
                name="conv_var_1",
                description="Test conversation variable 1",
                value="default_value_1",
            ),
            StringVariable(
                id=str(uuid.uuid4()),
                name="conv_var_2",
                description="Test conversation variable 2",
                value="default_value_2",
            ),
        ]

        # Create test variables
        self._node_var_with_exec = WorkflowDraftVariable.new_node_variable(
            app_id=self._test_app_id,
            node_id=self._node_id,
            name="test_var",
            value=build_segment("old_value"),
            node_execution_id=self._node_exec_id,
        )
        self._node_var_with_exec.last_edited_at = datetime_utils.naive_utc_now()

        self._node_var_without_exec = WorkflowDraftVariable.new_node_variable(
            app_id=self._test_app_id,
            node_id=self._node_id,
            name="no_exec_var",
            value=build_segment("some_value"),
            node_execution_id="temp_exec_id",
        )
        # Manually set node_execution_id to None after creation
        self._node_var_without_exec.node_execution_id = None

        self._node_var_missing_exec = WorkflowDraftVariable.new_node_variable(
            app_id=self._test_app_id,
            node_id=self._node_id,
            name="missing_exec_var",
            value=build_segment("some_value"),
            node_execution_id=str(uuid.uuid4()),  # Use a valid UUID that doesn't exist in database
        )

        self._conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=self._test_app_id,
            name="conv_var_1",
            value=build_segment("old_conv_value"),
        )
        self._conv_var.last_edited_at = datetime_utils.naive_utc_now()

        with Session(db.engine, expire_on_commit=False) as persistent_session, persistent_session.begin():
            persistent_session.add(
                self._workflow_node_execution,
            )

        # Add all to database
        db.session.add_all(
            [
                self._node_var_with_exec,
                self._node_var_without_exec,
                self._node_var_missing_exec,
                self._conv_var,
            ]
        )
        db.session.flush()

        # Store IDs for assertions
        self._node_var_with_exec_id = self._node_var_with_exec.id
        self._node_var_without_exec_id = self._node_var_without_exec.id
        self._node_var_missing_exec_id = self._node_var_missing_exec.id
        self._conv_var_id = self._conv_var.id

    def tearDown(self):
        self._session.rollback()
        with Session(db.engine) as session, session.begin():
            stmt = delete(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.id == self._workflow_node_execution.id
            )
            session.execute(stmt)

    def _get_test_srv(self) -> WorkflowDraftVariableService:
        return WorkflowDraftVariableService(session=self._session)

    def _create_mock_workflow(self) -> Workflow:
        """Create a real workflow with conversation variables and graph"""
        conversation_vars = self._conv_variables

        # Create a simple graph with the test node
        graph = {
            "nodes": [{"id": "test_reset_node", "type": "llm", "title": "Test Node", "data": {"type": "llm"}}],
            "edges": [],
        }

        workflow = Workflow.new(
            tenant_id=str(uuid.uuid4()),
            app_id=self._test_app_id,
            type="workflow",
            version="1.0",
            graph=json.dumps(graph),
            features="{}",
            created_by=str(uuid.uuid4()),
            environment_variables=[],
            conversation_variables=conversation_vars,
            rag_pipeline_variables=[],
        )
        return workflow

    def test_reset_node_variable_with_valid_execution_record(self):
        """Test resetting a node variable with valid execution record - should restore from execution"""
        srv = self._get_test_srv()
        mock_workflow = self._create_mock_workflow()

        # Get the variable before reset
        variable = srv.get_variable(self._node_var_with_exec_id)
        assert variable is not None
        assert variable.get_value().value == "old_value"
        assert variable.last_edited_at is not None

        # Reset the variable
        result = srv.reset_variable(mock_workflow, variable)

        # Should return the updated variable
        assert result is not None
        assert result.id == self._node_var_with_exec_id
        assert result.node_execution_id == self._workflow_node_execution.id
        assert result.last_edited_at is None  # Should be reset to None

        # The returned variable should have the updated value from execution record
        assert result.get_value().value == "output_value"

        # Verify the variable was updated in database
        updated_variable = srv.get_variable(self._node_var_with_exec_id)
        assert updated_variable is not None
        # The value should be updated from the execution record's outputs
        assert updated_variable.get_value().value == "output_value"
        assert updated_variable.last_edited_at is None
        assert updated_variable.node_execution_id == self._workflow_node_execution.id

    def test_reset_node_variable_with_no_execution_id(self):
        """Test resetting a node variable with no execution ID - should delete variable"""
        srv = self._get_test_srv()
        mock_workflow = self._create_mock_workflow()

        # Get the variable before reset
        variable = srv.get_variable(self._node_var_without_exec_id)
        assert variable is not None

        # Reset the variable
        result = srv.reset_variable(mock_workflow, variable)

        # Should return None (variable deleted)
        assert result is None

        # Verify the variable was deleted
        deleted_variable = srv.get_variable(self._node_var_without_exec_id)
        assert deleted_variable is None

    def test_reset_node_variable_with_missing_execution_record(self):
        """Test resetting a node variable when execution record doesn't exist"""
        srv = self._get_test_srv()
        mock_workflow = self._create_mock_workflow()

        # Get the variable before reset
        variable = srv.get_variable(self._node_var_missing_exec_id)
        assert variable is not None

        # Reset the variable
        result = srv.reset_variable(mock_workflow, variable)

        # Should return None (variable deleted)
        assert result is None

        # Verify the variable was deleted
        deleted_variable = srv.get_variable(self._node_var_missing_exec_id)
        assert deleted_variable is None

    def test_reset_conversation_variable(self):
        """Test resetting a conversation variable"""
        srv = self._get_test_srv()
        mock_workflow = self._create_mock_workflow()

        # Get the variable before reset
        variable = srv.get_variable(self._conv_var_id)
        assert variable is not None
        assert variable.get_value().value == "old_conv_value"
        assert variable.last_edited_at is not None

        # Reset the variable
        result = srv.reset_variable(mock_workflow, variable)

        # Should return the updated variable
        assert result is not None
        assert result.id == self._conv_var_id
        assert result.last_edited_at is None  # Should be reset to None

        # Verify the variable was updated with default value from workflow
        updated_variable = srv.get_variable(self._conv_var_id)
        assert updated_variable is not None
        # The value should be updated from the workflow's conversation variable default
        assert updated_variable.get_value().value == "default_value_1"
        assert updated_variable.last_edited_at is None

    def test_reset_system_variable_raises_error(self):
        """Test that resetting a system variable raises an error"""
        srv = self._get_test_srv()
        mock_workflow = self._create_mock_workflow()

        # Create a system variable
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=self._test_app_id,
            name="sys_var",
            value=build_segment("sys_value"),
            node_execution_id=self._node_exec_id,
        )
        db.session.add(sys_var)
        db.session.flush()

        # Attempt to reset the system variable
        with pytest.raises(VariableResetError) as exc_info:
            srv.reset_variable(mock_workflow, sys_var)

        assert "cannot reset system variable" in str(exc_info.value)
        assert sys_var.id in str(exc_info.value)
