import datetime
import uuid
from collections import OrderedDict
from typing import Any, NamedTuple

from flask_restful import marshal

from controllers.console.app.workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,
)
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_APP_ID = "test_app_id"
_TEST_NODE_EXEC_ID = str(uuid.uuid4())


class TestWorkflowDraftVariableFields:
    def test_conversation_variable(self):
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
        )

        conv_var.id = str(uuid.uuid4())
        conv_var.visible = True

        expected_without_value: OrderedDict[str, Any] = OrderedDict(
            {
                "id": str(conv_var.id),
                "type": conv_var.get_variable_type().value,
                "name": "conv_var",
                "description": "",
                "selector": [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
                "value_type": "number",
                "edited": False,
                "visible": True,
            }
        )

        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = 1
        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_create_sys_variable(self):
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=_TEST_APP_ID,
            name="sys_var",
            value=build_segment("a"),
            editable=True,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        sys_var.id = str(uuid.uuid4())
        sys_var.last_edited_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        sys_var.visible = True

        expected_without_value = OrderedDict(
            {
                "id": str(sys_var.id),
                "type": sys_var.get_variable_type().value,
                "name": "sys_var",
                "description": "",
                "selector": [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
                "value_type": "string",
                "edited": True,
                "visible": True,
            }
        )
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = "a"
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_node_variable(self):
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="node_var",
            value=build_segment([1, "a"]),
            visible=False,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        node_var.id = str(uuid.uuid4())
        node_var.last_edited_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

        expected_without_value: OrderedDict[str, Any] = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "node_var",
                "description": "",
                "selector": ["test_node", "node_var"],
                "value_type": "array[any]",
                "edited": True,
                "visible": False,
            }
        )

        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = [1, "a"]
        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value


class TestWorkflowDraftVariableList:
    def test_workflow_draft_variable_list(self):
        class TestCase(NamedTuple):
            name: str
            var_list: WorkflowDraftVariableList
            expected: dict

        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="test_var",
            value=build_segment("a"),
            visible=True,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )
        node_var.id = str(uuid.uuid4())
        node_var_dict = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "test_var",
                "description": "",
                "selector": ["test_node", "test_var"],
                "value_type": "string",
                "edited": False,
                "visible": True,
            }
        )

        cases = [
            TestCase(
                name="empty variable list",
                var_list=WorkflowDraftVariableList(variables=[]),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[], total=10),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": 10,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=None),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=10),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": 10,
                    }
                ),
            ),
        ]

        for idx, case in enumerate(cases, 1):
            assert marshal(case.var_list, _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS) == case.expected, (
                f"Test case {idx} failed, {case.name=}"
            )


def test_workflow_node_variables_fields():
    conv_var = WorkflowDraftVariable.new_conversation_variable(
        app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
    )
    resp = marshal(WorkflowDraftVariableList(variables=[conv_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "conv_var"
    assert item_dict["value"] == 1


def test_workflow_file_variable_with_signed_url():
    """Test that File type variables include signed URLs in API responses."""
    from core.file.enums import FileTransferMethod, FileType
    from core.file.models import File

    # Create a File object with LOCAL_FILE transfer method (which generates signed URLs)
    test_file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test_upload_file_id",
        filename="test.jpg",
        extension=".jpg",
        mime_type="image/jpeg",
        size=12345,
    )

    # Create a WorkflowDraftVariable with the File
    file_var = WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_APP_ID,
        node_id="test_node",
        name="file_var",
        value=build_segment(test_file),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )

    # Marshal the variable using the API fields
    resp = marshal(WorkflowDraftVariableList(variables=[file_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)

    # Verify the response structure
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "file_var"

    # Verify the value is a dict (File.to_dict() result) and contains expected fields
    value = item_dict["value"]
    assert isinstance(value, dict)

    # Verify the File fields are preserved
    assert value["id"] == test_file.id
    assert value["filename"] == test_file.filename
    assert value["type"] == test_file.type.value
    assert value["transfer_method"] == test_file.transfer_method.value
    assert value["size"] == test_file.size

    # Verify the URL is present (it should be a signed URL for LOCAL_FILE transfer method)
    remote_url = value["remote_url"]
    assert remote_url is not None

    assert isinstance(remote_url, str)
    # For LOCAL_FILE, the URL should contain signature parameters
    assert "timestamp=" in remote_url
    assert "nonce=" in remote_url
    assert "sign=" in remote_url


def test_workflow_file_variable_remote_url():
    """Test that File type variables with REMOTE_URL transfer method return the remote URL."""
    from core.file.enums import FileTransferMethod, FileType
    from core.file.models import File

    # Create a File object with REMOTE_URL transfer method
    test_file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/test.jpg",
        filename="test.jpg",
        extension=".jpg",
        mime_type="image/jpeg",
        size=12345,
    )

    # Create a WorkflowDraftVariable with the File
    file_var = WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_APP_ID,
        node_id="test_node",
        name="file_var",
        value=build_segment(test_file),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )

    # Marshal the variable using the API fields
    resp = marshal(WorkflowDraftVariableList(variables=[file_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)

    # Verify the response structure
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "file_var"

    # Verify the value is a dict (File.to_dict() result) and contains expected fields
    value = item_dict["value"]
    assert isinstance(value, dict)
    remote_url = value["remote_url"]

    # For REMOTE_URL, the URL should be the original remote URL
    assert remote_url == test_file.remote_url
