from unittest.mock import MagicMock

import pytest

from core.file import File, FileTransferMethod, FileType
from core.variables import ArrayFileSegment
from core.workflow.nodes.list_operator.entities import (
    ExtractConfig,
    FilterBy,
    FilterCondition,
    Limit,
    ListOperatorNodeData,
    OrderBy,
)
from core.workflow.nodes.list_operator.exc import InvalidKeyError
from core.workflow.nodes.list_operator.node import ListOperatorNode, _get_file_extract_string_func
from models.workflow import WorkflowNodeExecutionStatus


@pytest.fixture
def list_operator_node():
    config = {
        "variable": ["test_variable"],
        "filter_by": FilterBy(
            enabled=True,
            conditions=[
                FilterCondition(key="type", comparison_operator="in", value=[FileType.IMAGE, FileType.DOCUMENT])
            ],
        ),
        "order_by": OrderBy(enabled=False, value="asc"),
        "limit": Limit(enabled=False, size=0),
        "extract_by": ExtractConfig(enabled=False, serial="1"),
        "title": "Test Title",
    }
    node_data = ListOperatorNodeData(**config)
    node = ListOperatorNode(
        id="test_node_id",
        config={
            "id": "test_node_id",
            "data": node_data.model_dump(),
        },
        graph_init_params=MagicMock(),
        graph=MagicMock(),
        graph_runtime_state=MagicMock(),
    )
    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.variable_pool = MagicMock()
    return node


def test_filter_files_by_type(list_operator_node):
    # Setup test data
    files = [
        File(
            filename="image1.jpg",
            type=FileType.IMAGE,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related1",
        ),
        File(
            filename="document1.pdf",
            type=FileType.DOCUMENT,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related2",
        ),
        File(
            filename="image2.png",
            type=FileType.IMAGE,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related3",
        ),
        File(
            filename="audio1.mp3",
            type=FileType.AUDIO,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related4",
        ),
    ]
    variable = ArrayFileSegment(value=files)
    list_operator_node.graph_runtime_state.variable_pool.get.return_value = variable

    # Run the node
    result = list_operator_node._run()

    # Verify the result
    expected_files = [
        {
            "filename": "image1.jpg",
            "type": FileType.IMAGE,
            "tenant_id": "tenant1",
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "related1",
        },
        {
            "filename": "document1.pdf",
            "type": FileType.DOCUMENT,
            "tenant_id": "tenant1",
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "related2",
        },
        {
            "filename": "image2.png",
            "type": FileType.IMAGE,
            "tenant_id": "tenant1",
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "related3",
        },
    ]
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    for expected_file, result_file in zip(expected_files, result.outputs["result"]):
        assert expected_file["filename"] == result_file.filename
        assert expected_file["type"] == result_file.type
        assert expected_file["tenant_id"] == result_file.tenant_id
        assert expected_file["transfer_method"] == result_file.transfer_method
        assert expected_file["related_id"] == result_file.related_id


def test_get_file_extract_string_func():
    # Create a File object
    file = File(
        tenant_id="test_tenant",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        filename="test_file.txt",
        extension=".txt",
        mime_type="text/plain",
        remote_url="https://example.com/test_file.txt",
        related_id="test_related_id",
    )

    # Test each case
    assert _get_file_extract_string_func(key="name")(file) == "test_file.txt"
    assert _get_file_extract_string_func(key="type")(file) == "document"
    assert _get_file_extract_string_func(key="extension")(file) == ".txt"
    assert _get_file_extract_string_func(key="mime_type")(file) == "text/plain"
    assert _get_file_extract_string_func(key="transfer_method")(file) == "local_file"
    assert _get_file_extract_string_func(key="url")(file) == "https://example.com/test_file.txt"

    # Test with empty values
    empty_file = File(
        tenant_id="test_tenant",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        filename=None,
        extension=None,
        mime_type=None,
        remote_url=None,
        related_id="test_related_id",
    )

    assert _get_file_extract_string_func(key="name")(empty_file) == ""
    assert _get_file_extract_string_func(key="extension")(empty_file) == ""
    assert _get_file_extract_string_func(key="mime_type")(empty_file) == ""
    assert _get_file_extract_string_func(key="url")(empty_file) == ""

    # Test invalid key
    with pytest.raises(InvalidKeyError):
        _get_file_extract_string_func(key="invalid_key")
