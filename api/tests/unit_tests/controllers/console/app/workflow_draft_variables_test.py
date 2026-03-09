import uuid
from collections import OrderedDict
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest
from flask_restx import marshal

from controllers.console.app.workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,
    _serialize_full_content,
)
from dify_graph.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from dify_graph.variables.types import SegmentType
from factories.variable_factory import build_segment
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_APP_ID = "test_app_id"
_TEST_NODE_EXEC_ID = str(uuid.uuid4())


class TestWorkflowDraftVariableFields:
    def test_serialize_full_content(self):
        """Test that _serialize_full_content uses pre-loaded relationships."""
        # Create mock objects with relationships pre-loaded
        mock_variable_file = MagicMock(spec=WorkflowDraftVariableFile)
        mock_variable_file.size = 100000
        mock_variable_file.length = 50
        mock_variable_file.value_type = SegmentType.OBJECT
        mock_variable_file.upload_file_id = "test-upload-file-id"

        mock_variable = MagicMock(spec=WorkflowDraftVariable)
        mock_variable.file_id = "test-file-id"
        mock_variable.variable_file = mock_variable_file

        # Mock the file helpers
        with patch("controllers.console.app.workflow_draft_variable.file_helpers", autospec=True) as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"

            # Call the function
            result = _serialize_full_content(mock_variable)

            # Verify it returns the expected structure
            assert result is not None
            assert result["size_bytes"] == 100000
            assert result["length"] == 50
            assert result["value_type"] == "object"
            assert "download_url" in result
            assert result["download_url"] == "http://example.com/signed-url"

            # Verify it used the pre-loaded relationships (no database queries)
            mock_file_helpers.get_signed_file_url.assert_called_once_with("test-upload-file-id", as_attachment=True)

    def test_serialize_full_content_handles_none_cases(self):
        """Test that _serialize_full_content handles None cases properly."""

        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = None
        result = _serialize_full_content(draft_var)
        assert result is None

    def test_serialize_full_content_should_raises_when_file_id_exists_but_file_is_none(self):
        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = str(uuid.uuid4())
        draft_var.variable_file = None
        with pytest.raises(AssertionError):
            result = _serialize_full_content(draft_var)

    def test_conversation_variable(self):
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
        )

        conv_var.id = str(uuid.uuid4())
        conv_var.visible = True

        expected_without_value: OrderedDict[str, Any] = OrderedDict(
            {
                "id": str(conv_var.id),
                "type": conv_var.get_variable_type().value,
                "name": "conv_var",
                "description": "",
                "selector": [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
                "value_type": "number",
                "edited": False,
                "visible": True,
                "is_truncated": False,
            }
        )

        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value: OrderedDict[str, Any] = expected_without_value.copy()
        expected_with_value["value"] = 1
        expected_with_value["full_content"] = None
        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_create_sys_variable(self):
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=_TEST_APP_ID,
            name="sys_var",
            value=build_segment("a"),
            editable=True,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        sys_var.id = str(uuid.uuid4())
        sys_var.last_edited_at = naive_utc_now()
        sys_var.visible = True

        expected_without_value = OrderedDict(
            {
                "id": str(sys_var.id),
                "type": sys_var.get_variable_type().value,
                "name": "sys_var",
                "description": "",
                "selector": [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
                "value_type": "string",
                "edited": True,
                "visible": True,
                "is_truncated": False,
            }
        )
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value: OrderedDict[str, Any] = expected_without_value.copy()
        expected_with_value["value"] = "a"
        expected_with_value["full_content"] = None
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_node_variable(self):
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="node_var",
            value=build_segment([1, "a"]),
            visible=False,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        node_var.id = str(uuid.uuid4())
        node_var.last_edited_at = naive_utc_now()

        expected_without_value: OrderedDict[str, Any] = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "node_var",
                "description": "",
                "selector": ["test_node", "node_var"],
                "value_type": "array[any]",
                "edited": True,
                "visible": False,
                "is_truncated": False,
            }
        )

        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = [1, "a"]
        expected_with_value["full_content"] = None
        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_node_variable_with_file(self):
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="node_var",
            value=build_segment([1, "a"]),
            visible=False,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )

        node_var.id = str(uuid.uuid4())
        node_var.last_edited_at = naive_utc_now()
        variable_file = WorkflowDraftVariableFile(
            id=str(uuidv7()),
            upload_file_id=str(uuid.uuid4()),
            size=1024,
            length=10,
            value_type=SegmentType.ARRAY_STRING,
        )
        node_var.variable_file = variable_file
        node_var.file_id = variable_file.id

        expected_without_value: OrderedDict[str, Any] = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "node_var",
                "description": "",
                "selector": ["test_node", "node_var"],
                "value_type": "array[any]",
                "edited": True,
                "visible": False,
                "is_truncated": True,
            }
        )

        with patch("controllers.console.app.workflow_draft_variable.file_helpers", autospec=True) as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"
            assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
            expected_with_value = expected_without_value.copy()
            expected_with_value["value"] = [1, "a"]
            expected_with_value["full_content"] = {
                "size_bytes": 1024,
                "value_type": "array[string]",
                "length": 10,
                "download_url": "http://example.com/signed-url",
            }
            assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value


class TestWorkflowDraftVariableList:
    def test_workflow_draft_variable_list(self):
        class TestCase(NamedTuple):
            name: str
            var_list: WorkflowDraftVariableList
            expected: dict

        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="test_var",
            value=build_segment("a"),
            visible=True,
            node_execution_id=_TEST_NODE_EXEC_ID,
        )
        node_var.id = str(uuid.uuid4())
        node_var_dict = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "test_var",
                "description": "",
                "selector": ["test_node", "test_var"],
                "value_type": "string",
                "edited": False,
                "visible": True,
                "is_truncated": False,
            }
        )

        cases = [
            TestCase(
                name="empty variable list",
                var_list=WorkflowDraftVariableList(variables=[]),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[], total=10),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": 10,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=None),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=10),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": 10,
                    }
                ),
            ),
        ]

        for idx, case in enumerate(cases, 1):
            assert marshal(case.var_list, _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS) == case.expected, (
                f"Test case {idx} failed, {case.name=}"
            )


def test_workflow_node_variables_fields():
    conv_var = WorkflowDraftVariable.new_conversation_variable(
        app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
    )
    resp = marshal(WorkflowDraftVariableList(variables=[conv_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "conv_var"
    assert item_dict["value"] == 1


def test_workflow_file_variable_with_signed_url():
    """Test that File type variables include signed URLs in API responses."""
    from dify_graph.file.enums import FileTransferMethod, FileType
    from dify_graph.file.models import File

    # Create a File object with LOCAL_FILE transfer method (which generates signed URLs)
    test_file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test_upload_file_id",
        filename="test.jpg",
        extension=".jpg",
        mime_type="image/jpeg",
        size=12345,
    )

    # Create a WorkflowDraftVariable with the File
    file_var = WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_APP_ID,
        node_id="test_node",
        name="file_var",
        value=build_segment(test_file),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )

    # Marshal the variable using the API fields
    resp = marshal(WorkflowDraftVariableList(variables=[file_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)

    # Verify the response structure
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "file_var"

    # Verify the value is a dict (File.to_dict() result) and contains expected fields
    value = item_dict["value"]
    assert isinstance(value, dict)

    # Verify the File fields are preserved
    assert value["id"] == test_file.id
    assert value["filename"] == test_file.filename
    assert value["type"] == test_file.type.value
    assert value["transfer_method"] == test_file.transfer_method.value
    assert value["size"] == test_file.size

    # Verify the URL is present (it should be a signed URL for LOCAL_FILE transfer method)
    remote_url = value["remote_url"]
    assert remote_url is not None

    assert isinstance(remote_url, str)
    # For LOCAL_FILE, the URL should contain signature parameters
    assert "timestamp=" in remote_url
    assert "nonce=" in remote_url
    assert "sign=" in remote_url


def test_workflow_file_variable_remote_url():
    """Test that File type variables with REMOTE_URL transfer method return the remote URL."""
    from dify_graph.file.enums import FileTransferMethod, FileType
    from dify_graph.file.models import File

    # Create a File object with REMOTE_URL transfer method
    test_file = File(
        id="test_file_id",
        tenant_id="test_tenant_id",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/test.jpg",
        filename="test.jpg",
        extension=".jpg",
        mime_type="image/jpeg",
        size=12345,
    )

    # Create a WorkflowDraftVariable with the File
    file_var = WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_APP_ID,
        node_id="test_node",
        name="file_var",
        value=build_segment(test_file),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )

    # Marshal the variable using the API fields
    resp = marshal(WorkflowDraftVariableList(variables=[file_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)

    # Verify the response structure
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "file_var"

    # Verify the value is a dict (File.to_dict() result) and contains expected fields
    value = item_dict["value"]
    assert isinstance(value, dict)
    remote_url = value["remote_url"]

    # For REMOTE_URL, the URL should be the original remote URL
    assert remote_url == test_file.remote_url


# === Merged from test_workflow_draft_variable_api.py ===


import inspect
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from flask import Flask, Response

from controllers.console.app import workflow_draft_variable as controller_module
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.web.error import InvalidArgumentError, NotFoundError
from dify_graph.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from dify_graph.file.enums import FileTransferMethod, FileType
from dify_graph.file.models import File
from dify_graph.variables.segment_group import SegmentGroup
from dify_graph.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from dify_graph.variables.types import SegmentType
from factories.variable_factory import build_segment
from models import App


@pytest.fixture
def flask_app() -> Flask:
    return Flask(__name__)


def _unwrap(method: Any) -> Any:
    return inspect.unwrap(method)


def _app_model(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


class _SessionContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


def _patch_db(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, Any]:
    service_session = MagicMock()
    session_factory = MagicMock(return_value=service_session)
    session_factory.commit = MagicMock()
    db_obj = SimpleNamespace(engine=MagicMock(), session=session_factory)
    monkeypatch.setattr(controller_module, "db", db_obj)
    return db_obj, service_session


def test_api_prerequisite_should_wrap_function_and_return_original_result(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    monkeypatch.setattr(controller_module, "setup_required", lambda f: f)
    monkeypatch.setattr(controller_module, "login_required", lambda f: f)
    monkeypatch.setattr(controller_module, "account_initialization_required", lambda f: f)
    monkeypatch.setattr(controller_module, "edit_permission_required", lambda f: f)
    monkeypatch.setattr(controller_module, "get_app_model", lambda **kwargs: (lambda f: f))

    def target(x: int) -> int:
        return x + 1

    wrapped = controller_module._api_prerequisite(target)

    # Act
    result = wrapped(1)

    # Assert
    assert result == 2


def test_convert_values_to_json_serializable_object_should_convert_segment_group() -> None:
    # Arrange
    group = SegmentGroup(value=[build_segment("a"), build_segment(1)])

    # Act
    result = controller_module._convert_values_to_json_serializable_object(group)

    # Assert
    assert result == ["a", 1]


def test_convert_values_to_json_serializable_object_should_convert_array_file_segment() -> None:
    # Arrange
    file1 = File(
        id="f1",
        tenant_id="t1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/1.png",
        filename="1.png",
        extension=".png",
        mime_type="image/png",
        size=1,
    )
    file2 = File(
        id="f2",
        tenant_id="t1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/2.png",
        filename="2.png",
        extension=".png",
        mime_type="image/png",
        size=1,
    )
    segment = ArrayFileSegment(value=[file1, file2])

    # Act
    result = controller_module._convert_values_to_json_serializable_object(segment)

    # Assert
    assert isinstance(result, list)
    assert len(result) == 2
    assert result[0]["id"] == "f1"


def test_serialize_var_value_should_refresh_remote_url_for_file_segment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    file = File(
        id="f1",
        tenant_id="t1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/old.png",
        filename="1.png",
        extension=".png",
        mime_type="image/png",
        size=1,
    )
    monkeypatch.setattr(File, "generate_url", lambda self: "https://example.com/new.png")
    variable = MagicMock()
    variable.get_value.return_value = FileSegment(value=file)

    # Act
    result = cast(dict[str, Any], controller_module._serialize_var_value(variable))

    # Assert
    assert result["remote_url"] == "https://example.com/new.png"


def test_serialize_var_value_should_refresh_remote_urls_for_array_file_segment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    file = File(
        id="f1",
        tenant_id="t1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/old.png",
        filename="1.png",
        extension=".png",
        mime_type="image/png",
        size=1,
    )
    monkeypatch.setattr(File, "generate_url", lambda self: "https://example.com/new.png")
    variable = MagicMock()
    variable.get_value.return_value = ArrayFileSegment(value=[file])

    # Act
    result = cast(list[dict[str, Any]], controller_module._serialize_var_value(variable))

    # Assert
    assert result[0]["remote_url"] == "https://example.com/new.png"


def test_serialize_full_content_should_return_none_when_variable_not_truncated() -> None:
    # Arrange
    variable = MagicMock()
    variable.is_truncated.return_value = False

    # Act
    result = controller_module._serialize_full_content(variable)

    # Assert
    assert result is None


def test_validate_node_id_should_raise_for_reserved_node_ids() -> None:
    # Arrange

    # Act / Assert
    with pytest.raises(InvalidArgumentError):
        controller_module.validate_node_id(CONVERSATION_VARIABLE_NODE_ID)


def test_validate_node_id_should_allow_normal_node_id() -> None:
    # Arrange

    # Act
    result = controller_module.validate_node_id("node-1")

    # Assert
    assert result is None


def test_workflow_variable_collection_get_should_raise_when_workflow_missing(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.WorkflowVariableCollectionApi()
    app_model = _app_model(id="app-1")
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(is_workflow_exist=lambda **_: False)),
    )

    # Act / Assert
    with flask_app.test_request_context("/vars?page=1&limit=20"):
        with pytest.raises(DraftWorkflowNotExist):
            _unwrap(controller_module.WorkflowVariableCollectionApi.get)(api, app_model)


def test_workflow_variable_collection_get_should_return_variable_list(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.WorkflowVariableCollectionApi()
    app_model = _app_model(id="app-1")
    expected = SimpleNamespace(variables=[], total=0)
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(is_workflow_exist=lambda **_: True)),
    )
    service = SimpleNamespace(list_variables_without_values=MagicMock(return_value=expected))
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))
    _patch_db(monkeypatch)
    monkeypatch.setattr(controller_module, "Session", lambda **kwargs: _SessionContext(MagicMock()))

    # Act
    with flask_app.test_request_context("/vars?page=2&limit=5"):
        result = _unwrap(controller_module.WorkflowVariableCollectionApi.get)(api, app_model)

    # Assert
    assert result is expected


def test_workflow_variable_collection_delete_should_delete_and_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.WorkflowVariableCollectionApi()
    app_model = _app_model(id="app-1")
    db_obj, service_session = _patch_db(monkeypatch)
    service = SimpleNamespace(delete_workflow_variables=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    response = _unwrap(controller_module.WorkflowVariableCollectionApi.delete)(api, app_model)

    # Assert
    assert isinstance(response, Response)
    assert response.status_code == 204
    service.delete_workflow_variables.assert_called_once_with("app-1")
    db_obj.session.commit.assert_called_once()


def test_node_variable_collection_get_should_validate_node_and_return_values(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.NodeVariableCollectionApi()
    app_model = _app_model(id="app-1")
    expected = SimpleNamespace(variables=[])
    service = SimpleNamespace(list_node_variables=MagicMock(return_value=expected))
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))
    _patch_db(monkeypatch)
    monkeypatch.setattr(controller_module, "Session", lambda **kwargs: _SessionContext(MagicMock()))

    # Act
    result = _unwrap(controller_module.NodeVariableCollectionApi.get)(api, app_model, "node-1")

    # Assert
    assert result is expected


def test_node_variable_collection_delete_should_validate_node_and_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.NodeVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    db_obj, service_session = _patch_db(monkeypatch)
    service = SimpleNamespace(delete_node_variables=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    response = _unwrap(controller_module.NodeVariableCollectionApi.delete)(api, app_model, "node-1")

    # Assert
    assert response.status_code == 204
    service.delete_node_variables.assert_called_once_with("app-1", "node-1")
    db_obj.session.commit.assert_called_once()


def test_variable_api_get_should_raise_when_variable_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1")
    db_obj, _ = _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=None))
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act / Assert
    with pytest.raises(NotFoundError):
        _unwrap(controller_module.VariableApi.get)(api, app_model, "var-1")


def test_variable_api_get_should_raise_when_variable_belongs_to_other_app(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1")
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=SimpleNamespace(app_id="app-2")))
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act / Assert
    with pytest.raises(NotFoundError):
        _unwrap(controller_module.VariableApi.get)(api, app_model, "var-1")


def test_variable_api_get_should_return_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1")
    variable = SimpleNamespace(app_id="app-1")
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable))
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    result = _unwrap(controller_module.VariableApi.get)(api, app_model, "var-1")

    # Assert
    assert result is variable


def test_variable_api_patch_should_return_unchanged_variable_when_payload_is_empty(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    variable = SimpleNamespace(app_id="app-1", value_type=SegmentType.STRING)
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), update_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    with flask_app.test_request_context("/variable", method="PATCH", json={}):
        result = _unwrap(controller_module.VariableApi.patch)(api, app_model, "var-1")

    # Assert
    assert result is variable
    service.update_variable.assert_not_called()


def test_variable_api_patch_should_raise_for_invalid_file_payload(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    variable = SimpleNamespace(app_id="app-1", value_type=SegmentType.FILE)
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), update_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act / Assert
    with flask_app.test_request_context("/variable", method="PATCH", json={"value": "bad"}):
        with pytest.raises(InvalidArgumentError):
            _unwrap(controller_module.VariableApi.patch)(api, app_model, "var-1")


def test_variable_api_patch_should_raise_for_invalid_array_file_payload(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    variable = SimpleNamespace(app_id="app-1", value_type=SegmentType.ARRAY_FILE)
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), update_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act / Assert
    with flask_app.test_request_context("/variable", method="PATCH", json={"value": ["bad"]}):
        with pytest.raises(InvalidArgumentError):
            _unwrap(controller_module.VariableApi.patch)(api, app_model, "var-1")


def test_variable_api_patch_should_update_file_variable_and_commit(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    variable = SimpleNamespace(app_id="app-1", value_type=SegmentType.FILE)
    db_obj, _ = _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), update_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    built_file = SimpleNamespace(kind="file")
    built_segment = StringSegment(value="converted")
    monkeypatch.setattr(controller_module, "build_from_mapping", MagicMock(return_value=built_file))
    monkeypatch.setattr(controller_module, "build_segment_with_type", MagicMock(return_value=built_segment))

    # Act
    with flask_app.test_request_context("/variable", method="PATCH", json={"name": "n", "value": {"id": "f"}}):
        result = _unwrap(controller_module.VariableApi.patch)(api, app_model, "var-1")

    # Assert
    assert result is variable
    service.update_variable.assert_called_once_with(variable, name="n", value=built_segment)
    db_obj.session.commit.assert_called_once()


def test_variable_api_patch_should_update_array_file_variable_and_commit(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    variable = SimpleNamespace(app_id="app-1", value_type=SegmentType.ARRAY_FILE)
    db_obj, _ = _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), update_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    built_files = [SimpleNamespace(kind="file")]
    built_segment = StringSegment(value="converted")
    monkeypatch.setattr(controller_module, "build_from_mappings", MagicMock(return_value=built_files))
    monkeypatch.setattr(controller_module, "build_segment_with_type", MagicMock(return_value=built_segment))

    # Act
    with flask_app.test_request_context("/variable", method="PATCH", json={"value": [{"id": "f"}]}):
        result = _unwrap(controller_module.VariableApi.patch)(api, app_model, "var-1")

    # Assert
    assert result is variable
    service.update_variable.assert_called_once_with(variable, name=None, value=built_segment)
    db_obj.session.commit.assert_called_once()


def test_variable_api_delete_should_raise_when_variable_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1")
    _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=None), delete_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act / Assert
    with pytest.raises(NotFoundError):
        _unwrap(controller_module.VariableApi.delete)(api, app_model, "var-1")


def test_variable_api_delete_should_delete_and_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableApi()
    app_model = SimpleNamespace(id="app-1")
    variable = SimpleNamespace(app_id="app-1")
    db_obj, _ = _patch_db(monkeypatch)
    service = SimpleNamespace(get_variable=MagicMock(return_value=variable), delete_variable=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    response = _unwrap(controller_module.VariableApi.delete)(api, app_model, "var-1")

    # Assert
    assert response.status_code == 204
    service.delete_variable.assert_called_once_with(variable)
    db_obj.session.commit.assert_called_once()


def test_variable_reset_api_put_should_raise_when_draft_workflow_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableResetApi()
    app_model = SimpleNamespace(id="app-1")
    _patch_db(monkeypatch)
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda *_: None)),
    )
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock())

    # Act / Assert
    with pytest.raises(NotFoundError):
        _unwrap(controller_module.VariableResetApi.put)(api, app_model, "var-1")


def test_variable_reset_api_put_should_return_204_when_reset_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.VariableResetApi()
    app_model = SimpleNamespace(id="app-1")
    variable = SimpleNamespace(app_id="app-1")
    draft_workflow = SimpleNamespace(id="wf-1")

    db_obj, _ = _patch_db(monkeypatch)
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda *_: draft_workflow)),
    )
    service = SimpleNamespace(
        get_variable=MagicMock(return_value=variable),
        reset_variable=MagicMock(return_value=None),
    )
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))

    # Act
    response = _unwrap(controller_module.VariableResetApi.put)(api, app_model, "var-1")

    # Assert
    assert response.status_code == 204
    db_obj.session.commit.assert_called_once()


def test_variable_reset_api_put_should_return_marshaled_variable_when_reset_returns_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.VariableResetApi()
    app_model = SimpleNamespace(id="app-1")
    variable = SimpleNamespace(app_id="app-1")
    draft_workflow = SimpleNamespace(id="wf-1")
    reset_value = SimpleNamespace(id="reset-1")

    db_obj, _ = _patch_db(monkeypatch)
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda *_: draft_workflow)),
    )
    service = SimpleNamespace(
        get_variable=MagicMock(return_value=variable),
        reset_variable=MagicMock(return_value=reset_value),
    )
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))
    monkeypatch.setattr(controller_module, "marshal", MagicMock(return_value={"id": "reset-1"}))

    # Act
    response = _unwrap(controller_module.VariableResetApi.put)(api, app_model, "var-1")

    # Assert
    assert response == {"id": "reset-1"}
    db_obj.session.commit.assert_called_once()


def test_get_variable_list_should_route_to_correct_service_method(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    app_model = _app_model(id="app-1")
    expected_conversation = SimpleNamespace(source="conversation")
    expected_system = SimpleNamespace(source="system")
    expected_node = SimpleNamespace(source="node")
    service = SimpleNamespace(
        list_conversation_variables=MagicMock(return_value=expected_conversation),
        list_system_variables=MagicMock(return_value=expected_system),
        list_node_variables=MagicMock(return_value=expected_node),
    )
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))
    _patch_db(monkeypatch)
    monkeypatch.setattr(controller_module, "Session", lambda **kwargs: _SessionContext(MagicMock()))

    # Act
    result_conversation = controller_module._get_variable_list(app_model, CONVERSATION_VARIABLE_NODE_ID)
    result_system = controller_module._get_variable_list(app_model, SYSTEM_VARIABLE_NODE_ID)
    result_node = controller_module._get_variable_list(app_model, "node-1")

    # Assert
    assert result_conversation is expected_conversation
    assert result_system is expected_system
    assert result_node is expected_node


def test_conversation_variable_collection_get_should_raise_when_draft_workflow_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.ConversationVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda *_: None)),
    )

    # Act / Assert
    with pytest.raises(NotFoundError):
        _unwrap(controller_module.ConversationVariableCollectionApi.get)(api, app_model)


def test_conversation_variable_collection_get_should_prefill_commit_and_return_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.ConversationVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    draft_workflow = SimpleNamespace(id="wf-1")
    expected_list = SimpleNamespace(variables=[])

    db_obj, _ = _patch_db(monkeypatch)
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda *_: draft_workflow)),
    )
    service = SimpleNamespace(prefill_conversation_variable_default_values=MagicMock())
    monkeypatch.setattr(controller_module, "WorkflowDraftVariableService", MagicMock(return_value=service))
    monkeypatch.setattr(controller_module, "_get_variable_list", MagicMock(return_value=expected_list))

    # Act
    result = _unwrap(controller_module.ConversationVariableCollectionApi.get)(api, app_model)

    # Assert
    assert result is expected_list
    service.prefill_conversation_variable_default_values.assert_called_once_with(draft_workflow)
    db_obj.session.commit.assert_called_once()


def test_system_variable_collection_get_should_delegate_to_get_variable_list(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    api = controller_module.SystemVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    expected = SimpleNamespace(variables=[])
    get_list_mock = MagicMock(return_value=expected)
    monkeypatch.setattr(controller_module, "_get_variable_list", get_list_mock)

    # Act
    result = _unwrap(controller_module.SystemVariableCollectionApi.get)(api, app_model)

    # Assert
    assert result is expected
    get_list_mock.assert_called_once_with(app_model, SYSTEM_VARIABLE_NODE_ID)


def test_environment_variable_collection_get_should_raise_when_workflow_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.EnvironmentVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda **_: None)),
    )

    # Act / Assert
    with pytest.raises(DraftWorkflowNotExist):
        _unwrap(controller_module.EnvironmentVariableCollectionApi.get)(api, app_model)


def test_environment_variable_collection_get_should_return_env_variable_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    api = controller_module.EnvironmentVariableCollectionApi()
    app_model = SimpleNamespace(id="app-1")
    env_var = SimpleNamespace(
        id="env-1",
        name="API_KEY",
        description="desc",
        selector=["env", "API_KEY"],
        value_type=SegmentType.STRING,
        value="secret",
    )
    workflow = SimpleNamespace(environment_variables=[env_var])
    monkeypatch.setattr(
        controller_module,
        "WorkflowService",
        MagicMock(return_value=SimpleNamespace(get_draft_workflow=lambda **_: workflow)),
    )

    # Act
    result = _unwrap(controller_module.EnvironmentVariableCollectionApi.get)(api, app_model)

    # Assert
    assert result == {
        "items": [
            {
                "id": "env-1",
                "type": "env",
                "name": "API_KEY",
                "description": "desc",
                "selector": ["env", "API_KEY"],
                "value_type": "string",
                "value": "secret",
                "edited": False,
                "visible": True,
                "editable": True,
            }
        ]
    }
