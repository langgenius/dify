import dataclasses
import json
import secrets
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from typing import override
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.workflow.file_reference import build_file_reference
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from extensions.application_services.workflow_variables import build_workflow_variable_service
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from factories.variable_factory import build_segment
from graphon.enums import BuiltinNodeTypes as _workflow_draft_variable_service_BuiltinNodeTypes
from graphon.file import File, FileTransferMethod, FileType
from graphon.nodes import BuiltinNodeTypes as _workflow_draft_variable_service_sqlite_BuiltinNodeTypes
from graphon.variables.segments import StringSegment
from graphon.variables.types import SegmentType
from libs import datetime_utils
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models import Account as _workflow_draft_variable_service_sqlite_Account
from models import Tenant, TenantAccountJoin
from models.account import Account as _workflow_draft_variable_service_Account
from models.account import TenantAccountRole
from models.enums import CreatorUserRole, DraftVariableType
from models.model import UploadFile
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    is_system_variable_editable,
)
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository, _model_to_insertion_dict
from services.file_service import FileService
from services.variable_truncator import TruncationResult
from services.workflow.draft_variable_service import (
    DraftVariableSaver as _ApplicationDraftVariableSaver,
)
from services.workflow.draft_variable_service import (
    DraftVarLoader as _ApplicationDraftVarLoader,
)
from services.workflow.variable_file_gateway import WorkflowVariableFileGateway
from services.workflow.variable_service import WorkflowVariableService
from services.workflow_draft_variable_service import DraftVarLoader

"""Simplified unit tests for DraftVarLoader focusing on core functionality."""


def _persist_offloaded_variable(
    sqlite_session: Session,
    *,
    node_id: str,
    name: str,
) -> WorkflowDraftVariable:
    upload_file = UploadFile(
        tenant_id="test-tenant-id",
        storage_type=StorageType.LOCAL,
        key=f"storage/key/{name}.txt",
        name=f"{name}.txt",
        size=10,
        extension=".txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="test-user-id",
        created_at=datetime(2025, 1, 1),
        used=True,
    )
    variable_file = WorkflowDraftVariableFile(
        tenant_id="test-tenant-id",
        app_id="test-app-id",
        user_id="test-user-id",
        upload_file_id=upload_file.id,
        size=10,
        length=None,
        value_type=SegmentType.STRING,
    )
    draft_variable = WorkflowDraftVariable.new_node_variable(
        app_id="test-app-id",
        user_id="test-user-id",
        node_id=node_id,
        name=name,
        value=StringSegment(value="truncated"),
        node_execution_id=f"execution-{node_id}",
        file_id=variable_file.id,
    )
    sqlite_session.add_all([upload_file, variable_file, draft_variable])
    return draft_variable


class TestDraftVarLoaderSimpleCases:
    class TestDraftVarLoaderSimple:
        """Simplified unit tests for DraftVarLoader core methods."""

        @pytest.fixture
        def draft_var_loader(self, sqlite_engine: Engine):
            """Create DraftVarLoader instance for testing."""
            return DraftVarLoader(
                engine=sqlite_engine,
                app_id="test-app-id",
                tenant_id="test-tenant-id",
                user_id="test-user-id",
                fallback_variables=[],
            )

        def test_load_offloaded_variable_object_type_unit(self, draft_var_loader):
            """Test _load_offloaded_variable with object type - isolated unit test."""
            # Create mock objects
            upload_file = UploadFile(
                tenant_id="tenant-id",
                storage_type="opendal",
                key="storage/key/test.json",
                name="test.txt",
                size=0,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by="account-id",
                created_at=datetime.now(),
                used=False,
            )

            variable_file = WorkflowDraftVariableFile(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                upload_file_id="upload-file-id",
                size=0,
                length=0,
                value_type=SegmentType.OBJECT,
            )
            variable_file.upload_file = upload_file

            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="app-id",
                user_id="user-id",
                node_id="test-node-id",
                name="test_object",
                value=StringSegment(value="truncated"),
                node_execution_id="execution-id",
                file_id=variable_file.id,
            )
            draft_var.id = "draft-var-id"
            draft_var.description = "test description"
            draft_var.variable_file = variable_file

            test_object = {"key1": "value1", "key2": 42}
            test_json_content = json.dumps(test_object, ensure_ascii=False, separators=(",", ":"))

            with patch("services.workflow_draft_variable_service.storage") as mock_storage:
                mock_storage.load.return_value = test_json_content.encode()

                # Execute the method
                selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                # Verify results
                assert selector_tuple == ("test-node-id", "test_object")
                assert variable.id == "draft-var-id"
                assert variable.name == "test_object"
                assert variable.description == "test description"
                assert variable.value == test_object

                # Verify method calls
                mock_storage.load.assert_called_once_with("storage/key/test.json")

        def test_load_offloaded_variable_missing_variable_file_unit(self, draft_var_loader):
            """Test that assertion error is raised when variable_file is None."""
            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="app-id",
                user_id="user-id",
                node_id="test-node-id",
                name="test_variable",
                value=StringSegment(value="truncated"),
                node_execution_id="execution-id",
            )
            draft_var.variable_file = None

            with pytest.raises(AssertionError):
                draft_var_loader._load_offloaded_variable(draft_var)

        def test_load_offloaded_variable_missing_upload_file_unit(self, draft_var_loader):
            """Test that assertion error is raised when upload_file is None."""
            variable_file = WorkflowDraftVariableFile(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                upload_file_id="upload-file-id",
                size=0,
                length=0,
                value_type=SegmentType.FILE,
            )
            variable_file.upload_file = None

            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="app-id",
                user_id="user-id",
                node_id="test-node-id",
                name="test_variable",
                value=StringSegment(value="truncated"),
                node_execution_id="execution-id",
                file_id=variable_file.id,
            )
            draft_var.variable_file = variable_file

            with pytest.raises(AssertionError):
                draft_var_loader._load_offloaded_variable(draft_var)

        def test_load_variables_empty_selectors_unit(self, draft_var_loader):
            """Test load_variables returns empty list for empty selectors."""
            result = draft_var_loader.load_variables([])
            assert result == []

        def test_selector_to_tuple_unit(self, draft_var_loader):
            """Test _selector_to_tuple method."""
            selector = ["node_id", "var_name", "extra_field"]
            result = draft_var_loader._selector_to_tuple(selector)
            assert result == ("node_id", "var_name")

        def test_load_offloaded_variable_array_type_unit(self, draft_var_loader):
            """Test _load_offloaded_variable with array type - isolated unit test."""
            # Create mock objects
            upload_file = UploadFile(
                tenant_id="tenant-id",
                storage_type="opendal",
                key="storage/key/test_array.json",
                name="test.txt",
                size=0,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by="account-id",
                created_at=datetime.now(),
                used=False,
            )

            variable_file = WorkflowDraftVariableFile(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                upload_file_id="upload-file-id",
                size=0,
                length=0,
                value_type=SegmentType.ARRAY_ANY,
            )
            variable_file.upload_file = upload_file

            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="app-id",
                user_id="user-id",
                node_id="test-node-id",
                name="test_array",
                value=StringSegment(value="truncated"),
                node_execution_id="execution-id",
                file_id=variable_file.id,
            )
            draft_var.id = "draft-var-id"
            draft_var.description = "test array description"
            draft_var.variable_file = variable_file

            test_array = ["item1", 2, True]
            test_json_content = json.dumps(test_array)

            with patch("services.workflow_draft_variable_service.storage") as mock_storage:
                mock_storage.load.return_value = test_json_content.encode()
                # Execute the method
                selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                # Verify results
                assert selector_tuple == ("test-node-id", "test_array")
                assert variable.id == "draft-var-id"
                assert variable.name == "test_array"
                assert variable.description == "test array description"

                # Verify method calls
                mock_storage.load.assert_called_once_with("storage/key/test_array.json")

        def test_load_offloaded_variable_file_type_rebuilds_storage_backed_payload(self, draft_var_loader):
            upload_file = UploadFile(
                tenant_id="tenant-id",
                storage_type="opendal",
                key="storage/key/test_file.json",
                name="test.txt",
                size=0,
                extension="txt",
                mime_type="text/plain",
                created_by_role="account",
                created_by="account-id",
                created_at=datetime.now(),
                used=False,
            )

            variable_file = WorkflowDraftVariableFile(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                upload_file_id="upload-file-id",
                size=0,
                length=0,
                value_type=SegmentType.FILE,
            )
            variable_file.upload_file = upload_file

            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="app-1",
                user_id="user-id",
                node_id="test-node-id",
                name="test_file",
                value=StringSegment(value="truncated"),
                node_execution_id="execution-id",
            )
            draft_var.id = "draft-var-id"
            draft_var.description = "test file description"
            draft_var._set_selector(["test-node-id", "test_file"])
            draft_var.variable_file = variable_file

            persisted_file = File(
                file_id="file-1",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=build_file_reference(record_id="upload-1", storage_key="legacy-storage-key"),
                filename="test.txt",
                extension=".txt",
                mime_type="text/plain",
                size=12,
            )
            rebuilt_file = File(
                file_id="file-1",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=build_file_reference(record_id="upload-1"),
                filename="test.txt",
                extension=".txt",
                mime_type="text/plain",
                size=12,
                storage_key="canonical-storage-key",
            )

            raw_file = {
                **persisted_file.model_dump(mode="json"),
                "tenant_id": "legacy-tenant",
            }

            with (
                patch("services.workflow_draft_variable_service.storage") as mock_storage,
                patch("models.workflow._resolve_workflow_app_tenant_id", return_value="tenant-1"),
                patch("models.workflow.build_file_from_stored_mapping", return_value=rebuilt_file) as rebuild_file,
            ):
                mock_storage.load.return_value = json.dumps(raw_file).encode()

                selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

            assert selector_tuple == ("test-node-id", "test_file")
            assert variable.id == "draft-var-id"
            assert variable.name == "test_file"
            assert variable.description == "test file description"
            assert variable.value == rebuilt_file
            rebuild_file.assert_called_once_with(file_mapping=raw_file, tenant_id="tenant-1")

        @pytest.mark.parametrize(
            "sqlite_session",
            [(WorkflowDraftVariable, WorkflowDraftVariableFile, UploadFile)],
            indirect=True,
        )
        def test_load_variables_with_offloaded_variables_unit(
            self,
            draft_var_loader: DraftVarLoader,
            sqlite_session: Session,
        ):
            """Test load_variables method with mix of regular and offloaded variables."""
            selectors = [["node1", "regular_var"], ["node2", "offloaded_var"]]
            regular_draft_var = WorkflowDraftVariable.new_node_variable(
                app_id="test-app-id",
                user_id="test-user-id",
                node_id="node1",
                name="regular_var",
                value=StringSegment(value="regular_value"),
                node_execution_id="execution-node1",
            )
            regular_draft_var.description = "regular description"
            offloaded_draft_var = _persist_offloaded_variable(
                sqlite_session,
                node_id="node2",
                name="offloaded_var",
            )
            distractor = WorkflowDraftVariable.new_node_variable(
                app_id="test-app-id",
                user_id="another-user",
                node_id="node1",
                name="regular_var",
                value=StringSegment(value="wrong user"),
                node_execution_id="execution-distractor",
            )
            sqlite_session.add_all([regular_draft_var, distractor])
            sqlite_session.commit()

            offloaded_variable = Mock()
            offloaded_variable.id = offloaded_draft_var.id
            offloaded_variable.selector = ["node2", "offloaded_var"]

            with (
                patch("services.workflow_draft_variable_service.StorageKeyLoader"),
                patch.object(
                    draft_var_loader,
                    "_load_offloaded_variable",
                    return_value=(("node2", "offloaded_var"), offloaded_variable),
                ) as load_offloaded,
                patch("services.workflow_draft_variable_service.ThreadPoolExecutor") as executor_cls,
            ):
                executor = executor_cls.return_value.__enter__.return_value
                executor.map.side_effect = lambda function, values: [function(value) for value in values]

                result = draft_var_loader.load_variables(selectors)

            assert {variable.id for variable in result} == {regular_draft_var.id, offloaded_draft_var.id}
            load_offloaded.assert_called_once()
            loaded_offloaded = load_offloaded.call_args.args[0]
            assert isinstance(loaded_offloaded, WorkflowDraftVariable)
            assert loaded_offloaded.id == offloaded_draft_var.id
            assert loaded_offloaded.variable_file is not None
            assert loaded_offloaded.variable_file.upload_file is not None
            assert loaded_offloaded.variable_file.upload_file.key == "storage/key/offloaded_var.txt"

        @pytest.mark.parametrize(
            "sqlite_session",
            [(WorkflowDraftVariable, WorkflowDraftVariableFile, UploadFile)],
            indirect=True,
        )
        def test_load_variables_all_offloaded_variables_unit(
            self,
            draft_var_loader: DraftVarLoader,
            sqlite_session: Session,
        ):
            """Test load_variables method with only offloaded variables."""
            selectors = [["node1", "offloaded_var1"], ["node2", "offloaded_var2"]]
            offloaded_var1 = _persist_offloaded_variable(
                sqlite_session,
                node_id="node1",
                name="offloaded_var1",
            )
            offloaded_var2 = _persist_offloaded_variable(
                sqlite_session,
                node_id="node2",
                name="offloaded_var2",
            )
            sqlite_session.commit()

            with (
                patch("services.workflow_draft_variable_service.StorageKeyLoader"),
                patch("services.workflow_draft_variable_service.ThreadPoolExecutor") as executor_cls,
            ):
                executor = executor_cls.return_value.__enter__.return_value
                executor.map.return_value = [
                    (("node1", "offloaded_var1"), Mock()),
                    (("node2", "offloaded_var2"), Mock()),
                ]

                result = draft_var_loader.load_variables(selectors)

            assert len(result) == 2
            executor_cls.assert_called_once_with(max_workers=10)
            executor.map.assert_called_once()
            loaded_draft_vars = executor.map.call_args.args[1]
            assert {variable.id for variable in loaded_draft_vars} == {offloaded_var1.id, offloaded_var2.id}
            assert all(variable.variable_file.upload_file is not None for variable in loaded_draft_vars)


SQLITE_MODELS = (Workflow, WorkflowDraftVariable, WorkflowDraftVariableFile, WorkflowNodeExecutionModel)


class TestWorkflowDraftVariableServiceCases:
    pytestmark = [
        pytest.mark.usefixtures("sqlite_session"),
        pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
    ]

    class TestDraftVariableSaver:
        def _get_test_app_id(self):
            suffix = secrets.token_hex(6)
            return f"test_app_id_{suffix}"

        def test__should_variable_be_visible(self, sqlite_session: Session):
            mock_user = _workflow_draft_variable_service_Account(name="test", email="test@example.com")
            mock_user.id = str(uuid.uuid4())
            test_app_id = self._get_test_app_id()
            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="test-tenant-id",
                app_id=test_app_id,
                node_id="test_node_id",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.START,
                node_execution_id="test_execution_id",
                user=mock_user,
            )
            assert (
                saver._should_variable_be_visible(
                    "123_456", _workflow_draft_variable_service_BuiltinNodeTypes.IF_ELSE, "output"
                )
                is False
            )
            assert (
                saver._should_variable_be_visible(
                    "123", _workflow_draft_variable_service_BuiltinNodeTypes.START, "output"
                )
                is True
            )

        def test__normalize_variable_for_start_node(self, sqlite_session: Session):
            @dataclasses.dataclass(frozen=True)
            class TestCase:
                name: str
                input_node_id: str
                input_name: str
                expected_node_id: str
                expected_name: str

            _node_id = "1747228642872"
            cases = [
                TestCase(
                    name="name with `sys.` prefix should return the system node_id",
                    input_node_id=_node_id,
                    input_name="sys.workflow_id",
                    expected_node_id=SYSTEM_VARIABLE_NODE_ID,
                    expected_name="workflow_id",
                ),
                TestCase(
                    name="name without `sys.` prefix should return the original input node_id",
                    input_node_id=_node_id,
                    input_name="start_input",
                    expected_node_id=_node_id,
                    expected_name="start_input",
                ),
                TestCase(
                    name="name with `env.` prefix should return the environment node_id",
                    input_node_id=_node_id,
                    input_name="env.API_KEY",
                    expected_node_id=ENVIRONMENT_VARIABLE_NODE_ID,
                    expected_name="API_KEY",
                ),
                TestCase(
                    name="name with `conversation.` prefix should return the conversation node_id",
                    input_node_id=_node_id,
                    input_name="conversation.session_id",
                    expected_node_id=CONVERSATION_VARIABLE_NODE_ID,
                    expected_name="session_id",
                ),
                TestCase(
                    name="dummy_variable should return the original input node_id",
                    input_node_id=_node_id,
                    input_name="__dummy__",
                    expected_node_id=_node_id,
                    expected_name="__dummy__",
                ),
            ]

            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = str(uuid.uuid4())
            test_app_id = self._get_test_app_id()
            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="test-tenant-id",
                app_id=test_app_id,
                node_id=_node_id,
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.START,
                node_execution_id="test_execution_id",
                user=mock_user,
            )
            for idx, c in enumerate(cases, 1):
                fail_msg = f"Test case {c.name} failed, index={idx}"
                node_id, name = saver._normalize_variable_for_start_node(c.input_name)
                assert node_id == c.expected_node_id, fail_msg
                assert name == c.expected_name, fail_msg

        def test_build_variables_from_start_mapping_rebuilds_system_files(self, sqlite_session: Session):
            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = str(uuid.uuid4())
            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="tenant-1",
                app_id=self._get_test_app_id(),
                node_id="start",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.START,
                node_execution_id="exec-1",
                user=mock_user,
            )
            rebuilt_file = File(
                file_id="file-1",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference="upload-1",
                filename="test.txt",
                extension=".txt",
                mime_type="text/plain",
                size=12,
                storage_key="canonical-storage-key",
            )
            raw_file = {
                **rebuilt_file.model_dump(mode="json"),
                "tenant_id": "legacy-tenant",
            }

            with patch.object(
                saver._file_inputs,
                "restore",
                return_value=rebuilt_file,
            ) as rebuild_file:
                draft_vars = saver._build_variables_from_start_mapping({"sys.files": [raw_file]})

            sys_var = draft_vars[0]
            assert sys_var.get_value().value[0] == rebuilt_file
            rebuild_file.assert_called_once_with(mapping=raw_file, tenant_id="tenant-1")

        @pytest.fixture
        def draft_saver(self, sqlite_session: Session):
            """Create _ApplicationDraftVariableSaver instance with user context."""
            # Create a mock user
            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = "test-user-id"

            return _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="test-tenant-id",
                app_id="test-app-id",
                node_id="test-node-id",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.LLM,
                node_execution_id="test-execution-id",
                user=mock_user,
            )

        def test_draft_saver_with_small_variables(self, draft_saver: _ApplicationDraftVariableSaver):
            with patch(
                "services.workflow.draft_variable_service.DraftVariableSaver._try_offload_large_variable",
                autospec=True,
            ) as _mock_try_offload:
                _mock_try_offload.return_value = None
                mock_segment = StringSegment(value="small value")
                draft_var = draft_saver._create_draft_variable(name="small_var", value=mock_segment, visible=True)

                # Should not have large variable metadata
                assert draft_var.file_id is None
                _mock_try_offload.return_value = None

        def test_draft_saver_with_large_variables(self, draft_saver: _ApplicationDraftVariableSaver):
            with patch(
                "services.workflow.draft_variable_service.DraftVariableSaver._try_offload_large_variable",
                autospec=True,
            ) as _mock_try_offload:
                mock_segment = StringSegment(value="small value")
                mock_draft_var_file = WorkflowDraftVariableFile(
                    tenant_id=str(uuidv7()),
                    app_id=str(uuidv7()),
                    user_id=str(uuidv7()),
                    size=1024,
                    length=10,
                    value_type=SegmentType.ARRAY_STRING,
                    upload_file_id=str(uuidv7()),
                )
                mock_draft_var_file.id = str(uuidv7())

                _mock_try_offload.return_value = mock_segment, mock_draft_var_file
                draft_var = draft_saver._create_draft_variable(name="small_var", value=mock_segment, visible=True)

                # Should not have large variable metadata
                assert draft_var.file_id == mock_draft_var_file.id

        def test_try_offload_large_variable_uses_resource_tenant(self, sqlite_session: Session):
            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = "test-user-id"
            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="app-tenant-id",
                app_id="test-app-id",
                node_id="test-node-id",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.LLM,
                node_execution_id="test-execution-id",
                user=mock_user,
            )
            upload_file = UploadFile(
                tenant_id="app-tenant-id",
                storage_type=StorageType.LOCAL,
                key="workflow/draft-variable.txt",
                name="draft-variable.txt",
                size=11,
                extension="txt",
                mime_type="text/plain",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=mock_user.id,
                created_at=naive_utc_now(),
                used=True,
            )
            sqlite_session.add(upload_file)
            sqlite_session.commit()
            truncation_result = TruncationResult(result=StringSegment(value="..."), truncated=True)

            with (
                patch(
                    "services.workflow.draft_variable_service.VariableTruncator.truncate",
                    return_value=truncation_result,
                ),
                patch.object(saver._files, "upload_file", return_value=upload_file) as upload,
            ):
                result = saver._try_offload_large_variable("large_var", StringSegment(value="large value"))

            assert result is not None
            _, variable_file = result
            assert upload.call_args.kwargs["tenant_id"] == "app-tenant-id"
            assert variable_file.tenant_id == "app-tenant-id"
            sqlite_session.expire_all()
            stored_variable_file = sqlite_session.get(WorkflowDraftVariableFile, variable_file.id)
            assert stored_variable_file is None
            assert variable_file.upload_file_id == upload_file.id

        @patch("repositories.workflow.draft_variable_repository._batch_upsert_draft_variable", autospec=True)
        def test_save_method_integration(self, mock_batch_upsert, draft_saver):
            """Test complete save workflow."""
            outputs = {"result": {"data": "test_output"}, "metadata": {"type": "llm_response"}}

            draft_saver.save(outputs=outputs)

            # Should batch upsert draft variables
            mock_batch_upsert.assert_called_once()
            draft_vars = mock_batch_upsert.call_args[0][1]
            assert len(draft_vars) == 2

        @patch("repositories.workflow.draft_variable_repository._batch_upsert_draft_variable", autospec=True)
        def test_start_node_save_persists_sys_timestamp_and_workflow_run_id(
            self, mock_batch_upsert, sqlite_session: Session
        ):
            """Start node should persist common `sys.*` variables, not only `sys.files`."""
            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = "test-user-id"
            mock_user.tenant_id = "test-tenant-id"

            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="test-tenant-id",
                app_id="test-app-id",
                node_id="start-node-id",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.START,
                node_execution_id="exec-id",
                user=mock_user,
            )

            outputs = {
                f"{SYSTEM_VARIABLE_NODE_ID}.{SystemVariableKey.TIMESTAMP}": 1700000000,
                f"{SYSTEM_VARIABLE_NODE_ID}.{SystemVariableKey.WORKFLOW_EXECUTION_ID}": "run-id-123",
            }

            saver.save(outputs=outputs)

            mock_batch_upsert.assert_called_once()
            draft_vars = mock_batch_upsert.call_args[0][1]

            # plus one dummy output because there are no non-sys Start inputs
            assert len(draft_vars) == 3

            sys_vars = [v for v in draft_vars if v.node_id == SYSTEM_VARIABLE_NODE_ID]
            assert {v.name for v in sys_vars} == {
                str(SystemVariableKey.TIMESTAMP),
                str(SystemVariableKey.WORKFLOW_EXECUTION_ID),
            }

        @patch("repositories.workflow.draft_variable_repository._batch_upsert_draft_variable", autospec=True)
        def test_start_node_save_normalizes_reserved_prefix_outputs(self, mock_batch_upsert, sqlite_session: Session):
            mock_user = _workflow_draft_variable_service_Account(
                name="Test _workflow_draft_variable_service_Account", email="test@example.com"
            )
            mock_user.id = "test-user-id"
            mock_user.tenant_id = "test-tenant-id"

            saver = _ApplicationDraftVariableSaver(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), DatabaseFileAccessController()
                ),
                cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
                ),
                files=FileService(sqlite_session.get_bind()),
                tenant_id="test-tenant-id",
                app_id="test-app-id",
                node_id="start-node-id",
                node_type=_workflow_draft_variable_service_BuiltinNodeTypes.START,
                node_execution_id="exec-id",
                user=mock_user,
            )

            saver.save(
                outputs={
                    "env.API_KEY": "secret",
                    "conversation.session_id": "conversation-1",
                    "sys.workflow_run_id": "run-id-123",
                }
            )

            mock_batch_upsert.assert_called_once()
            draft_vars = mock_batch_upsert.call_args[0][1]

            assert len(draft_vars) == 3

            env_var = next(v for v in draft_vars if v.node_id == ENVIRONMENT_VARIABLE_NODE_ID)
            assert env_var.name == "API_KEY"
            assert env_var.editable is False

            conversation_var = next(v for v in draft_vars if v.node_id == CONVERSATION_VARIABLE_NODE_ID)
            assert conversation_var.name == "session_id"
            assert conversation_var.node_execution_id is None

            sys_var = next(v for v in draft_vars if v.node_id == SYSTEM_VARIABLE_NODE_ID)
            assert sys_var.name == str(SystemVariableKey.WORKFLOW_EXECUTION_ID)

    class TestWorkflowVariableService:
        def _get_test_app_id(self):
            suffix = secrets.token_hex(6)
            return f"test_app_id_{suffix}"

        def test_list_variables_without_values_excludes_node_ids(self, sqlite_session: Session):
            service = build_workflow_variable_service(
                database_client=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
            )
            variable = WorkflowDraftVariable.new_node_variable(
                app_id="app-1",
                node_id="node-1",
                name="output",
                value=StringSegment(value="value"),
                node_execution_id="execution-1",
            )
            variable.user_id = "user-1"
            excluded_system = WorkflowDraftVariable.new_sys_variable(
                app_id="app-1", name="query", value=StringSegment(value="hidden"), node_execution_id="execution-1"
            )
            excluded_system.user_id = "user-1"
            other_user = WorkflowDraftVariable.new_node_variable(
                app_id="app-1",
                node_id="node-2",
                name="output",
                value=StringSegment(value="other"),
                node_execution_id="execution-2",
            )
            other_user.user_id = "user-2"
            sqlite_session.add_all([variable, excluded_system, other_user])
            sqlite_session.commit()

            result = service.list_variables_without_values(
                app_id="app-1",
                page=1,
                limit=20,
                user_id="user-1",
                exclude_node_ids={SYSTEM_VARIABLE_NODE_ID, CONVERSATION_VARIABLE_NODE_ID},
            )

            assert result.total == 1
            assert [item.id for item in result.variables] == [variable.id]

        def test_system_variable_editability_check(self):
            """Test the system variable editability function directly"""
            # Test editable system variables
            assert is_system_variable_editable("files") is True
            assert is_system_variable_editable("query") is True

            # Test non-editable system variables
            assert is_system_variable_editable("workflow_id") is False
            assert is_system_variable_editable("conversation_id") is False
            assert is_system_variable_editable("user_id") is False

        def test_workflow_draft_variable_factory_methods(self):
            """Test that factory methods create proper instances"""
            test_app_id = self._get_test_app_id()
            test_value = StringSegment(value="test_value")

            # Test conversation variable factory
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id=test_app_id, name="conv_var", value=test_value, description="Test conversation variable"
            )
            assert conv_var.get_variable_type() == DraftVariableType.CONVERSATION
            assert conv_var.editable is True
            assert conv_var.node_execution_id is None

            # Test system variable factory
            sys_var = WorkflowDraftVariable.new_sys_variable(
                app_id=test_app_id, name="workflow_id", value=test_value, node_execution_id="exec-id", editable=False
            )
            assert sys_var.get_variable_type() == DraftVariableType.SYS
            assert sys_var.editable is False
            assert sys_var.node_execution_id == "exec-id"

            # Test node variable factory
            node_var = WorkflowDraftVariable.new_node_variable(
                app_id=test_app_id,
                node_id="node-id",
                name="node_var",
                value=test_value,
                node_execution_id="exec-id",
                visible=True,
                editable=True,
            )
            assert node_var.get_variable_type() == DraftVariableType.NODE
            assert node_var.visible is True
            assert node_var.editable is True
            assert node_var.node_execution_id == "exec-id"

    class TestModelToInsertionDict:
        """Reproduce two production errors in _model_to_insertion_dict / _new()."""

        def test_visible_and_is_default_value_always_present(self):
            """Problem 1: _new() did not set visible/is_default_value, causing
            inconsistent dict keys across rows in multi-row INSERT and missing
            is_default_value in the insertion dict entirely.
            """
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id="app-1",
                name="counter",
                value=StringSegment(value="0"),
            )
            # _new() should explicitly set these fields so they are not None
            assert conv_var.visible is not None
            assert conv_var.is_default_value is not None

            d = _model_to_insertion_dict(conv_var)
            # visible must appear in every row's dict
            assert "visible" in d
            # is_default_value must always be present
            assert "is_default_value" in d

        def test_description_passthrough(self):
            """_model_to_insertion_dict passes description as-is;
            length validation is enforced earlier in build_conversation_variable_from_mapping.
            """
            desc = "a" * 200
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id="app-1",
                name="counter",
                value=StringSegment(value="0"),
                description=desc,
            )
            d = _model_to_insertion_dict(conv_var)
            assert d["description"] == desc

        def test_is_default_value_omitted_when_none(self):
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id="app-1",
                name="counter",
                value=StringSegment(value="0"),
            )
            conv_var.is_default_value = None

            d = _model_to_insertion_dict(conv_var)

            assert "is_default_value" not in d


"""SQLite-backed workflow draft-variable service coverage."""


def _persist_account(*, engine: Engine, tenant_id: str) -> _workflow_draft_variable_service_sqlite_Account:
    tenant = Tenant(name="draft-variable-tenant")
    tenant.id = tenant_id
    account = _workflow_draft_variable_service_sqlite_Account(
        email=f"draft-{uuid.uuid4()}@example.com", name="Draft Variable User"
    )
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)
    with Session(bind=engine, expire_on_commit=False) as session:
        session.add_all([tenant, account, membership])
        session.commit()
    return account


class TestWorkflowDraftVariableServiceSqliteCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _bind_storage(
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        monkeypatch.setattr(
            storage,
            "storage_runner",
            OpenDALStorage(scheme="fs", root=str(tmp_path / "storage")),
            raising=False,
        )

    class TestWorkflowVariableService(unittest.TestCase):
        _test_app_id: str
        _session: Session
        _test_user_id: str
        _node1_id = "test_node_1"
        _node2_id = "test_node_2"
        _node_exec_id = str(uuid.uuid4())

        @pytest.fixture(autouse=True)
        def _bind_session(self, sqlite_session: Session) -> None:
            self._session = sqlite_session

        @override
        def setUp(self) -> None:
            self._test_app_id = str(uuid.uuid4())
            self._test_user_id = str(uuid.uuid4())
            sys_var = WorkflowDraftVariable.new_sys_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                name="sys_var",
                value=build_segment("sys_value"),
                node_execution_id=self._node_exec_id,
            )
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                name="conv_var",
                value=build_segment("conv_value"),
            )
            node2_vars = [
                WorkflowDraftVariable.new_node_variable(
                    app_id=self._test_app_id,
                    user_id=self._test_user_id,
                    node_id=self._node2_id,
                    name="int_var",
                    value=build_segment(1),
                    visible=False,
                    node_execution_id=self._node_exec_id,
                ),
                WorkflowDraftVariable.new_node_variable(
                    app_id=self._test_app_id,
                    user_id=self._test_user_id,
                    node_id=self._node2_id,
                    name="str_var",
                    value=build_segment("str_value"),
                    visible=True,
                    node_execution_id=self._node_exec_id,
                ),
            ]
            node1_var = WorkflowDraftVariable.new_node_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                node_id=self._node1_id,
                name="str_var",
                value=build_segment("str_value"),
                visible=True,
                node_execution_id=self._node_exec_id,
            )
            _variables = list(node2_vars)
            _variables.extend(
                [
                    node1_var,
                    sys_var,
                    conv_var,
                ]
            )

            self._session.add_all(_variables)
            self._session.commit()
            self._variable_ids = [v.id for v in _variables]
            self._node1_str_var_id = node1_var.id
            self._sys_var_id = sys_var.id
            self._conv_var_id = conv_var.id
            self._node2_var_ids = [v.id for v in node2_vars]

        def _get_test_srv(self) -> WorkflowVariableService:
            return build_workflow_variable_service(
                database_client=sessionmaker(bind=self._session.get_bind(), expire_on_commit=False)
            )

        @override
        def tearDown(self) -> None:
            self._session.rollback()

        def test_list_variables(self) -> None:
            srv = self._get_test_srv()
            var_list = srv.list_variables_without_values(self._test_app_id, page=1, limit=2, user_id=self._test_user_id)
            assert var_list.total == 5
            assert len(var_list.variables) == 2
            page1_var_ids = {v.id for v in var_list.variables}
            assert page1_var_ids.issubset(self._variable_ids)

            var_list_2 = srv.list_variables_without_values(
                self._test_app_id, page=2, limit=2, user_id=self._test_user_id
            )
            assert var_list_2.total is None
            assert len(var_list_2.variables) == 2
            page2_var_ids = {v.id for v in var_list_2.variables}
            assert page2_var_ids.isdisjoint(page1_var_ids)
            assert page2_var_ids.issubset(self._variable_ids)

        def test_delete_node_variables(self) -> None:
            srv = self._get_test_srv()
            srv.delete_node_variables(self._test_app_id, self._node2_id, user_id=self._test_user_id)
            node2_var_count = self._session.scalar(
                select(func.count())
                .select_from(WorkflowDraftVariable)
                .where(
                    WorkflowDraftVariable.app_id == self._test_app_id,
                    WorkflowDraftVariable.node_id == self._node2_id,
                    WorkflowDraftVariable.user_id == self._test_user_id,
                )
            )
            assert node2_var_count == 0

        def test_get_draft_variables_by_selectors(self) -> None:
            selectors = [
                [self._node1_id, "str_var"],
                [self._node2_id, "str_var"],
                [self._node2_id, "int_var"],
            ]
            variables = WorkflowDraftVariableRepository(
                sessions=sessionmaker(bind=self._session.get_bind(), expire_on_commit=False)
            ).get_draft_variables_by_selectors(self._test_app_id, selectors, user_id=self._test_user_id)
            assert len(variables) == 3
            assert {v.id for v in variables} == {self._node1_str_var_id} | set(self._node2_var_ids)

    class TestDraftVariableLoader(unittest.TestCase):
        _test_app_id: str
        _test_tenant_id: str
        _engine: Engine

        _node1_id = "test_loader_node_1"
        _node_exec_id = str(uuid.uuid4())

        @pytest.fixture(autouse=True)
        def _bind_engine(self, sqlite_engine: Engine) -> None:
            self._engine = sqlite_engine

        @override
        def setUp(self) -> None:
            self._test_app_id = str(uuid.uuid4())
            self._test_tenant_id = str(uuid.uuid4())
            self._test_user_id = str(uuid.uuid4())
            sys_var = WorkflowDraftVariable.new_sys_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                name="sys_var",
                value=build_segment("sys_value"),
                node_execution_id=self._node_exec_id,
            )
            conv_var = WorkflowDraftVariable.new_conversation_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                name="conv_var",
                value=build_segment("conv_value"),
            )
            node_var = WorkflowDraftVariable.new_node_variable(
                app_id=self._test_app_id,
                user_id=self._test_user_id,
                node_id=self._node1_id,
                name="str_var",
                value=build_segment("str_value"),
                visible=True,
                node_execution_id=self._node_exec_id,
            )
            _variables = [
                node_var,
                sys_var,
                conv_var,
            ]

            with Session(bind=self._engine, expire_on_commit=False) as session:
                session.add_all(_variables)
                session.flush()
                session.commit()
            self._variable_ids = [v.id for v in _variables]
            self._node_var_id = node_var.id
            self._sys_var_id = sys_var.id
            self._conv_var_id = conv_var.id

        @override
        def tearDown(self) -> None:
            with Session(bind=self._engine, expire_on_commit=False) as session:
                session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.app_id == self._test_app_id))
                session.commit()

        def test_variable_loader_with_empty_selector(self) -> None:
            var_loader = _ApplicationDraftVarLoader(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                ),
                load_file=storage.load,
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=self._engine, expire_on_commit=False)
                ),
                app_id=self._test_app_id,
                tenant_id=self._test_tenant_id,
                user_id=self._test_user_id,
            )
            variables = var_loader.load_variables([])
            assert len(variables) == 0

        def test_variable_loader_with_non_empty_selector(self) -> None:
            var_loader = _ApplicationDraftVarLoader(
                file_inputs=WorkflowVariableFileGateway(
                    sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                ),
                load_file=storage.load,
                repository=WorkflowDraftVariableRepository(
                    sessions=sessionmaker(bind=self._engine, expire_on_commit=False)
                ),
                app_id=self._test_app_id,
                tenant_id=self._test_tenant_id,
                user_id=self._test_user_id,
            )
            variables = var_loader.load_variables(
                [
                    [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
                    [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
                    [self._node1_id, "str_var"],
                ]
            )
            assert len(variables) == 3
            conv_var = next(v for v in variables if v.selector[0] == CONVERSATION_VARIABLE_NODE_ID)
            assert conv_var.id == self._conv_var_id
            sys_var = next(v for v in variables if v.selector[0] == SYSTEM_VARIABLE_NODE_ID)
            assert sys_var.id == self._sys_var_id
            node1_var = next(v for v in variables if v.selector[0] == self._node1_id)
            assert node1_var.id == self._node_var_id

        def test_load_offloaded_variable_string_type_integration(self) -> None:
            """Test _load_offloaded_variable with string type using _ApplicationDraftVariableSaver for data creation."""
            account = _persist_account(engine=self._engine, tenant_id=self._test_tenant_id)

            # Create a large string that will be offloaded
            test_content = "x" * 15000  # Create a string larger than LARGE_VARIABLE_THRESHOLD (10KB)
            large_string_segment = StringSegment(value=test_content)

            node_execution_id = str(uuid.uuid4())

            try:
                with Session(bind=self._engine, expire_on_commit=False) as session:
                    # Use _ApplicationDraftVariableSaver to create offloaded variable (this mimics production)
                    saver = _ApplicationDraftVariableSaver(
                        file_inputs=WorkflowVariableFileGateway(
                            sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                        ),
                        cleanup_files=lambda _ids: pytest.fail("Unexpected failed-upload cleanup"),
                        repository=WorkflowDraftVariableRepository(
                            sessions=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
                        ),
                        files=FileService(self._engine),
                        tenant_id=self._test_tenant_id,
                        app_id=self._test_app_id,
                        node_id="test_offload_node",
                        node_type=_workflow_draft_variable_service_sqlite_BuiltinNodeTypes.LLM,  # Use a real node type
                        node_execution_id=node_execution_id,
                        user=account,
                    )

                    # Save the variable - this will trigger offloading due to large size
                    saver.save(outputs={"offloaded_string_var": large_string_segment})
                    session.commit()

                    # Now test loading using _ApplicationDraftVarLoader
                    var_loader = _ApplicationDraftVarLoader(
                        file_inputs=WorkflowVariableFileGateway(
                            sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                        ),
                        load_file=storage.load,
                        repository=WorkflowDraftVariableRepository(
                            sessions=sessionmaker(bind=self._engine, expire_on_commit=False)
                        ),
                        app_id=self._test_app_id,
                        tenant_id=self._test_tenant_id,
                        user_id=account.id,
                    )

                    # Load the variable using the standard workflow
                    variables = var_loader.load_variables([["test_offload_node", "offloaded_string_var"]])

                    # Verify results
                    assert len(variables) == 1
                    loaded_variable = variables[0]
                    assert loaded_variable.name == "offloaded_string_var"
                    assert loaded_variable.selector == ["test_offload_node", "offloaded_string_var"]
                    assert loaded_variable.value == test_content

            finally:
                build_workflow_variable_service(
                    database_client=sessionmaker(bind=self._engine, expire_on_commit=False)
                ).delete_user_workflow_variables(self._test_app_id, user_id=account.id)

        def test_load_offloaded_variable_object_type_integration(self) -> None:
            """Test _load_offloaded_variable with object type using real storage and service."""

            # Create a test object
            test_object = {"key1": "value1", "key2": 42, "nested": {"inner": "data"}}
            test_json = json.dumps(test_object, ensure_ascii=False, separators=(",", ":"))
            content_bytes = test_json.encode()

            # Create an upload file record
            upload_file = UploadFile(
                tenant_id=self._test_tenant_id,
                storage_type=StorageType.LOCAL,
                key=f"test_offload_{uuid.uuid4()}.json",
                name="test_offload.json",
                size=len(content_bytes),
                extension="json",
                mime_type="application/json",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid.uuid4()),
                created_at=datetime_utils.naive_utc_now(),
                used=True,
                used_by=str(uuid.uuid4()),
                used_at=datetime_utils.naive_utc_now(),
            )

            # Store the content in storage
            storage.save(upload_file.key, content_bytes)

            # Create a variable file record
            variable_file = WorkflowDraftVariableFile(
                upload_file_id=upload_file.id,
                value_type=SegmentType.OBJECT,
                tenant_id=self._test_tenant_id,
                app_id=self._test_app_id,
                user_id=str(uuid.uuid4()),
                size=len(content_bytes),
                length=len(test_object),
                created_at=datetime_utils.naive_utc_now(),
            )

            try:
                with Session(bind=self._engine, expire_on_commit=False) as session:
                    # Add upload file and variable file first to get their IDs
                    session.add_all([upload_file, variable_file])
                    session.flush()  # This generates the IDs

                    # Now create the offloaded draft variable with the correct file_id
                    offloaded_var = WorkflowDraftVariable.new_node_variable(
                        app_id=self._test_app_id,
                        user_id=self._test_user_id,
                        node_id="test_offload_node",
                        name="offloaded_object_var",
                        value=build_segment({"truncated": True}),
                        visible=True,
                        node_execution_id=str(uuid.uuid4()),
                    )
                    offloaded_var.file_id = variable_file.id

                    session.add(offloaded_var)
                    session.flush()
                    session.commit()

                    draft_vars = WorkflowDraftVariableRepository(
                        sessions=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
                    ).get_draft_variables_by_selectors(
                        self._test_app_id,
                        [["test_offload_node", "offloaded_object_var"]],
                        user_id=self._test_user_id,
                    )

                    assert len(draft_vars) == 1
                    loaded_var = draft_vars[0]
                    assert loaded_var.is_truncated()

                    # Create _ApplicationDraftVarLoader and test loading
                    var_loader = _ApplicationDraftVarLoader(
                        file_inputs=WorkflowVariableFileGateway(
                            sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                        ),
                        load_file=storage.load,
                        repository=WorkflowDraftVariableRepository(
                            sessions=sessionmaker(bind=self._engine, expire_on_commit=False)
                        ),
                        app_id=self._test_app_id,
                        tenant_id=self._test_tenant_id,
                        user_id=self._test_user_id,
                    )

                    # Test the _load_offloaded_variable method
                    selector_tuple, variable = var_loader._load_offloaded_variable(loaded_var)

                    # Verify the results
                    assert selector_tuple == ("test_offload_node", "offloaded_object_var")
                    assert variable.id == loaded_var.id
                    assert variable.name == "offloaded_object_var"
                    assert variable.value == test_object

            finally:
                # Clean up
                with Session(bind=self._engine) as session:
                    # Query and delete by ID to ensure they're tracked in this session
                    session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.id == offloaded_var.id))
                    session.execute(
                        delete(WorkflowDraftVariableFile).where(WorkflowDraftVariableFile.id == variable_file.id)
                    )
                    session.execute(delete(UploadFile).where(UploadFile.id == upload_file.id))
                    session.commit()
                storage.delete(upload_file.key)

        def test_load_variables_with_offloaded_variables_integration(self) -> None:
            """Test load_variables method with mix of regular and offloaded variables using real storage."""
            # Create a regular variable (already exists from setUp)
            # Create offloaded variable content
            test_content = "This is offloaded content for integration test"
            content_bytes = test_content.encode()

            # Create upload file record
            upload_file = UploadFile(
                tenant_id=self._test_tenant_id,
                storage_type=StorageType.LOCAL,
                key=f"test_integration_{uuid.uuid4()}.txt",
                name="test_integration.txt",
                size=len(content_bytes),
                extension="txt",
                mime_type="text/plain",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid.uuid4()),
                created_at=datetime_utils.naive_utc_now(),
                used=True,
                used_by=str(uuid.uuid4()),
                used_at=datetime_utils.naive_utc_now(),
            )

            # Store the content
            storage.save(upload_file.key, content_bytes)

            # Create variable file
            variable_file = WorkflowDraftVariableFile(
                upload_file_id=upload_file.id,
                value_type=SegmentType.STRING,
                tenant_id=self._test_tenant_id,
                app_id=self._test_app_id,
                user_id=str(uuid.uuid4()),
                size=len(content_bytes),
                length=None,
                created_at=datetime_utils.naive_utc_now(),
            )

            try:
                with Session(bind=self._engine, expire_on_commit=False) as session:
                    # Add upload file and variable file first to get their IDs
                    session.add_all([upload_file, variable_file])
                    session.flush()  # This generates the IDs

                    # Now create the offloaded draft variable with the correct file_id
                    offloaded_var = WorkflowDraftVariable.new_node_variable(
                        app_id=self._test_app_id,
                        user_id=self._test_user_id,
                        node_id="test_integration_node",
                        name="offloaded_integration_var",
                        value=build_segment("truncated"),
                        visible=True,
                        node_execution_id=str(uuid.uuid4()),
                    )
                    offloaded_var.file_id = variable_file.id

                    session.add(offloaded_var)
                    session.flush()
                    session.commit()

                    # Test load_variables with both regular and offloaded variables
                    # This method should handle the relationship preloading internally
                    var_loader = _ApplicationDraftVarLoader(
                        file_inputs=WorkflowVariableFileGateway(
                            sessionmaker(bind=self._engine, expire_on_commit=False), DatabaseFileAccessController()
                        ),
                        load_file=storage.load,
                        repository=WorkflowDraftVariableRepository(
                            sessions=sessionmaker(bind=self._engine, expire_on_commit=False)
                        ),
                        app_id=self._test_app_id,
                        tenant_id=self._test_tenant_id,
                        user_id=self._test_user_id,
                    )

                    variables = var_loader.load_variables(
                        [
                            [SYSTEM_VARIABLE_NODE_ID, "sys_var"],  # Regular variable from setUp
                            ["test_integration_node", "offloaded_integration_var"],  # Offloaded variable
                        ]
                    )

                    # Verify results
                    assert len(variables) == 2

                    # Find regular variable
                    regular_var = next(v for v in variables if v.selector[0] == SYSTEM_VARIABLE_NODE_ID)
                    assert regular_var.id == self._sys_var_id
                    assert regular_var.value == "sys_value"

                    # Find offloaded variable
                    offloaded_loaded_var = next(v for v in variables if v.selector[0] == "test_integration_node")
                    assert offloaded_loaded_var.id == offloaded_var.id
                    assert offloaded_loaded_var.value == test_content

            finally:
                # Clean up
                with Session(bind=self._engine) as session:
                    # Query and delete by ID to ensure they're tracked in this session
                    session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.id == offloaded_var.id))
                    session.execute(
                        delete(WorkflowDraftVariableFile).where(WorkflowDraftVariableFile.id == variable_file.id)
                    )
                    session.execute(delete(UploadFile).where(UploadFile.id == upload_file.id))
                    session.commit()
                storage.delete(upload_file.key)
