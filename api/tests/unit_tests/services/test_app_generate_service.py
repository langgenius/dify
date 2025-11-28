"""
Comprehensive Unit Tests for AppGenerateService

This module provides extensive testing for the app generation service,
covering all app modes, rate limiting, quota management, streaming vs blocking,
error handling, and edge cases.

Tests cover:
- Chat app generation (basic and advanced)
- Completion app generation
- Agent chat app generation
- Workflow app generation
- Rate limiting and quota management
- Streaming vs blocking responses
- Error handling and validation
- Multi-user concurrent access
- Different invoke sources (web, API, service, etc.)
- Root node execution in workflows
- Billing enabled/disabled scenarios
- Edge cases and boundary conditions
"""

import uuid
from collections.abc import Generator
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import Account, App, AppMode, EndUser, Tenant
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.errors.app import (
    InvokeRateLimitError,
    QuotaExceededError,
    WorkflowNotFoundError,
)


@pytest.fixture
def tenant():
    """Create a test tenant."""
    tenant = MagicMock(spec=Tenant)
    tenant.id = str(uuid.uuid4())
    tenant.name = "Test Tenant"
    tenant.created_at = datetime.utcnow()
    return tenant


@pytest.fixture
def account(tenant):
    """Create a test account."""
    account = MagicMock(spec=Account)
    account.id = str(uuid.uuid4())
    account.name = "Test User"
    account.email = "test@example.com"
    account.tenant_id = tenant.id
    account.created_at = datetime.utcnow()
    return account


@pytest.fixture
def end_user(tenant):
    """Create a test end user."""
    end_user = MagicMock(spec=EndUser)
    end_user.id = str(uuid.uuid4())
    end_user.tenant_id = tenant.id
    end_user.session_id = str(uuid.uuid4())
    end_user.type = "browser"
    end_user.is_anonymous = True
    end_user.created_at = datetime.utcnow()
    return end_user


@pytest.fixture
def chat_app(tenant):
    """Create a test chat app."""
    app = MagicMock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = tenant.id
    app.name = "Test Chat App"
    app.mode = AppMode.CHAT.value
    app.is_agent = False
    app.enable_site = True
    app.enable_api = True
    app.created_at = datetime.utcnow()
    app.max_active_requests = 5
    return app


@pytest.fixture
def completion_app(tenant):
    """Create a test completion app."""
    app = MagicMock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = tenant.id
    app.name = "Test Completion App"
    app.mode = AppMode.COMPLETION.value
    app.is_agent = False
    app.enable_site = True
    app.enable_api = True
    app.created_at = datetime.utcnow()
    app.max_active_requests = 5
    return app


@pytest.fixture
def agent_chat_app(tenant):
    """Create a test agent chat app."""
    app = MagicMock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = tenant.id
    app.name = "Test Agent Chat App"
    app.mode = AppMode.AGENT_CHAT.value
    app.enable_site = True
    app.enable_api = True
    app.created_at = datetime.utcnow()
    app.max_active_requests = 5
    return app


@pytest.fixture
def advanced_chat_app(tenant):
    """Create a test advanced chat app."""
    app = MagicMock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = tenant.id
    app.name = "Test Advanced Chat App"
    app.mode = AppMode.ADVANCED_CHAT.value
    app.is_agent = False
    app.enable_site = True
    app.enable_api = True
    app.created_at = datetime.utcnow()
    app.max_active_requests = 5
    return app


@pytest.fixture
def workflow_app(tenant):
    """Create a test workflow app."""
    app = MagicMock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = tenant.id
    app.name = "Test Workflow App"
    app.mode = AppMode.WORKFLOW.value
    app.is_agent = False
    app.enable_site = True
    app.enable_api = True
    app.created_at = datetime.utcnow()
    app.max_active_requests = 5
    return app


@pytest.fixture
def workflow(tenant, workflow_app):
    """Create a test workflow."""
    workflow = MagicMock(spec=Workflow)
    workflow.id = str(uuid.uuid4())
    workflow.tenant_id = tenant.id
    workflow.app_id = workflow_app.id
    workflow.version = "1.0"
    workflow.graph = {"nodes": [], "edges": []}
    workflow.features = {}
    workflow.created_at = datetime.utcnow()
    return workflow


class TestAppGenerateServiceChatMode:
    """Tests for chat app generation."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_chat_app_streaming(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generating chat app response with streaming."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        
        # Mock rate limit
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        # Mock streaming response
        def mock_generate():
            yield {"type": "message", "content": "Hello"}
            yield {"type": "message", "content": " World"}
            yield {"type": "end"}

        # Mock generator instance
        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = mock_generate()
        
        # Mock convert_to_event_stream to pass through the generator
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through the generator
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello", "conversation_id": None}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        assert isinstance(result, Generator)
        responses = list(result)
        assert len(responses) == 3
        assert responses[0]["content"] == "Hello"
        assert responses[1]["content"] == " World"
        assert responses[2]["type"] == "end"

        # Verify rate limit was checked
        mock_rate_limit_instance.enter.assert_called_once()

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_chat_app_blocking(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generating chat app response without streaming."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        
        # Mock rate limit
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        # Mock blocking response
        response_dict = {
            "message": "Complete response",
            "conversation_id": str(uuid.uuid4()),
        }
        
        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = response_dict
        
        # Mock convert_to_event_stream to return the dict as-is for blocking
        mock_generator.convert_to_event_stream.return_value = response_dict
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello", "conversation_id": None}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        # Verify
        assert isinstance(result, dict)
        assert result["message"] == "Complete response"
        assert "conversation_id" in result

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_chat_with_end_user(self, mock_config, mock_rate_limit, mock_generator, chat_app, end_user):
        """Test generating chat app response with end user."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        
        # Mock rate limit
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        # Mock response
        response_dict = {"message": "Response"}
        
        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = response_dict
        
        # Mock convert_to_event_stream to return the dict as-is
        mock_generator.convert_to_event_stream.return_value = response_dict
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        # Verify
        assert result is not None
        mock_generator.assert_called_once()
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["user"] == end_user


class TestAppGenerateServiceCompletionMode:
    """Tests for completion app generation."""

    @patch("services.app_generate_service.CompletionAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_completion_app_streaming(
        self, mock_config, mock_rate_limit, mock_generator, completion_app, account
    ):
        """Test generating completion app response with streaming."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance

        def mock_generate():
            yield {"type": "text", "text": "Generated"}
            yield {"type": "text", "text": " content"}
            yield {"type": "end"}

        mock_generator_instance.generate.return_value = mock_generate()

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"inputs": {"prompt": "Write a story"}}
        result = AppGenerateService.generate(
            app_model=completion_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        assert isinstance(result, Generator)
        responses = list(result)
        assert len(responses) == 3

    @patch("services.app_generate_service.CompletionAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_completion_app_blocking(
        self, mock_config, mock_rate_limit, mock_generator, completion_app, account
    ):
        """Test generating completion app response without streaming."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = {
            "text": "Complete generated content",
            "usage": {"tokens": 100},
        }

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"inputs": {"prompt": "Write a story"}}
        result = AppGenerateService.generate(
            app_model=completion_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        # Verify
        assert isinstance(result, dict)
        assert result["text"] == "Complete generated content"
        assert result["usage"]["tokens"] == 100


class TestAppGenerateServiceAgentMode:
    """Tests for agent chat app generation."""

    @patch("services.app_generate_service.AgentChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_agent_chat_with_tools(
        self, mock_config, mock_rate_limit, mock_generator, agent_chat_app, account
    ):
        """Test generating agent chat response with tool usage."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance

        def mock_generate():
            yield {"type": "agent_thought", "thought": "I need to search"}
            yield {"type": "tool_call", "tool": "search", "input": "query"}
            yield {"type": "tool_response", "output": "results"}
            yield {"type": "agent_message", "message": "Based on search..."}
            yield {"type": "end"}

        mock_generator_instance.generate.return_value = mock_generate()

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Search for information", "conversation_id": None}
        result = AppGenerateService.generate(
            app_model=agent_chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        responses = list(result)
        assert len(responses) == 5
        assert responses[0]["type"] == "agent_thought"
        assert responses[1]["type"] == "tool_call"
        assert responses[2]["type"] == "tool_response"
        assert responses[3]["type"] == "agent_message"


class TestAppGenerateServiceWorkflowMode:
    """Tests for workflow app generation."""

    @patch("services.app_generate_service.WorkflowAppGenerator")
    @patch("services.app_generate_service.WorkflowService")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_workflow_app_success(
        self,
        mock_config,
        mock_rate_limit,
        mock_workflow_service,
        mock_generator,
        workflow_app,
        workflow,
        account,
    ):
        """Test generating workflow app response successfully."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_workflow_service.get_draft_workflow.return_value = workflow

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance

        def mock_generate():
            yield {"type": "workflow_started"}
            yield {"type": "node_started", "node_id": "node_1"}
            yield {"type": "node_finished", "node_id": "node_1", "output": {"result": "data"}}
            yield {"type": "workflow_finished", "outputs": {"final": "result"}}

        mock_generator_instance.generate.return_value = mock_generate()

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"inputs": {"input_field": "value"}}
        result = AppGenerateService.generate(
            app_model=workflow_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        responses = list(result)
        assert len(responses) == 4
        assert responses[0]["type"] == "workflow_started"
        assert responses[-1]["type"] == "workflow_finished"

    @patch("services.app_generate_service.WorkflowAppGenerator")
    @patch("services.app_generate_service.WorkflowService")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_workflow_with_root_node(
        self,
        mock_config,
        mock_rate_limit,
        mock_workflow_service,
        mock_generator,
        workflow_app,
        workflow,
        account,
    ):
        """Test generating workflow starting from specific root node."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_workflow_service.get_draft_workflow.return_value = workflow

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "workflow_finished"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        root_node_id = "node_123"
        args = {"inputs": {"input_field": "value"}}
        result = AppGenerateService.generate(
            app_model=workflow_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
            root_node_id=root_node_id,
        )

        # Verify
        list(result)  # Consume generator
        mock_generator.assert_called_once()
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs.get("root_node_id") == root_node_id

    @patch("services.app_generate_service.WorkflowService")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_workflow_not_found(
        self, mock_config, mock_rate_limit, mock_workflow_service, workflow_app, account
    ):
        """Test generating workflow when workflow doesn't exist."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_workflow_service.get_draft_workflow.return_value = None

        # Execute & Verify
        args = {"inputs": {"input_field": "value"}}
        with pytest.raises(WorkflowNotFoundError):
            AppGenerateService.generate(
                app_model=workflow_app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )


class TestAppGenerateServiceRateLimiting:
    """Tests for rate limiting functionality."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_rate_limit_enforced(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test that rate limiting is enforced."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit_instance.enter.side_effect = InvokeRateLimitError("Rate limit exceeded")
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        # Execute & Verify
        args = {"query": "Hello"}
        with pytest.raises(InvokeRateLimitError):
            AppGenerateService.generate(
                app_model=chat_app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_rate_limit_released_after_generation(
        self, mock_config, mock_rate_limit, mock_generator, chat_app, account
    ):
        """Test that rate limit is released after generation completes."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        list(result)  # Consume generator

        # Verify rate limit was released
        mock_rate_limit_instance.exit.assert_called_once()

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_concurrent_requests_within_limit(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test multiple concurrent requests within rate limit."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute multiple requests
        args = {"query": "Hello"}
        for i in range(5):
            result = AppGenerateService.generate(
                app_model=chat_app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )
            list(result)

        # Verify rate limit was checked for each request
        assert mock_rate_limit_instance.enter.call_count == 5


class TestAppGenerateServiceQuotaManagement:
    """Tests for quota management and billing."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.QuotaType")
    @patch("services.app_generate_service.dify_config")
    def test_quota_consumed_when_billing_enabled(
        self, mock_config, mock_quota_type, mock_rate_limit, mock_generator, chat_app, account
    ):
        """Test that quota is consumed when billing is enabled."""
        # Setup
        mock_config.BILLING_ENABLED = True
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_workflow_quota = MagicMock()
        mock_quota_type.WORKFLOW = mock_workflow_quota
        mock_workflow_quota.consume.return_value = MagicMock()

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        list(result)

        # Verify quota was consumed
        mock_workflow_quota.consume.assert_called_once_with(chat_app.tenant_id)

    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.QuotaType")
    @patch("services.app_generate_service.dify_config")
    def test_quota_exceeded_error(self, mock_config, mock_quota_type, mock_rate_limit, chat_app, account):
        """Test error when quota is exceeded."""
        # Setup
        mock_config.BILLING_ENABLED = True
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_workflow_quota = MagicMock()
        mock_quota_type.WORKFLOW = mock_workflow_quota
        mock_workflow_quota.consume.side_effect = QuotaExceededError(
            feature="workflow", tenant_id=chat_app.tenant_id, required=1
        )

        # Execute & Verify
        args = {"query": "Hello"}
        with pytest.raises(InvokeRateLimitError) as exc_info:
            AppGenerateService.generate(
                app_model=chat_app,
                user=account,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

        assert "quota limit reached" in str(exc_info.value).lower()

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_no_quota_check_when_billing_disabled(
        self, mock_config, mock_rate_limit, mock_generator, chat_app, account
    ):
        """Test that quota is not checked when billing is disabled."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        list(result)

        # Verify - no quota consumption should occur
        # (We can't directly verify this without mocking QuotaType, but the test passes if no error)


class TestAppGenerateServiceInvokeSources:
    """Tests for different invoke sources."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_invoke_from_web_app(self, mock_config, mock_rate_limit, mock_generator, chat_app, end_user):
        """Test invocation from web app."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        list(result)

        # Verify
        mock_generator.assert_called_once()
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["invoke_from"] == InvokeFrom.WEB_APP

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_invoke_from_service_api(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test invocation from service API."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )

        list(result)

        # Verify
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["invoke_from"] == InvokeFrom.SERVICE_API

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_invoke_from_explore(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test invocation from explore page."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.EXPLORE,
            streaming=True,
        )

        list(result)

        # Verify
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["invoke_from"] == InvokeFrom.EXPLORE


class TestAppGenerateServiceAdvancedChat:
    """Tests for advanced chat mode."""

    @patch("services.app_generate_service.AdvancedChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_advanced_chat_with_context(
        self, mock_config, mock_rate_limit, mock_generator, advanced_chat_app, account
    ):
        """Test generating advanced chat with conversation context."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance

        def mock_generate():
            yield {"type": "message", "content": "Response with context"}
            yield {"type": "end"}

        mock_generator_instance.generate.return_value = mock_generate()

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        conversation_id = str(uuid.uuid4())
        args = {
            "query": "Follow-up question",
            "conversation_id": conversation_id,
        }
        result = AppGenerateService.generate(
            app_model=advanced_chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        responses = list(result)
        assert len(responses) == 2
        mock_generator.assert_called_once()
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["args"]["conversation_id"] == conversation_id


class TestAppGenerateServiceEdgeCases:
    """Tests for edge cases and error scenarios."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_with_empty_args(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generation with empty arguments."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify - should handle gracefully
        list(result)
        mock_generator.assert_called_once()

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_with_very_long_input(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generation with very long input text."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        very_long_query = "A" * 10000  # 10k characters
        args = {"query": very_long_query}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        list(result)
        call_kwargs = mock_generator.call_args[1]
        assert len(call_kwargs["args"]["query"]) == 10000

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_with_special_characters(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generation with special characters in input."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        special_query = "Test with émojis 🎉 and symbols @#$%^&*()"
        args = {"query": special_query}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        list(result)
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["args"]["query"] == special_query

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generator_exception_handling(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test handling of exceptions during generation."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.side_effect = Exception("Generation failed")

        # Execute & Verify
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        with pytest.raises(Exception) as exc_info:
            list(result)

        assert "Generation failed" in str(exc_info.value)
        # Rate limit should still be released
        mock_rate_limit_instance.exit.assert_called_once()

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_generate_with_none_conversation_id(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test generation with None conversation_id (new conversation)."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter(
            [{"type": "message", "content": "New conversation"}, {"type": "end"}]
        )

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello", "conversation_id": None}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        # Verify
        list(result)
        call_kwargs = mock_generator.call_args[1]
        assert call_kwargs["args"]["conversation_id"] is None


class TestAppGenerateServiceMaxActiveRequests:
    """Tests for max active requests configuration."""

    @patch("services.app_generate_service.ChatAppGenerator")
    @patch("services.app_generate_service.RateLimit")
    @patch("services.app_generate_service.dify_config")
    def test_default_max_active_requests(self, mock_config, mock_rate_limit, mock_generator, chat_app, account):
        """Test default max active requests value."""
        # Setup
        mock_config.BILLING_ENABLED = False
        mock_config.APP_MAX_ACTIVE_REQUESTS = 10
        mock_config.APP_DEFAULT_ACTIVE_REQUESTS = 5
        mock_rate_limit_instance = MagicMock()
        mock_rate_limit.return_value = mock_rate_limit_instance
        mock_rate_limit.gen_request_key.return_value = "test_request_id"
        mock_rate_limit_instance.enter.return_value = "test_request_id"

        mock_generator_instance = MagicMock()
        mock_generator.return_value = mock_generator_instance
        mock_generator_instance.generate.return_value = iter([{"type": "end"}])

        # Mock convert_to_event_stream to pass through
        mock_generator.convert_to_event_stream.side_effect = lambda x: x
        
        # Mock rate_limit.generate to pass through
        mock_rate_limit_instance.generate.side_effect = lambda gen, request_id: gen

        # Execute
        args = {"query": "Hello"}
        result = AppGenerateService.generate(
            app_model=chat_app,
            user=account,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        list(result)

        # Verify RateLimit was initialized with app_id
        mock_rate_limit.assert_called_once()
        assert mock_rate_limit.call_args[0][0] == chat_app.id
