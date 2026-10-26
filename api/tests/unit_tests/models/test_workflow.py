import dataclasses
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest import mock
from unittest.mock import Mock
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.helper import encrypter
from core.workflow.file_reference import build_file_reference
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from extensions.storage.storage_type import StorageType
from factories import variable_factory
from factories.variable_factory import build_segment
from fields.workflow_run_fields import (
    node_execution_response_source,
    workflow_run_pagination_response_source,
    workflow_run_response_source,
)
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionStatus,
)
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, SegmentType, StringVariable
from graphon.variables.segments import IntegerSegment, Segment
from models import ConversationVariable
from models import Workflow as _workflow_feature_compatibility_Workflow
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, ExecutionOffLoadType, WorkflowRunTriggeredFrom
from models.model import EndUser, UploadFile
from models.tools import WorkflowToolProvider
from models.workflow import (
    Workflow as _workflow_Workflow,
)
from models.workflow import (
    Workflow as _workflow_models_Workflow,
)
from models.workflow import (
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowDraftVariable,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
    is_system_variable_editable,
)


class TestConversationVariableCases:
    @staticmethod
    def test_from_variable_coerces_non_uuid_primary_key() -> None:
        variable = variable_factory.build_conversation_variable_from_mapping(
            {
                "id": "opt-comp-prompt-var",
                "name": "optimization_comparison_prompt",
                "value_type": SegmentType.STRING,
                "value": "-",
            }
        )

        row = ConversationVariable.from_variable(app_id="app_id", conversation_id="conversation_id", variable=variable)

        expected = str(uuid5(NAMESPACE_URL, "dify:conversation-variable:optimization_comparison_prompt"))
        UUID(row.id)
        assert row.id == expected
        assert variable.id == "opt-comp-prompt-var"
        assert row.to_variable().id == "opt-comp-prompt-var"

    @staticmethod
    def test_from_variable_and_to_variable() -> None:
        variable = variable_factory.build_conversation_variable_from_mapping(
            {
                "id": str(uuid4()),
                "name": "name",
                "value_type": SegmentType.OBJECT,
                "value": {
                    "key": {
                        "key": "value",
                    }
                },
            }
        )

        conversation_variable = ConversationVariable.from_variable(
            app_id="app_id", conversation_id="conversation_id", variable=variable
        )

        assert conversation_variable.to_variable() == variable


class TestWorkflowCases:
    @staticmethod
    def test_environment_variables():
        # tenant_id context variable removed - using current_user.current_tenant_id directly

        # Create a Workflow instance
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Create some EnvironmentVariable instances
        variable1 = StringVariable(name="var1", value="value1", id=str(uuid4()), selector=["env", "var1"])
        variable2 = IntegerVariable(name="var2", value=123, id=str(uuid4()), selector=["env", "var2"])
        variable3 = SecretVariable(name="var3", value="secret", id=str(uuid4()), selector=["env", "var3"])
        variable4 = FloatVariable(name="var4", value=float("3.14"), id=str(uuid4()), selector=["env", "var4"])

        with (
            mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
            mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        ):
            # Set the environment_variables property of the Workflow instance
            variables = [variable1, variable2, variable3, variable4]
            workflow.environment_variables = variables

            # Get the environment_variables property and assert its value
            assert workflow.environment_variables == variables

    @staticmethod
    def test_llm_environment_variable_round_trip():
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )
        variable = LLMEnvironmentVariable(
            name="for_research",
            value={"provider": "langgenius/anthropic/anthropic", "name": "claude-sonnet", "mode": "chat"},
            id=str(uuid4()),
            selector=["env", "for_research"],
        )

        workflow.environment_variables = [variable]

        assert workflow.environment_variables == [variable]
        assert json.loads(workflow._environment_variables)["for_research"]["value_type"] == "llm"
        assert workflow.to_dict()["environment_variables"][0]["value_type"] == "llm"

    @staticmethod
    def test_update_environment_variables():
        # tenant_id context variable removed - using current_user.current_tenant_id directly

        # Create a Workflow instance
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Create some EnvironmentVariable instances
        variable1 = StringVariable(name="var1", value="value1", id=str(uuid4()), selector=["env", "var1"])
        variable2 = IntegerVariable(name="var2", value=123, id=str(uuid4()), selector=["env", "var2"])
        variable3 = SecretVariable(
            name="var3",
            value="secret",
            id=str(uuid4()),
            selector=["env", "var3"],
            description="old description",
        )
        variable4 = FloatVariable(name="var4", value=float("3.14"), id=str(uuid4()), selector=["env", "var4"])

        with (
            mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
            mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        ):
            variables = [variable1, variable2, variable3, variable4]

            # Set the environment_variables property of the Workflow instance
            workflow.environment_variables = variables
            assert workflow.environment_variables == [variable1, variable2, variable3, variable4]

            # Update the name and description of variable3 and keep the value as it is
            variables[2] = variable3.model_copy(
                update={
                    "name": "new name",
                    "description": "new description",
                    "value": HIDDEN_VALUE,
                }
            )

            workflow.environment_variables = variables
            assert workflow.environment_variables[2].name == "new name"
            assert workflow.environment_variables[2].description == "new description"
            assert workflow.environment_variables[2].value == variable3.value

    @staticmethod
    def test_to_dict():
        # tenant_id context variable removed - using current_user.current_tenant_id directly

        # Create a Workflow instance
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )

        # Create some EnvironmentVariable instances

        with (
            mock.patch("core.helper.encrypter.encrypt_token", return_value="encrypted_token"),
            mock.patch("core.helper.encrypter.decrypt_token", return_value="secret"),
        ):
            # Set the environment_variables property of the Workflow instance
            workflow.environment_variables = [
                SecretVariable(name="secret", value="secret", id=str(uuid4())),
                StringVariable(name="text", value="text", id=str(uuid4())),
            ]

            workflow_dict = workflow.to_dict()
            assert workflow_dict["environment_variables"][0]["value"] == ""
            assert workflow_dict["environment_variables"][1]["value"] == "text"

            workflow_dict = workflow.to_dict(include_secret=True)
            assert workflow_dict["environment_variables"][0]["value"] == "secret"
            assert workflow_dict["environment_variables"][1]["value"] == "text"

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(_workflow_Workflow, Account)], indirect=True)
    def test_workflow_account_accessors_use_caller_session(sqlite_session: Session):
        created_account = Account(name="Created Account", email="created@example.com")
        created_account.id = "created-account-id"
        updated_account = Account(name="Updated Account", email="updated@example.com")
        updated_account.id = "updated-account-id"
        decoy_account = Account(name="Decoy Account", email="decoy@example.com")
        decoy_account.id = "decoy-account-id"
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="created-account-id",
            environment_variables=[],
            conversation_variables=[],
            updated_by="updated-account-id",
        )
        sqlite_session.add_all([decoy_account, updated_account, workflow, created_account])
        sqlite_session.flush()

        assert workflow.created_by_account(sqlite_session) is created_account
        assert workflow.updated_by_account(sqlite_session) is updated_account

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(_workflow_Workflow, WorkflowToolProvider)], indirect=True)
    def test_workflow_tool_published_accessor_uses_caller_session(sqlite_session: Session):
        workflow = _workflow_Workflow(
            tenant_id="tenant_id",
            app_id="app_id",
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            created_by="account_id",
            environment_variables=[],
            conversation_variables=[],
        )
        matching_provider = WorkflowToolProvider(
            name="matching-provider",
            label="Matching provider",
            icon="tool",
            app_id=workflow.app_id,
            version="1",
            user_id="account-id",
            tenant_id=workflow.tenant_id,
            description="Matching workflow tool",
        )
        decoy_provider = WorkflowToolProvider(
            name="decoy-provider",
            label="Decoy provider",
            icon="tool",
            app_id="other-app",
            version="1",
            user_id="account-id",
            tenant_id=workflow.tenant_id,
            description="Different app",
        )
        sqlite_session.add_all([decoy_provider, workflow, matching_provider])
        sqlite_session.flush()

        with pytest.warns(DeprecationWarning, match="not accurate"):
            assert workflow.tool_published(sqlite_session) is True

    @staticmethod
    def test_normalize_environment_variable_mappings_converts_full_mask_to_hidden_value():
        normalized = _workflow_Workflow.normalize_environment_variable_mappings(
            [
                {
                    "id": str(uuid4()),
                    "name": "secret",
                    "value": encrypter.full_mask_token(),
                    "value_type": "secret",
                }
            ]
        )

        assert normalized[0]["value"] == HIDDEN_VALUE

    @staticmethod
    def test_normalize_environment_variable_mappings_keeps_hidden_value():
        normalized = _workflow_Workflow.normalize_environment_variable_mappings(
            [
                {
                    "id": str(uuid4()),
                    "name": "secret",
                    "value": HIDDEN_VALUE,
                    "value_type": "secret",
                }
            ]
        )

        assert normalized[0]["value"] == HIDDEN_VALUE

    class TestWorkflowNodeExecution:
        def test_execution_metadata_dict(self):
            node_exec = WorkflowNodeExecutionModel(
                execution_metadata=None,
            )
            assert node_exec.execution_metadata_dict == {}

            original = {"a": 1, "b": ["2"]}
            node_exec.execution_metadata = json.dumps(original)
            assert node_exec.execution_metadata_dict == original

    class TestIsSystemVariableEditable:
        def test_is_system_variable(self):
            cases = [
                ("query", True),
                ("files", True),
                ("dialogue_count", False),
                ("conversation_id", False),
                ("user_id", False),
                ("app_id", False),
                ("workflow_id", False),
                ("workflow_run_id", False),
            ]
            for name, editable in cases:
                assert editable == is_system_variable_editable(name)

            assert is_system_variable_editable("invalid_or_new_system_variable") is False

    class TestWorkflowDraftVariableGetValue:
        def test_get_value_by_case(self):
            @dataclasses.dataclass
            class TestCase:
                name: str
                value: Segment

            test_file = File(
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="https://example.com/example.jpg",
                filename="example.jpg",
                extension=".jpg",
                mime_type="image/jpeg",
                size=100,
            )
            cases: list[TestCase] = [
                TestCase(
                    name="number/int",
                    value=build_segment(1),
                ),
                TestCase(
                    name="number/float",
                    value=build_segment(1.0),
                ),
                TestCase(
                    name="string",
                    value=build_segment("a"),
                ),
                TestCase(
                    name="object",
                    value=build_segment({}),
                ),
                TestCase(
                    name="file",
                    value=build_segment(test_file),
                ),
                TestCase(
                    name="array[any]",
                    value=build_segment([1, "a"]),
                ),
                TestCase(
                    name="array[string]",
                    value=build_segment(["a", "b"]),
                ),
                TestCase(
                    name="array[number]/int",
                    value=build_segment([1, 2]),
                ),
                TestCase(
                    name="array[number]/float",
                    value=build_segment([1.0, 2.0]),
                ),
                TestCase(
                    name="array[number]/mixed",
                    value=build_segment([1, 2.0]),
                ),
                TestCase(
                    name="array[object]",
                    value=build_segment([{}, {"a": 1}]),
                ),
                TestCase(
                    name="none",
                    value=build_segment(None),
                ),
            ]

            for idx, c in enumerate(cases, 1):
                fail_msg = f"test case {c.name} failed, index={idx}"
                draft_var = WorkflowDraftVariable()
                draft_var.set_value(c.value)
                assert c.value == draft_var.get_value(), fail_msg

        def test_file_variable_preserves_all_fields(self):
            """Test that File type variables preserve all fields during encoding/decoding."""

            # Create a File with specific field values
            test_file = File(
                file_id="test_file_id",
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="https://example.com/test.jpg",
                filename="test.jpg",
                extension=".jpg",
                mime_type="image/jpeg",
                size=12345,  # Specific size to test preservation
                storage_key="test_storage_key",
            )

            # Create a FileSegment and WorkflowDraftVariable
            file_segment = build_segment(test_file)
            draft_var = WorkflowDraftVariable()
            draft_var.set_value(file_segment)

            # Retrieve the value and verify all fields are preserved
            retrieved_segment = draft_var.get_value()
            retrieved_file = retrieved_segment.value

            # Verify all important fields are preserved
            assert retrieved_file.id == test_file.id
            assert retrieved_file.type == test_file.type
            assert retrieved_file.transfer_method == test_file.transfer_method
            assert retrieved_file.remote_url == test_file.remote_url
            assert retrieved_file.filename == test_file.filename
            assert retrieved_file.extension == test_file.extension
            assert retrieved_file.mime_type == test_file.mime_type
            assert retrieved_file.size == test_file.size  # This was the main issue being fixed
            # Note: storage_key is not serialized in model_dump() so it won't be preserved

            # Verify the segments have the same type and the important fields match
            assert file_segment.value_type == retrieved_segment.value_type

        def test_file_variable_rebuilds_storage_backed_payloads_with_app_tenant(self):
            persisted_file = File(
                file_id="test_file_id",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=build_file_reference(record_id="upload-1", storage_key="legacy-storage-key"),
                filename="test.txt",
                extension=".txt",
                mime_type="text/plain",
                size=12,
            )
            rebuilt_file = File(
                file_id="test_file_id",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=build_file_reference(record_id="upload-1"),
                filename="test.txt",
                extension=".txt",
                mime_type="text/plain",
                size=12,
                storage_key="canonical-storage-key",
            )
            draft_var = WorkflowDraftVariable(
                app_id="app-1",
            )
            draft_var.set_value(build_segment(persisted_file))
            draft_var._WorkflowDraftVariable__value = None

            with (
                mock.patch("models.workflow._resolve_workflow_app_tenant_id", return_value="tenant-1"),
                mock.patch("models.workflow.build_file_from_stored_mapping", return_value=rebuilt_file) as rebuild_file,
            ):
                retrieved_segment = draft_var.get_value()

            assert retrieved_segment.value == rebuilt_file
            rebuild_file.assert_called_once()
            assert rebuild_file.call_args.kwargs["tenant_id"] == "tenant-1"

        def test_get_and_set_value(self):
            draft_var = WorkflowDraftVariable()
            int_var = IntegerSegment(value=1)
            draft_var.set_value(int_var)
            value = draft_var.get_value()
            assert value == int_var


"""Regression coverage for ``models.workflow.WorkflowAppLog`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER.

Both accessors are exercised against the real ``sqlite_session`` fixture (a genuine
SQLAlchemy ``Session`` bound to a pristine full-schema SQLite database) so the assertions
cover actual query behaviour rather than a mock's recorded call.
"""


def _log(role: CreatorUserRole, created_by: str) -> WorkflowAppLog:
    """Construct a WorkflowAppLog without touching the database."""
    return WorkflowAppLog(
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id="00000000-0000-0000-0000-000000000003",
        workflow_run_id="00000000-0000-0000-0000-000000000004",
        created_from=WorkflowAppLogCreatedFrom.WEB_APP,
        created_by_role=role,
        created_by=created_by,
    )


class TestWorkflowAppLogModelsCases:
    class TestCreatedByAccount:
        def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            log = _log(CreatorUserRole.ACCOUNT, created_by=account.id)

            result = log.created_by_account(session=sqlite_session)

            assert result is not None
            assert result.id == account.id

        def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            log = _log(CreatorUserRole.END_USER, created_by=account.id)

            assert log.created_by_account(session=sqlite_session) is None

    class TestCreatedByEndUser:
        def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            log = _log(CreatorUserRole.END_USER, created_by=end_user.id)

            result = log.created_by_end_user(session=sqlite_session)

            assert result is not None
            assert result.id == end_user.id

        def test_returns_none_when_role_is_account(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            log = _log(CreatorUserRole.ACCOUNT, created_by=end_user.id)

            assert log.created_by_end_user(session=sqlite_session) is None


"""
This unit test verifies Workflow compatibility before and after supporting multiple file types.
"""


OLD_VERSION_WORKFLOW_FEATURES: dict[str, JsonValue] = {
    "file_upload": {
        "image": {
            "enabled": True,
            "number_limits": 6,
            "transfer_methods": ["remote_url", "local_file"],
        }
    },
    "opening_statement": "",
    "retriever_resource": {"enabled": True},
    "sensitive_word_avoidance": {"enabled": False},
    "speech_to_text": {"enabled": False},
    "suggested_questions": [],
    "suggested_questions_after_answer": {"enabled": False},
    "text_to_speech": {"enabled": False, "language": "", "voice": ""},
}

NEW_VERSION_WORKFLOW_FEATURES: dict[str, JsonValue] = {
    "file_upload": {
        "enabled": True,
        "allowed_file_types": ["image"],
        "allowed_file_extensions": [],
        "allowed_file_upload_methods": ["remote_url", "local_file"],
        "number_limits": 6,
    },
    "opening_statement": "",
    "retriever_resource": {"enabled": True},
    "sensitive_word_avoidance": {"enabled": False},
    "speech_to_text": {"enabled": False},
    "suggested_questions": [],
    "suggested_questions_after_answer": {"enabled": False},
    "text_to_speech": {"enabled": False, "language": "", "voice": ""},
}


class TestWorkflowFeatureCompatibilityCases:
    @staticmethod
    def test_workflow_features() -> None:
        workflow = _workflow_feature_compatibility_Workflow(
            tenant_id="",
            app_id="",
            type="",
            version="",
            graph="",
            features=json.dumps(OLD_VERSION_WORKFLOW_FEATURES),
            created_by="",
            environment_variables=[],
            conversation_variables=[],
        )

        assert workflow.features_dict == NEW_VERSION_WORKFLOW_FEATURES


"""
Comprehensive unit tests for Workflow models.

This test suite covers:
- Workflow model validation
- WorkflowRun state transitions
- NodeExecution relationships
- Graph configuration validation
"""


class TestWorkflowModelsCases:
    class TestWorkflowModelValidation:
        """Test suite for Workflow model validation and basic operations."""

        def test_workflow_creation_with_required_fields(self) -> None:
            """Test creating a workflow with all required fields."""
            # Arrange
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            created_by = str(uuid4())
            graph = json.dumps({"nodes": [], "edges": []})
            features = json.dumps({"file_upload": {"enabled": True}})

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=graph,
                features=features,
                created_by=created_by,
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            assert workflow.tenant_id == tenant_id
            assert workflow.app_id == app_id
            assert workflow.type == WorkflowType.WORKFLOW
            assert workflow.version == "draft"
            assert workflow.graph == graph
            assert workflow.created_by == created_by
            assert workflow.created_at is not None
            assert workflow.updated_at is not None

        def test_workflow_type_enum_values(self) -> None:
            """Test WorkflowType enum values."""
            # Assert
            assert WorkflowType.WORKFLOW == "workflow"
            assert WorkflowType.CHAT.value == "chat"
            assert WorkflowType.RAG_PIPELINE.value == "rag-pipeline"

        def test_workflow_type_value_of(self) -> None:
            """Test WorkflowType.value_of method."""
            # Act & Assert
            assert WorkflowType.value_of("workflow") == WorkflowType.WORKFLOW
            assert WorkflowType.value_of("chat") == WorkflowType.CHAT
            assert WorkflowType.value_of("rag-pipeline") == WorkflowType.RAG_PIPELINE

            with pytest.raises(ValueError, match="invalid workflow type value"):
                WorkflowType.value_of("invalid_type")

        def test_workflow_graph_dict_property(self) -> None:
            """Test graph_dict property parses JSON correctly."""
            # Arrange
            graph_data = {"nodes": [{"id": "start", "type": "start"}], "edges": list[object]()}
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_data),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Act
            result = workflow.graph_dict

            # Assert
            assert result == graph_data
            assert "nodes" in result
            assert len(result["nodes"]) == 1

        def test_workflow_features_dict_property(self) -> None:
            """Test features_dict property parses JSON correctly."""
            # Arrange
            features_data = {"file_upload": {"enabled": True, "max_files": 5}}
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph="{}",
                features=json.dumps(features_data),
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Act
            result = workflow.features_dict

            # Assert
            assert result == features_data
            assert result["file_upload"]["enabled"] is True
            assert result["file_upload"]["max_files"] == 5

        def test_workflow_with_marked_name_and_comment(self) -> None:
            """Test workflow creation with marked name and comment."""
            # Arrange & Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="v1.0",
                graph="{}",
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
                marked_name="Production Release",
                marked_comment="Initial production version",
            )

            # Assert
            assert workflow.marked_name == "Production Release"
            assert workflow.marked_comment == "Initial production version"

        def test_workflow_version_draft_constant(self) -> None:
            """Test VERSION_DRAFT constant."""
            # Assert
            assert _workflow_models_Workflow.VERSION_DRAFT == "draft"

    class TestWorkflowRunStateTransitions:
        """Test suite for WorkflowRun state transitions and lifecycle."""

        def test_workflow_run_creation_with_required_fields(self) -> None:
            """Test creating a workflow run with required fields."""
            # Arrange
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            workflow_id = str(uuid4())
            created_by = str(uuid4())

            # Act
            workflow_run = WorkflowRun(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=created_by,
            )

            # Assert
            assert workflow_run.tenant_id == tenant_id
            assert workflow_run.app_id == app_id
            assert workflow_run.workflow_id == workflow_id
            assert workflow_run.type == WorkflowType.WORKFLOW
            assert workflow_run.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING
            assert workflow_run.status == WorkflowExecutionStatus.RUNNING
            assert workflow_run.created_by == created_by

        def test_workflow_run_state_transition_running_to_succeeded(self) -> None:
            """Test state transition from running to succeeded."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.END_USER,
                created_by=str(uuid4()),
            )

            # Act
            workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
            workflow_run.finished_at = datetime.now(UTC)
            workflow_run.elapsed_time = 2.5

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.SUCCEEDED
            assert workflow_run.finished_at is not None
            assert workflow_run.elapsed_time == 2.5

        def test_workflow_run_state_transition_running_to_failed(self) -> None:
            """Test state transition from running to failed with error."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Act
            workflow_run.status = WorkflowExecutionStatus.FAILED
            workflow_run.error = "Node execution failed: Invalid input"
            workflow_run.finished_at = datetime.now(UTC)

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.FAILED
            assert workflow_run.error == "Node execution failed: Invalid input"
            assert workflow_run.finished_at is not None

        def test_workflow_run_state_transition_running_to_stopped(self) -> None:
            """Test state transition from running to stopped."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Act
            workflow_run.status = WorkflowExecutionStatus.STOPPED
            workflow_run.finished_at = datetime.now(UTC)

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.STOPPED
            assert workflow_run.finished_at is not None

        def test_workflow_run_state_transition_running_to_paused(self) -> None:
            """Test state transition from running to paused."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.END_USER,
                created_by=str(uuid4()),
            )

            # Act
            workflow_run.status = WorkflowExecutionStatus.PAUSED

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.PAUSED
            assert workflow_run.finished_at is None  # Not finished when paused

        def test_workflow_run_state_transition_paused_to_running(self) -> None:
            """Test state transition from paused back to running."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Act
            workflow_run.status = WorkflowExecutionStatus.RUNNING

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.RUNNING

        def test_workflow_run_with_partial_succeeded_status(self) -> None:
            """Test workflow run with partial-succeeded status."""
            # Arrange & Act
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                exceptions_count=2,
            )

            # Assert
            assert workflow_run.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED
            assert workflow_run.exceptions_count == 2

        def test_workflow_run_with_inputs_and_outputs(self) -> None:
            """Test workflow run with inputs and outputs as JSON."""
            # Arrange
            inputs = {"query": "What is AI?", "context": "technology"}
            outputs = {"answer": "AI is Artificial Intelligence", "confidence": 0.95}

            # Act
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.END_USER,
                created_by=str(uuid4()),
                inputs=json.dumps(inputs),
                outputs=json.dumps(outputs),
            )

            # Assert
            assert workflow_run.inputs_dict == inputs
            assert workflow_run.outputs_dict == outputs

        def test_workflow_run_graph_dict_property(self) -> None:
            """Test graph_dict property for workflow run."""
            # Arrange
            graph = {"nodes": [{"id": "start", "type": "start"}], "edges": list[object]()}
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                graph=json.dumps(graph),
            )

            # Act
            result = workflow_run.graph_dict

            # Assert
            assert result == graph
            assert "nodes" in result

        def test_workflow_run_to_dict_serialization(self) -> None:
            """Test WorkflowRun to_dict method."""
            # Arrange
            workflow_run_id = str(uuid4())
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            workflow_id = str(uuid4())
            created_by = str(uuid4())

            workflow_run = WorkflowRun(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=created_by,
                total_tokens=1500,
                total_steps=5,
            )
            workflow_run.id = workflow_run_id

            # Act
            result = workflow_run.to_dict()

            # Assert
            assert result["id"] == workflow_run_id
            assert result["tenant_id"] == tenant_id
            assert result["app_id"] == app_id
            assert result["workflow_id"] == workflow_id
            assert result["status"] == WorkflowExecutionStatus.SUCCEEDED
            assert result["total_tokens"] == 1500
            assert result["total_steps"] == 5

        def test_workflow_run_from_dict_deserialization(self) -> None:
            """Test WorkflowRun from_dict method."""
            # Arrange
            data = {
                "id": str(uuid4()),
                "tenant_id": str(uuid4()),
                "app_id": str(uuid4()),
                "workflow_id": str(uuid4()),
                "type": WorkflowType.WORKFLOW,
                "triggered_from": WorkflowRunTriggeredFrom.APP_RUN,
                "version": "v1.0",
                "graph": {"nodes": list[object](), "edges": list[object]()},
                "inputs": {"query": "test"},
                "status": WorkflowExecutionStatus.SUCCEEDED,
                "outputs": {"result": "success"},
                "error": None,
                "elapsed_time": 3.5,
                "total_tokens": 2000,
                "total_steps": 10,
                "created_by_role": CreatorUserRole.ACCOUNT,
                "created_by": str(uuid4()),
                "created_at": datetime.now(UTC),
                "finished_at": datetime.now(UTC),
                "exceptions_count": 0,
            }

            # Act
            workflow_run = WorkflowRun.from_dict(data)

            # Assert
            assert workflow_run.id == data["id"]
            assert workflow_run.workflow_id == data["workflow_id"]
            assert workflow_run.status == WorkflowExecutionStatus.SUCCEEDED
            assert workflow_run.total_tokens == 2000

    class TestNodeExecutionRelationships:
        """Test suite for WorkflowNodeExecutionModel relationships and data."""

        def test_node_execution_creation_with_required_fields(self) -> None:
            """Test creating a node execution with required fields."""
            # Arrange
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            workflow_id = str(uuid4())
            workflow_run_id = str(uuid4())
            created_by = str(uuid4())

            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=workflow_run_id,
                index=1,
                node_id="start",
                node_type=BuiltinNodeTypes.START,
                title="Start Node",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=created_by,
            )

            # Assert
            assert node_execution.tenant_id == tenant_id
            assert node_execution.app_id == app_id
            assert node_execution.workflow_id == workflow_id
            assert node_execution.workflow_run_id == workflow_run_id
            assert node_execution.node_id == "start"
            assert node_execution.node_type == BuiltinNodeTypes.START
            assert node_execution.index == 1

        def test_node_execution_with_predecessor_relationship(self) -> None:
            """Test node execution with predecessor node relationship."""
            # Arrange
            predecessor_node_id = "start"
            current_node_id = "llm_1"

            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=2,
                predecessor_node_id=predecessor_node_id,
                node_id=current_node_id,
                node_type=BuiltinNodeTypes.LLM,
                title="LLM Node",
                status=WorkflowNodeExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Assert
            assert node_execution.predecessor_node_id == predecessor_node_id
            assert node_execution.node_id == current_node_id
            assert node_execution.index == 2

        def test_node_execution_single_step_debugging(self) -> None:
            """Test node execution for single-step debugging (no workflow_run_id)."""
            # Arrange & Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value,
                workflow_run_id=None,  # Single-step has no workflow run
                index=1,
                node_id="llm_test",
                node_type=BuiltinNodeTypes.LLM,
                title="Test LLM",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Assert
            assert node_execution.triggered_from == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value
            assert node_execution.workflow_run_id is None

        def test_node_execution_with_inputs_outputs_process_data(self) -> None:
            """Test node execution with inputs, outputs, and process_data."""
            # Arrange
            inputs = {"query": "What is AI?", "temperature": 0.7}
            outputs = {"answer": "AI is Artificial Intelligence"}
            process_data = {"tokens_used": 150, "model": "gpt-4"}

            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="llm_1",
                node_type=BuiltinNodeTypes.LLM,
                title="LLM Node",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                inputs=json.dumps(inputs),
                outputs=json.dumps(outputs),
                process_data=json.dumps(process_data),
            )

            # Assert
            assert node_execution.inputs_dict == inputs
            assert node_execution.outputs_dict == outputs
            assert node_execution.process_data_dict == process_data

        def test_node_execution_status_transitions(self) -> None:
            """Test node execution status transitions."""
            # Arrange
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="code_1",
                node_type=BuiltinNodeTypes.CODE,
                title="Code Node",
                status=WorkflowNodeExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Act - transition to succeeded
            node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
            node_execution.elapsed_time = 1.2
            node_execution.finished_at = datetime.now(UTC)

            # Assert
            assert node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert node_execution.elapsed_time == 1.2
            assert node_execution.finished_at is not None

        def test_node_execution_with_error(self) -> None:
            """Test node execution with error status."""
            # Arrange
            error_message = "Code execution failed: SyntaxError on line 5"

            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=3,
                node_id="code_1",
                node_type=BuiltinNodeTypes.CODE,
                title="Code Node",
                status=WorkflowNodeExecutionStatus.FAILED,
                error=error_message,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )

            # Assert
            assert node_execution.status == WorkflowNodeExecutionStatus.FAILED
            assert node_execution.error == error_message

        def test_node_execution_with_metadata(self) -> None:
            """Test node execution with execution metadata."""
            # Arrange
            metadata = {
                "total_tokens": 500,
                "total_price": 0.01,
                "currency": "USD",
                "tool_info": {"provider": "openai", "tool": "gpt-4"},
            }

            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="llm_1",
                node_type=BuiltinNodeTypes.LLM,
                title="LLM Node",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                execution_metadata=json.dumps(metadata),
            )

            # Assert
            assert node_execution.execution_metadata_dict == metadata
            assert node_execution.execution_metadata_dict["total_tokens"] == 500

        def test_node_execution_metadata_dict_empty(self) -> None:
            """Test execution_metadata_dict returns empty dict when metadata is None."""
            # Arrange
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="start",
                node_type=BuiltinNodeTypes.START,
                title="Start",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                execution_metadata=None,
            )

            # Act
            result = node_execution.execution_metadata_dict

            # Assert
            assert result == {}

        def test_node_execution_different_node_types(self) -> None:
            """Test node execution with different node types."""
            # Test various node types
            node_types = [
                (BuiltinNodeTypes.START, "Start Node"),
                (BuiltinNodeTypes.LLM, "LLM Node"),
                (BuiltinNodeTypes.CODE, "Code Node"),
                (BuiltinNodeTypes.TOOL, "Tool Node"),
                (BuiltinNodeTypes.IF_ELSE, "Conditional Node"),
                (BuiltinNodeTypes.END, "End Node"),
            ]

            for node_type, title in node_types:
                # Act
                node_execution = WorkflowNodeExecutionModel(
                    tenant_id=str(uuid4()),
                    app_id=str(uuid4()),
                    workflow_id=str(uuid4()),
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                    workflow_run_id=str(uuid4()),
                    index=1,
                    node_id=f"{node_type}_1",
                    node_type=node_type,
                    title=title,
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=str(uuid4()),
                )

                # Assert
                assert node_execution.node_type == node_type
                assert node_execution.title == title

    class TestGraphConfigurationValidation:
        """Test suite for graph configuration validation."""

        def test_workflow_graph_with_nodes_and_edges(self) -> None:
            """Test workflow graph configuration with nodes and edges."""
            # Arrange
            graph_config = {
                "nodes": [
                    {"id": "start", "type": "start", "data": {"title": "Start"}},
                    {"id": "llm_1", "type": "llm", "data": {"title": "LLM Node", "model": "gpt-4"}},
                    {"id": "end", "type": "end", "data": {"title": "End"}},
                ],
                "edges": [
                    {"source": "start", "target": "llm_1"},
                    {"source": "llm_1", "target": "end"},
                ],
            }

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_config),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            graph_dict = workflow.graph_dict
            assert len(graph_dict["nodes"]) == 3
            assert len(graph_dict["edges"]) == 2
            assert graph_dict["nodes"][0]["id"] == "start"
            assert graph_dict["edges"][0]["source"] == "start"
            assert graph_dict["edges"][0]["target"] == "llm_1"

        def test_workflow_graph_empty_configuration(self) -> None:
            """Test workflow with empty graph configuration."""
            # Arrange
            graph_config = {"nodes": list[object](), "edges": list[object]()}

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_config),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            graph_dict = workflow.graph_dict
            assert graph_dict["nodes"] == []
            assert graph_dict["edges"] == []

        def test_workflow_graph_complex_node_data(self) -> None:
            """Test workflow graph with complex node data structures."""
            # Arrange
            graph_config = {
                "nodes": [
                    {
                        "id": "llm_1",
                        "type": "llm",
                        "data": {
                            "title": "Advanced LLM",
                            "model": {"provider": "openai", "name": "gpt-4", "mode": "chat"},
                            "prompt_template": [
                                {"role": "system", "text": "You are a helpful assistant"},
                                {"role": "user", "text": "{{query}}"},
                            ],
                            "model_parameters": {"temperature": 0.7, "max_tokens": 2000},
                        },
                    }
                ],
                "edges": list[object](),
            }

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_config),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            graph_dict = workflow.graph_dict
            node_data = graph_dict["nodes"][0]["data"]
            assert node_data["model"]["provider"] == "openai"
            assert node_data["model_parameters"]["temperature"] == 0.7
            assert len(node_data["prompt_template"]) == 2

        def test_workflow_run_graph_preservation(self) -> None:
            """Test that WorkflowRun preserves graph configuration from Workflow."""
            # Arrange
            original_graph = {
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "end", "type": "end"},
                ],
                "edges": [{"source": "start", "target": "end"}],
            }

            # Act
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                graph=json.dumps(original_graph),
            )

            # Assert
            assert workflow_run.graph_dict == original_graph
            assert len(workflow_run.graph_dict["nodes"]) == 2

        def test_workflow_graph_with_conditional_branches(self) -> None:
            """Test workflow graph with conditional branching (if-else)."""
            # Arrange
            graph_config = {
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "if_else_1", "type": "if-else", "data": {"conditions": list[object]()}},
                    {"id": "branch_true", "type": "llm"},
                    {"id": "branch_false", "type": "code"},
                    {"id": "end", "type": "end"},
                ],
                "edges": [
                    {"source": "start", "target": "if_else_1"},
                    {"source": "if_else_1", "sourceHandle": "true", "target": "branch_true"},
                    {"source": "if_else_1", "sourceHandle": "false", "target": "branch_false"},
                    {"source": "branch_true", "target": "end"},
                    {"source": "branch_false", "target": "end"},
                ],
            }

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_config),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            graph_dict = workflow.graph_dict
            assert len(graph_dict["nodes"]) == 5
            assert len(graph_dict["edges"]) == 5
            # Verify conditional edges
            conditional_edges = [e for e in graph_dict["edges"] if "sourceHandle" in e]
            assert len(conditional_edges) == 2

        def test_workflow_graph_with_loop_structure(self) -> None:
            """Test workflow graph with loop/iteration structure."""
            # Arrange
            graph_config = {
                "nodes": [
                    {"id": "start", "type": "start"},
                    {"id": "iteration_1", "type": "iteration", "data": {"iterator": "items"}},
                    {"id": "loop_body", "type": "llm"},
                    {"id": "end", "type": "end"},
                ],
                "edges": [
                    {"source": "start", "target": "iteration_1"},
                    {"source": "iteration_1", "target": "loop_body"},
                    {"source": "loop_body", "target": "iteration_1"},
                    {"source": "iteration_1", "target": "end"},
                ],
            }

            # Act
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(graph_config),
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Assert
            graph_dict = workflow.graph_dict
            iteration_node = next(n for n in graph_dict["nodes"] if n["type"] == "iteration")
            assert iteration_node["data"]["iterator"] == "items"

        def test_workflow_graph_dict_with_null_graph(self) -> None:
            """Test graph_dict property when graph is None."""
            # Arrange
            workflow = _workflow_models_Workflow.new(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=None,  # pyrefly: ignore[bad-argument-type]
                features="{}",
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )

            # Act
            result = workflow.graph_dict

            # Assert
            assert result == {}

        def test_workflow_run_inputs_dict_with_null_inputs(self) -> None:
            """Test inputs_dict property when inputs is None."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                inputs=None,
            )

            # Act
            result = workflow_run.inputs_dict

            # Assert
            assert result == {}

        def test_workflow_run_outputs_dict_with_null_outputs(self) -> None:
            """Test outputs_dict property when outputs is None."""
            # Arrange
            workflow_run = WorkflowRun(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="v1.0",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                outputs=None,
            )

            # Act
            result = workflow_run.outputs_dict

            # Assert
            assert result == {}

        def test_node_execution_inputs_dict_with_null_inputs(self) -> None:
            """Test node execution inputs_dict when inputs is None."""
            # Arrange
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="start",
                node_type=BuiltinNodeTypes.START,
                title="Start",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                inputs=None,
            )

            # Act
            result = node_execution.inputs_dict

            # Assert
            assert result is None

        def test_node_execution_outputs_dict_with_null_outputs(self) -> None:
            """Test node execution outputs_dict when outputs is None."""
            # Arrange
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id="start",
                node_type=BuiltinNodeTypes.START,
                title="Start",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
                outputs=None,
            )

            # Act
            result = node_execution.outputs_dict

            # Assert
            assert result is None


"""Regression coverage for ``WorkflowNodeExecutionModel`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER. Also covers the session-carrying response
source used by the console endpoints that validate ``WorkflowRunNodeExecutionResponse``
with ``from_attributes=True``.
"""


def _execution(role: CreatorUserRole, created_by: str) -> WorkflowNodeExecutionModel:
    """Construct a WorkflowNodeExecutionModel without touching the database."""
    return WorkflowNodeExecutionModel(
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id=str(uuid4()),
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=role,
        created_by=created_by,
    )


class TestWorkflowNodeExecutionAccessorsCases:
    class TestCreatedByAccount:
        def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            execution = _execution(CreatorUserRole.ACCOUNT, created_by=account.id)

            result = execution.created_by_account(session=sqlite_session)

            assert result is not None
            assert result.id == account.id

        def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            execution = _execution(CreatorUserRole.END_USER, created_by=account.id)

            assert execution.created_by_account(session=sqlite_session) is None

    class TestCreatedByEndUser:
        def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            execution = _execution(CreatorUserRole.END_USER, created_by=end_user.id)

            result = execution.created_by_end_user(session=sqlite_session)

            assert result is not None
            assert result.id == end_user.id

        def test_returns_none_when_role_is_account(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            execution = _execution(CreatorUserRole.ACCOUNT, created_by=end_user.id)

            assert execution.created_by_end_user(session=sqlite_session) is None

    class TestNodeExecutionResponseSource:
        def test_accessors_resolve_via_wrapped_session_and_other_attributes_proxy(
            self, sqlite_session: Session
        ) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            execution = _execution(CreatorUserRole.ACCOUNT, created_by=account.id)

            source = node_execution_response_source(execution, session=sqlite_session)

            resolved = source.created_by_account
            assert resolved is not None
            assert resolved.id == account.id
            assert source.created_by_end_user is None
            assert source.node_id == "n1"


"""SQLite-backed tests for workflow node execution offload behavior."""


TABLES = (WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, UploadFile)


def _persist_upload_file(session: Session, *, key: str = "offload/process-data.json") -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name="process-data.json",
        size=18,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime.now(UTC),
        used=True,
    )
    session.add(upload_file)
    session.flush()
    return upload_file


def _persist_execution(
    session: Session,
    *,
    process_data: str = '{"test": "data"}',
    offloads: tuple[tuple[ExecutionOffLoadType, str], ...] = (),
) -> WorkflowNodeExecutionModel:
    execution = WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="code",
        title="Code",
        inputs='{"input": "value"}',
        process_data=process_data,
        outputs='{"output": "value"}',
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=None,
    )
    session.add(execution)
    session.flush()

    session.add_all(
        [
            WorkflowNodeExecutionOffload(
                tenant_id=execution.tenant_id,
                app_id=execution.app_id,
                node_execution_id=execution.id,
                type_=type_,
                file_id=file_id,
            )
            for type_, file_id in offloads
        ]
    )
    session.commit()
    session.expunge_all()

    stmt = WorkflowNodeExecutionModel.preload_offload_data(
        select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution.id)
    )
    loaded_execution = session.scalar(stmt)
    assert loaded_execution is not None
    return loaded_execution


class TestWorkflowNodeExecutionOffloadCases:
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    class TestWorkflowNodeExecutionModel:
        """Exercise truncation flags and content restoration using persisted offload rows."""

        def test_process_data_truncated_property_false_when_no_offload_data(self, sqlite_session: Session) -> None:
            execution = _persist_execution(sqlite_session)

            assert execution.process_data_truncated is False

        def test_process_data_truncated_property_false_when_no_process_data_file(self, sqlite_session: Session) -> None:
            execution = _persist_execution(
                sqlite_session,
                offloads=(
                    (ExecutionOffLoadType.INPUTS, "inputs-file"),
                    (ExecutionOffLoadType.OUTPUTS, "outputs-file"),
                ),
            )

            assert execution.process_data_truncated is False

        def test_process_data_truncated_property_true_when_process_data_file_exists(
            self, sqlite_session: Session
        ) -> None:
            execution = _persist_execution(
                sqlite_session,
                offloads=((ExecutionOffLoadType.PROCESS_DATA, "process-data-file-id"),),
            )

            assert execution.process_data_truncated is True

        def test_load_full_process_data_with_no_offload_data(self, sqlite_session: Session) -> None:
            execution = _persist_execution(sqlite_session)
            storage = Mock()

            result = execution.load_full_process_data(sqlite_session, storage)

            assert result == {"test": "data"}
            storage.load.assert_not_called()

        def test_load_full_process_data_with_no_file(self, sqlite_session: Session) -> None:
            execution = _persist_execution(
                sqlite_session,
                offloads=((ExecutionOffLoadType.INPUTS, "inputs-file"),),
            )
            storage = Mock()

            result = execution.load_full_process_data(sqlite_session, storage)

            assert result == {"test": "data"}
            storage.load.assert_not_called()

        def test_load_full_process_data_with_file(self, sqlite_session: Session) -> None:
            upload_file = _persist_upload_file(sqlite_session)
            execution = _persist_execution(
                sqlite_session,
                process_data='{"truncated": true}',
                offloads=((ExecutionOffLoadType.PROCESS_DATA, upload_file.id),),
            )
            full_process_data = {"full": "data", "large_field": "x" * 10000}
            storage = Mock()
            storage.load.return_value = json.dumps(full_process_data)

            result = execution.load_full_process_data(sqlite_session, storage)

            assert result == full_process_data
            storage.load.assert_called_once_with(upload_file.key)

        def test_consistency_with_inputs_outputs_truncation(self, sqlite_session: Session) -> None:
            execution = _persist_execution(
                sqlite_session,
                offloads=(
                    (ExecutionOffLoadType.INPUTS, "inputs-file"),
                    (ExecutionOffLoadType.OUTPUTS, "outputs-file"),
                    (ExecutionOffLoadType.PROCESS_DATA, "process-data-file"),
                ),
            )

            assert execution.inputs_truncated is True
            assert execution.outputs_truncated is True
            assert execution.process_data_truncated is True

        def test_mixed_truncation_states(self, sqlite_session: Session) -> None:
            execution = _persist_execution(
                sqlite_session,
                offloads=((ExecutionOffLoadType.PROCESS_DATA, "process-data-file"),),
            )

            assert execution.inputs_truncated is False
            assert execution.outputs_truncated is False
            assert execution.process_data_truncated is True

        def test_preload_offload_data_and_files_loads_process_data_file(self, sqlite_session: Session) -> None:
            upload_file = _persist_upload_file(sqlite_session)
            execution = _persist_execution(
                sqlite_session,
                offloads=((ExecutionOffLoadType.PROCESS_DATA, upload_file.id),),
            )
            execution_id = execution.id
            sqlite_session.expunge_all()

            stmt = WorkflowNodeExecutionModel.preload_offload_data_and_files(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution_id)
            )
            preloaded_execution = sqlite_session.scalar(stmt)

            assert preloaded_execution is not None
            assert len(preloaded_execution.offload_data) == 1
            assert preloaded_execution.offload_data[0].file is not None
            assert preloaded_execution.offload_data[0].file.key == upload_file.key


"""Regression coverage for ``WorkflowRun`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER. Also covers the session-carrying response
sources used by the console endpoints that validate the run detail / pagination responses
with ``from_attributes=True``.
"""


def _run(role: CreatorUserRole, created_by: str) -> WorkflowRun:
    """Construct a WorkflowRun without touching the database."""
    return WorkflowRun(
        id=str(uuid4()),
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id=str(uuid4()),
        type="workflow",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1.0",
        status="succeeded",
        created_by_role=role,
        created_by=created_by,
    )


class TestWorkflowRunAccessorsCases:
    class TestCreatedByAccount:
        def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            run = _run(CreatorUserRole.ACCOUNT, created_by=account.id)

            result = run.created_by_account(session=sqlite_session)

            assert result is not None
            assert result.id == account.id

        def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            run = _run(CreatorUserRole.END_USER, created_by=account.id)

            assert run.created_by_account(session=sqlite_session) is None

    class TestCreatedByEndUser:
        def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            run = _run(CreatorUserRole.END_USER, created_by=end_user.id)

            result = run.created_by_end_user(session=sqlite_session)

            assert result is not None
            assert result.id == end_user.id

        def test_returns_none_when_role_is_account(self, sqlite_session: Session) -> None:
            end_user = EndUser(
                tenant_id="00000000-0000-0000-0000-000000000001",
                type=EndUserType.BROWSER,
                session_id="session-1",
            )
            sqlite_session.add(end_user)
            sqlite_session.flush()
            run = _run(CreatorUserRole.ACCOUNT, created_by=end_user.id)

            assert run.created_by_end_user(session=sqlite_session) is None

    class TestWorkflowRunResponseSources:
        def test_detail_source_resolves_accessors_and_proxies_other_attributes(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            run = _run(CreatorUserRole.ACCOUNT, created_by=account.id)

            source = workflow_run_response_source(run, session=sqlite_session)

            resolved = source.created_by_account
            assert resolved is not None
            assert resolved.id == account.id
            assert source.created_by_end_user is None
            assert source.version == "1.0"

        def test_pagination_source_wraps_each_run(self, sqlite_session: Session) -> None:
            account = Account(name="Test Account", email="test@example.com")
            sqlite_session.add(account)
            sqlite_session.flush()
            runs = [_run(CreatorUserRole.ACCOUNT, created_by=account.id) for _ in range(2)]
            pagination = SimpleNamespace(data=runs, limit=20, has_more=False)

            payload = workflow_run_pagination_response_source(pagination, session=sqlite_session)

            assert payload["limit"] == 20
            assert payload["has_more"] is False
            assert [item.created_by_account.id for item in payload["data"]] == [account.id, account.id]


@pytest.mark.parametrize(
    ("features", "expected"),
    [
        pytest.param({}, {}, id="missing-upload"),
        pytest.param({"file_upload": None}, {"file_upload": None}, id="null-upload"),
        pytest.param({"file_upload": False}, {"file_upload": False}, id="non-object-upload"),
        pytest.param({"file_upload": {}}, {"file_upload": {}}, id="missing-image"),
        pytest.param({"file_upload": {"image": None}}, {"file_upload": {"image": None}}, id="null-image"),
        pytest.param({"file_upload": {"image": False}}, {"file_upload": {"image": False}}, id="non-object-image"),
        pytest.param(
            {"file_upload": {"enabled": False, "image": {"enabled": False}}},
            {"file_upload": {"enabled": False, "image": {"enabled": False}}},
            id="disabled-image",
        ),
        pytest.param(OLD_VERSION_WORKFLOW_FEATURES, NEW_VERSION_WORKFLOW_FEATURES, id="legacy-image"),
        pytest.param(NEW_VERSION_WORKFLOW_FEATURES, NEW_VERSION_WORKFLOW_FEATURES, id="modern-upload"),
    ],
)
def test_normalized_features_preserves_stored_payload_without_dirtying_workflow(
    sqlite_session: Session,
    features: dict[str, JsonValue],
    expected: dict[str, JsonValue],
) -> None:
    stored_features = json.dumps(features)
    workflow = _workflow_feature_compatibility_Workflow(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        type=WorkflowType.CHAT,
        version="published",
        graph="{}",
        features=stored_features,
        created_by=str(uuid4()),
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()

    assert workflow.normalized_features_dict == expected
    assert workflow.serialized_features == stored_features
    assert workflow not in sqlite_session.dirty

    sqlite_session.expire(workflow)
    assert workflow.serialized_features == stored_features
