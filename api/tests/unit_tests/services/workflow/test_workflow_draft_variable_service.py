import dataclasses
import json
import secrets
import uuid
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import StringSegment
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account
from models.enums import DraftVariableType
from models.model import UploadFile
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    is_system_variable_editable,
)
from services.entities.upload_file import FileUploadActor
from services.variable_truncator import TruncationResult
from services.workflow_draft_variable_service import (
    DraftVariableSaver,
    VariableResetError,
    WorkflowDraftVariableService,
    _model_to_insertion_dict,
)

SQLITE_MODELS = (Workflow, WorkflowDraftVariable, WorkflowDraftVariableFile, WorkflowNodeExecutionModel)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@dataclass(frozen=True)
class _UploadRequest:
    actor: FileUploadActor
    tenant_id: str
    filename: str
    content: bytes
    mimetype: str


@dataclass
class _UploadFileCreator:
    result: UploadFile | None = None
    calls: list[_UploadRequest] = field(default_factory=list)

    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> UploadFile:
        del allowed_extensions, source_url, default_file_size_limit
        self.calls.append(_UploadRequest(actor, tenant_id, filename, content, mimetype))
        if self.result is None:
            raise AssertionError("this test does not expect a file upload")
        return self.result


def _execution_with_outputs(outputs: dict[str, object]) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id="exec-id",
        tenant_id="test-tenant-id",
        app_id="test-app-id",
        workflow_id="test-workflow-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="test-workflow-run-id",
        index=1,
        node_execution_id="test-node-execution-id",
        node_id="test_node_id",
        node_type=BuiltinNodeTypes.LLM,
        title="Test Node",
        inputs="{}",
        process_data="{}",
        outputs=json.dumps(outputs),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        elapsed_time=1.0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="test-user-id",
    )


class TestDraftVariableSaver:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test__should_variable_be_visible(self, sqlite_session: Session):
        mock_user = Account(name="test", email="test@example.com")
        mock_user.id = str(uuid.uuid4())
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=sqlite_session,
            tenant_id="test-tenant-id",
            app_id=test_app_id,
            node_id="test_node_id",
            node_type=BuiltinNodeTypes.START,
            node_execution_id="test_execution_id",
            user=mock_user,
            files=_UploadFileCreator(),
        )
        assert saver._should_variable_be_visible("123_456", BuiltinNodeTypes.IF_ELSE, "output") is False
        assert saver._should_variable_be_visible("123", BuiltinNodeTypes.START, "output") is True

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

        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = str(uuid.uuid4())
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=sqlite_session,
            tenant_id="test-tenant-id",
            app_id=test_app_id,
            node_id=_node_id,
            node_type=BuiltinNodeTypes.START,
            node_execution_id="test_execution_id",
            user=mock_user,
            files=_UploadFileCreator(),
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
            session=sqlite_session,
            tenant_id="tenant-1",
            app_id=self._get_test_app_id(),
            node_id="start",
            node_type=BuiltinNodeTypes.START,
            node_execution_id="exec-1",
            user=mock_user,
            files=_UploadFileCreator(),
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

        with patch(
            "services.workflow_draft_variable_service.build_file_from_stored_mapping",
            return_value=rebuilt_file,
        ) as rebuild_file:
            draft_vars = saver._build_variables_from_start_mapping({"sys.files": [raw_file]})

        sys_var = draft_vars[0]
        assert sys_var.get_value().value[0] == rebuilt_file
        rebuild_file.assert_called_once_with(file_mapping=raw_file, tenant_id="tenant-1")

    @pytest.fixture
    def draft_saver(self, sqlite_session: Session):
        """Create DraftVariableSaver instance with user context."""
        # Create a mock user
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"

        return DraftVariableSaver(
            session=sqlite_session,
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            node_id="test-node-id",
            node_type=BuiltinNodeTypes.LLM,
            node_execution_id="test-execution-id",
            user=mock_user,
            files=_UploadFileCreator(),
        )

    def test_draft_saver_with_small_variables(self, draft_saver: DraftVariableSaver):
        with patch(
            "services.workflow_draft_variable_service.DraftVariableSaver._try_offload_large_variable", autospec=True
        ) as _mock_try_offload:
            _mock_try_offload.return_value = None
            mock_segment = StringSegment(value="small value")
            draft_var = draft_saver._create_draft_variable(name="small_var", value=mock_segment, visible=True)

            # Should not have large variable metadata
            assert draft_var.file_id is None
            _mock_try_offload.return_value = None

    def test_draft_saver_with_large_variables(self, draft_saver: DraftVariableSaver):
        with patch(
            "services.workflow_draft_variable_service.DraftVariableSaver._try_offload_large_variable", autospec=True
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
            referenced_file_id = str(uuidv7())
            original_segment = StringSegment(value=build_file_reference(record_id=referenced_file_id))

            _mock_try_offload.return_value = mock_segment, mock_draft_var_file
            draft_var = draft_saver._create_draft_variable(name="small_var", value=original_segment, visible=True)

            # Should not have large variable metadata
            assert draft_var.file_id == mock_draft_var_file.id
            assert set(draft_var.__dict__["_pending_upload_file_reference_ids"]) == {
                mock_draft_var_file.upload_file_id,
                referenced_file_id,
            }

    def test_try_offload_large_variable_uses_resource_tenant(self, sqlite_session: Session):
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
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
        files = _UploadFileCreator(upload_file)
        saver = DraftVariableSaver(
            session=sqlite_session,
            tenant_id="app-tenant-id",
            app_id="test-app-id",
            node_id="test-node-id",
            node_type=BuiltinNodeTypes.LLM,
            node_execution_id="test-execution-id",
            user=mock_user,
            files=files,
        )
        truncation_result = TruncationResult(result=StringSegment(value="..."), truncated=True)

        with patch(
            "services.workflow_draft_variable_service.VariableTruncator.truncate", return_value=truncation_result
        ):
            result = saver._try_offload_large_variable("large_var", StringSegment(value="large value"))

        assert result is not None
        _, variable_file = result
        assert [call.tenant_id for call in files.calls] == ["app-tenant-id"]
        assert variable_file.tenant_id == "app-tenant-id"
        sqlite_session.expire_all()
        stored_variable_file = sqlite_session.get(WorkflowDraftVariableFile, variable_file.id)
        assert stored_variable_file is not None
        assert stored_variable_file.upload_file_id == upload_file.id

    @patch("services.workflow_draft_variable_service._batch_upsert_draft_variable", autospec=True)
    def test_save_method_integration(self, mock_batch_upsert, draft_saver):
        """Test complete save workflow."""
        outputs = {"result": {"data": "test_output"}, "metadata": {"type": "llm_response"}}

        draft_saver.save(outputs=outputs)

        # Should batch upsert draft variables
        mock_batch_upsert.assert_called_once()
        draft_vars = mock_batch_upsert.call_args[0][1]
        assert len(draft_vars) == 2

    @patch("services.workflow_draft_variable_service._batch_upsert_draft_variable", autospec=True)
    def test_start_node_save_persists_sys_timestamp_and_workflow_run_id(
        self, mock_batch_upsert, sqlite_session: Session
    ):
        """Start node should persist common `sys.*` variables, not only `sys.files`."""
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
        mock_user.tenant_id = "test-tenant-id"

        saver = DraftVariableSaver(
            session=sqlite_session,
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            node_id="start-node-id",
            node_type=BuiltinNodeTypes.START,
            node_execution_id="exec-id",
            user=mock_user,
            files=_UploadFileCreator(),
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

    @patch("services.workflow_draft_variable_service._batch_upsert_draft_variable", autospec=True)
    def test_start_node_save_normalizes_reserved_prefix_outputs(self, mock_batch_upsert, sqlite_session: Session):
        mock_user = Account(name="Test Account", email="test@example.com")
        mock_user.id = "test-user-id"
        mock_user.tenant_id = "test-tenant-id"

        saver = DraftVariableSaver(
            session=sqlite_session,
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            node_id="start-node-id",
            node_type=BuiltinNodeTypes.START,
            node_execution_id="exec-id",
            user=mock_user,
            files=_UploadFileCreator(),
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


class TestWorkflowDraftVariableService:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def _create_test_workflow(self, app_id: str) -> Workflow:
        """Create a real Workflow instance for testing"""
        return Workflow.new(
            tenant_id="test_tenant_id",
            app_id=app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features="{}",
            created_by="test_user_id",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

    def test_list_variables_without_values_excludes_node_ids(self, sqlite_session: Session):
        service = WorkflowDraftVariableService(sqlite_session)
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

    def test_reset_conversation_variable(self, sqlite_session: Session):
        """Test resetting a conversation variable"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real conversation variable
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id, name="test_var", value=test_value, description="Test conversation variable"
        )

        # Mock the _reset_conv_var method
        expected_result = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id,
            name="test_var",
            value=StringSegment(value="reset_value"),
        )
        with patch.object(service, "_reset_conv_var", return_value=expected_result, autospec=True) as mock_reset_conv:
            result = service.reset_variable(workflow, variable)

            mock_reset_conv.assert_called_once_with(workflow, variable)
            assert result == expected_result

    def test_reset_node_variable_with_no_execution_id(self, sqlite_session: Session):
        """Test resetting a node variable with no execution ID - should delete variable"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with no execution ID
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id,
            node_id="test_node_id",
            name="test_var",
            value=test_value,
            node_execution_id="exec-id",  # Set initially
        )
        # Manually set to None to simulate the test condition
        variable.node_execution_id = None
        sqlite_session.add(variable)
        sqlite_session.commit()

        result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should delete the variable and return None
        assert sqlite_session.get(WorkflowDraftVariable, variable.id) is None
        assert result is None

    def test_reset_node_variable_with_missing_execution_record(self, sqlite_session: Session):
        """Test resetting a node variable when execution record doesn't exist"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with execution ID
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id, node_id="test_node_id", name="test_var", value=test_value, node_execution_id="exec-id"
        )
        sqlite_session.add(variable)
        sqlite_session.commit()

        result = service._reset_node_var_or_sys_var(workflow, variable)

        assert sqlite_session.get(WorkflowDraftVariable, variable.id) is None
        assert result is None

    def test_reset_node_variable_with_valid_execution_record(self, sqlite_session: Session):
        """Reset a node variable from its execution output and flush the restored value."""
        service = WorkflowDraftVariableService(sqlite_session)

        execution = _execution_with_outputs({"test_var": "output_value"})

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with execution ID
        test_value = StringSegment(value="original_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id, node_id="test_node_id", name="test_var", value=test_value, node_execution_id="exec-id"
        )
        sqlite_session.add_all([execution, variable])
        sqlite_session.commit()

        # Mock workflow methods
        mock_node_config = {"type": "test_node"}
        with (
            patch.object(sqlite_session, "flush", wraps=sqlite_session.flush) as flush,
            patch.object(workflow, "get_node_config_by_id", return_value=mock_node_config, autospec=True),
            patch.object(workflow, "get_node_type_from_node_config", return_value=BuiltinNodeTypes.LLM, autospec=True),
        ):
            result = service._reset_node_var_or_sys_var(workflow, variable)

            # Verify last_edited_at was reset
            assert variable.last_edited_at is None
            flush.assert_called()
            # Should return the updated variable
            assert result == variable

    def test_reset_non_editable_system_variable_raises_error(self, sqlite_session: Session):
        """Test that resetting a non-editable system variable raises an error"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create a non-editable system variable (workflow_id is not editable)
        test_value = StringSegment(value="test_workflow_id")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="workflow_id",  # This is not in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=False,  # Non-editable system variable
        )

        with pytest.raises(VariableResetError) as exc_info:
            service.reset_variable(workflow, variable)
        assert "cannot reset system variable" in str(exc_info.value)
        assert f"variable_id={variable.id}" in str(exc_info.value)

    def test_reset_editable_system_variable_succeeds(self, sqlite_session: Session):
        """Test that resetting an editable system variable succeeds"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create an editable system variable (files is editable)
        test_value = StringSegment(value="[]")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="files",  # This is in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=True,  # Editable system variable
        )
        sqlite_session.add(variable)
        sqlite_session.commit()

        execution = _execution_with_outputs({"sys.files": "[]"})
        sqlite_session.add(execution)
        sqlite_session.commit()

        with patch.object(sqlite_session, "flush", wraps=sqlite_session.flush) as flush:
            result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should succeed and return the variable
        assert result == variable
        assert variable.last_edited_at is None
        flush.assert_called()

    def test_reset_query_system_variable_succeeds(self, sqlite_session: Session):
        """Test that resetting query system variable (another editable one) succeeds"""
        service = WorkflowDraftVariableService(sqlite_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create an editable system variable (query is editable)
        test_value = StringSegment(value="original query")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="query",  # This is in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=True,  # Editable system variable
        )
        sqlite_session.add(variable)
        sqlite_session.commit()

        execution = _execution_with_outputs({"sys.query": "reset query"})
        sqlite_session.add(execution)
        sqlite_session.commit()

        with patch.object(sqlite_session, "flush", wraps=sqlite_session.flush) as flush:
            result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should succeed and return the variable
        assert result == variable
        assert variable.last_edited_at is None
        flush.assert_called()

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
