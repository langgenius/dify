import pytest

from core.file import File, FileTransferMethod, FileType
from core.variables import FileSegment, StringSegment
from core.workflow.entities.variable_pool import VariablePool


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
