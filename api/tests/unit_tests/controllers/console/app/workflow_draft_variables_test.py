import uuid
from collections import OrderedDict
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest
from flask_restx import marshal

from controllers.console.app.workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,
    _serialize_full_content,
)
from core.variables.types import SegmentType
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_APP_ID = "test_app_id"
_TEST_NODE_EXEC_ID = str(uuid.uuid4())


class TestWorkflowDraftVariableFields:
    def test_serialize_full_content(self):
        """Test that _serialize_full_content uses pre-loaded relationships."""
        # Create mock objects with relationships pre-loaded
        mock_variable_file = MagicMock(spec=WorkflowDraftVariableFile)
        mock_variable_file.size = 100000
        mock_variable_file.length = 50
        mock_variable_file.value_type = SegmentType.OBJECT
        mock_variable_file.upload_file_id = "test-upload-file-id"

        mock_variable = MagicMock(spec=WorkflowDraftVariable)
        mock_variable.file_id = "test-file-id"
        mock_variable.variable_file = mock_variable_file

        # Mock the file helpers
        with patch("controllers.console.app.workflow_draft_variable.file_helpers") as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"

            # Call the function
            result = _serialize_full_content(mock_variable)

            # Verify it returns the expected structure
            assert result is not None
            assert result["size_bytes"] == 100000
            assert result["length"] == 50
            assert result["value_type"] == "object"
            assert "download_url" in result
            assert result["download_url"] == "http://example.com/signed-url"

            # Verify it used the pre-loaded relationships (no database queries)
            mock_file_helpers.get_signed_file_url.assert_called_once_with("test-upload-file-id", as_attachment=True)

    def test_serialize_full_content_handles_none_cases(self):
        """Test that _serialize_full_content handles None cases properly."""

        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = None
        result = _serialize_full_content(draft_var)
        assert result is None

    def test_serialize_full_content_should_raises_when_file_id_exists_but_file_is_none(self):
        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = str(uuid.uuid4())
        draft_var.variable_file = None
        with pytest.raises(AssertionError):
            result = _serialize_full_content(draft_var)

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
                "is_truncated": False,
            }
        )

        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = 1
        expected_with_value["full_content"] = None
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
        sys_var.last_edited_at = naive_utc_now()
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
                "is_truncated": False,
            }
        )
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = "a"
        expected_with_value["full_content"] = None
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
        node_var.last_edited_at = naive_utc_now()

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
                "is_truncated": False,
            }
        )

        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = [1, "a"]
        expected_with_value["full_content"] = None
        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_node_variable_with_file(self):
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="node_var",
            value=build_segment([1, "a"]),
            visible=False,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        node_var.id = str(uuid.uuid4())
        node_var.last_edited_at = naive_utc_now()
        variable_file = WorkflowDraftVariableFile(
            id=str(uuidv7()),
            upload_file_id=str(uuid.uuid4()),
            size=1024,
            length=10,
            value_type=SegmentType.ARRAY_STRING,
        )
        node_var.variable_file = variable_file
        node_var.file_id = variable_file.id

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
                "is_truncated": True,
            }
        )

        with patch("controllers.console.app.workflow_draft_variable.file_helpers") as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"
            assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
            expected_with_value = expected_without_value.copy()
            expected_with_value["value"] = [1, "a"]
            expected_with_value["full_content"] = {
                "size_bytes": 1024,
                "value_type": "array[string]",
                "length": 10,
                "download_url": "http://example.com/signed-url",
            }
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
                "is_truncated": False,
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
