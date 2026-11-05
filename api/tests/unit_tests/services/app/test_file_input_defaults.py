from copy import deepcopy

import pytest

from dify_graph.variables.input_entities import VariableEntity, VariableEntityType
from services.app.file_input_defaults import apply_file_input_defaults


@pytest.mark.parametrize("cleared", [False, True])
def test_defaults_are_prepared_without_changing_inputs_or_configuration(cleared: bool) -> None:
    editor_file = {
        "transferMethod": "local_file",
        "uploadedId": "00000000-0000-0000-0000-000000000001",
        "supportFileType": "document",
    }
    api_file = {
        "transfer_method": "remote_url",
        "upload_file_id": "00000000-0000-0000-0000-000000000002",
        "type": "document",
        "url": "https://example.com/default.txt",
    }
    variables = [
        VariableEntity(variable="file", label="File", type=VariableEntityType.FILE, default=editor_file),
        VariableEntity(variable="files", label="Files", type=VariableEntityType.FILE_LIST, default=[api_file]),
    ]
    inputs: dict[str, object] = {"file": "", "files": []} if cleared else {"file": None}
    original_inputs = deepcopy(inputs)
    original_variables = deepcopy(variables)

    result = apply_file_input_defaults(inputs, variables)

    if cleared:
        assert result == {"file": "", "files": []}
    else:
        assert result == {
            "file": {
                "type": "document",
                "transfer_method": "local_file",
                "url": "",
                "upload_file_id": editor_file["uploadedId"],
            },
            "files": [api_file],
        }
    assert result is not inputs
    assert inputs == original_inputs
    assert variables == original_variables


def test_omitted_inputs_and_non_file_defaults() -> None:
    variables = [
        VariableEntity(variable="text", label="Text", type=VariableEntityType.TEXT_INPUT, default="hello"),
        VariableEntity(variable="files", label="Files", type=VariableEntityType.FILE_LIST, default=[]),
    ]

    assert apply_file_input_defaults(None, variables) == {}
