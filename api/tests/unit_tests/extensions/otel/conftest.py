"""
Shared fixtures for OTel tests.

Provides:
- Mock TracerProvider with MemorySpanExporter
- Mock configurations
- Test data factories
"""

from unittest.mock import MagicMock, create_autospec

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import set_tracer_provider


@pytest.fixture
def memory_span_exporter():
    """Provide an in-memory span exporter for testing."""
    return InMemorySpanExporter()


@pytest.fixture
def tracer_provider_with_memory_exporter(memory_span_exporter):
    """Provide a TracerProvider configured with memory exporter."""
    import opentelemetry.trace as trace_api

    trace_api._TRACER_PROVIDER = None
    trace_api._TRACER_PROVIDER_SET_ONCE._done = False

    provider = TracerProvider()
    processor = SimpleSpanProcessor(memory_span_exporter)
    provider.add_span_processor(processor)
    set_tracer_provider(provider)

    yield provider

    provider.force_flush()


@pytest.fixture
def mock_app_model():
    """Create a mock App model."""
    app = MagicMock()
    app.id = "test-app-id"
    app.tenant_id = "test-tenant-id"
    return app


@pytest.fixture
def mock_account_user():
    """Create a mock Account user."""
    from models.model import Account

    user = create_autospec(Account, instance=True)
    user.id = "test-user-id"
    return user


@pytest.fixture
def mock_end_user():
    """Create a mock EndUser."""
    from models.model import EndUser

    user = create_autospec(EndUser, instance=True)
    user.id = "test-end-user-id"
    return user


@pytest.fixture
def mock_workflow_runner():
    """Create a mock WorkflowAppRunner."""
    runner = MagicMock()
    runner.application_generate_entity = MagicMock()
    runner.application_generate_entity.user_id = "test-user-id"
    runner.application_generate_entity.stream = True
    runner.application_generate_entity.app_config = MagicMock()
    runner.application_generate_entity.app_config.app_id = "test-app-id"
    runner.application_generate_entity.app_config.tenant_id = "test-tenant-id"
    runner.application_generate_entity.app_config.workflow_id = "test-workflow-id"
    return runner


@pytest.fixture(autouse=True)
def reset_handler_instances():
    """Reset handler singleton instances before each test."""
    from extensions.otel.decorators.base import _HANDLER_INSTANCES

    _HANDLER_INSTANCES.clear()
    from extensions.otel.decorators.handler import SpanHandler

    _HANDLER_INSTANCES[SpanHandler] = SpanHandler()
    yield
    _HANDLER_INSTANCES.clear()
