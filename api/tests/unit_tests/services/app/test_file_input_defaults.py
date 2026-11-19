from copy import deepcopy

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from graphon.variables.input_entities import VariableEntity, VariableEntityType
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
    scope = FileAccessScope(
        tenant_id="tenant-1",
        user_id="end-user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.SERVICE_API,
    )

    with bind_file_access_scope(scope):
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
        current_scope = get_current_file_access_scope()
        assert current_scope is not None
        assert current_scope.granted_upload_file_ids == {editor_file["uploadedId"], api_file["upload_file_id"]}

    assert result is not inputs
    assert inputs == original_inputs
    assert variables == original_variables
    assert get_current_file_access_scope() is None
