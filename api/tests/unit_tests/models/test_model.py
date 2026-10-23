import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from dify_trace_arize_phoenix import arize_phoenix_trace
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from dify_trace_arize_phoenix.config import ArizeConfig
from openinference.semconv.trace import SpanAttributes
from opentelemetry.sdk.trace import Tracer, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import MessageTraceInfo
from core.ops.ops_trace_manager import OpsTraceManager, TaskData
from core.workflow.file_reference import build_file_reference
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from models import model as model_module
from models.account import Account, Tenant
from models.dataset import DatasetCollectionBinding
from models.enums import (
    CollectionBindingType,
    ConversationFromSource,
    CustomizeTokenStrategy,
    FeedbackFromSource,
    FeedbackRating,
)
from models.model import (
    AccountTrialAppRecord,
    AnnotationReplyConfig,
    App,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppMCPServer,
    AppMode,
    AppModelConfig,
    Conversation,
    IconType,
    InstalledApp,
    Message,
    MessageAnnotation,
    MessageDict,
    MessageFeedback,
    RecommendedApp,
    Site,
    load_annotation_reply_config,
)
from models.workflow import Workflow, WorkflowType
from tasks import ops_trace_task
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_message

"""Regression coverage for the ``@property``→session-parameter refactor on
``AppAnnotationHitHistory`` accessors.

Covers two of `api/models/model.py`'s legacy `@property` accessors that reached for the global
``db.session`` internally and have been converted to plain methods taking an explicit
``session: Session`` (per the pattern established in #40370/#40797/#41394/#41830, tracked in
#40372):

- ``AppAnnotationHitHistory.account`` (joins through ``MessageAnnotation.account_id``)
- ``AppAnnotationHitHistory.annotation_create_account`` (looks up ``self.account_id`` directly)

Each accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""


def _annotation_hit_history_session_accessors_persist_account(session: Session) -> Account:
    account = Account(name="Test Account", email="test@example.com")
    session.add(account)
    session.flush()
    return account


def _annotation_hit_history_session_accessors_persist_annotation(
    session: Session, *, app_id: str, account_id: str
) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app_id,
        conversation_id=None,
        message_id=None,
        question="What is AI?",
        content="AI stands for Artificial Intelligence.",
        account_id=account_id,
    )
    session.add(annotation)
    session.flush()
    return annotation


def _hit_history(*, app_id: str, annotation_id: str, account_id: str) -> AppAnnotationHitHistory:
    return AppAnnotationHitHistory(
        app_id=app_id,
        annotation_id=annotation_id,
        source="api",
        question="What is AI?",
        account_id=account_id,
        score=0.95,
        message_id=str(uuid4()),
        annotation_question="What is AI?",
        annotation_content="AI stands for Artificial Intelligence.",
    )


class TestAnnotationHitHistorySessionAccessorsCases:
    class TestAppAnnotationHitHistoryAccount:
        def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
            app_id = str(uuid4())
            creator = _annotation_hit_history_session_accessors_persist_account(sqlite_session)
            annotation = _annotation_hit_history_session_accessors_persist_annotation(
                sqlite_session, app_id=app_id, account_id=creator.id
            )
            history = _hit_history(app_id=app_id, annotation_id=annotation.id, account_id=str(uuid4()))

            result = history.account(session=sqlite_session)

            assert result is not None
            assert result.id == creator.id

        def test_returns_none_when_annotation_missing(self, sqlite_session: Session) -> None:
            history = _hit_history(app_id=str(uuid4()), annotation_id=str(uuid4()), account_id=str(uuid4()))

            assert history.account(session=sqlite_session) is None

    class TestAppAnnotationHitHistoryAnnotationCreateAccount:
        def test_returns_the_hit_requester(self, sqlite_session: Session) -> None:
            app_id = str(uuid4())
            requester = _annotation_hit_history_session_accessors_persist_account(sqlite_session)
            annotation = _annotation_hit_history_session_accessors_persist_annotation(
                sqlite_session, app_id=app_id, account_id=str(uuid4())
            )
            history = _hit_history(app_id=app_id, annotation_id=annotation.id, account_id=requester.id)

            result = history.annotation_create_account(session=sqlite_session)

            assert result is not None
            assert result.id == requester.id

        def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
            history = _hit_history(app_id=str(uuid4()), annotation_id=str(uuid4()), account_id=str(uuid4()))

            assert history.annotation_create_account(session=sqlite_session) is None


"""Regression coverage for the ``@property``→session-parameter refactor on
``AppAnnotationSetting.collection_binding_detail``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session: Session`` (per the pattern established in
#40370/#40797/#41394/#41830, tracked in #40372).

The accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual query
behaviour rather than a mock's recorded call.
"""


def _persist_collection_binding(session: Session) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        collection_name="test_collection",
        provider_name="test_provider",
        model_name="test_model",
        type=CollectionBindingType.DATASET,
    )
    session.add(binding)
    session.flush()
    return binding


def _persist_setting(session: Session, *, collection_binding_id: str) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=str(uuid4()),
        score_threshold=0.8,
        collection_binding_id=collection_binding_id,
        created_user_id=str(uuid4()),
        updated_user_id=str(uuid4()),
    )
    session.add(setting)
    session.flush()
    return setting


class TestAppAnnotationSettingSessionAccessorsCases:
    class TestAppAnnotationSettingCollectionBindingDetail:
        def test_returns_the_bound_collection_binding(self, sqlite_session: Session) -> None:
            binding = _persist_collection_binding(sqlite_session)
            setting = _persist_setting(sqlite_session, collection_binding_id=binding.id)

            result = setting.collection_binding_detail(session=sqlite_session)

            assert result is not None
            assert result.id == binding.id

        def test_returns_none_when_binding_missing(self, sqlite_session: Session) -> None:
            setting = _persist_setting(sqlite_session, collection_binding_id=str(uuid4()))

            assert setting.collection_binding_detail(session=sqlite_session) is None


"""Regression coverage for the ``db.session``→session-parameter refactor on
``AppMCPServer.generate_server_code``.

The static method reached for the global ``db.session`` internally and has been converted to
take an explicit ``session: Session`` (per the pattern established in #40370/#40797/#41394,
tracked in #40372).
"""


def _persist_server(session: Session, *, server_code: str) -> AppMCPServer:
    server = AppMCPServer(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        name="Test MCP Server",
        description="Test server",
        server_code=server_code,
        status="active",
        parameters="{}",
    )
    session.add(server)
    session.flush()
    return server


class TestAppMcpServerSessionAccessorsCases:
    @staticmethod
    def test_generate_server_code_retries_a_taken_code_through_the_given_session(sqlite_session: Session) -> None:
        _persist_server(sqlite_session, server_code="taken-code")

        with patch("models.model.generate_string", side_effect=["taken-code", "fresh-code"]):
            result = AppMCPServer.generate_server_code(16, session=sqlite_session)

        assert result == "fresh-code"


"""
Comprehensive unit tests for App models.

This test suite covers:
- App configuration validation
- App-Message relationships
- Conversation model integrity
- Annotation model relationships
"""


class TestAppModelsCases:
    class TestAppModelValidation:
        """Test suite for App model validation and basic operations."""

        def test_app_creation_with_required_fields(self):
            """Test creating an app with all required fields."""
            # Arrange
            tenant_id = str(uuid4())
            created_by = str(uuid4())

            # Act
            app = App(
                tenant_id=tenant_id,
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=created_by,
            )

            # Assert
            assert app.name == "Test App"
            assert app.tenant_id == tenant_id
            assert app.mode == AppMode.CHAT
            assert app.enable_site is True
            assert app.enable_api is False
            assert app.created_by == created_by

        def test_app_creation_with_optional_fields(self):
            """Test creating an app with optional fields."""
            # Arrange & Act
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.COMPLETION,
                enable_site=True,
                enable_api=True,
                created_by=str(uuid4()),
                description="Test description",
                icon_type=IconType.EMOJI,
                icon="🤖",
                icon_background="#FF5733",
                is_demo=True,
                is_public=False,
                api_rpm=100,
                api_rph=1000,
            )

            # Assert
            assert app.description == "Test description"
            assert app.icon_type == IconType.EMOJI
            assert app.icon == "🤖"
            assert app.icon_background == "#FF5733"
            assert app.is_demo is True
            assert app.is_public is False
            assert app.api_rpm == 100
            assert app.api_rph == 1000

        def test_app_mode_validation(self):
            """Test app mode enum values."""
            # Assert
            expected_modes = {
                "chat",
                "completion",
                "workflow",
                "advanced-chat",
                "agent-chat",
                "agent",
                "channel",
                "rag-pipeline",
            }
            assert {mode.value for mode in AppMode} == expected_modes

        def test_app_mode_value_of(self):
            """Test AppMode.value_of method."""
            # Act & Assert
            assert AppMode.value_of("chat") == AppMode.CHAT
            assert AppMode.value_of("completion") == AppMode.COMPLETION
            assert AppMode.value_of("workflow") == AppMode.WORKFLOW

            with pytest.raises(ValueError, match="invalid mode value"):
                AppMode.value_of("invalid_mode")

        def test_icon_type_validation(self):
            """Test icon type enum values."""
            # Assert
            assert {t.value for t in IconType} == {"image", "emoji", "link"}

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_desc_or_prompt_with_description(self, sqlite_session: Session):
            """Test desc_or_prompt_with_session when description exists."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
                description="App description",
            )

            # Act
            result = app.desc_or_prompt_with_session(session=sqlite_session)

            # Assert
            assert result == "App description"

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_desc_or_prompt_without_description(self, sqlite_session: Session):
            """Test desc_or_prompt property when description is empty."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
                description="",
            )
            decoy_config = AppModelConfig(app_id=str(uuid4()), pre_prompt="A decoy prompt")
            sqlite_session.add_all([app, decoy_config])
            sqlite_session.flush()

            # Act
            result = app.desc_or_prompt_with_session(session=sqlite_session)

            # Assert
            assert result == ""

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_is_agent_false_when_not_configured_as_agent(self, sqlite_session: Session):
            """`is_agent_with_session` returns False when the config has no agent mode."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
                app_model_config_id=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()

            # Act
            result = app.is_agent_with_session(session=sqlite_session)

            # Assert
            assert result is False

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_is_agent_with_session_persists_mode_across_sessions(self, sqlite_session: Session):
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()
            model_config = AppModelConfig(
                app_id=app.id,
                agent_mode=json.dumps({"enabled": True, "strategy": "react"}),
            )
            sqlite_session.add(model_config)
            sqlite_session.flush()
            app.app_model_config_id = model_config.id
            sqlite_session.commit()

            with Session(sqlite_session.get_bind(), expire_on_commit=False) as migration_session:
                assert app.is_agent_with_session(session=migration_session) is True

            sqlite_session.expire_all()
            assert sqlite_session.get(App, app.id).mode == AppMode.AGENT_CHAT

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_mode_compatible_with_agent(self, sqlite_session: Session):
            """Test mode_compatible_with_agent property."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            decoy_config = AppModelConfig(
                app_id=str(uuid4()),
                agent_mode=json.dumps({"enabled": True, "strategy": "react"}),
            )
            sqlite_session.add_all([app, decoy_config])
            sqlite_session.flush()

            # Act
            result = app.mode_compatible_with_agent_with_session(session=sqlite_session)

            # Assert
            assert result == AppMode.CHAT

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_mode_compatible_with_agent_reports_agent_chat(self, sqlite_session: Session):
            """A CHAT app whose own config enables agent mode reports AGENT_CHAT."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()
            app.app_model_config_id = str(uuid4())
            config = AppModelConfig(
                app_id=app.id,
                agent_mode=json.dumps({"enabled": True, "strategy": "react"}),
            )
            config.id = app.app_model_config_id
            sqlite_session.add(config)
            sqlite_session.flush()

            # Act
            result = app.mode_compatible_with_agent_with_session(session=sqlite_session)

            # Assert
            assert result == AppMode.AGENT_CHAT

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_model_config_with_session_reads_through_the_caller_session(self, sqlite_session: Session):
            """`app_model_config_with_session` resolves the linked config through the caller's session."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()
            model_config = AppModelConfig(app_id=app.id, agent_mode=json.dumps({"enabled": False}))
            sqlite_session.add(model_config)
            sqlite_session.flush()
            app.app_model_config_id = model_config.id
            sqlite_session.commit()

            # Act: a session the model never owns, proving the lookup does not reach for a global one
            with Session(sqlite_session.get_bind(), expire_on_commit=False) as caller_session:
                result = app.app_model_config_with_session(session=caller_session)

                # Assert
                assert result is not None
                assert result.id == model_config.id
                assert result in caller_session

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_app_model_config_with_session_returns_none_when_unlinked(self, sqlite_session: Session):
            """An app without `app_model_config_id` resolves to None without querying."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()

            # Act / Assert: an unbound session would raise if the guard were dropped
            with Session(expire_on_commit=False) as unbound_session:
                assert app.app_model_config_with_session(session=unbound_session) is None

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_workflow_with_session_reads_through_the_caller_session(self, sqlite_session: Session):
            """`workflow_with_session` resolves the published workflow through the caller's session."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()
            workflow = Workflow(
                tenant_id=app.tenant_id,
                app_id=app.id,
                type=WorkflowType.WORKFLOW,
                version="1",
                graph=json.dumps({"nodes": [], "edges": []}),
                created_by=app.created_by,
            )
            workflow._features = "{}"
            sqlite_session.add(workflow)
            sqlite_session.flush()
            app.workflow_id = workflow.id
            sqlite_session.commit()

            # Act: a session the model never owns, proving the lookup does not reach for a global one
            with Session(sqlite_session.get_bind(), expire_on_commit=False) as caller_session:
                result = app.workflow_with_session(session=caller_session)

                # Assert
                assert result is not None
                assert result.id == workflow.id
                assert result in caller_session

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_workflow_with_session_returns_none_when_unpublished(self, sqlite_session: Session):
            """An app without `workflow_id` resolves to None without querying."""
            # Arrange
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()

            # Act / Assert: an unbound session would raise if the guard were dropped
            with Session(expire_on_commit=False) as unbound_session:
                assert app.workflow_with_session(session=unbound_session) is None

        @pytest.mark.parametrize("sqlite_session", [(App, AppModelConfig)], indirect=True)
        def test_deleted_tools_checks_plugin_builtin_providers_through_core_plugin_service(
            self, sqlite_session: Session
        ):
            """Plugin-backed built-in tools are checked through core PluginService."""
            # Arrange
            app = App(
                tenant_id="tenant-1",
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=False,
                created_by=str(uuid4()),
            )
            sqlite_session.add(app)
            sqlite_session.flush()
            app_model_config = AppModelConfig(
                app_id=app.id,
                agent_mode=json.dumps(
                    {
                        "enabled": True,
                        "strategy": "function_call",
                        "tools": [
                            {
                                "provider_type": "builtin",
                                "provider_id": "langgenius/openai/openai",
                                "tool_name": "chat",
                                "tool_parameters": {},
                            }
                        ],
                        "prompt": None,
                    }
                ),
            )
            sqlite_session.add(app_model_config)
            sqlite_session.flush()
            app.app_model_config_id = app_model_config.id
            sqlite_session.flush()

            # Act
            with (
                patch("core.tools.tool_manager.ToolManager.get_hardcoded_provider", side_effect=Exception),
                patch("core.plugin.plugin_service.PluginService.check_tools_existence", return_value=[False]) as exists,
            ):
                result = app.deleted_tools_with_session(session=sqlite_session)

            # Assert
            assert result == [{"type": "builtin", "tool_name": "chat", "provider_id": "langgenius/openai/openai"}]
            exists.assert_called_once()
            assert exists.call_args.args[0] == "tenant-1"
            assert [str(provider_id) for provider_id in exists.call_args.args[1]] == ["langgenius/openai/openai"]

    class TestAppModelConfig:
        """Test suite for AppModelConfig model."""

        def test_legacy_dataset_configs_default_retrieval_model_without_dropping_settings(self):
            config = AppModelConfig(
                app_id=str(uuid4()),
                dataset_configs=json.dumps({"reranking_enable": True, "top_k": 8}),
            )

            assert config.dataset_configs_dict == {
                "retrieval_model": "single",
                "reranking_enable": True,
                "top_k": 8,
            }

        def test_app_model_config_creation(self):
            """Test creating an AppModelConfig."""
            # Arrange
            app_id = str(uuid4())
            created_by = str(uuid4())

            # Act
            config = AppModelConfig(
                app_id=app_id,
                provider="openai",
                model_id="gpt-4",
                created_by=created_by,
            )

            # Assert
            assert config.app_id == app_id
            assert config.provider == "openai"
            assert config.model_id == "gpt-4"
            assert config.created_by == created_by

        def test_app_model_config_with_configs_json(self):
            """Test AppModelConfig with JSON configs."""
            # Arrange
            configs = {"temperature": 0.7, "max_tokens": 1000}

            # Act
            config = AppModelConfig(
                app_id=str(uuid4()),
                provider="openai",
                model_id="gpt-4",
                created_by=str(uuid4()),
                configs=configs,
            )

            # Assert
            assert config.configs == configs

        def test_app_model_config_model_dict_property(self):
            """Test model_dict property."""
            # Arrange
            model_data = {"provider": "openai", "name": "gpt-4"}
            config = AppModelConfig(
                app_id=str(uuid4()),
                provider="openai",
                model_id="gpt-4",
                created_by=str(uuid4()),
                model=json.dumps(model_data),
            )

            # Act
            result = config.model_dict

            # Assert
            assert result == model_data

        def test_app_model_config_model_dict_empty(self):
            """Test model_dict property when model is None."""
            # Arrange
            config = AppModelConfig(
                app_id=str(uuid4()),
                provider="openai",
                model_id="gpt-4",
                created_by=str(uuid4()),
                model=None,
            )

            # Act
            result = config.model_dict

            # Assert
            assert result == {}

        def test_app_model_config_suggested_questions_list(self):
            """Test suggested_questions_list property."""
            # Arrange
            questions = ["What can you do?", "How does this work?"]
            config = AppModelConfig(
                app_id=str(uuid4()),
                provider="openai",
                model_id="gpt-4",
                created_by=str(uuid4()),
                suggested_questions=json.dumps(questions),
            )

            # Act
            result = config.suggested_questions_list

            # Assert
            assert result == questions

        def test_to_dict_uses_injected_annotation_reply(self):
            config = AppModelConfig(app_id=str(uuid4()))
            annotation_reply: AnnotationReplyConfig = {"enabled": False}

            result = config.to_dict(annotation_reply=annotation_reply)

            assert result["annotation_reply"] == annotation_reply

    class TestAnnotationReplyConfigLoader:
        @pytest.mark.parametrize("sqlite_session", [(AppAnnotationSetting, DatasetCollectionBinding)], indirect=True)
        def test_load_annotation_reply_config_returns_disabled_when_setting_missing(self, sqlite_session: Session):
            binding = DatasetCollectionBinding(
                provider_name="decoy-provider",
                model_name="decoy-model",
                type=CollectionBindingType.ANNOTATION,
                collection_name="decoy-collection",
            )
            sqlite_session.add(binding)
            sqlite_session.flush()
            sqlite_session.add(
                AppAnnotationSetting(
                    app_id="other-app",
                    score_threshold=0.9,
                    collection_binding_id=binding.id,
                    created_user_id="user-1",
                    updated_user_id="user-1",
                )
            )
            sqlite_session.flush()

            result = load_annotation_reply_config(sqlite_session, "app-1")

            assert result == {"enabled": False}

        @pytest.mark.parametrize("sqlite_session", [(AppAnnotationSetting, DatasetCollectionBinding)], indirect=True)
        def test_load_annotation_reply_config_returns_embedding_model(self, sqlite_session: Session):
            collection_binding = DatasetCollectionBinding(
                provider_name="provider",
                model_name="embedding",
                type=CollectionBindingType.ANNOTATION,
                collection_name="annotation-collection",
            )
            sqlite_session.add(collection_binding)
            sqlite_session.flush()
            annotation_setting = AppAnnotationSetting(
                app_id="app-1",
                score_threshold=0.7,
                collection_binding_id=collection_binding.id,
                created_user_id="user-1",
                updated_user_id="user-1",
            )
            sqlite_session.add(annotation_setting)
            sqlite_session.flush()

            result = load_annotation_reply_config(sqlite_session, "app-1")

            assert result == {
                "id": annotation_setting.id,
                "enabled": True,
                "score_threshold": 0.7,
                "embedding_model": {
                    "embedding_provider_name": "provider",
                    "embedding_model_name": "embedding",
                },
            }

        @pytest.mark.parametrize("sqlite_session", [(AppAnnotationSetting, DatasetCollectionBinding)], indirect=True)
        def test_load_annotation_reply_config_raises_when_binding_missing(self, sqlite_session: Session):
            sqlite_session.add(
                AppAnnotationSetting(
                    app_id="app-1",
                    score_threshold=0.7,
                    collection_binding_id=str(uuid4()),
                    created_user_id="user-1",
                    updated_user_id="user-1",
                )
            )
            sqlite_session.flush()

            with pytest.raises(ValueError, match="Collection binding detail not found"):
                load_annotation_reply_config(sqlite_session, "app-1")

    class TestConversationModel:
        """Test suite for Conversation model integrity."""

        def test_app_returns_matching_app_from_caller_session(self, sqlite_session: Session) -> None:
            other_app = App(
                tenant_id=str(uuid4()), name="Other app", mode=AppMode.CHAT, enable_site=False, enable_api=False
            )
            app = App(
                tenant_id=str(uuid4()), name="Conversation app", mode=AppMode.CHAT, enable_site=False, enable_api=False
            )
            sqlite_session.add_all([other_app, app])
            sqlite_session.flush()
            conversation = Conversation(app_id=app.id)

            assert conversation.app(session=sqlite_session) is app

        def test_app_returns_none_when_app_is_missing(self, sqlite_session: Session) -> None:
            other_app = App(
                tenant_id=str(uuid4()), name="Other app", mode=AppMode.CHAT, enable_site=False, enable_api=False
            )
            sqlite_session.add(other_app)
            sqlite_session.flush()
            conversation = Conversation(app_id=str(uuid4()))

            assert conversation.app(session=sqlite_session) is None

        def test_conversation_creation_with_required_fields(self):
            """Test creating a conversation with required fields."""
            # Arrange
            app_id = str(uuid4())
            from_end_user_id = str(uuid4())

            # Act
            conversation = Conversation(
                app_id=app_id,
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=from_end_user_id,
            )

            # Assert
            assert conversation.app_id == app_id
            assert conversation.mode == AppMode.CHAT
            assert conversation.name == "Test Conversation"
            assert conversation.status == "normal"
            assert conversation.from_source == "api"
            assert conversation.from_end_user_id == from_end_user_id

        def test_conversation_with_inputs(self, sqlite_session: Session):
            """Test conversation inputs round-trip through the session-aware accessor."""
            # Arrange
            inputs = {"query": "Hello", "context": "test"}
            conversation = Conversation(
                app_id=str(uuid4()),
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
            )
            conversation._inputs = inputs

            # Act
            result = conversation.inputs_with_session(session=sqlite_session)

            # Assert
            assert result == inputs

        def test_conversation_inputs_is_write_only(self):
            """Reading conversation.inputs must fail loudly; reads go through inputs_with_session."""
            conversation = Conversation(app_id=str(uuid4()), _inputs={})

            with pytest.raises(AttributeError, match="no getter"):
                _ = conversation.inputs

        def test_conversation_inputs_setter(self):
            """Test conversation inputs setter."""
            # Arrange
            conversation = Conversation(
                app_id=str(uuid4()),
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
            )
            inputs = {"query": "Hello", "context": "test"}

            # Act
            conversation.inputs = inputs

            # Assert
            assert conversation._inputs == inputs

        @pytest.mark.parametrize("sqlite_session", [(Conversation, Message)], indirect=True)
        def test_conversation_summary_or_query_with_summary(self, sqlite_session: Session):
            """Test summary_or_query_with_session when summary exists."""
            # Arrange
            conversation = Conversation(
                app_id=str(uuid4()),
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
                summary="Test summary",
            )

            # Act
            result = conversation.summary_or_query_with_session(session=sqlite_session)

            # Assert
            assert result == "Test summary"

        @pytest.mark.parametrize("sqlite_session", [(Conversation, Message)], indirect=True)
        def test_conversation_summary_or_query_without_summary(self, sqlite_session: Session):
            """Test summary_or_query_with_session when summary is empty."""
            # Arrange
            conversation = Conversation(
                app_id=str(uuid4()),
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
                summary=None,
            )
            conversation._inputs = {}
            sqlite_session.add(conversation)
            sqlite_session.flush()
            first_message = Message(
                app_id=conversation.app_id,
                conversation_id=conversation.id,
                query="First message query",
                message={"role": "user", "content": "First message query"},
                answer="First answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                created_at=datetime(2024, 1, 1),
            )
            first_message._inputs = {}
            later_message = Message(
                app_id=conversation.app_id,
                conversation_id=conversation.id,
                query="Later message query",
                message={"role": "user", "content": "Later message query"},
                answer="Later answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                created_at=datetime(2024, 1, 2),
            )
            later_message._inputs = {}
            sqlite_session.add_all([later_message, first_message])
            sqlite_session.flush()

            # Act
            result = conversation.summary_or_query_with_session(session=sqlite_session)

            # Assert
            assert result == "First message query"

        @pytest.mark.parametrize(
            "sqlite_session", [(Conversation, AppModelConfig, AppAnnotationSetting)], indirect=True
        )
        def test_model_config_uses_caller_session_for_annotation_reply(self, sqlite_session: Session):
            app_id = str(uuid4())
            app_model_config = AppModelConfig(app_id=app_id, pre_prompt="Persisted prompt")
            sqlite_session.add(app_model_config)
            sqlite_session.flush()
            conversation = Conversation(
                app_id=app_id,
                app_model_config_id=app_model_config.id,
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
                model_id="model-1",
                model_provider="provider-1",
            )
            conversation._inputs = {}
            sqlite_session.add(conversation)
            sqlite_session.flush()

            result = conversation.model_config_with_session(session=sqlite_session)

            assert result["annotation_reply"] == {"enabled": False}
            assert result["pre_prompt"] == "Persisted prompt"
            assert result["model_id"] == "model-1"
            assert result["provider"] == "provider-1"

        @pytest.mark.parametrize("sqlite_session", [(Conversation, AppAnnotationSetting)], indirect=True)
        def test_override_model_config_uses_caller_session_for_annotation_reply(self, sqlite_session: Session):
            app_id = str(uuid4())
            conversation = Conversation(
                app_id=app_id,
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
                override_model_configs=json.dumps({"model": {"provider": "openai", "name": "gpt-4"}}),
                model_id="model-1",
                model_provider="provider-1",
            )
            conversation._inputs = {}
            sqlite_session.add(conversation)
            sqlite_session.flush()

            result = conversation.model_config_with_session(session=sqlite_session)

            assert result["annotation_reply"] == {"enabled": False}
            assert result["model"] == {"provider": "openai", "name": "gpt-4"}
            assert result["model_id"] == "model-1"
            assert result["provider"] == "provider-1"

        def test_conversation_in_debug_mode(self):
            """Test in_debug_mode property."""
            # Arrange
            conversation = Conversation(
                app_id=str(uuid4()),
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
                override_model_configs='{"model": "gpt-4"}',
            )

            # Act
            result = conversation.in_debug_mode

            # Assert
            assert result is True

        @pytest.mark.parametrize("sqlite_session", [(Conversation,)], indirect=True)
        def test_conversation_to_dict_serialization(self, sqlite_session: Session):
            """Test conversation to_dict method."""
            # Arrange
            app_id = str(uuid4())
            from_end_user_id = str(uuid4())
            conversation = Conversation(
                app_id=app_id,
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=from_end_user_id,
                dialogue_count=5,
            )
            conversation.id = str(uuid4())
            conversation._inputs = {"query": "test"}

            # Act
            result = conversation.to_dict(session=sqlite_session)

            # Assert
            assert result["id"] == conversation.id
            assert result["app_id"] == app_id
            assert result["mode"] == AppMode.CHAT
            assert result["name"] == "Test Conversation"
            assert result["status"] == "normal"
            assert result["from_source"] == "api"
            assert result["from_end_user_id"] == from_end_user_id
            assert result["dialogue_count"] == 5
            assert result["inputs"] == {"query": "test"}

    class TestMessageModel:
        """Test suite for Message model and App-Message relationships."""

        def test_message_creation_with_required_fields(self):
            """Test creating a message with required fields."""
            # Arrange
            app_id = str(uuid4())
            conversation_id = str(uuid4())

            # Act
            message = Message(
                app_id=app_id,
                conversation_id=conversation_id,
                query="What is AI?",
                message={"role": "user", "content": "What is AI?"},
                answer="AI stands for Artificial Intelligence.",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
            )

            # Assert
            assert message.app_id == app_id
            assert message.conversation_id == conversation_id
            assert message.query == "What is AI?"
            assert message.answer == "AI stands for Artificial Intelligence."
            assert message.currency == "USD"
            assert message.from_source == "api"

        def test_message_with_inputs(self, sqlite_session: Session):
            """Test message inputs round-trip through the session-aware accessor."""
            # Arrange
            inputs = {"query": "Hello", "context": "test"}
            message = Message(
                app_id=str(uuid4()),
                conversation_id=str(uuid4()),
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                _inputs=inputs,
            )

            # Act
            result = message.inputs_with_session(session=sqlite_session)

            # Assert
            assert result == inputs

        def test_message_inputs_is_write_only(self):
            """Reading message.inputs must fail loudly; reads go through inputs_with_session."""
            message = Message(app_id=str(uuid4()), _inputs={})

            with pytest.raises(AttributeError, match="no getter"):
                _ = message.inputs

        def test_message_inputs_setter(self):
            """Test message inputs setter."""
            # Arrange
            message = Message(
                app_id=str(uuid4()),
                conversation_id=str(uuid4()),
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
            inputs = {"query": "Hello", "context": "test"}

            # Act
            message.inputs = inputs

            # Assert
            assert message._inputs == inputs

        def test_message_in_debug_mode(self):
            """Test message in_debug_mode property."""
            # Arrange
            message = Message(
                app_id=str(uuid4()),
                conversation_id=str(uuid4()),
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                override_model_configs='{"model": "gpt-4"}',
            )

            # Act
            result = message.in_debug_mode

            # Assert
            assert result is True

        def test_message_metadata_dict_property(self):
            """Test message_metadata_dict property."""
            # Arrange
            metadata = {"retriever_resources": ["doc1", "doc2"], "usage": {"tokens": 100}}
            message = Message(
                app_id=str(uuid4()),
                conversation_id=str(uuid4()),
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                message_metadata=json.dumps(metadata),
            )

            # Act
            result = message.message_metadata_dict

            # Assert
            assert result == metadata

        def test_message_metadata_dict_empty(self):
            """Test message_metadata_dict when metadata is None."""
            # Arrange
            message = Message(
                app_id=str(uuid4()),
                conversation_id=str(uuid4()),
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                message_metadata=None,
            )

            # Act
            result = message.message_metadata_dict

            # Assert
            assert result == {}

        @pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
        def test_message_to_dict_serialization(self, sqlite_session: Session):
            """Test message to_dict method."""
            # Arrange
            app_id = str(uuid4())
            conversation_id = str(uuid4())
            now = datetime.now(UTC)

            message = Message(
                app_id=app_id,
                conversation_id=conversation_id,
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                total_price=Decimal("0.0003"),
                currency="USD",
                from_source=ConversationFromSource.API,
                status="normal",
                id=str(uuid4()),
                _inputs={"query": "test"},
                created_at=now,
                updated_at=now,
            )

            # Act
            result = message.to_dict(session=sqlite_session)

            # Assert
            assert result["id"] == message.id
            assert result["app_id"] == app_id
            assert result["conversation_id"] == conversation_id
            assert result["query"] == "Test query"
            assert result["answer"] == "Test answer"
            assert result["status"] == "normal"
            assert result["from_source"] == "api"
            assert result["inputs"] == {"query": "test"}
            assert "created_at" in result
            assert "updated_at" in result

        def test_message_from_dict_deserialization(self):
            """Test message from_dict method."""
            # Arrange
            message_id = str(uuid4())
            app_id = str(uuid4())
            conversation_id = str(uuid4())
            data = {
                "id": message_id,
                "app_id": app_id,
                "conversation_id": conversation_id,
                "model_id": "gpt-4",
                "inputs": {"query": "test"},
                "query": "Test query",
                "message": {"role": "user", "content": "Test"},
                "answer": "Test answer",
                "total_price": Decimal("0.0003"),
                "status": "normal",
                "error": None,
                "message_metadata": {"usage": {"tokens": 100}},
                "from_source": "api",
                "from_end_user_id": None,
                "from_account_id": None,
                "created_at": "2024-01-01T00:00:00",
                "updated_at": "2024-01-01T00:00:00",
                "agent_based": False,
                "workflow_run_id": None,
            }

            # Act
            message = Message.from_dict(data)

            # Assert
            assert message.id == message_id
            assert message.app_id == app_id
            assert message.conversation_id == conversation_id
            assert message.query == "Test query"
            assert message.answer == "Test answer"

    class TestMessageAnnotation:
        """Test suite for MessageAnnotation and annotation relationships."""

        def test_message_annotation_creation(self):
            """Test creating a message annotation."""
            # Arrange
            app_id = str(uuid4())
            conversation_id = str(uuid4())
            message_id = str(uuid4())
            account_id = str(uuid4())

            # Act
            annotation = MessageAnnotation(
                app_id=app_id,
                conversation_id=conversation_id,
                message_id=message_id,
                question="What is AI?",
                content="AI stands for Artificial Intelligence.",
                account_id=account_id,
            )

            # Assert
            assert annotation.app_id == app_id
            assert annotation.conversation_id == conversation_id
            assert annotation.message_id == message_id
            assert annotation.question == "What is AI?"
            assert annotation.content == "AI stands for Artificial Intelligence."
            assert annotation.account_id == account_id

        def test_message_annotation_without_message_id(self):
            """Test creating annotation without message_id."""
            # Arrange
            app_id = str(uuid4())
            account_id = str(uuid4())

            # Act
            annotation = MessageAnnotation(
                app_id=app_id,
                question="What is AI?",
                conversation_id=None,
                message_id=None,
                content="AI stands for Artificial Intelligence.",
                account_id=account_id,
            )

            # Assert
            assert annotation.app_id == app_id
            assert annotation.message_id is None
            assert annotation.conversation_id is None
            assert annotation.question == "What is AI?"
            assert annotation.content == "AI stands for Artificial Intelligence."

        def test_message_annotation_hit_count_default(self):
            """Test annotation hit_count default value."""
            # Arrange
            annotation = MessageAnnotation(
                app_id=str(uuid4()),
                question="Test question",
                conversation_id=None,
                message_id=None,
                content="Test content",
                account_id=str(uuid4()),
            )

            # Act & Assert - default value is set by database
            # Model instantiation doesn't set server defaults
            assert hasattr(annotation, "hit_count")

    class TestAppAnnotationSetting:
        """Test suite for AppAnnotationSetting model."""

        def test_app_annotation_setting_creation(self):
            """Test creating an app annotation setting."""
            # Arrange
            app_id = str(uuid4())
            collection_binding_id = str(uuid4())
            created_user_id = str(uuid4())
            updated_user_id = str(uuid4())

            # Act
            setting = AppAnnotationSetting(
                app_id=app_id,
                score_threshold=0.8,
                collection_binding_id=collection_binding_id,
                created_user_id=created_user_id,
                updated_user_id=updated_user_id,
            )

            # Assert
            assert setting.app_id == app_id
            assert setting.score_threshold == 0.8
            assert setting.collection_binding_id == collection_binding_id
            assert setting.created_user_id == created_user_id
            assert setting.updated_user_id == updated_user_id

        def test_app_annotation_setting_score_threshold_validation(self):
            """Test score threshold values."""
            # Arrange & Act
            setting_high = AppAnnotationSetting(
                app_id=str(uuid4()),
                score_threshold=0.95,
                collection_binding_id=str(uuid4()),
                created_user_id=str(uuid4()),
                updated_user_id=str(uuid4()),
            )
            setting_low = AppAnnotationSetting(
                app_id=str(uuid4()),
                score_threshold=0.5,
                collection_binding_id=str(uuid4()),
                created_user_id=str(uuid4()),
                updated_user_id=str(uuid4()),
            )

            # Assert
            assert setting_high.score_threshold == 0.95
            assert setting_low.score_threshold == 0.5

    class TestAppAnnotationHitHistory:
        """Test suite for AppAnnotationHitHistory model."""

        def test_app_annotation_hit_history_creation(self):
            """Test creating an annotation hit history."""
            # Arrange
            app_id = str(uuid4())
            annotation_id = str(uuid4())
            message_id = str(uuid4())
            account_id = str(uuid4())

            # Act
            history = AppAnnotationHitHistory(
                app_id=app_id,
                annotation_id=annotation_id,
                source="api",
                question="What is AI?",
                account_id=account_id,
                score=0.95,
                message_id=message_id,
                annotation_question="What is AI?",
                annotation_content="AI stands for Artificial Intelligence.",
            )

            # Assert
            assert history.app_id == app_id
            assert history.annotation_id == annotation_id
            assert history.source == "api"
            assert history.question == "What is AI?"
            assert history.account_id == account_id
            assert history.score == 0.95
            assert history.message_id == message_id
            assert history.annotation_question == "What is AI?"
            assert history.annotation_content == "AI stands for Artificial Intelligence."

        def test_app_annotation_hit_history_score_values(self):
            """Test annotation hit history with different score values."""
            # Arrange & Act
            history_high = AppAnnotationHitHistory(
                app_id=str(uuid4()),
                annotation_id=str(uuid4()),
                source="api",
                question="Test",
                account_id=str(uuid4()),
                score=0.99,
                message_id=str(uuid4()),
                annotation_question="Test",
                annotation_content="Content",
            )
            history_low = AppAnnotationHitHistory(
                app_id=str(uuid4()),
                annotation_id=str(uuid4()),
                source="api",
                question="Test",
                account_id=str(uuid4()),
                score=0.6,
                message_id=str(uuid4()),
                annotation_question="Test",
                annotation_content="Content",
            )

            # Assert
            assert history_high.score == 0.99
            assert history_low.score == 0.6

    class TestSiteModel:
        """Test suite for Site model."""

        def test_site_core_bulk_insert_generates_ids(self, sqlite_session: Session):
            """Core bulk inserts generate an ID for every site row."""
            app_ids = [str(uuid4()), str(uuid4())]

            sqlite_session.execute(
                Site.__table__.insert(),
                [
                    {
                        "app_id": app_id,
                        "title": f"Site {index}",
                        "default_language": "en-US",
                        "customize_token_strategy": CustomizeTokenStrategy.UUID,
                    }
                    for index, app_id in enumerate(app_ids)
                ],
            )

            site_ids = sqlite_session.scalars(select(Site.id).where(Site.app_id.in_(app_ids))).all()
            assert len(site_ids) == len(app_ids)
            assert len(set(site_ids)) == len(app_ids)
            assert all(UUID(site_id).version == 4 for site_id in site_ids)

        def test_site_creation_with_required_fields(self):
            """Test creating a site with required fields."""
            # Arrange
            app_id = str(uuid4())

            # Act
            site = Site(
                app_id=app_id,
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )

            # Assert
            assert site.app_id == app_id
            assert site.title == "Test Site"
            assert site.default_language == "en-US"
            assert site.customize_token_strategy == CustomizeTokenStrategy.UUID

        def test_site_creation_with_optional_fields(self):
            """Test creating a site with optional fields."""
            # Arrange & Act
            site = Site(
                app_id=str(uuid4()),
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
                icon_type=IconType.EMOJI,
                icon="🌐",
                icon_background="#0066CC",
                description="Test site description",
                copyright="© 2024 Test",
                privacy_policy="https://example.com/privacy",
            )

            # Assert
            assert site.icon_type == IconType.EMOJI
            assert site.icon == "🌐"
            assert site.icon_background == "#0066CC"
            assert site.description == "Test site description"
            assert site.copyright == "© 2024 Test"
            assert site.privacy_policy == "https://example.com/privacy"

        def test_site_custom_disclaimer_setter(self):
            """Test site custom_disclaimer setter."""
            # Arrange
            site = Site(
                app_id=str(uuid4()),
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )

            # Act
            site.custom_disclaimer = "This is a test disclaimer"

            # Assert
            assert site.custom_disclaimer == "This is a test disclaimer"

        def test_site_custom_disclaimer_exceeds_limit(self):
            """Test site custom_disclaimer with excessive length."""
            # Arrange
            site = Site(
                app_id=str(uuid4()),
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )
            long_disclaimer = "x" * 513  # Exceeds 512 character limit

            # Act & Assert
            with pytest.raises(ValueError, match="Custom disclaimer cannot exceed 512 characters"):
                site.custom_disclaimer = long_disclaimer

    class TestModelIntegration:
        """Test suite for model integration scenarios."""

        def test_complete_app_conversation_message_hierarchy(self):
            """Test complete hierarchy from app to message."""
            # Arrange
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            conversation_id = str(uuid4())
            message_id = str(uuid4())
            created_by = str(uuid4())

            # Create app
            app = App(
                tenant_id=tenant_id,
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
                created_by=created_by,
                id=app_id,
            )

            # Create conversation
            conversation = Conversation(
                app_id=app_id,
                mode=AppMode.CHAT,
                name="Test Conversation",
                status="normal",
                from_source=ConversationFromSource.API,
                from_end_user_id=str(uuid4()),
            )
            conversation.id = conversation_id

            # Create message
            message = Message(
                app_id=app_id,
                conversation_id=conversation_id,
                query="Test query",
                message={"role": "user", "content": "Test"},
                answer="Test answer",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                id=message_id,
            )

            # Assert
            assert app.id == app_id
            assert conversation.app_id == app_id
            assert message.app_id == app_id
            assert message.conversation_id == conversation_id
            assert app.mode == AppMode.CHAT
            assert conversation.mode == AppMode.CHAT

        def test_app_with_annotation_setting(self):
            """Test app with annotation setting."""
            # Arrange
            app_id = str(uuid4())
            collection_binding_id = str(uuid4())
            created_user_id = str(uuid4())

            # Create app
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
                created_by=created_user_id,
                id=app_id,
            )

            # Create annotation setting
            setting = AppAnnotationSetting(
                app_id=app_id,
                score_threshold=0.85,
                collection_binding_id=collection_binding_id,
                created_user_id=created_user_id,
                updated_user_id=created_user_id,
            )

            # Assert
            assert setting.app_id == app.id
            assert setting.score_threshold == 0.85

        def test_message_with_annotation(self):
            """Test message with annotation."""
            # Arrange
            app_id = str(uuid4())
            conversation_id = str(uuid4())
            message_id = str(uuid4())
            account_id = str(uuid4())

            # Create message
            message = Message(
                app_id=app_id,
                conversation_id=conversation_id,
                query="What is AI?",
                message={"role": "user", "content": "What is AI?"},
                answer="AI stands for Artificial Intelligence.",
                message_unit_price=Decimal("0.0001"),
                answer_unit_price=Decimal("0.0002"),
                currency="USD",
                from_source=ConversationFromSource.API,
                id=message_id,
            )

            # Create annotation
            annotation = MessageAnnotation(
                app_id=app_id,
                conversation_id=conversation_id,
                message_id=message_id,
                question="What is AI?",
                content="AI stands for Artificial Intelligence.",
                account_id=account_id,
            )

            # Assert
            assert annotation.app_id == message.app_id
            assert annotation.conversation_id == message.conversation_id
            assert annotation.message_id == message.id

        def test_annotation_hit_history_tracking(self):
            """Test annotation hit history tracking."""
            # Arrange
            app_id = str(uuid4())
            annotation_id = str(uuid4())
            message_id = str(uuid4())
            account_id = str(uuid4())

            # Create annotation
            annotation = MessageAnnotation(
                app_id=app_id,
                question="What is AI?",
                content="AI stands for Artificial Intelligence.",
                conversation_id=None,
                message_id=message_id,
                account_id=account_id,
            )
            annotation.id = annotation_id

            # Create hit history
            history = AppAnnotationHitHistory(
                app_id=app_id,
                annotation_id=annotation_id,
                source="api",
                question="What is AI?",
                account_id=account_id,
                score=0.92,
                message_id=message_id,
                annotation_question="What is AI?",
                annotation_content="AI stands for Artificial Intelligence.",
            )

            # Assert
            assert history.app_id == annotation.app_id
            assert history.annotation_id == annotation.id
            assert history.score == 0.92

        def test_app_with_site(self):
            """Test app with site."""
            # Arrange
            app_id = str(uuid4())

            # Create app
            app = App(
                tenant_id=str(uuid4()),
                name="Test App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
                created_by=str(uuid4()),
                id=app_id,
            )

            # Create site
            site = Site(
                app_id=app_id,
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )

            # Assert
            assert site.app_id == app.id
            assert app.enable_site is True


"""Regression coverage for the ``@property``→session-parameter refactor on ``App.tenant``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session`` (per the pattern established in
#41830/#41831 for ``InstalledApp.tenant`` / ``ApiToolProvider.tenant``, tracked in #40372).
"""


def _app_session_accessors_persist_tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    return tenant


def _app_session_accessors_persist_app(session: Session, *, tenant_id: str) -> App:
    app = App(
        tenant_id=tenant_id,
        name="Test App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=False,
        created_by=str(uuid4()),
    )
    session.add(app)
    session.flush()
    return app


class TestAppSessionAccessorsCases:
    class TestAppTenant:
        def test_returns_the_matching_tenant(self, sqlite_session: Session) -> None:
            tenant = _app_session_accessors_persist_tenant(sqlite_session)
            app = _app_session_accessors_persist_app(sqlite_session, tenant_id=tenant.id)

            result = app.tenant(session=sqlite_session)

            assert result is not None
            assert result.id == tenant.id

        def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
            app = _app_session_accessors_persist_app(sqlite_session, tenant_id=str(uuid4()))

            assert app.tenant(session=sqlite_session) is None


"""Regression coverage for the ``@property``→session-parameter refactor on
``InstalledApp.tenant``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session: Session`` (per the pattern established in
#40370/#40797/#41394/#41830/#41885, tracked in #40372).
"""


def _installed_app_session_accessors_persist_tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    return tenant


def _persist_installed_app(session: Session, *, tenant_id: str) -> InstalledApp:
    installed_app = InstalledApp(
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        app_owner_tenant_id=str(uuid4()),
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.flush()
    return installed_app


class TestInstalledAppSessionAccessorsCases:
    class TestInstalledAppTenant:
        def test_returns_the_matching_tenant(self, sqlite_session: Session) -> None:
            tenant = _installed_app_session_accessors_persist_tenant(sqlite_session)
            installed_app = _persist_installed_app(sqlite_session, tenant_id=tenant.id)

            result = installed_app.tenant(session=sqlite_session)

            assert result is not None
            assert result.id == tenant.id

        def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
            installed_app = _persist_installed_app(sqlite_session, tenant_id=str(uuid4()))

            assert installed_app.tenant(session=sqlite_session) is None


"""Regression coverage for the ``@property``→session-parameter refactor on Message
feedback/annotation accessors.

Covers three of `api/models/model.py`'s legacy `@property` accessors that reached for the global
``db.session`` internally and have been removed in favour of their existing explicit-session
methods (per the pattern established in #40370/#40797/#41394/#41830, tracked in #40372):

- ``MessageFeedback.from_account_with_session``
- ``MessageAnnotation.account_with_session``
- ``MessageAnnotation.annotation_create_account_with_session``

Each accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""


def _message_annotation_session_accessors_persist_account(session: Session, *, email: str | None = None) -> Account:
    account = Account(name="Test Account", email=email or "test@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_feedback(session: Session, *, app_id: str, from_account_id: str | None) -> MessageFeedback:
    feedback = MessageFeedback(
        app_id=app_id,
        conversation_id=str(uuid4()),
        message_id=str(uuid4()),
        rating=FeedbackRating.LIKE,
        from_source=FeedbackFromSource.USER,
        from_account_id=from_account_id,
    )
    session.add(feedback)
    session.flush()
    return feedback


def _message_annotation_session_accessors_persist_annotation(
    session: Session, *, app_id: str, account_id: str
) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app_id,
        conversation_id=None,
        message_id=None,
        question="What is AI?",
        content="AI stands for Artificial Intelligence.",
        account_id=account_id,
    )
    session.add(annotation)
    session.flush()
    return annotation


class TestMessageAnnotationSessionAccessorsCases:
    class TestMessageFeedbackFromAccount:
        def test_returns_the_feedback_author(self, sqlite_session: Session) -> None:
            account = _message_annotation_session_accessors_persist_account(sqlite_session)
            feedback = _persist_feedback(sqlite_session, app_id=str(uuid4()), from_account_id=account.id)

            result = feedback.from_account_with_session(session=sqlite_session)

            assert result is not None
            assert result.id == account.id

        def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
            feedback = _persist_feedback(sqlite_session, app_id=str(uuid4()), from_account_id=str(uuid4()))

            assert feedback.from_account_with_session(session=sqlite_session) is None

    class TestMessageAnnotationAccount:
        def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
            creator = _message_annotation_session_accessors_persist_account(sqlite_session, email="creator@example.com")
            annotation = _message_annotation_session_accessors_persist_annotation(
                sqlite_session, app_id=str(uuid4()), account_id=creator.id
            )

            result = annotation.account_with_session(session=sqlite_session)

            assert result is not None
            assert result.id == creator.id

        def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
            annotation = _message_annotation_session_accessors_persist_annotation(
                sqlite_session, app_id=str(uuid4()), account_id=str(uuid4())
            )

            assert annotation.account_with_session(session=sqlite_session) is None

    class TestMessageAnnotationAnnotationCreateAccount:
        def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
            creator = _message_annotation_session_accessors_persist_account(
                sqlite_session, email="creator2@example.com"
            )
            annotation = _message_annotation_session_accessors_persist_annotation(
                sqlite_session, app_id=str(uuid4()), account_id=creator.id
            )

            result = annotation.annotation_create_account_with_session(session=sqlite_session)

            assert result is not None
            assert result.id == creator.id

        def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
            annotation = _message_annotation_session_accessors_persist_annotation(
                sqlite_session, app_id=str(uuid4()), account_id=str(uuid4())
            )

            assert annotation.annotation_create_account_with_session(session=sqlite_session) is None


"""Keep the persisted provider through private trace JSON and the real consumer."""


_MESSAGE = TypeAdapter(MessageDict)


class TestMessageTraceSerializationCases:
    @staticmethod
    @pytest.fixture
    def persisted_message(sqlite_session: Session) -> Message:
        now = datetime(2026, 10, 20, tzinfo=UTC)
        message = make_message(
            message_id=str(uuid4()),
            app_id=str(uuid4()),
            conversation_id=str(uuid4()),
            inputs={},
            query="Synthetic input",
            message={},
            answer="Synthetic output",
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            total_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            created_at=now,
            updated_at=now + timedelta(seconds=1),
        )
        message.model_provider = "langgenius/openai/openai"
        message.model_id = "gpt-4o-mini"
        sqlite_session.add(message)
        sqlite_session.commit()
        sqlite_session.expire_all()
        restored = sqlite_session.get(Message, message.id)
        assert restored is not None
        return restored

    @staticmethod
    @pytest.mark.parametrize("provider", ["langgenius/openai/openai", "Custom/Provider:Exact", None])
    def test_message_provider_survives_real_json_round_trip(
        sqlite_session: Session,
        persisted_message: Message,
        provider: str | None,
    ) -> None:
        persisted_message.model_provider = provider
        sqlite_session.commit()
        sqlite_session.refresh(persisted_message)
        wire = json.dumps(persisted_message.to_dict(session=sqlite_session), default=str)
        payload = _MESSAGE.validate_json(wire)
        restored = Message.from_dict(payload)
        assert "model_provider" in payload
        assert restored.model_provider == provider
        assert restored.model_id == persisted_message.model_id
        assert restored.id == persisted_message.id

    @staticmethod
    @pytest.mark.parametrize("shape", ["current", "legacy_missing", "explicit_null"])
    def test_private_trace_task_preserves_provider_into_real_arize_span(
        sqlite_session: Session,
        persisted_message: Message,
        monkeypatch: pytest.MonkeyPatch,
        shape: str,
    ) -> None:
        message_data = persisted_message.to_dict(session=sqlite_session)
        if shape == "legacy_missing":
            message_data.pop("model_provider", None)
        elif shape == "explicit_null":
            message_data["model_provider"] = None
        start = datetime(2026, 10, 20, tzinfo=UTC)
        info = MessageTraceInfo(
            message_id=persisted_message.id,
            message_data=message_data,
            conversation_model="chat",
            conversation_mode="chat",
            inputs={"query": "Synthetic input"},
            outputs="Synthetic output",
            start_time=start,
            end_time=start + timedelta(seconds=1),
            metadata={},
            message_tokens=1,
            answer_tokens=1,
            total_tokens=2,
        )
        encoded = (
            TaskData(app_id=persisted_message.app_id, trace_info_type="MessageTraceInfo", trace_info=info.model_dump())
            .model_dump_json()
            .encode()
        )
        exporter = InMemorySpanExporter()
        provider = TracerProvider()
        processor = SimpleSpanProcessor(exporter)
        provider.add_span_processor(processor)

        def setup(_config: ArizeConfig) -> tuple[Tracer, SimpleSpanProcessor]:
            tracer = provider.get_tracer("message-provider-serialization")
            assert isinstance(tracer, Tracer)
            return tracer, processor

        monkeypatch.setattr(arize_phoenix_trace, "setup_tracer", setup)
        instance = ArizePhoenixDataTrace(ArizeConfig(api_key="unused-synthetic-key", space_id="synthetic-space"))
        paths: list[str] = []
        deleted: list[str] = []

        def load(path: str) -> bytes:
            paths.append(path)
            return encoded

        def delete(path: str) -> None:
            deleted.append(path)

        def lookup(app_id: str) -> ArizePhoenixDataTrace:
            assert app_id == persisted_message.app_id
            return instance

        def failed(_key: str) -> None:
            pytest.fail("The real trace consumer must not hide a failed dispatch")

        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        monkeypatch.setattr(ops_trace_task.storage, "load", load)
        monkeypatch.setattr(ops_trace_task.storage, "delete", delete)
        monkeypatch.setattr(ops_trace_task.redis_client, "incr", failed)
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lookup)
        monkeypatch.setattr("extensions.ext_enterprise_telemetry.is_enabled", lambda: False)
        try:
            ops_trace_task.process_trace_tasks.apply(
                args=({"app_id": persisted_message.app_id, "file_id": "owned-synthetic"},), throw=True
            ).get()
            spans = exporter.get_finished_spans()
            llm = [span for span in spans if span.name == "llm"]
            assert len(llm) == 1
            attributes = llm[0].attributes
            assert attributes is not None
            assert attributes[SpanAttributes.LLM_MODEL_NAME] == persisted_message.model_id
            if shape == "current":
                assert attributes[SpanAttributes.LLM_PROVIDER] == persisted_message.model_provider
            else:
                assert SpanAttributes.LLM_PROVIDER not in attributes
            assert paths == [f"ops_trace/{persisted_message.app_id}/owned-synthetic.json"]
            assert deleted == paths
        finally:
            provider.shutdown()


def _wrap_md(url: str) -> str:
    """
    Wrap a raw URL into the markdown that re_sign_file_url_answer expects:
    [link](<url>)
    """
    return f"please click [file]({url}) to download."


def _build_local_file_mapping(record_id: str, *, tenant_id: str | None = None) -> dict[str, object]:
    mapping: dict[str, object] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": FileTransferMethod.LOCAL_FILE,
        "reference": build_file_reference(record_id=record_id),
        "type": "document",
        "filename": "example.txt",
        "extension": ".txt",
        "mime_type": "text/plain",
        "size": 1,
    }
    if tenant_id is not None:
        mapping["tenant_id"] = tenant_id
    return mapping


class TestModelCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def patch_file_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
        """
        Patch file_helpers.get_signed_file_url to a deterministic stub.
        """
        monkeypatch.setattr(
            model_module.file_helpers,
            "get_signed_file_url",
            lambda file_id: f"https://signed.example/{file_id}",
        )

    @staticmethod
    def test_file_preview_valid_replaced() -> None:
        """
        Valid file-preview URL must be re-signed:
        - Extract upload_file_id correctly
        - Replace the original URL with the signed URL
        """
        upload_id = "abc-123"
        url = f"/files/{upload_id}/file-preview?timestamp=111&nonce=222&sign=333"
        msg = Message(answer=_wrap_md(url))

        out = msg.re_sign_file_url_answer
        assert f"https://signed.example/{upload_id}" in out
        assert url not in out

    @staticmethod
    def test_file_preview_misspelled_not_replaced() -> None:
        """
        Misspelled endpoint 'file-previe?timestamp=' should NOT be rewritten.
        """
        upload_id = "zzz-001"
        # path deliberately misspelled: file-previe? (missing 'w')
        # and we append &note=file-preview to trick the old `"file-preview" in url` check.
        url = f"/files/{upload_id}/file-previe?timestamp=111&nonce=222&sign=333&note=file-preview"
        original = _wrap_md(url)
        msg = Message(answer=original)

        out = msg.re_sign_file_url_answer
        # Expect NO replacement, should not rewrite misspelled file-previe URL
        assert out == original

    @staticmethod
    def test_image_preview_valid_replaced() -> None:
        """
        Valid image-preview URL must be re-signed.
        """
        upload_id = "img-789"
        url = f"/files/{upload_id}/image-preview?timestamp=123&nonce=456&sign=789"
        msg = Message(answer=_wrap_md(url))

        out = msg.re_sign_file_url_answer
        assert f"https://signed.example/{upload_id}" in out
        assert url not in out

    @staticmethod
    def test_image_preview_misspelled_not_replaced() -> None:
        """
        Misspelled endpoint 'image-previe?timestamp=' should NOT be rewritten.
        """
        upload_id = "img-err-42"
        url = f"/files/{upload_id}/image-previe?timestamp=1&nonce=2&sign=3&note=image-preview"
        original = _wrap_md(url)
        msg = Message(answer=original)

        out = msg.re_sign_file_url_answer
        # Expect NO replacement, should not rewrite misspelled image-previe URL
        assert out == original

    @staticmethod
    @pytest.mark.parametrize("owner_cls", [Conversation, Message])
    def test_inputs_restore_external_remote_url_file_mappings(
        owner_cls: type[Conversation] | type[Message], sqlite_session: Session
    ) -> None:
        owner = owner_cls(app_id="app-1")
        owner.inputs = {
            "file": {
                "dify_model_identity": FILE_MODEL_IDENTITY,
                "transfer_method": FileTransferMethod.REMOTE_URL,
                "type": "document",
                "url": "https://example.com/report.pdf",
                "filename": "report.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
                "size": 1,
            }
        }

        restored_file = owner.inputs_with_session(session=sqlite_session)["file"]

        assert restored_file.transfer_method == FileTransferMethod.REMOTE_URL
        assert restored_file.remote_url == "https://example.com/report.pdf"

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_message_inputs_resolve_file_tenant_with_caller_session(sqlite_session: Session) -> None:
        app = App(
            id="app-1",
            tenant_id="tenant-1",
            name="File owner",
            description="",
            mode=AppMode.CHAT,
            icon_type=IconType.EMOJI,
            icon="file",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=False,
            max_active_requests=0,
        )
        decoy = App(
            id="other-app",
            tenant_id="other-tenant",
            name="Decoy",
            description="",
            mode=AppMode.CHAT,
            icon_type=IconType.EMOJI,
            icon="file",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=False,
            max_active_requests=0,
        )
        sqlite_session.add_all([decoy, app])
        sqlite_session.flush()
        message = Message(app_id="app-1")
        message.inputs = {"file": _build_local_file_mapping("upload-1")}

        with patch(
            "models.model.build_file_from_input_mapping",
            side_effect=lambda **kwargs: kwargs["tenant_resolver"](),
        ):
            inputs = message.inputs_with_session(session=sqlite_session)

        assert inputs["file"] == "tenant-1"

        # session.scalar.assert_called_once()  # removed: see #40799 conftest note

    @staticmethod
    def test_file_url_bare_url_re_signed() -> None:
        """#40788: bare tool file URL (no markdown wrapping) must be re-signed.

        Bare URLs are produced by the agent runtime when the model returns a
        non-linkified file reference. The previous regex only matched
        [text](url) markdown form, so the bare URL kept INTERNAL_FILES_URL.
        """
        upload_id = "bare-1"
        url = f"/files/{upload_id}/file-preview?timestamp=1&nonce=2&sign=3"
        msg = Message(answer=url)  # bare, no markdown wrapping

        out = msg.re_sign_file_url_answer
        assert f"https://signed.example/{upload_id}" in out
        assert url not in out

    @staticmethod
    def test_file_url_backticked_url_re_signed() -> None:
        """#40788: backticked tool file URL must be re-signed.

        Backticks are used by the runtime to quote file references inline.
        The previous regex only matched [text](url), so backticked URLs
        stayed on INTERNAL_FILES_URL.
        """
        upload_id = "tick-2"
        url = f"/files/{upload_id}/file-preview?timestamp=10&nonce=20&sign=30"
        msg = Message(answer=f"see `{url}` for details")

        out = msg.re_sign_file_url_answer
        assert f"https://signed.example/{upload_id}" in out
        assert url not in out

    @staticmethod
    def test_file_url_mixed_formats_all_re_signed() -> None:
        """#40788: all three URL shapes in the same answer are re-signed.

        Sanity check that the three patterns cooperate — bare, backticked,
        and markdown — without double-signing or skipping any.
        """
        upload_ids = ["mix-a", "mix-b", "mix-c"]
        bare = f"/files/{upload_ids[0]}/file-preview?timestamp=1&nonce=2&sign=3"
        tick = f"/files/{upload_ids[1]}/file-preview?timestamp=10&nonce=20&sign=30"
        md = f"/files/{upload_ids[2]}/file-preview?timestamp=100&nonce=200&sign=300"
        msg = Message(answer=f"raw {bare} ` {tick} ` and [file]({md})")

        out = msg.re_sign_file_url_answer
        for uid in upload_ids:
            assert f"https://signed.example/{uid}" in out
        for url in (bare, tick, md):
            assert url not in out


"""Regression coverage for the ``@property``→session-parameter refactor on
``RecommendedApp`` and ``AccountTrialAppRecord``.

The legacy ``@property`` accessors reached for the global ``db.session`` internally and have
been converted to plain methods taking an explicit ``session: Session`` (per the pattern
established in #40370/#41394/#41830/#42000, tracked in #40372).
"""


def _recommended_app_session_accessors_persist_app(session: Session) -> App:
    app = App(
        tenant_id=str(uuid4()),
        name="Test App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=False,
        created_by=str(uuid4()),
        description="App description",
    )
    session.add(app)
    session.flush()
    return app


def _persist_recommended_app(session: Session, *, app_id: str) -> RecommendedApp:
    recommended_app = RecommendedApp(
        app_id=app_id,
        description={"en_US": "A recommended app"},
        copyright="Dify",
        privacy_policy="https://dify.ai/privacy",
        category="Assistant",
    )
    session.add(recommended_app)
    session.flush()
    return recommended_app


def _recommended_app_session_accessors_persist_account(session: Session) -> Account:
    account = Account(name="Test User", email=f"user-{uuid4()}@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_trial_record(session: Session, *, account_id: str, app_id: str) -> AccountTrialAppRecord:
    record = AccountTrialAppRecord(account_id=account_id, app_id=app_id, count=1)
    session.add(record)
    session.flush()
    return record


class TestRecommendedAppSessionAccessorsCases:
    class TestRecommendedAppApp:
        def test_returns_the_matching_app(self, sqlite_session: Session) -> None:
            app = _recommended_app_session_accessors_persist_app(sqlite_session)
            recommended_app = _persist_recommended_app(sqlite_session, app_id=app.id)

            result = recommended_app.app(session=sqlite_session)

            assert result is not None
            assert result.id == app.id

        def test_returns_none_when_app_missing(self, sqlite_session: Session) -> None:
            recommended_app = _persist_recommended_app(sqlite_session, app_id=str(uuid4()))

            assert recommended_app.app(session=sqlite_session) is None

    class TestAccountTrialAppRecordAccessors:
        def test_app_returns_the_matching_app(self, sqlite_session: Session) -> None:
            app = _recommended_app_session_accessors_persist_app(sqlite_session)
            record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=app.id)

            result = record.app(session=sqlite_session)

            assert result is not None
            assert result.id == app.id

        def test_app_returns_none_when_app_missing(self, sqlite_session: Session) -> None:
            record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=str(uuid4()))

            assert record.app(session=sqlite_session) is None

        def test_user_returns_the_matching_account(self, sqlite_session: Session) -> None:
            account = _recommended_app_session_accessors_persist_account(sqlite_session)
            record = _persist_trial_record(sqlite_session, account_id=account.id, app_id=str(uuid4()))

            result = record.user(session=sqlite_session)

            assert result is not None
            assert result.id == account.id

        def test_user_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
            record = _persist_trial_record(sqlite_session, account_id=str(uuid4()), app_id=str(uuid4()))

            assert record.user(session=sqlite_session) is None
