import dataclasses
import secrets
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from extensions.application_services.workflow_variables import build_workflow_variable_service
from extensions.storage.storage_type import StorageType
from graphon.enums import BuiltinNodeTypes
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import StringSegment
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account
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
    DraftVariableSaver,
)
from services.workflow.variable_file_gateway import WorkflowVariableFileGateway

SQLITE_MODELS = (Workflow, WorkflowDraftVariable, WorkflowDraftVariableFile, WorkflowNodeExecutionModel)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


class TestDraftVariableSaver:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test__should_variable_be_visible(self, sqlite_session: Session):
        mock_user = Account(name="test", email="test@example.com")
        mock_user.id = str(uuid.uuid4())
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.START,
            node_execution_id="test_execution_id",
            user=mock_user,
        )
        assert saver._should_variable_be_visible("123_456", BuiltinNodeTypes.IF_ELSE, "output") == False
        assert saver._should_variable_be_visible("123", BuiltinNodeTypes.START, "output") == True

    def test__normalize_variable_for_start_node(self, sqlite_session: Session):
        @dataclasses.dataclass(frozen=True)
        class TestCase:
            name: str
            input_node_id: str
            input_name: str
            expected_node_id: str
            expected_name: str

        _NODE_ID = "1747228642872"
        cases = [
            TestCase(
                name="name with `sys.` prefix should return the system node_id",
                input_node_id=_NODE_ID,
                input_name="sys.workflow_id",
                expected_node_id=SYSTEM_VARIABLE_NODE_ID,
                expected_name="workflow_id",
            ),
            TestCase(
                name="name without `sys.` prefix should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="start_input",
                expected_node_id=_NODE_ID,
                expected_name="start_input",
            ),
            TestCase(
                name="name with `env.` prefix should return the environment node_id",
                input_node_id=_NODE_ID,
                input_name="env.API_KEY",
                expected_node_id=ENVIRONMENT_VARIABLE_NODE_ID,
                expected_name="API_KEY",
            ),
            TestCase(
                name="name with `conversation.` prefix should return the conversation node_id",
                input_node_id=_NODE_ID,
                input_name="conversation.session_id",
                expected_node_id=CONVERSATION_VARIABLE_NODE_ID,
                expected_name="session_id",
            ),
            TestCase(
                name="dummy_variable should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="__dummy__",
                expected_node_id=_NODE_ID,
                expected_name="__dummy__",
            ),
        ]

        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = str(uuid.uuid4())
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
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
            node_id=_NODE_ID,
            node_type=BuiltinNodeTypes.START,
            node_execution_id="test_execution_id",
            user=mock_user,
        )
        for idx, c in enumerate(cases, 1):
            fail_msg = f"Test case {c.name} failed, index={idx}"
            node_id, name = saver._normalize_variable_for_start_node(c.input_name)
            assert node_id == c.expected_node_id, fail_msg
            assert name == c.expected_name, fail_msg

    def test_build_variables_from_start_mapping_rebuilds_system_files(self, sqlite_session: Session):
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = str(uuid.uuid4())
        saver = DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.START,
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
        """Create DraftVariableSaver instance with user context."""
        # Create a mock user
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"

        return DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.LLM,
            node_execution_id="test-execution-id",
            user=mock_user,
        )

    def test_draft_saver_with_small_variables(self, draft_saver: DraftVariableSaver):
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

    def test_draft_saver_with_large_variables(self, draft_saver: DraftVariableSaver):
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
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
        saver = DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.LLM,
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
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
        mock_user.tenant_id = "test-tenant-id"

        saver = DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.START,
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
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
        mock_user.tenant_id = "test-tenant-id"

        saver = DraftVariableSaver(
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
            node_type=BuiltinNodeTypes.START,
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
        assert is_system_variable_editable("files") == True
        assert is_system_variable_editable("query") == True

        # Test non-editable system variables
        assert is_system_variable_editable("workflow_id") == False
        assert is_system_variable_editable("conversation_id") == False
        assert is_system_variable_editable("user_id") == False

    def test_workflow_draft_variable_factory_methods(self):
        """Test that factory methods create proper instances"""
        test_app_id = self._get_test_app_id()
        test_value = StringSegment(value="test_value")

        # Test conversation variable factory
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id, name="conv_var", value=test_value, description="Test conversation variable"
        )
        assert conv_var.get_variable_type() == DraftVariableType.CONVERSATION
        assert conv_var.editable == True
        assert conv_var.node_execution_id is None

        # Test system variable factory
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id, name="workflow_id", value=test_value, node_execution_id="exec-id", editable=False
        )
        assert sys_var.get_variable_type() == DraftVariableType.SYS
        assert sys_var.editable == False
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
        assert node_var.visible == True
        assert node_var.editable == True
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
