import uuid
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from typing import Any, NamedTuple
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from controllers.console.app import workflow_draft_variable as draft_variable_module
from controllers.console.app.workflow_draft_variable import (
    EnvironmentVariableCollectionApi,
    NodeVariableCollectionApi,
    VariableApi,
    WorkflowDraftVariableFullContentResponse,
    WorkflowDraftVariableListResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    WorkflowDraftVariableResponse,
    WorkflowDraftVariableWithoutValueResponse,
    WorkflowVariableCollectionApi,
)
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models import Account, App, AppMode
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_APP_ID = "test_app_id"
_TEST_NODE_EXEC_ID = str(uuid.uuid4())


def _app_model() -> App:
    app_model = App()
    app_model.id = _TEST_APP_ID
    app_model.tenant_id = "tenant-1"
    app_model.name = "test app"
    app_model.mode = AppMode.WORKFLOW
    return app_model


def _current_user() -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "user-1"
    return account


def _node_variable(*, value: Any = "value") -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_APP_ID,
        user_id="user-1",
        node_id="node-1",
        name="node_var",
        value=build_segment(value),
        node_execution_id=_TEST_NODE_EXEC_ID,
    )
    variable.id = str(uuid.uuid4())
    return variable


def _assert_raw_payload_matches_model(payload: dict[str, Any], model: type[Any], expected: dict[str, Any]) -> None:
    assert payload == expected
    assert model.model_validate(payload).model_dump(mode="json") == expected


def test_workflow_draft_variable_update_payload_keeps_value_as_json_until_variable_type_is_known() -> None:
    payload = draft_variable_module.WorkflowDraftVariableUpdatePayload.model_validate(
        {"value": {"transfer_method": "ordinary-object-field", "nested": {"enabled": True}}}
    )

    assert payload.value == {"transfer_method": "ordinary-object-field", "nested": {"enabled": True}}


def test_workflow_variable_collection_get_returns_without_value_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    variable = _node_variable()
    captured_args: dict[str, Any] = {}

    class WorkflowService:
        def is_workflow_exist(self, *, app_model: Any) -> bool:
            captured_args["workflow_app_id"] = app_model.id
            return True

    class DraftVariableService:
        def __init__(self, *, session: object) -> None:
            captured_args["session"] = session

        def list_variables_without_values(self, **kwargs: Any) -> WorkflowDraftVariableList:
            captured_args.update(kwargs)
            return WorkflowDraftVariableList(variables=[variable], total=None)

    session = object()
    monkeypatch.setattr(draft_variable_module, "WorkflowService", WorkflowService)
    monkeypatch.setattr(draft_variable_module, "WorkflowDraftVariableService", DraftVariableService)
    monkeypatch.setattr(draft_variable_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        draft_variable_module,
        "sessionmaker",
        lambda *_args, **_kwargs: SimpleNamespace(begin=lambda: nullcontext(session)),
    )

    api = WorkflowVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflows/draft/variables?page=2&limit=3", method="GET"):
        payload = handler(api, _current_user(), _app_model())

    expected_payload = {
        "items": [
            {
                "id": variable.id,
                "type": "node",
                "name": "node_var",
                "description": "",
                "selector": ["node-1", "node_var"],
                "value_type": "string",
                "edited": False,
                "visible": True,
                "is_truncated": False,
            }
        ],
        "total": None,
    }

    assert captured_args == {
        "workflow_app_id": _TEST_APP_ID,
        "session": session,
        "app_id": _TEST_APP_ID,
        "page": 2,
        "limit": 3,
        "user_id": "user-1",
    }
    _assert_raw_payload_matches_model(payload, WorkflowDraftVariableListWithoutValueResponse, expected_payload)


def test_node_variable_collection_get_returns_value_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    variable = _node_variable(value=None)

    class DraftVariableService:
        def __init__(self, *, session: object) -> None:
            pass

        def list_node_variables(self, app_id: str, node_id: str, *, user_id: str) -> WorkflowDraftVariableList:
            assert (app_id, node_id, user_id) == (_TEST_APP_ID, "node-1", "user-1")
            return WorkflowDraftVariableList(variables=[variable])

    monkeypatch.setattr(draft_variable_module, "WorkflowDraftVariableService", DraftVariableService)
    monkeypatch.setattr(draft_variable_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        draft_variable_module,
        "sessionmaker",
        lambda *_args, **_kwargs: SimpleNamespace(begin=lambda: nullcontext(object())),
    )

    api = NodeVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflows/draft/nodes/node-1/variables", method="GET"):
        payload = handler(api, _current_user(), _app_model(), "node-1")

    expected_payload = {
        "items": [
            {
                "id": variable.id,
                "type": "node",
                "name": "node_var",
                "description": "",
                "selector": ["node-1", "node_var"],
                "value_type": "none",
                "edited": False,
                "visible": True,
                "is_truncated": False,
                "value": None,
                "full_content": None,
            }
        ]
    }
    _assert_raw_payload_matches_model(payload, WorkflowDraftVariableListResponse, expected_payload)


def test_variable_patch_noop_returns_current_variable_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    variable = _node_variable(value=42)
    update_variable_mock = Mock()

    class DraftVariableService:
        def __init__(self, session: object) -> None:
            pass

        def get_variable(self, *, variable_id: str) -> WorkflowDraftVariable:
            assert variable_id == variable.id
            return variable

        def update_variable(self, *args: Any, **kwargs: Any) -> None:
            update_variable_mock(*args, **kwargs)

    monkeypatch.setattr(draft_variable_module, "WorkflowDraftVariableService", DraftVariableService)
    session = Mock(return_value=object())
    session.commit = Mock()
    monkeypatch.setattr(draft_variable_module, "db", SimpleNamespace(session=session))

    api = VariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context(f"/apps/app-1/workflows/draft/variables/{variable.id}", method="PATCH", json={}):
        payload = handler(api, _current_user(), _app_model(), uuid.UUID(variable.id))

    expected_payload = {
        "id": variable.id,
        "type": "node",
        "name": "node_var",
        "description": "",
        "selector": ["node-1", "node_var"],
        "value_type": "number",
        "edited": False,
        "visible": True,
        "is_truncated": False,
        "value": 42,
        "full_content": None,
    }

    update_variable_mock.assert_not_called()
    _assert_raw_payload_matches_model(payload, WorkflowDraftVariableResponse, expected_payload)


def test_variable_patch_file_value_forwards_raw_mapping_to_file_factory(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    variable = _node_variable(value="old")
    variable.value_type = SegmentType.FILE
    raw_mapping = {
        "transfer_method": "local_file",
        "upload_file_id": "file-1",
        "filename": "kept-for-file-factory",
    }
    built_file = object()
    captured: dict[str, Any] = {}

    def build_from_mapping(**kwargs: Any) -> object:
        captured.update(kwargs)
        return built_file

    def build_segment_with_type(segment_type: SegmentType, value: object):
        assert segment_type == SegmentType.FILE
        assert value is built_file
        return build_segment("updated")

    class DraftVariableService:
        def __init__(self, session: object) -> None:
            pass

        def get_variable(self, *, variable_id: str) -> WorkflowDraftVariable:
            assert variable_id == variable.id
            return variable

        def update_variable(self, target: WorkflowDraftVariable, *, name: str | None, value: Any) -> None:
            assert target is variable
            assert name is None
            target.set_value(value)

    monkeypatch.setattr(draft_variable_module, "WorkflowDraftVariableService", DraftVariableService)
    monkeypatch.setattr(draft_variable_module, "build_from_mapping", build_from_mapping)
    monkeypatch.setattr(draft_variable_module, "build_segment_with_type", build_segment_with_type)
    session = Mock(return_value=object())
    session.commit = Mock()
    monkeypatch.setattr(draft_variable_module, "db", SimpleNamespace(session=session))

    api = VariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        f"/apps/app-1/workflows/draft/variables/{variable.id}",
        method="PATCH",
        json={"value": raw_mapping},
    ):
        payload = handler(api, _current_user(), _app_model(), uuid.UUID(variable.id))

    assert captured["tenant_id"] == "tenant-1"
    assert captured["mapping"] == raw_mapping
    expected_payload = {
        "id": variable.id,
        "type": "node",
        "name": "node_var",
        "description": "",
        "selector": ["node-1", "node_var"],
        "value_type": "string",
        "edited": False,
        "visible": True,
        "is_truncated": False,
        "value": "updated",
        "full_content": None,
    }
    _assert_raw_payload_matches_model(payload, WorkflowDraftVariableResponse, expected_payload)


def test_environment_variable_collection_get_returns_response_model_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_var = SimpleNamespace(
        id="env-1",
        name="API_KEY",
        description="secret token",
        selector=["env", "API_KEY"],
        value_type=SegmentType.SECRET,
        value="token",
    )

    class WorkflowService:
        def get_draft_workflow(self, *, app_model: Any) -> SimpleNamespace:
            assert app_model.id == _TEST_APP_ID
            return SimpleNamespace(environment_variables=[env_var])

    monkeypatch.setattr(draft_variable_module, "WorkflowService", WorkflowService)

    api = EnvironmentVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflows/draft/environment-variables", method="GET"):
        payload = handler(api, _current_user(), _app_model())

    expected_payload = {
        "items": [
            {
                "id": "env-1",
                "type": "env",
                "name": "API_KEY",
                "description": "secret token",
                "selector": ["env", "API_KEY"],
                "value_type": "secret",
                "value": "token",
                "edited": False,
                "visible": True,
                "editable": True,
            }
        ]
    }
    _assert_raw_payload_matches_model(
        payload,
        draft_variable_module.WorkflowDraftEnvironmentVariableListResponse,
        expected_payload,
    )


class TestWorkflowDraftVariableFields:
    def test_full_content_response_constructor(self):
        """Test that full_content serialization uses pre-loaded relationships."""
        # Create mock objects with relationships pre-loaded
        mock_variable = WorkflowDraftVariable(
            file_id="test-file-id",
            variable_file=WorkflowDraftVariableFile(
                size=100000,
                length=50,
                value_type=SegmentType.OBJECT,
                upload_file_id="test-upload-file-id",
                tenant_id=str(uuid.uuid4()),
                app_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
            ),
        )

        # Mock the file helpers
        with patch("controllers.console.app.workflow_draft_variable.file_helpers", autospec=True) as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"

            # Call the function
            result = WorkflowDraftVariableFullContentResponse.from_workflow_draft_variable(mock_variable)

            # Verify it returns the expected structure
            assert result is not None
            assert result.size_bytes == 100000
            assert result.length == 50
            assert result.value_type == "object"
            assert result.download_url == "http://example.com/signed-url"

            # Verify it used the pre-loaded relationships (no database queries)
            mock_file_helpers.get_signed_file_url.assert_called_once_with("test-upload-file-id", as_attachment=True)

    def test_full_content_response_constructor_handles_none_cases(self):
        """Test that full_content serialization handles None cases properly."""

        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = None
        result = WorkflowDraftVariableFullContentResponse.from_workflow_draft_variable(draft_var)
        assert result is None

    def test_full_content_response_constructor_preserves_none_size(self):
        draft_var = WorkflowDraftVariable(
            file_id="test-file-id",
            variable_file=WorkflowDraftVariableFile(
                size=None,
                length=50,
                value_type=SegmentType.OBJECT,
                upload_file_id="test-upload-file-id",
                tenant_id=str(uuid.uuid4()),
                app_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
            ),
        )

        with patch("controllers.console.app.workflow_draft_variable.file_helpers", autospec=True) as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"

            result = WorkflowDraftVariableFullContentResponse.from_workflow_draft_variable(draft_var)

        assert result is not None
        assert result.size_bytes is None

    def test_full_content_response_constructor_should_raises_when_file_id_exists_but_file_is_none(self):
        # Test with no file_id
        draft_var = WorkflowDraftVariable()
        draft_var.file_id = str(uuid.uuid4())
        draft_var.variable_file = None
        with pytest.raises(AssertionError):
            result = WorkflowDraftVariableFullContentResponse.from_workflow_draft_variable(draft_var)

    def test_conversation_variable(self):
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
        )

        conv_var.id = str(uuid.uuid4())
        conv_var.visible = True

        expected_without_value: dict[str, Any] = {
            "id": conv_var.id,
            "type": conv_var.get_variable_type().value,
            "name": "conv_var",
            "description": "",
            "selector": [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
            "value_type": "number",
            "edited": False,
            "visible": True,
            "is_truncated": False,
        }

        assert (
            WorkflowDraftVariableWithoutValueResponse.from_workflow_draft_variable(conv_var).model_dump(mode="json")
            == expected_without_value
        )
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = 1
        expected_with_value["full_content"] = None
        assert (
            WorkflowDraftVariableResponse.from_workflow_draft_variable(conv_var).model_dump(mode="json")
            == expected_with_value
        )

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

        expected_without_value: dict[str, Any] = {
            "id": sys_var.id,
            "type": sys_var.get_variable_type().value,
            "name": "sys_var",
            "description": "",
            "selector": [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
            "value_type": "string",
            "edited": True,
            "visible": True,
            "is_truncated": False,
        }
        assert (
            WorkflowDraftVariableWithoutValueResponse.from_workflow_draft_variable(sys_var).model_dump(mode="json")
            == expected_without_value
        )
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = "a"
        expected_with_value["full_content"] = None
        assert (
            WorkflowDraftVariableResponse.from_workflow_draft_variable(sys_var).model_dump(mode="json")
            == expected_with_value
        )

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

        expected_without_value: dict[str, Any] = {
            "id": node_var.id,
            "type": node_var.get_variable_type().value,
            "name": "node_var",
            "description": "",
            "selector": ["test_node", "node_var"],
            "value_type": "array[any]",
            "edited": True,
            "visible": False,
            "is_truncated": False,
        }

        assert (
            WorkflowDraftVariableWithoutValueResponse.from_workflow_draft_variable(node_var).model_dump(mode="json")
            == expected_without_value
        )
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = [1, "a"]
        expected_with_value["full_content"] = None
        assert (
            WorkflowDraftVariableResponse.from_workflow_draft_variable(node_var).model_dump(mode="json")
            == expected_with_value
        )

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
            upload_file_id=str(uuid.uuid4()),
            size=1024,
            length=10,
            value_type=SegmentType.ARRAY_STRING,
            tenant_id=str(uuidv7()),
            app_id=str(uuidv7()),
            user_id=str(uuidv7()),
        )
        variable_file.id = str(uuidv7())
        node_var.variable_file = variable_file
        node_var.file_id = variable_file.id

        expected_without_value: dict[str, Any] = {
            "id": node_var.id,
            "type": node_var.get_variable_type().value,
            "name": "node_var",
            "description": "",
            "selector": ["test_node", "node_var"],
            "value_type": "array[any]",
            "edited": True,
            "visible": False,
            "is_truncated": True,
        }

        with patch("controllers.console.app.workflow_draft_variable.file_helpers", autospec=True) as mock_file_helpers:
            mock_file_helpers.get_signed_file_url.return_value = "http://example.com/signed-url"
            assert (
                WorkflowDraftVariableWithoutValueResponse.from_workflow_draft_variable(node_var).model_dump(mode="json")
                == expected_without_value
            )
            expected_with_value = expected_without_value.copy()
            expected_with_value["value"] = [1, "a"]
            expected_with_value["full_content"] = {
                "size_bytes": 1024,
                "value_type": "array[string]",
                "length": 10,
                "download_url": "http://example.com/signed-url",
            }
            assert (
                WorkflowDraftVariableResponse.from_workflow_draft_variable(node_var).model_dump(mode="json")
                == expected_with_value
            )


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
        node_var_dict = {
            "id": node_var.id,
            "type": node_var.get_variable_type().value,
            "name": "test_var",
            "description": "",
            "selector": ["test_node", "test_var"],
            "value_type": "string",
            "edited": False,
            "visible": True,
            "is_truncated": False,
        }

        cases = [
            TestCase(
                name="empty variable list",
                var_list=WorkflowDraftVariableList(variables=[]),
                expected={
                    "items": [],
                    "total": None,
                },
            ),
            TestCase(
                name="empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[], total=10),
                expected={
                    "items": [],
                    "total": 10,
                },
            ),
            TestCase(
                name="non-empty variable list",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=None),
                expected={
                    "items": [node_var_dict],
                    "total": None,
                },
            ),
            TestCase(
                name="non-empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=10),
                expected={
                    "items": [node_var_dict],
                    "total": 10,
                },
            ),
        ]

        for idx, case in enumerate(cases, 1):
            assert (
                WorkflowDraftVariableListWithoutValueResponse.from_workflow_draft_variable_list(
                    case.var_list
                ).model_dump(mode="json")
                == case.expected
            ), f"Test case {idx} failed, {case.name=}"


def test_workflow_node_variables_fields():
    conv_var = WorkflowDraftVariable.new_conversation_variable(
        app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
    )
    conv_var.visible = True
    resp = WorkflowDraftVariableListResponse.from_workflow_draft_variable_list(
        WorkflowDraftVariableList(variables=[conv_var])
    ).model_dump(mode="json")
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "conv_var"
    assert item_dict["value"] == 1


def test_workflow_file_variable_with_signed_url():
    """Test that File type variables include signed URLs in API responses."""
    from graphon.file import File, FileTransferMethod, FileType

    # Create a File object with LOCAL_FILE transfer method (which generates signed URLs)
    test_file = File(
        file_id="test_file_id",
        file_type=FileType.IMAGE,
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

    resp = WorkflowDraftVariableListResponse.from_workflow_draft_variable_list(
        WorkflowDraftVariableList(variables=[file_var])
    ).model_dump(mode="json")

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
    from graphon.file import File, FileTransferMethod, FileType

    # Create a File object with REMOTE_URL transfer method
    test_file = File(
        file_id="test_file_id",
        file_type=FileType.IMAGE,
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

    resp = WorkflowDraftVariableListResponse.from_workflow_draft_variable_list(
        WorkflowDraftVariableList(variables=[file_var])
    ).model_dump(mode="json")

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
