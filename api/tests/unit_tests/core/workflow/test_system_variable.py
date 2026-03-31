from types import SimpleNamespace

from graphon.file import File, FileTransferMethod, FileType
from graphon.nodes import BuiltinNodeTypes

from core.workflow.system_variables import (
    build_system_variables,
    default_system_variables,
    get_node_creation_preload_selectors,
    system_variables_to_mapping,
)


def test_build_system_variables_normalizes_workflow_execution_id():
    system_variables = build_system_variables(
        user_id="user-id",
        workflow_execution_id="run-id",
        query="hello",
        ignored=None,
    )
    system_values = system_variables_to_mapping(system_variables)

    assert system_values == {
        "user_id": "user-id",
        "workflow_run_id": "run-id",
        "query": "hello",
        "files": [],
    }


def test_build_system_variables_preserves_explicit_workflow_run_id():
    system_variables = build_system_variables(
        workflow_run_id="explicit-run-id",
        workflow_execution_id="ignored-run-id",
    )
    system_values = system_variables_to_mapping(system_variables)

    assert system_values["workflow_run_id"] == "explicit-run-id"
    assert system_values["files"] == []


def test_build_system_variables_preserves_file_values():
    file = File(
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="file-id",
        filename="test.txt",
        extension=".txt",
        mime_type="text/plain",
        size=1,
        storage_key="storage-key",
    )

    system_variables = build_system_variables(files=[file])
    system_values = system_variables_to_mapping(system_variables)

    assert system_values["files"] == [file]


def test_default_system_variables_generates_workflow_run_id():
    system_variables = default_system_variables()
    system_values = system_variables_to_mapping(system_variables)

    assert isinstance(system_values["workflow_run_id"], str)
    assert system_values["workflow_run_id"]
    assert system_values["files"] == []


def test_get_node_creation_preload_selectors_requires_conversation_for_memory_nodes():
    selectors = get_node_creation_preload_selectors(
        node_type=BuiltinNodeTypes.QUESTION_CLASSIFIER,
        node_data=SimpleNamespace(memory=object()),
    )

    assert selectors == (("sys", "conversation_id"),)


def test_get_node_creation_preload_selectors_skips_non_memory_nodes():
    selectors = get_node_creation_preload_selectors(
        node_type=BuiltinNodeTypes.START,
        node_data=SimpleNamespace(memory=None),
    )

    assert selectors == ()
