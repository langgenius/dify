from unittest.mock import MagicMock

import pytest

from core.file import File
from core.file.models import FileTransferMethod, FileType
from core.variables import ArrayFileSegment
from core.workflow.nodes.list_operator.entities import FilterBy, FilterCondition, Limit, ListOperatorNodeData, OrderBy
from core.workflow.nodes.list_operator.node import ListOperatorNode
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
