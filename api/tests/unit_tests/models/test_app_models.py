"""
Comprehensive unit tests for App models.

This test suite covers:
- App configuration validation
- App-Message relationships
- Conversation model integrity
- Annotation model relationships
"""

import json
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from models.model import (
    App,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppMode,
    AppModelConfig,
    Conversation,
    IconType,
    Message,
    MessageAnnotation,
    Site,
)


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

    def test_app_desc_or_prompt_with_description(self):
        """Test desc_or_prompt property when description exists."""
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
        result = app.desc_or_prompt

        # Assert
        assert result == "App description"

    def test_app_desc_or_prompt_without_description(self):
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

        # Mock app_model_config property
        with patch.object(App, "app_model_config", new_callable=lambda: property(lambda self: None)):
            # Act
            result = app.desc_or_prompt

            # Assert
            assert result == ""

    def test_app_is_agent_property_false(self):
        """Test is_agent property returns False when not configured as agent."""
        # Arrange
        app = App(
            tenant_id=str(uuid4()),
            name="Test App",
            mode=AppMode.CHAT,
            enable_site=True,
            enable_api=False,
            created_by=str(uuid4()),
        )

        # Mock app_model_config to return None
        with patch.object(App, "app_model_config", new_callable=lambda: property(lambda self: None)):
            # Act
            result = app.is_agent

            # Assert
            assert result is False

    def test_app_mode_compatible_with_agent(self):
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

        # Mock is_agent to return False
        with patch.object(App, "is_agent", new_callable=lambda: property(lambda self: False)):
            # Act
            result = app.mode_compatible_with_agent

            # Assert
            assert result == AppMode.CHAT


class TestAppModelConfig:
    """Test suite for AppModelConfig model."""

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

    def test_app_model_config_annotation_reply_dict_disabled(self):
        """Test annotation_reply_dict when annotation is disabled."""
        # Arrange
        config = AppModelConfig(
            app_id=str(uuid4()),
            provider="openai",
            model_id="gpt-4",
            created_by=str(uuid4()),
        )

        # Mock database query to return None
        with patch("models.model.db.session.query") as mock_query:
            mock_query.return_value.where.return_value.first.return_value = None

            # Act
            result = config.annotation_reply_dict

            # Assert
            assert result == {"enabled": False}


class TestConversationModel:
    """Test suite for Conversation model integrity."""

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
            from_source="api",
            from_end_user_id=from_end_user_id,
        )

        # Assert
        assert conversation.app_id == app_id
        assert conversation.mode == AppMode.CHAT
        assert conversation.name == "Test Conversation"
        assert conversation.status == "normal"
        assert conversation.from_source == "api"
        assert conversation.from_end_user_id == from_end_user_id

    def test_conversation_with_inputs(self):
        """Test conversation inputs property."""
        # Arrange
        inputs = {"query": "Hello", "context": "test"}
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid4()),
        )
        conversation._inputs = inputs

        # Act
        result = conversation.inputs

        # Assert
        assert result == inputs

    def test_conversation_inputs_setter(self):
        """Test conversation inputs setter."""
        # Arrange
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid4()),
        )
        inputs = {"query": "Hello", "context": "test"}

        # Act
        conversation.inputs = inputs

        # Assert
        assert conversation._inputs == inputs

    def test_conversation_summary_or_query_with_summary(self):
        """Test summary_or_query property when summary exists."""
        # Arrange
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid4()),
            summary="Test summary",
        )

        # Act
        result = conversation.summary_or_query

        # Assert
        assert result == "Test summary"

    def test_conversation_summary_or_query_without_summary(self):
        """Test summary_or_query property when summary is empty."""
        # Arrange
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid4()),
            summary=None,
        )

        # Mock first_message to return a message with query
        mock_message = MagicMock()
        mock_message.query = "First message query"
        with patch.object(Conversation, "first_message", new_callable=lambda: property(lambda self: mock_message)):
            # Act
            result = conversation.summary_or_query

            # Assert
            assert result == "First message query"

    def test_conversation_in_debug_mode(self):
        """Test in_debug_mode property."""
        # Arrange
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=str(uuid4()),
            override_model_configs='{"model": "gpt-4"}',
        )

        # Act
        result = conversation.in_debug_mode

        # Assert
        assert result is True

    def test_conversation_to_dict_serialization(self):
        """Test conversation to_dict method."""
        # Arrange
        app_id = str(uuid4())
        from_end_user_id = str(uuid4())
        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
            from_end_user_id=from_end_user_id,
            dialogue_count=5,
        )
        conversation.id = str(uuid4())
        conversation._inputs = {"query": "test"}

        # Act
        result = conversation.to_dict()

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
            from_source="api",
        )

        # Assert
        assert message.app_id == app_id
        assert message.conversation_id == conversation_id
        assert message.query == "What is AI?"
        assert message.answer == "AI stands for Artificial Intelligence."
        assert message.currency == "USD"
        assert message.from_source == "api"

    def test_message_with_inputs(self):
        """Test message inputs property."""
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
            from_source="api",
        )
        message._inputs = inputs

        # Act
        result = message.inputs

        # Assert
        assert result == inputs

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
            from_source="api",
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
            from_source="api",
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
            from_source="api",
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
            from_source="api",
            message_metadata=None,
        )

        # Act
        result = message.message_metadata_dict

        # Assert
        assert result == {}

    def test_message_to_dict_serialization(self):
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
            from_source="api",
            status="normal",
        )
        message.id = str(uuid4())
        message._inputs = {"query": "test"}
        message.created_at = now
        message.updated_at = now

        # Act
        result = message.to_dict()

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

    def test_site_creation_with_required_fields(self):
        """Test creating a site with required fields."""
        # Arrange
        app_id = str(uuid4())

        # Act
        site = Site(
            app_id=app_id,
            title="Test Site",
            default_language="en-US",
            customize_token_strategy="uuid",
        )

        # Assert
        assert site.app_id == app_id
        assert site.title == "Test Site"
        assert site.default_language == "en-US"
        assert site.customize_token_strategy == "uuid"

    def test_site_creation_with_optional_fields(self):
        """Test creating a site with optional fields."""
        # Arrange & Act
        site = Site(
            app_id=str(uuid4()),
            title="Test Site",
            default_language="en-US",
            customize_token_strategy="uuid",
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
            customize_token_strategy="uuid",
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
            customize_token_strategy="uuid",
        )
        long_disclaimer = "x" * 513  # Exceeds 512 character limit

        # Act & Assert
        with pytest.raises(ValueError, match="Custom disclaimer cannot exceed 512 characters"):
            site.custom_disclaimer = long_disclaimer

    def test_site_generate_code(self):
        """Test Site.generate_code static method."""
        # Mock database query to return 0 (no existing codes)
        with patch("models.model.db.session.query") as mock_query:
            mock_query.return_value.where.return_value.count.return_value = 0

            # Act
            code = Site.generate_code(8)

            # Assert
            assert isinstance(code, str)
            assert len(code) == 8


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
        )
        app.id = app_id

        # Create conversation
        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
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
            from_source="api",
        )
        message.id = message_id

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
        )
        app.id = app_id

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
            from_source="api",
        )
        message.id = message_id

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
        )
        app.id = app_id

        # Create site
        site = Site(
            app_id=app_id,
            title="Test Site",
            default_language="en-US",
            customize_token_strategy="uuid",
        )

        # Assert
        assert site.app_id == app.id
        assert app.enable_site is True


class TestConversationStatusCount:
    """Test suite for Conversation.status_count property N+1 query fix."""

    def test_status_count_no_messages(self):
        """Test status_count returns None when conversation has no messages."""
        # Arrange
        conversation = Conversation(
            app_id=str(uuid4()),
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
        )
        conversation.id = str(uuid4())

        # Mock the database query to return no messages
        with patch("models.model.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.return_value = []

            # Act
            result = conversation.status_count

            # Assert
            assert result is None

    def test_status_count_messages_without_workflow_runs(self):
        """Test status_count when messages have no workflow_run_id."""
        # Arrange
        app_id = str(uuid4())
        conversation_id = str(uuid4())

        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
        )
        conversation.id = conversation_id

        # Mock the database query to return no messages with workflow_run_id
        with patch("models.model.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.return_value = []

            # Act
            result = conversation.status_count

            # Assert
            assert result is None

    def test_status_count_batch_loading_implementation(self):
        """Test that status_count uses batch loading instead of N+1 queries."""
        # Arrange
        from core.workflow.enums import WorkflowExecutionStatus

        app_id = str(uuid4())
        conversation_id = str(uuid4())

        # Create workflow run IDs
        workflow_run_id_1 = str(uuid4())
        workflow_run_id_2 = str(uuid4())
        workflow_run_id_3 = str(uuid4())

        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
        )
        conversation.id = conversation_id

        # Mock messages with workflow_run_id
        mock_messages = [
            MagicMock(
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id_1,
            ),
            MagicMock(
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id_2,
            ),
            MagicMock(
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id_3,
            ),
        ]

        # Mock workflow runs with different statuses
        mock_workflow_runs = [
            MagicMock(
                id=workflow_run_id_1,
                status=WorkflowExecutionStatus.SUCCEEDED.value,
                app_id=app_id,
            ),
            MagicMock(
                id=workflow_run_id_2,
                status=WorkflowExecutionStatus.FAILED.value,
                app_id=app_id,
            ),
            MagicMock(
                id=workflow_run_id_3,
                status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
                app_id=app_id,
            ),
        ]

        # Track database calls
        calls_made = []

        def mock_scalars(query):
            calls_made.append(str(query))
            mock_result = MagicMock()

            # Return messages for the first query (messages with workflow_run_id)
            if "messages" in str(query) and "conversation_id" in str(query):
                mock_result.all.return_value = mock_messages
            # Return workflow runs for the batch query
            elif "workflow_runs" in str(query):
                mock_result.all.return_value = mock_workflow_runs
            else:
                mock_result.all.return_value = []

            return mock_result

        # Act & Assert
        with patch("models.model.db.session.scalars", side_effect=mock_scalars):
            result = conversation.status_count

            # Verify only 2 database queries were made (not N+1)
            assert len(calls_made) == 2, f"Expected 2 queries, got {len(calls_made)}: {calls_made}"

            # Verify the first query gets messages
            assert "messages" in calls_made[0]
            assert "conversation_id" in calls_made[0]

            # Verify the second query batch loads workflow runs with proper filtering
            assert "workflow_runs" in calls_made[1]
            assert "app_id" in calls_made[1]  # Security filter applied
            assert "IN" in calls_made[1]  # Batch loading with IN clause

            # Verify correct status counts
            assert result["success"] == 1  # One SUCCEEDED
            assert result["failed"] == 1  # One FAILED
            assert result["partial_success"] == 1  # One PARTIAL_SUCCEEDED

    def test_status_count_app_id_filtering(self):
        """Test that status_count filters workflow runs by app_id for security."""
        # Arrange
        app_id = str(uuid4())
        other_app_id = str(uuid4())
        conversation_id = str(uuid4())
        workflow_run_id = str(uuid4())

        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
        )
        conversation.id = conversation_id

        # Mock message with workflow_run_id
        mock_messages = [
            MagicMock(
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id,
            ),
        ]

        calls_made = []

        def mock_scalars(query):
            calls_made.append(str(query))
            mock_result = MagicMock()

            if "messages" in str(query):
                mock_result.all.return_value = mock_messages
            elif "workflow_runs" in str(query):
                # Return empty list because no workflow run matches the correct app_id
                mock_result.all.return_value = []  # Workflow run filtered out by app_id
            else:
                mock_result.all.return_value = []

            return mock_result

        # Act
        with patch("models.model.db.session.scalars", side_effect=mock_scalars):
            result = conversation.status_count

            # Assert - query should include app_id filter
            workflow_query = calls_made[1]
            assert "app_id" in workflow_query

            # Since workflow run has wrong app_id, it shouldn't be included in counts
            assert result["success"] == 0
            assert result["failed"] == 0
            assert result["partial_success"] == 0

    def test_status_count_handles_invalid_workflow_status(self):
        """Test that status_count gracefully handles invalid workflow status values."""
        # Arrange
        app_id = str(uuid4())
        conversation_id = str(uuid4())
        workflow_run_id = str(uuid4())

        conversation = Conversation(
            app_id=app_id,
            mode=AppMode.CHAT,
            name="Test Conversation",
            status="normal",
            from_source="api",
        )
        conversation.id = conversation_id

        mock_messages = [
            MagicMock(
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id,
            ),
        ]

        # Mock workflow run with invalid status
        mock_workflow_runs = [
            MagicMock(
                id=workflow_run_id,
                status="invalid_status",  # Invalid status that should raise ValueError
                app_id=app_id,
            ),
        ]

        with patch("models.model.db.session.scalars") as mock_scalars:
            # Mock the messages query
            def mock_scalars_side_effect(query):
                mock_result = MagicMock()
                if "messages" in str(query):
                    mock_result.all.return_value = mock_messages
                elif "workflow_runs" in str(query):
                    mock_result.all.return_value = mock_workflow_runs
                else:
                    mock_result.all.return_value = []
                return mock_result

            mock_scalars.side_effect = mock_scalars_side_effect

            # Act - should not raise exception
            result = conversation.status_count

            # Assert - should handle invalid status gracefully
            assert result["success"] == 0
            assert result["failed"] == 0
            assert result["partial_success"] == 0
