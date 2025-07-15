import dataclasses
import json
from unittest import mock
from uuid import uuid4

from constants import HIDDEN_VALUE
from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable
from core.variables.segments import IntegerSegment, Segment
from factories.variable_factory import build_segment
from models.model import EndUser
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowNodeExecutionModel, is_system_variable_editable


def test_environment_variables():
    # tenant_id context variable removed - using current_user.current_tenant_id directly

    # Create a Workflow instance
    workflow = Workflow(
        tenant_id="tenant_id",
        app_id="app_id",
        type="workflow",
        version="draft",
        graph="{}",
        features="{}",
        created_by="account_id",
        environment_variables=[],
        conversation_variables=[],
    )

    # Create some EnvironmentVariable instances
    variable1 = StringVariable.model_validate(
        {"name": "var1", "value": "value1", "id": str(uuid4()), "selector": ["env", "var1"]}
    )
    variable2 = IntegerVariable.model_validate(
        {"name": "var2", "value": 123, "id": str(uuid4()), "selector": ["env", "var2"]}
    )
    variable3 = SecretVariable.model_validate(
        {"name": "var3", "value": "secret", "id": str(uuid4()), "selector": ["env", "var3"]}
    )
    variable4 = FloatVariable.model_validate(
        {"name": "var4", "value": 3.14, "id": str(uuid4()), "selector": ["env", "var4"]}
    )

    # Mock current_user as an EndUser
    mock_user = mock.Mock(spec=EndUser)
    mock_user.tenant_id = "tenant_id"

    with (
        mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
        mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        mock.patch("models.workflow.current_user", mock_user),
    ):
        # Set the environment_variables property of the Workflow instance
        variables = [variable1, variable2, variable3, variable4]
        workflow.environment_variables = variables

        # Get the environment_variables property and assert its value
        assert workflow.environment_variables == variables


def test_update_environment_variables():
    # tenant_id context variable removed - using current_user.current_tenant_id directly

    # Create a Workflow instance
    workflow = Workflow(
        tenant_id="tenant_id",
        app_id="app_id",
        type="workflow",
        version="draft",
        graph="{}",
        features="{}",
        created_by="account_id",
        environment_variables=[],
        conversation_variables=[],
    )

    # Create some EnvironmentVariable instances
    variable1 = StringVariable.model_validate(
        {"name": "var1", "value": "value1", "id": str(uuid4()), "selector": ["env", "var1"]}
    )
    variable2 = IntegerVariable.model_validate(
        {"name": "var2", "value": 123, "id": str(uuid4()), "selector": ["env", "var2"]}
    )
    variable3 = SecretVariable.model_validate(
        {"name": "var3", "value": "secret", "id": str(uuid4()), "selector": ["env", "var3"]}
    )
    variable4 = FloatVariable.model_validate(
        {"name": "var4", "value": 3.14, "id": str(uuid4()), "selector": ["env", "var4"]}
    )

    # Mock current_user as an EndUser
    mock_user = mock.Mock(spec=EndUser)
    mock_user.tenant_id = "tenant_id"

    with (
        mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
        mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        mock.patch("models.workflow.current_user", mock_user),
    ):
        variables = [variable1, variable2, variable3, variable4]

        # Set the environment_variables property of the Workflow instance
        workflow.environment_variables = variables
        assert workflow.environment_variables == [variable1, variable2, variable3, variable4]

        # Update the name of variable3 and keep the value as it is
        variables[2] = variable3.model_copy(
            update={
                "name": "new name",
                "value": HIDDEN_VALUE,
            }
        )

        workflow.environment_variables = variables
        assert workflow.environment_variables[2].name == "new name"
        assert workflow.environment_variables[2].value == variable3.value


def test_to_dict():
    # tenant_id context variable removed - using current_user.current_tenant_id directly

    # Create a Workflow instance
    workflow = Workflow(
        tenant_id="tenant_id",
        app_id="app_id",
        type="workflow",
        version="draft",
        graph="{}",
        features="{}",
        created_by="account_id",
        environment_variables=[],
        conversation_variables=[],
    )

    # Create some EnvironmentVariable instances

    # Mock current_user as an EndUser
    mock_user = mock.Mock(spec=EndUser)
    mock_user.tenant_id = "tenant_id"

    with (
        mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
        mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        mock.patch("models.workflow.current_user", mock_user),
    ):
        # Set the environment_variables property of the Workflow instance
        workflow.environment_variables = [
            SecretVariable.model_validate({"name": "secret", "value": "secret", "id": str(uuid4())}),
            StringVariable.model_validate({"name": "text", "value": "text", "id": str(uuid4())}),
        ]

        workflow_dict = workflow.to_dict()
        assert workflow_dict["environment_variables"][0]["value"] == ""
        assert workflow_dict["environment_variables"][1]["value"] == "text"

        workflow_dict = workflow.to_dict(include_secret=True)
        assert workflow_dict["environment_variables"][0]["value"] == "secret"
        assert workflow_dict["environment_variables"][1]["value"] == "text"


class TestWorkflowNodeExecution:
    def test_execution_metadata_dict(self):
        node_exec = WorkflowNodeExecutionModel()
        node_exec.execution_metadata = None
        assert node_exec.execution_metadata_dict == {}

        original = {"a": 1, "b": ["2"]}
        node_exec.execution_metadata = json.dumps(original)
        assert node_exec.execution_metadata_dict == original


class TestIsSystemVariableEditable:
    def test_is_system_variable(self):
        cases = [
            ("query", True),
            ("files", True),
            ("dialogue_count", False),
            ("conversation_id", False),
            ("user_id", False),
            ("app_id", False),
            ("workflow_id", False),
            ("workflow_run_id", False),
        ]
        for name, editable in cases:
            assert editable == is_system_variable_editable(name)

        assert is_system_variable_editable("invalid_or_new_system_variable") == False


class TestWorkflowDraftVariableGetValue:
    def test_get_value_by_case(self):
        @dataclasses.dataclass
        class TestCase:
            name: str
            value: Segment

        tenant_id = "test_tenant_id"

        test_file = File(
            tenant_id=tenant_id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/example.jpg",
            filename="example.jpg",
            extension=".jpg",
            mime_type="image/jpeg",
            size=100,
        )
        cases: list[TestCase] = [
            TestCase(
                name="number/int",
                value=build_segment(1),
            ),
            TestCase(
                name="number/float",
                value=build_segment(1.0),
            ),
            TestCase(
                name="string",
                value=build_segment("a"),
            ),
            TestCase(
                name="object",
                value=build_segment({}),
            ),
            TestCase(
                name="file",
                value=build_segment(test_file),
            ),
            TestCase(
                name="array[any]",
                value=build_segment([1, "a"]),
            ),
            TestCase(
                name="array[string]",
                value=build_segment(["a", "b"]),
            ),
            TestCase(
                name="array[number]/int",
                value=build_segment([1, 2]),
            ),
            TestCase(
                name="array[number]/float",
                value=build_segment([1.0, 2.0]),
            ),
            TestCase(
                name="array[number]/mixed",
                value=build_segment([1, 2.0]),
            ),
            TestCase(
                name="array[object]",
                value=build_segment([{}, {"a": 1}]),
            ),
            TestCase(
                name="none",
                value=build_segment(None),
            ),
        ]

        for idx, c in enumerate(cases, 1):
            fail_msg = f"test case {c.name} failed, index={idx}"
            draft_var = WorkflowDraftVariable()
            draft_var.set_value(c.value)
            assert c.value == draft_var.get_value(), fail_msg

    def test_file_variable_preserves_all_fields(self):
        """Test that File type variables preserve all fields during encoding/decoding."""
        tenant_id = "test_tenant_id"

        # Create a File with specific field values
        test_file = File(
            id="test_file_id",
            tenant_id=tenant_id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/test.jpg",
            filename="test.jpg",
            extension=".jpg",
            mime_type="image/jpeg",
            size=12345,  # Specific size to test preservation
            storage_key="test_storage_key",
        )

        # Create a FileSegment and WorkflowDraftVariable
        file_segment = build_segment(test_file)
        draft_var = WorkflowDraftVariable()
        draft_var.set_value(file_segment)

        # Retrieve the value and verify all fields are preserved
        retrieved_segment = draft_var.get_value()
        retrieved_file = retrieved_segment.value

        # Verify all important fields are preserved
        assert retrieved_file.id == test_file.id
        assert retrieved_file.tenant_id == test_file.tenant_id
        assert retrieved_file.type == test_file.type
        assert retrieved_file.transfer_method == test_file.transfer_method
        assert retrieved_file.remote_url == test_file.remote_url
        assert retrieved_file.filename == test_file.filename
        assert retrieved_file.extension == test_file.extension
        assert retrieved_file.mime_type == test_file.mime_type
        assert retrieved_file.size == test_file.size  # This was the main issue being fixed
        # Note: storage_key is not serialized in model_dump() so it won't be preserved

        # Verify the segments have the same type and the important fields match
        assert file_segment.value_type == retrieved_segment.value_type

    def test_get_and_set_value(self):
        draft_var = WorkflowDraftVariable()
        int_var = IntegerSegment(value=1)
        draft_var.set_value(int_var)
        value = draft_var.get_value()
        assert value == int_var
