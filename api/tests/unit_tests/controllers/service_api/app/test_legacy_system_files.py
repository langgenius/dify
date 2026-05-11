from unittest.mock import MagicMock

from controllers.service_api.app.legacy_system_files import (
    attach_legacy_system_file_warning_for_service_api,
    normalize_legacy_system_file_args_for_service_api,
)
from services.app_generate_service import AppGenerateService

_LEGACY_FILE_TEMPLATE = "{{#" + ".".join(("sys", "files")) + "#}}"


def _legacy_file_graph() -> dict:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {"id": "answer", "data": {"type": "answer", "answer": _LEGACY_FILE_TEMPLATE}},
        ],
        "edges": [],
    }


def test_hidden_service_api_file_payload_maps_to_generated_start_input(mocker):
    workflow = MagicMock()
    workflow.graph_dict = _legacy_file_graph()
    get_workflow = mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
    app_model = MagicMock()
    files = [{"transfer_method": "remote_url", "url": "https://example.com/a.png"}]

    args, compat_variable = normalize_legacy_system_file_args_for_service_api(
        app_model=app_model,
        args={"inputs": {}},
        raw_payload={"system": {"files": files}},
    )

    get_workflow.assert_called_once()
    assert compat_variable is not None
    assert args["files"] == files
    assert args["inputs"][compat_variable.variable_name] == files


def test_service_api_warning_is_attached_only_when_compatibility_was_used():
    compat_variable = MagicMock(variable_name="generated_files_input")

    response = attach_legacy_system_file_warning_for_service_api({"answer": "ok"}, compat_variable)
    response_without_warning = attach_legacy_system_file_warning_for_service_api({"answer": "ok"}, None)

    assert response["warnings"]
    assert response_without_warning == {"answer": "ok"}
