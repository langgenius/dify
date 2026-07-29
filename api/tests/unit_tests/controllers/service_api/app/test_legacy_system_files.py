from collections.abc import Mapping
from unittest.mock import MagicMock

from pytest_mock import MockerFixture

from controllers.service_api.app.legacy_system_files import (
    attach_legacy_system_file_warning_for_service_api,
    normalize_legacy_system_file_args_for_service_api,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from services.app_generate_service import AppGenerateService

_LEGACY_FILE_TEMPLATE = "{{#" + ".".join(("sys", "files")) + "#}}"
_USER_INPUT_FILE_INPUT_KEY = ".".join(("userinput", "files"))


def _legacy_file_graph() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "answer", "data": {"type": "answer", "answer": _LEGACY_FILE_TEMPLATE}},
        ]
    }


def test_hidden_service_api_file_payload_maps_to_userinput_files(mocker: MockerFixture) -> None:
    workflow = MagicMock()
    workflow.graph_dict = _legacy_file_graph()
    get_workflow = mocker.patch.object(AppGenerateService, "get_workflow", return_value=workflow)
    app_model = MagicMock()
    session = MagicMock()
    files = [{"transfer_method": "remote_url", "url": "https://example.com/a.png"}]

    args, compat_variable = normalize_legacy_system_file_args_for_service_api(
        session=session,
        app_model=app_model,
        args={"inputs": {}, "files": None},
        raw_payload={"system": {"files": files}},
    )

    get_workflow.assert_called_once_with(app_model, InvokeFrom.SERVICE_API, None, session=session)
    assert compat_variable is not None
    assert args["files"] == files
    assert args["inputs"][_USER_INPUT_FILE_INPUT_KEY] == files


def test_service_api_file_payload_is_ignored_when_absent(mocker: MockerFixture) -> None:
    get_workflow = mocker.patch.object(AppGenerateService, "get_workflow")
    app_model = MagicMock()
    original_args = {"inputs": {"existing": "value"}}

    args, compat_variable = normalize_legacy_system_file_args_for_service_api(
        session=MagicMock(),
        app_model=app_model,
        args=original_args,
        raw_payload={},
    )

    assert args is original_args
    assert compat_variable is None
    get_workflow.assert_not_called()


def test_top_level_service_api_file_payload_still_checks_workflow_graph(mocker: MockerFixture) -> None:
    workflow = MagicMock()
    workflow.graph_dict = {"nodes": [{"data": {"type": "answer", "answer": "no legacy file"}}]}
    get_workflow = mocker.patch.object(AppGenerateService, "get_workflow", return_value=workflow)
    app_model = MagicMock()
    session = MagicMock()
    files = [{"id": "file-1"}]

    args, compat_variable = normalize_legacy_system_file_args_for_service_api(
        session=session,
        app_model=app_model,
        args={"inputs": {}, "files": files},
        raw_payload={},
    )

    get_workflow.assert_called_once_with(app_model, InvokeFrom.SERVICE_API, None, session=session)
    assert args["files"] == files
    assert compat_variable is None


def test_service_api_warning_is_attached_only_when_compatibility_was_used() -> None:
    compat_variable = MagicMock(node_id="userinput", variable_name="files")

    response = attach_legacy_system_file_warning_for_service_api({"answer": "ok"}, compat_variable)
    response_without_warning = attach_legacy_system_file_warning_for_service_api({"answer": "ok"}, None)

    assert isinstance(response, Mapping)
    assert response["warnings"]
    assert response_without_warning == {"answer": "ok"}
