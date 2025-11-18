from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileTransferMethod, FileType
from core.variables import ArrayFileSegment
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.list_operator.entities import (
    ExtractConfig,
    FilterBy,
    FilterCondition,
    Limit,
    ListOperatorNodeData,
    Order,
    OrderByConfig,
)
from core.workflow.nodes.list_operator.exc import InvalidKeyError
from core.workflow.nodes.list_operator.node import (
    ListOperatorNode,
    _get_file_extract_string_func,
    _get_file_filter_func,
    _order_file,
)
from models.enums import UserFrom


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
    graph_init_params.tenant_id = "test_tenant"
    graph_init_params.app_id = "test_app"
    graph_init_params.workflow_id = "test_workflow"
    graph_init_params.graph_config = {}
    graph_init_params.user_id = "test_user"
    graph_init_params.user_from = UserFrom.ACCOUNT
    graph_init_params.invoke_from = InvokeFrom.SERVICE_API
    graph_init_params.call_depth = 0

    node = ListOperatorNode(
        id="test_node_id",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=MagicMock(),
    )
    # Initialize node data
    node.init_node_data(node_config["data"])
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
            storage_key="",
        ),
        File(
            filename="document1.pdf",
            type=FileType.DOCUMENT,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related2",
            storage_key="",
        ),
        File(
            filename="image2.png",
            type=FileType.IMAGE,
            tenant_id="tenant1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related3",
            storage_key="",
        ),
        File(
            filename="audio1.mp3",
            type=FileType.AUDIO,
            tenant_id="tenant1",
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
    for expected_file, result_file in zip(expected_files, result.outputs["result"].value):
        assert expected_file["filename"] == result_file.filename
        assert expected_file["type"] == result_file.type
        assert expected_file["tenant_id"] == result_file.tenant_id
        assert expected_file["transfer_method"] == result_file.transfer_method
        assert expected_file["related_id"] == result_file.related_id


def test_get_file_extract_string_func(monkeypatch):
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
        storage_key="",
    )

    # Test each case
    assert _get_file_extract_string_func(key="name")(file) == "test_file.txt"
    assert _get_file_extract_string_func(key="type")(file) == "document"
    assert _get_file_extract_string_func(key="extension")(file) == ".txt"
    assert _get_file_extract_string_func(key="mime_type")(file) == "text/plain"
    assert _get_file_extract_string_func(key="transfer_method")(file) == "local_file"

    # Make URL extraction deterministic
    mock_generate = MagicMock(return_value="mocked-url-1")
    monkeypatch.setattr(File, "generate_url", mock_generate)
    extractor_url = _get_file_extract_string_func(key="url")
    assert extractor_url(file) == "mocked-url-1"
    assert mock_generate.call_count == 1

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
        storage_key="",
    )

    assert _get_file_extract_string_func(key="name")(empty_file) == ""
    assert _get_file_extract_string_func(key="extension")(empty_file) == ""
    assert _get_file_extract_string_func(key="mime_type")(empty_file) == ""
    assert extractor_url(empty_file) == "mocked-url-1"
    assert mock_generate.call_count == 2

    # Test invalid key
    with pytest.raises(InvalidKeyError):
        _get_file_extract_string_func(key="invalid_key")


def test_get_file_extract_string_func_related_id():
    file = File(
        tenant_id="tenant",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="rel-123",
        storage_key="",
    )
    extractor = _get_file_extract_string_func(key="related_id")
    assert extractor(file) == "rel-123"


def test_get_file_extract_string_func_url_calls_generate_url(monkeypatch):
    file = File(
        tenant_id="tenant",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="rel-456",
        storage_key="",
    )
    # Patch method on the class to ensure it's called
    mock_generate = MagicMock(return_value="mocked-url")
    monkeypatch.setattr(File, "generate_url", mock_generate)
    extractor = _get_file_extract_string_func(key="url")
    assert extractor(file) == "mocked-url"
    mock_generate.assert_called_once_with()


def test_get_file_filter_func_by_related_id():
    files = [
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="a-1",
            storage_key="",
        ),
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="b-2",
            storage_key="",
        ),
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="a-3",
            storage_key="",
        ),
    ]

    # Filter by exact related_id
    filter_func = _get_file_filter_func(key="related_id", condition="is", value="b-2")
    filtered = list(filter(filter_func, files))
    assert len(filtered) == 1
    assert filtered[0].related_id == "b-2"

    # Also verify contains works
    contains_func = _get_file_filter_func(key="related_id", condition="contains", value="a-")
    contains_filtered = list(filter(contains_func, files))
    assert [f.related_id for f in contains_filtered] == ["a-1", "a-3"]


def test_order_file_by_related_id():
    files = [
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="b",
            storage_key="",
        ),
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="a",
            storage_key="",
        ),
        File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="c",
            storage_key="",
        ),
    ]

    asc = _order_file(order=Order.ASC, order_by="related_id", array=files)
    assert [f.related_id for f in asc] == ["a", "b", "c"]

    desc = _order_file(order=Order.DESC, order_by="related_id", array=files)
    assert [f.related_id for f in desc] == ["c", "b", "a"]
