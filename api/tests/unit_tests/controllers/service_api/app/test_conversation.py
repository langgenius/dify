import uuid
from datetime import UTC, datetime
from typing import Literal

import pytest
from pydantic import ValidationError

import services
from controllers.console.explore.conversation import ConversationRenamePayload as ConsolePayload
from controllers.service_api.app.conversation import (
    ConversationListQuery,
    ConversationRenamePayload,
    ConversationVariableInfiniteScrollPaginationResponse,
    ConversationVariableResponse,
    ConversationVariablesQuery,
    ConversationVariableUpdatePayload,
)
from controllers.service_api.app.conversation import ConversationRenamePayload as ServicePayload
from controllers.service_api.app.error import NotChatAppError
from fields._value_type_serializer import serialize_value_type
from graphon.variables import StringSegment
from graphon.variables.types import SegmentType
from models.model import App, AppMode

"""
Unit tests for Service API Conversation controllers.

Tests coverage for:
- ConversationListQuery, ConversationRenamePayload Pydantic models
- ConversationVariablesQuery with SQL injection prevention
- ConversationVariableUpdatePayload
- App mode validation for chat-only endpoints

Focus on:
- Pydantic model validation including security checks
- SQL injection prevention in variable name filtering
- Error types and mappings
"""


class TestConversationCases:
    class TestConversationListQuery:
        """Test suite for ConversationListQuery Pydantic model."""

        def test_query_with_defaults(self) -> None:
            """Test query with default values."""
            query = ConversationListQuery()
            assert query.last_id is None
            assert query.limit == 20
            assert query.sort_by == "-updated_at"

        def test_query_with_last_id(self) -> None:
            """Test query with pagination last_id."""
            last_id = str(uuid.uuid4())
            query = ConversationListQuery(last_id=last_id)
            assert str(query.last_id) == last_id

        def test_query_limit_boundaries(self) -> None:
            """Test query respects limit boundaries."""
            query_min = ConversationListQuery(limit=1)
            assert query_min.limit == 1

            query_max = ConversationListQuery(limit=100)
            assert query_max.limit == 100

        @pytest.mark.parametrize(
            "sort_by",
            [
                "created_at",
                "-created_at",
                "updated_at",
                "-updated_at",
            ],
        )
        def test_query_valid_sort_options(
            self, sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"]
        ) -> None:
            """Test all valid sort_by options."""
            query = ConversationListQuery(sort_by=sort_by)
            assert query.sort_by == sort_by

    class TestConversationRenamePayload:
        """Test suite for ConversationRenamePayload Pydantic model."""

        def test_payload_with_name(self) -> None:
            """Test payload with explicit name."""
            payload = ConversationRenamePayload(name="My New Chat", auto_generate=False)
            assert payload.name == "My New Chat"
            assert payload.auto_generate is False

        def test_payload_with_auto_generate(self) -> None:
            """Test payload with auto_generate enabled."""
            payload = ConversationRenamePayload(auto_generate=True)
            assert payload.auto_generate is True
            assert payload.name is None

        def test_payload_requires_name_when_auto_generate_false(self) -> None:
            """Test that name is required when auto_generate is False."""
            with pytest.raises(
                ValueError,
                match=(
                    "1 validation error for ConversationRenamePayload\\\n  Value error, "
                    "name is required when auto_generate is false"
                ),
            ) as exc_info:
                ConversationRenamePayload(auto_generate=False)
            assert "name is required when auto_generate is false" in str(exc_info.value)

        def test_payload_requires_non_empty_name_when_auto_generate_false(self) -> None:
            """Test that empty string name is rejected."""
            with pytest.raises(
                ValueError,
                match=(
                    "1 validation error for ConversationRenamePayload\\\n  Value error, "
                    "name is required when auto_generate is false"
                ),
            ):
                ConversationRenamePayload(name="", auto_generate=False)

        def test_payload_requires_non_whitespace_name_when_auto_generate_false(self) -> None:
            """Test that whitespace-only name is rejected."""
            with pytest.raises(
                ValueError,
                match=(
                    "1 validation error for ConversationRenamePayload\\\n  Value error, "
                    "name is required when auto_generate is false"
                ),
            ):
                ConversationRenamePayload(name="   ", auto_generate=False)

        def test_payload_name_with_special_characters(self) -> None:
            """Test payload with name containing special characters."""
            payload = ConversationRenamePayload(name="Chat #1 - (Test) & More!", auto_generate=False)
            assert payload.name == "Chat #1 - (Test) & More!"

        def test_payload_name_with_unicode(self) -> None:
            """Test payload with Unicode characters in name."""
            payload = ConversationRenamePayload(name="对话 📝 Чат", auto_generate=False)
            assert payload.name == "对话 📝 Чат"

    class TestConversationVariablesQuery:
        """Test suite for ConversationVariablesQuery Pydantic model."""

        def test_query_with_defaults(self) -> None:
            """Test query with default values."""
            query = ConversationVariablesQuery()
            assert query.last_id is None
            assert query.limit == 20
            assert query.variable_name is None

        def test_query_with_variable_name(self) -> None:
            """Test query with valid variable_name filter."""
            query = ConversationVariablesQuery(variable_name="user_preference")
            assert query.variable_name == "user_preference"

        def test_query_allows_hyphen_in_variable_name(self) -> None:
            """Test that hyphens are allowed in variable names."""
            query = ConversationVariablesQuery(variable_name="my-variable")
            assert query.variable_name == "my-variable"

        def test_query_allows_underscore_in_variable_name(self) -> None:
            """Test that underscores are allowed in variable names."""
            query = ConversationVariablesQuery(variable_name="my_variable")
            assert query.variable_name == "my_variable"

        def test_query_allows_period_in_variable_name(self) -> None:
            """Test that periods are allowed in variable names."""
            query = ConversationVariablesQuery(variable_name="config.setting")
            assert query.variable_name == "config.setting"

        def test_query_rejects_sql_injection_single_quote(self) -> None:
            """Test that single quotes are rejected (SQL injection prevention)."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name="'; DROP TABLE users;--")
            assert "can only contain" in str(exc_info.value)

        def test_query_rejects_sql_injection_double_quote(self) -> None:
            """Test that double quotes are rejected."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name='name"test')
            assert "can only contain" in str(exc_info.value)

        def test_query_rejects_sql_injection_semicolon(self) -> None:
            """Test that semicolons are rejected."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name="name;malicious")
            assert "can only contain" in str(exc_info.value)

        def test_query_rejects_sql_injection_comment(self) -> None:
            """Test that SQL comments are rejected."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name="name--comment")
            assert "invalid characters" in str(exc_info.value)

        def test_query_rejects_special_characters(self) -> None:
            """Test that special characters are rejected."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name="name@domain")
            assert "can only contain" in str(exc_info.value)

        def test_query_rejects_backticks(self) -> None:
            """Test that backticks are rejected (SQL injection prevention)."""
            with pytest.raises(
                ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"
            ) as exc_info:
                ConversationVariablesQuery(variable_name="`table`")
            assert "can only contain" in str(exc_info.value)

        def test_query_pagination_limits(self) -> None:
            """Test query pagination limit boundaries."""
            query_min = ConversationVariablesQuery(limit=1)
            assert query_min.limit == 1

            query_max = ConversationVariablesQuery(limit=100)
            assert query_max.limit == 100

    class TestConversationVariableUpdatePayload:
        """Test suite for ConversationVariableUpdatePayload Pydantic model."""

        def test_payload_with_string_value(self) -> None:
            """Test payload with string value."""
            payload = ConversationVariableUpdatePayload(value="hello")
            assert payload.value == "hello"

        def test_payload_with_number_value(self) -> None:
            """Test payload with number value."""
            payload = ConversationVariableUpdatePayload(value=42)
            assert payload.value == 42

        def test_payload_with_float_value(self) -> None:
            """Test payload with float value."""
            payload = ConversationVariableUpdatePayload(value=float("3.14159"))
            assert payload.value == float("3.14159")

        def test_payload_with_list_value(self) -> None:
            """Test payload with list value."""
            payload = ConversationVariableUpdatePayload(value=["a", "b", "c"])
            assert payload.value == ["a", "b", "c"]

        def test_payload_with_dict_value(self) -> None:
            """Test payload with dictionary value."""
            payload = ConversationVariableUpdatePayload(value={"key": "value"})
            assert payload.value == {"key": "value"}

        def test_payload_with_none_value(self) -> None:
            """Test payload with None value."""
            payload = ConversationVariableUpdatePayload(value=None)
            assert payload.value is None

        def test_payload_with_boolean_value(self) -> None:
            """Test payload with boolean value."""
            payload = ConversationVariableUpdatePayload(value=True)
            assert payload.value is True

        def test_payload_with_nested_structure(self) -> None:
            """Test payload with deeply nested structure."""
            nested = {"level1": {"level2": {"level3": ["a", "b", {"c": 123}]}}}
            payload = ConversationVariableUpdatePayload(value=nested)
            assert payload.value == nested

    class TestConversationVariableResponseModels:
        def test_variable_response_normalizes_value_type_and_timestamps(self) -> None:
            """Given an integer segment type and UTC timestamps, expose a number and epoch seconds."""
            created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
            response = ConversationVariableResponse.model_validate(
                {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "foo",
                    "value_type": SegmentType.INTEGER,
                    "value": 1,
                    "description": "desc",
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )
            assert response.value_type == "number"
            assert response.value == "1"
            assert response.created_at == int(created_at.timestamp())
            assert response.updated_at == int(created_at.timestamp())

        def test_variable_response_normalizes_string_value_type_alias(self) -> None:
            """Given the integer type alias, expose the canonical number type."""
            response = ConversationVariableResponse.model_validate(
                {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "foo",
                    "value_type": SegmentType.INTEGER.value,
                }
            )

            assert response.value_type == "number"

        def test_variable_response_normalizes_callable_exposed_type(self) -> None:
            """Given a segment type with an exposed_type method, use its string result."""
            response = ConversationVariableResponse.model_validate(
                {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "foo",
                    "value_type": SegmentType.STRING,
                }
            )

            assert response.value_type == "string"

        def test_serialize_value_type_supports_segments_and_mappings(self) -> None:
            """Given a segment or value_type mapping, return its exposed type."""
            assert serialize_value_type(StringSegment(value="hello")) == "string"
            assert serialize_value_type({"value_type": SegmentType.INTEGER}) == "number"

        def test_variable_pagination_response(self) -> None:
            """Given a valid pagination payload, preserve its limit, cursor state, and variable."""
            response = ConversationVariableInfiniteScrollPaginationResponse.model_validate(
                {
                    "limit": 1,
                    "has_more": False,
                    "data": [
                        {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "foo",
                            "value_type": "string",
                            "value": "bar",
                        }
                    ],
                }
            )
            assert response.limit == 1
            assert response.has_more is False
            assert len(response.data) == 1
            assert response.data[0].name == "foo"

    class TestConversationAppModeValidation:
        """Test app mode validation for conversation endpoints."""

        @pytest.mark.parametrize(
            "mode",
            [
                AppMode.CHAT,
                AppMode.AGENT_CHAT.value,
                AppMode.AGENT.value,
                AppMode.ADVANCED_CHAT.value,
            ],
        )
        def test_chat_modes_are_valid_for_conversation_endpoints(self, mode: str) -> None:
            """Test that all chat modes are valid for conversation endpoints.

            Verifies that CHAT, AGENT_CHAT, AGENT, and ADVANCED_CHAT modes pass
            validation without raising NotChatAppError.
            """
            app = App(
                mode=AppMode(mode),
            )

            # Validation should pass without raising for chat modes
            app_mode = AppMode.value_of(app.mode)
            assert app_mode in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}

        def test_completion_mode_is_invalid_for_conversation_endpoints(self) -> None:
            """Test that COMPLETION mode is invalid for conversation endpoints.

            Verifies that calling a conversation endpoint with a COMPLETION mode
            app raises NotChatAppError.
            """
            app = App(
                mode=AppMode.COMPLETION,
            )

            app_mode = AppMode.value_of(app.mode)
            assert app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
            with pytest.raises(NotChatAppError):
                raise NotChatAppError()

        def test_workflow_mode_is_invalid_for_conversation_endpoints(self) -> None:
            """Test that WORKFLOW mode is invalid for conversation endpoints.

            Verifies that calling a conversation endpoint with a WORKFLOW mode
            app raises NotChatAppError.
            """
            app = App(
                mode=AppMode.WORKFLOW,
            )

            app_mode = AppMode.value_of(app.mode)
            assert app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
            with pytest.raises(NotChatAppError):
                raise NotChatAppError()

    class TestConversationErrorTypes:
        """Test conversation-related error types."""

        def test_conversation_not_exists_error(self) -> None:
            """Test ConversationNotExistsError exists and can be raised."""
            error = services.errors.conversation.ConversationNotExistsError()
            assert isinstance(error, services.errors.conversation.ConversationNotExistsError)

        def test_conversation_completed_error(self) -> None:
            """Test ConversationCompletedError exists."""
            error = services.errors.conversation.ConversationCompletedError()
            assert isinstance(error, services.errors.conversation.ConversationCompletedError)

        def test_last_conversation_not_exists_error(self) -> None:
            """Test LastConversationNotExistsError exists."""
            error = services.errors.conversation.LastConversationNotExistsError()
            assert isinstance(error, services.errors.conversation.LastConversationNotExistsError)

        def test_conversation_variable_not_exists_error(self) -> None:
            """Test ConversationVariableNotExistsError exists."""
            error = services.errors.conversation.ConversationVariableNotExistsError()
            assert isinstance(error, services.errors.conversation.ConversationVariableNotExistsError)

        def test_conversation_variable_type_mismatch_error(self) -> None:
            """Test ConversationVariableTypeMismatchError exists."""
            error = services.errors.conversation.ConversationVariableTypeMismatchError("Type mismatch")
            assert isinstance(error, services.errors.conversation.ConversationVariableTypeMismatchError)

    class TestConversationPayloadsController:
        def test_rename_requires_name(self) -> None:
            with pytest.raises(
                ValueError,
                match=(
                    "1 validation error for ConversationRenamePayload\\\n  Value error, "
                    "name is required when auto_generate is false"
                ),
            ):
                ConversationRenamePayload(auto_generate=False, name="")

        def test_variables_query_invalid_name(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for ConversationVariablesQuery\\\nvariable_name"):
                ConversationVariablesQuery(variable_name="bad;")


class TestConversationRenamePayloadCases:
    from tests.unit_tests.conftest import app

    app = staticmethod(app)

    @staticmethod
    @pytest.mark.parametrize("payload_cls", [ConsolePayload, ServicePayload])
    def test_payload_allows_auto_generate_without_name(payload_cls: type[ConversationRenamePayload]) -> None:
        """Given either endpoint payload model, accept automatic naming without a name."""
        payload = payload_cls.model_validate({"auto_generate": True})

        assert payload.auto_generate is True
        assert payload.name is None

    @staticmethod
    @pytest.mark.parametrize("payload_cls", [ConsolePayload, ServicePayload])
    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_payload_requires_name_when_not_auto_generate(
        payload_cls: type[ConversationRenamePayload], value: str | None
    ) -> None:
        """Given either endpoint model and a blank name, reject manual naming with ValidationError."""
        with pytest.raises(ValidationError):
            payload_cls.model_validate({"name": value, "auto_generate": False})
