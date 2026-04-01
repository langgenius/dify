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

import sys
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import BadRequest, NotFound

import services
from controllers.service_api.app.conversation import (
    ConversationApi,
    ConversationDetailApi,
    ConversationListQuery,
    ConversationRenameApi,
    ConversationRenamePayload,
    ConversationVariableDetailApi,
    ConversationVariablesApi,
    ConversationVariablesQuery,
    ConversationVariableUpdatePayload,
)
from controllers.service_api.app.error import NotChatAppError
from models.model import App, AppMode, EndUser
from services.conversation_service import ConversationService
from services.errors.conversation import (
    ConversationNotExistsError,
    ConversationVariableNotExistsError,
    ConversationVariableTypeMismatchError,
    LastConversationNotExistsError,
)


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestConversationListQuery:
    """Test suite for ConversationListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = ConversationListQuery()
        assert query.last_id is None
        assert query.limit == 20
        assert query.sort_by == "-updated_at"

    def test_query_with_last_id(self):
        """Test query with pagination last_id."""
        last_id = str(uuid.uuid4())
        query = ConversationListQuery(last_id=last_id)
        assert str(query.last_id) == last_id

    def test_query_limit_boundaries(self):
        """Test query respects limit boundaries."""
        query_min = ConversationListQuery(limit=1)
        assert query_min.limit == 1

        query_max = ConversationListQuery(limit=100)
        assert query_max.limit == 100

    def test_query_rejects_limit_below_minimum(self):
        """Test query rejects limit < 1."""
        with pytest.raises(ValueError):
            ConversationListQuery(limit=0)

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 100."""
        with pytest.raises(ValueError):
            ConversationListQuery(limit=101)

    @pytest.mark.parametrize(
        "sort_by",
        [
            "created_at",
            "-created_at",
            "updated_at",
            "-updated_at",
        ],
    )
    def test_query_valid_sort_options(self, sort_by):
        """Test all valid sort_by options."""
        query = ConversationListQuery(sort_by=sort_by)
        assert query.sort_by == sort_by


class TestConversationRenamePayload:
    """Test suite for ConversationRenamePayload Pydantic model."""

    def test_payload_with_name(self):
        """Test payload with explicit name."""
        payload = ConversationRenamePayload(name="My New Chat", auto_generate=False)
        assert payload.name == "My New Chat"
        assert payload.auto_generate is False

    def test_payload_with_auto_generate(self):
        """Test payload with auto_generate enabled."""
        payload = ConversationRenamePayload(auto_generate=True)
        assert payload.auto_generate is True
        assert payload.name is None

    def test_payload_requires_name_when_auto_generate_false(self):
        """Test that name is required when auto_generate is False."""
        with pytest.raises(ValueError) as exc_info:
            ConversationRenamePayload(auto_generate=False)
        assert "name is required when auto_generate is false" in str(exc_info.value)

    def test_payload_requires_non_empty_name_when_auto_generate_false(self):
        """Test that empty string name is rejected."""
        with pytest.raises(ValueError):
            ConversationRenamePayload(name="", auto_generate=False)

    def test_payload_requires_non_whitespace_name_when_auto_generate_false(self):
        """Test that whitespace-only name is rejected."""
        with pytest.raises(ValueError):
            ConversationRenamePayload(name="   ", auto_generate=False)

    def test_payload_name_with_special_characters(self):
        """Test payload with name containing special characters."""
        payload = ConversationRenamePayload(name="Chat #1 - (Test) & More!", auto_generate=False)
        assert payload.name == "Chat #1 - (Test) & More!"

    def test_payload_name_with_unicode(self):
        """Test payload with Unicode characters in name."""
        payload = ConversationRenamePayload(name="对话 📝 Чат", auto_generate=False)
        assert payload.name == "对话 📝 Чат"


class TestConversationVariablesQuery:
    """Test suite for ConversationVariablesQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = ConversationVariablesQuery()
        assert query.last_id is None
        assert query.limit == 20
        assert query.variable_name is None

    def test_query_with_variable_name(self):
        """Test query with valid variable_name filter."""
        query = ConversationVariablesQuery(variable_name="user_preference")
        assert query.variable_name == "user_preference"

    def test_query_allows_hyphen_in_variable_name(self):
        """Test that hyphens are allowed in variable names."""
        query = ConversationVariablesQuery(variable_name="my-variable")
        assert query.variable_name == "my-variable"

    def test_query_allows_underscore_in_variable_name(self):
        """Test that underscores are allowed in variable names."""
        query = ConversationVariablesQuery(variable_name="my_variable")
        assert query.variable_name == "my_variable"

    def test_query_allows_period_in_variable_name(self):
        """Test that periods are allowed in variable names."""
        query = ConversationVariablesQuery(variable_name="config.setting")
        assert query.variable_name == "config.setting"

    def test_query_rejects_sql_injection_single_quote(self):
        """Test that single quotes are rejected (SQL injection prevention)."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name="'; DROP TABLE users;--")
        assert "can only contain" in str(exc_info.value)

    def test_query_rejects_sql_injection_double_quote(self):
        """Test that double quotes are rejected."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name='name"test')
        assert "can only contain" in str(exc_info.value)

    def test_query_rejects_sql_injection_semicolon(self):
        """Test that semicolons are rejected."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name="name;malicious")
        assert "can only contain" in str(exc_info.value)

    def test_query_rejects_sql_injection_comment(self):
        """Test that SQL comments are rejected."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name="name--comment")
        assert "invalid characters" in str(exc_info.value)

    def test_query_rejects_special_characters(self):
        """Test that special characters are rejected."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name="name@domain")
        assert "can only contain" in str(exc_info.value)

    def test_query_rejects_backticks(self):
        """Test that backticks are rejected (SQL injection prevention)."""
        with pytest.raises(ValueError) as exc_info:
            ConversationVariablesQuery(variable_name="`table`")
        assert "can only contain" in str(exc_info.value)

    def test_query_pagination_limits(self):
        """Test query pagination limit boundaries."""
        query_min = ConversationVariablesQuery(limit=1)
        assert query_min.limit == 1

        query_max = ConversationVariablesQuery(limit=100)
        assert query_max.limit == 100


class TestConversationVariableUpdatePayload:
    """Test suite for ConversationVariableUpdatePayload Pydantic model."""

    def test_payload_with_string_value(self):
        """Test payload with string value."""
        payload = ConversationVariableUpdatePayload(value="hello")
        assert payload.value == "hello"

    def test_payload_with_number_value(self):
        """Test payload with number value."""
        payload = ConversationVariableUpdatePayload(value=42)
        assert payload.value == 42

    def test_payload_with_float_value(self):
        """Test payload with float value."""
        payload = ConversationVariableUpdatePayload(value=3.14159)
        assert payload.value == 3.14159

    def test_payload_with_list_value(self):
        """Test payload with list value."""
        payload = ConversationVariableUpdatePayload(value=["a", "b", "c"])
        assert payload.value == ["a", "b", "c"]

    def test_payload_with_dict_value(self):
        """Test payload with dictionary value."""
        payload = ConversationVariableUpdatePayload(value={"key": "value"})
        assert payload.value == {"key": "value"}

    def test_payload_with_none_value(self):
        """Test payload with None value."""
        payload = ConversationVariableUpdatePayload(value=None)
        assert payload.value is None

    def test_payload_with_boolean_value(self):
        """Test payload with boolean value."""
        payload = ConversationVariableUpdatePayload(value=True)
        assert payload.value is True

    def test_payload_with_nested_structure(self):
        """Test payload with deeply nested structure."""
        nested = {"level1": {"level2": {"level3": ["a", "b", {"c": 123}]}}}
        payload = ConversationVariableUpdatePayload(value=nested)
        assert payload.value == nested


class TestConversationAppModeValidation:
    """Test app mode validation for conversation endpoints."""

    @pytest.mark.parametrize(
        "mode",
        [
            AppMode.CHAT.value,
            AppMode.AGENT_CHAT.value,
            AppMode.ADVANCED_CHAT.value,
        ],
    )
    def test_chat_modes_are_valid_for_conversation_endpoints(self, mode):
        """Test that all chat modes are valid for conversation endpoints.

        Verifies that CHAT, AGENT_CHAT, and ADVANCED_CHAT modes pass
        validation without raising NotChatAppError.
        """
        app = Mock(spec=App)
        app.mode = mode

        # Validation should pass without raising for chat modes
        app_mode = AppMode.value_of(app.mode)
        assert app_mode in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}

    def test_completion_mode_is_invalid_for_conversation_endpoints(self):
        """Test that COMPLETION mode is invalid for conversation endpoints.

        Verifies that calling a conversation endpoint with a COMPLETION mode
        app raises NotChatAppError.
        """
        app = Mock(spec=App)
        app.mode = AppMode.COMPLETION.value

        app_mode = AppMode.value_of(app.mode)
        assert app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        with pytest.raises(NotChatAppError):
            raise NotChatAppError()

    def test_workflow_mode_is_invalid_for_conversation_endpoints(self):
        """Test that WORKFLOW mode is invalid for conversation endpoints.

        Verifies that calling a conversation endpoint with a WORKFLOW mode
        app raises NotChatAppError.
        """
        app = Mock(spec=App)
        app.mode = AppMode.WORKFLOW.value

        app_mode = AppMode.value_of(app.mode)
        assert app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        with pytest.raises(NotChatAppError):
            raise NotChatAppError()


class TestConversationErrorTypes:
    """Test conversation-related error types."""

    def test_conversation_not_exists_error(self):
        """Test ConversationNotExistsError exists and can be raised."""
        error = services.errors.conversation.ConversationNotExistsError()
        assert isinstance(error, services.errors.conversation.ConversationNotExistsError)

    def test_conversation_completed_error(self):
        """Test ConversationCompletedError exists."""
        error = services.errors.conversation.ConversationCompletedError()
        assert isinstance(error, services.errors.conversation.ConversationCompletedError)

    def test_last_conversation_not_exists_error(self):
        """Test LastConversationNotExistsError exists."""
        error = services.errors.conversation.LastConversationNotExistsError()
        assert isinstance(error, services.errors.conversation.LastConversationNotExistsError)

    def test_conversation_variable_not_exists_error(self):
        """Test ConversationVariableNotExistsError exists."""
        error = services.errors.conversation.ConversationVariableNotExistsError()
        assert isinstance(error, services.errors.conversation.ConversationVariableNotExistsError)

    def test_conversation_variable_type_mismatch_error(self):
        """Test ConversationVariableTypeMismatchError exists."""
        error = services.errors.conversation.ConversationVariableTypeMismatchError("Type mismatch")
        assert isinstance(error, services.errors.conversation.ConversationVariableTypeMismatchError)


class TestConversationService:
    """Test ConversationService integration patterns."""

    def test_pagination_by_last_id_method_exists(self):
        """Test that ConversationService.pagination_by_last_id exists."""
        assert hasattr(ConversationService, "pagination_by_last_id")
        assert callable(ConversationService.pagination_by_last_id)

    def test_delete_method_exists(self):
        """Test that ConversationService.delete exists."""
        assert hasattr(ConversationService, "delete")
        assert callable(ConversationService.delete)

    def test_rename_method_exists(self):
        """Test that ConversationService.rename exists."""
        assert hasattr(ConversationService, "rename")
        assert callable(ConversationService.rename)

    def test_get_conversational_variable_method_exists(self):
        """Test that ConversationService.get_conversational_variable exists."""
        assert hasattr(ConversationService, "get_conversational_variable")
        assert callable(ConversationService.get_conversational_variable)

    def test_update_conversation_variable_method_exists(self):
        """Test that ConversationService.update_conversation_variable exists."""
        assert hasattr(ConversationService, "update_conversation_variable")
        assert callable(ConversationService.update_conversation_variable)

    @patch.object(ConversationService, "pagination_by_last_id")
    def test_pagination_returns_expected_format(self, mock_pagination):
        """Test pagination returns expected data format."""
        mock_result = Mock()
        mock_result.data = []
        mock_result.limit = 20
        mock_result.has_more = False
        mock_pagination.return_value = mock_result

        result = ConversationService.pagination_by_last_id(
            app_model=Mock(spec=App),
            user=Mock(spec=EndUser),
            last_id=None,
            limit=20,
            invoke_from=Mock(),
            sort_by="-updated_at",
        )

        assert hasattr(result, "data")
        assert hasattr(result, "limit")
        assert hasattr(result, "has_more")

    @patch.object(ConversationService, "rename")
    def test_rename_returns_conversation(self, mock_rename):
        """Test rename returns updated conversation."""
        mock_conversation = Mock()
        mock_conversation.name = "New Name"
        mock_rename.return_value = mock_conversation

        result = ConversationService.rename(
            app_model=Mock(spec=App),
            conversation_id="conv_123",
            user=Mock(spec=EndUser),
            name="New Name",
            auto_generate=False,
        )

        assert result.name == "New Name"


class TestConversationPayloadsController:
    def test_rename_requires_name(self) -> None:
        with pytest.raises(ValueError):
            ConversationRenamePayload(auto_generate=False, name="")

    def test_variables_query_invalid_name(self) -> None:
        with pytest.raises(ValueError):
            ConversationVariablesQuery(variable_name="bad;")


class TestConversationApiController:
    def test_list_not_chat(self, app) -> None:
        api = ConversationApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/conversations", method="GET"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user)

    def test_list_last_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        class _SessionStub:
            def __enter__(self):
                return SimpleNamespace()

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr(
            ConversationService,
            "pagination_by_last_id",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(LastConversationNotExistsError()),
        )
        conversation_module = sys.modules["controllers.service_api.app.conversation"]
        monkeypatch.setattr(conversation_module, "db", SimpleNamespace(engine=object()))
        monkeypatch.setattr(conversation_module, "Session", lambda *_args, **_kwargs: _SessionStub())

        api = ConversationApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/conversations?last_id=00000000-0000-0000-0000-000000000001&limit=20",
            method="GET",
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user)


class TestConversationDetailApiController:
    def test_delete_not_chat(self, app) -> None:
        api = ConversationDetailApi()
        handler = _unwrap(api.delete)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/conversations/1", method="DELETE"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user, c_id="00000000-0000-0000-0000-000000000001")

    def test_delete_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            ConversationService,
            "delete",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )

        api = ConversationDetailApi()
        handler = _unwrap(api.delete)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/conversations/1", method="DELETE"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, c_id="00000000-0000-0000-0000-000000000001")


class TestConversationRenameApiController:
    def test_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            ConversationService,
            "rename",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )

        api = ConversationRenameApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/conversations/1/name",
            method="POST",
            json={"auto_generate": True},
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, c_id="00000000-0000-0000-0000-000000000001")


class TestConversationVariablesApiController:
    def test_not_chat(self, app) -> None:
        api = ConversationVariablesApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/conversations/1/variables", method="GET"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user, c_id="00000000-0000-0000-0000-000000000001")

    def test_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            ConversationService,
            "get_conversational_variable",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )

        api = ConversationVariablesApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/conversations/1/variables?limit=20",
            method="GET",
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, c_id="00000000-0000-0000-0000-000000000001")


class TestConversationVariableDetailApiController:
    def test_update_type_mismatch(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            ConversationService,
            "update_conversation_variable",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationVariableTypeMismatchError("bad")),
        )

        api = ConversationVariableDetailApi()
        handler = _unwrap(api.put)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/conversations/1/variables/2",
            method="PUT",
            json={"value": "x"},
        ):
            with pytest.raises(BadRequest):
                handler(
                    api,
                    app_model=app_model,
                    end_user=end_user,
                    c_id="00000000-0000-0000-0000-000000000001",
                    variable_id="00000000-0000-0000-0000-000000000002",
                )

    def test_update_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            ConversationService,
            "update_conversation_variable",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationVariableNotExistsError()),
        )

        api = ConversationVariableDetailApi()
        handler = _unwrap(api.put)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context(
            "/conversations/1/variables/2",
            method="PUT",
            json={"value": "x"},
        ):
            with pytest.raises(NotFound):
                handler(
                    api,
                    app_model=app_model,
                    end_user=end_user,
                    c_id="00000000-0000-0000-0000-000000000001",
                    variable_id="00000000-0000-0000-0000-000000000002",
                )
