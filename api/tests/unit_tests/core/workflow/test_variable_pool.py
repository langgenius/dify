import pytest
from pydantic import ValidationError

from core.file import File, FileTransferMethod, FileType
from core.variables import FileSegment, StringSegment
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from factories.variable_factory import build_segment, segment_to_variable


@pytest.fixture
def pool():
    return VariablePool(system_variables={}, user_inputs={})


@pytest.fixture
def file():
    return File(
        tenant_id="test_tenant_id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test_related_id",
        remote_url="test_url",
        filename="test_file.txt",
        storage_key="",
    )


def test_get_file_attribute(pool, file):
    # Add a FileSegment to the pool
    pool.add(("node_1", "file_var"), FileSegment(value=file))

    # Test getting the 'name' attribute of the file
    result = pool.get(("node_1", "file_var", "name"))

    assert result is not None
    assert result.value == file.filename

    # Test getting a non-existent attribute
    result = pool.get(("node_1", "file_var", "non_existent_attr"))
    assert result is None


def test_use_long_selector(pool):
    pool.add(("node_1", "part_1", "part_2"), StringSegment(value="test_value"))

    result = pool.get(("node_1", "part_1", "part_2"))
    assert result is not None
    assert result.value == "test_value"


class TestVariablePool:
    def test_constructor(self):
        pool = VariablePool()
        pool = VariablePool(
            variable_dictionary={},
            user_inputs={},
            system_variables={},
            environment_variables=[],
            conversation_variables=[],
        )

        pool = VariablePool(
            user_inputs={"key": "value"},
            system_variables={SystemVariableKey.WORKFLOW_ID: "test_workflow_id"},
            environment_variables=[
                segment_to_variable(
                    segment=build_segment(1),
                    selector=[ENVIRONMENT_VARIABLE_NODE_ID, "env_var_1"],
                    name="env_var_1",
                )
            ],
            conversation_variables=[
                segment_to_variable(
                    segment=build_segment("1"),
                    selector=[CONVERSATION_VARIABLE_NODE_ID, "conv_var_1"],
                    name="conv_var_1",
                )
            ],
        )

    def test_constructor_with_invalid_system_variable_key(self):
        with pytest.raises(ValidationError):
            VariablePool(system_variables={"invalid_key": "value"})  # type: ignore
