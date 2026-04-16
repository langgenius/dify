from unittest.mock import MagicMock

import pytest
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.nodes.list_operator.entities import (
    ExtractConfig,
    FilterBy,
    FilterCondition,
    Limit,
    ListOperatorNodeData,
    Order,
    OrderByConfig,
)
from graphon.nodes.list_operator.exc import InvalidKeyError
from graphon.nodes.list_operator.node import ListOperatorNode, _get_file_extract_string_func
from graphon.variables import ArrayFileSegment

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom


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
        "order_by": OrderByConfig(enabled=False, value=Order.ASC),
        "limit": Limit(enabled=False, size=0),
        "extract_by": ExtractConfig(enabled=False, serial="1"),
        "title": "Test Title",
    }
    node_data = ListOperatorNodeData.model_validate(config)
    node_config = {
        "id": "test_node_id",
        "data": node_data.model_dump(),
    }
    # Create properly configured mock for graph_init_params
    graph_init_params = MagicMock()
    graph_init_params.workflow_id = "test_workflow"
    graph_init_params.graph_config = {}
    graph_init_params.call_depth = 0
    graph_init_params.run_context = {
        DIFY_RUN_CONTEXT_KEY: {
            "tenant_id": "test_tenant",
            "app_id": "test_app",
            "user_id": "test_user",
            "user_from": UserFrom.ACCOUNT,
            "invoke_from": InvokeFrom.SERVICE_API,
        }
    }

    node = ListOperatorNode(
        id="test_node_id",
        config=node_config,
        graph_init_params=graph_init_params,
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
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related1",
            storage_key="",
        ),
        File(
            filename="document1.pdf",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related2",
            storage_key="",
        ),
        File(
            filename="image2.png",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related3",
            storage_key="",
        ),
        File(
            filename="audio1.mp3",
            type=FileType.AUDIO,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related4",
            storage_key="",
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
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "related2",
        },
        {
            "filename": "image2.png",
            "type": FileType.IMAGE,
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "related_id": "related3",
        },
    ]
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    for expected_file, result_file in zip(expected_files, result.outputs["result"].value):
        assert expected_file["filename"] == result_file.filename
        assert expected_file["type"] == result_file.type
        assert expected_file["transfer_method"] == result_file.transfer_method
        assert expected_file["related_id"] == result_file.related_id


def test_get_file_extract_string_func():
    # Create a File object
    file = File(
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        filename="test_file.txt",
        extension=".txt",
        mime_type="text/plain",
        remote_url="https://example.com/test_file.txt",
        related_id="test_related_id",
        storage_key="",
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
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        filename=None,
        extension=None,
        mime_type=None,
        remote_url=None,
        related_id="test_related_id",
        storage_key="",
    )

    assert _get_file_extract_string_func(key="name")(empty_file) == ""
    assert _get_file_extract_string_func(key="extension")(empty_file) == ""
    assert _get_file_extract_string_func(key="mime_type")(empty_file) == ""
    assert _get_file_extract_string_func(key="url")(empty_file) == ""

    # Test invalid key
    with pytest.raises(InvalidKeyError):
        _get_file_extract_string_func(key="invalid_key")
