"""Unit tests for MCP entities module."""

from queue import Queue

from core.mcp.entities import (
    SUPPORTED_PROTOCOL_VERSIONS,
    RequestContext,
)
from core.mcp.session.base_session import BaseSession
from core.mcp.types import LATEST_PROTOCOL_VERSION, RequestParams, ServerNotification, ServerRequest


def _session() -> BaseSession:
    return BaseSession(
        read_stream=Queue(),
        write_stream=Queue(),
        receive_request_type=ServerRequest,
        receive_notification_type=ServerNotification,
    )


class TestProtocolVersions:
    """Test protocol version constants."""

    def test_supported_protocol_versions(self):
        """Test supported protocol versions list."""
        assert isinstance(SUPPORTED_PROTOCOL_VERSIONS, list)
        assert len(SUPPORTED_PROTOCOL_VERSIONS) >= 3
        assert "2024-11-05" in SUPPORTED_PROTOCOL_VERSIONS
        assert "2025-03-26" in SUPPORTED_PROTOCOL_VERSIONS
        assert LATEST_PROTOCOL_VERSION in SUPPORTED_PROTOCOL_VERSIONS

    def test_latest_protocol_version_is_supported(self):
        """Test that latest protocol version is in supported versions."""
        assert LATEST_PROTOCOL_VERSION in SUPPORTED_PROTOCOL_VERSIONS


class TestRequestContext:
    """Test RequestContext dataclass."""

    def test_request_context_creation(self):
        """Test creating a RequestContext instance."""
        session = _session()
        lifespan = {"key": "value"}
        meta = RequestParams.Meta(progressToken="test-token")

        context = RequestContext(
            request_id="test-request-123",
            meta=meta,
            session=session,
            lifespan_context=lifespan,
        )

        assert context.request_id == "test-request-123"
        assert context.meta == meta
        assert context.session == session
        assert context.lifespan_context == lifespan

    def test_request_context_with_none_meta(self):
        """Test creating RequestContext with None meta."""
        session = _session()

        context = RequestContext(
            request_id=42,  # Can be int or string
            meta=None,
            session=session,
            lifespan_context=None,
        )

        assert context.request_id == 42
        assert context.meta is None
        assert context.session == session
        assert context.lifespan_context is None

    def test_request_context_attributes(self):
        """Test RequestContext attributes are accessible."""
        session = _session()

        context = RequestContext(
            request_id="test-123",
            meta=None,
            session=session,
            lifespan_context=None,
        )

        # Verify attributes are accessible
        assert hasattr(context, "request_id")
        assert hasattr(context, "meta")
        assert hasattr(context, "session")
        assert hasattr(context, "lifespan_context")

        # Verify values
        assert context.request_id == "test-123"
        assert context.meta is None
        assert context.session == session
        assert context.lifespan_context is None

    def test_request_context_generic_typing(self):
        """Test RequestContext with different generic types."""
        # Create a real session without starting its receive loop.
        session = _session()

        # Create context with string lifespan context
        context_str = RequestContext[BaseSession, str](
            request_id="test-1",
            meta=None,
            session=session,
            lifespan_context="string-context",
        )
        assert isinstance(context_str.lifespan_context, str)

        # Create context with dict lifespan context
        context_dict = RequestContext[BaseSession, dict](
            request_id="test-2",
            meta=None,
            session=session,
            lifespan_context={"key": "value"},
        )
        assert isinstance(context_dict.lifespan_context, dict)

        # Create context with custom object lifespan context
        class CustomLifespan:
            def __init__(self, data):
                self.data = data

        custom_lifespan = CustomLifespan("test-data")
        context_custom = RequestContext[BaseSession, CustomLifespan](
            request_id="test-3",
            meta=None,
            session=session,
            lifespan_context=custom_lifespan,
        )
        assert isinstance(context_custom.lifespan_context, CustomLifespan)
        assert context_custom.lifespan_context.data == "test-data"

    def test_request_context_with_progress_meta(self):
        """Test RequestContext with progress metadata."""
        session = _session()
        progress_meta = RequestParams.Meta(progressToken="progress-123")

        context = RequestContext(
            request_id="req-456",
            meta=progress_meta,
            session=session,
            lifespan_context=None,
        )

        assert context.meta is not None
        assert context.meta.progressToken == "progress-123"

    def test_request_context_equality(self):
        """Test RequestContext equality comparison."""
        session1 = _session()
        session2 = _session()

        context1 = RequestContext(
            request_id="test-123",
            meta=None,
            session=session1,
            lifespan_context="context",
        )

        context2 = RequestContext(
            request_id="test-123",
            meta=None,
            session=session1,
            lifespan_context="context",
        )

        context3 = RequestContext(
            request_id="test-456",
            meta=None,
            session=session1,
            lifespan_context="context",
        )

        # Same values should be equal
        assert context1 == context2

        # Different request_id should not be equal
        assert context1 != context3

        # Different session should not be equal
        context4 = RequestContext(
            request_id="test-123",
            meta=None,
            session=session2,
            lifespan_context="context",
        )
        assert context1 != context4

    def test_request_context_repr(self):
        """Test RequestContext string representation."""
        session = _session()

        context = RequestContext(
            request_id="test-123",
            meta=None,
            session=session,
            lifespan_context={"data": "test"},
        )

        repr_str = repr(context)
        assert "RequestContext" in repr_str
        assert "test-123" in repr_str
        assert repr(session) in repr_str
