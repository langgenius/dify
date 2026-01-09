"""Unit tests for MCP entities module."""

from unittest.mock import Mock

from core.mcp.entities import (
    SUPPORTED_PROTOCOL_VERSIONS,
    LifespanContextT,
    RequestContext,
    SessionT,
)
from core.mcp.session.base_session import BaseSession
from core.mcp.types import LATEST_PROTOCOL_VERSION, RequestParams


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
        mock_session = Mock(spec=BaseSession)
        mock_lifespan = {"key": "value"}
        mock_meta = RequestParams.Meta(progressToken="test-token")

        context = RequestContext(
            request_id="test-request-123",
            meta=mock_meta,
            session=mock_session,
            lifespan_context=mock_lifespan,
        )

        assert context.request_id == "test-request-123"
        assert context.meta == mock_meta
        assert context.session == mock_session
        assert context.lifespan_context == mock_lifespan

    def test_request_context_with_none_meta(self):
        """Test creating RequestContext with None meta."""
        mock_session = Mock(spec=BaseSession)

        context = RequestContext(
            request_id=42,  # Can be int or string
            meta=None,
            session=mock_session,
            lifespan_context=None,
        )

        assert context.request_id == 42
        assert context.meta is None
        assert context.session == mock_session
        assert context.lifespan_context is None

    def test_request_context_attributes(self):
        """Test RequestContext attributes are accessible."""
        mock_session = Mock(spec=BaseSession)

        context = RequestContext(
            request_id="test-123",
            meta=None,
            session=mock_session,
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
        assert context.session == mock_session
        assert context.lifespan_context is None

    def test_request_context_generic_typing(self):
        """Test RequestContext with different generic types."""
        # Create a mock session with specific type
        mock_session = Mock(spec=BaseSession)

        # Create context with string lifespan context
        context_str = RequestContext[BaseSession, str](
            request_id="test-1",
            meta=None,
            session=mock_session,
            lifespan_context="string-context",
        )
        assert isinstance(context_str.lifespan_context, str)

        # Create context with dict lifespan context
        context_dict = RequestContext[BaseSession, dict](
            request_id="test-2",
            meta=None,
            session=mock_session,
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
            session=mock_session,
            lifespan_context=custom_lifespan,
        )
        assert isinstance(context_custom.lifespan_context, CustomLifespan)
        assert context_custom.lifespan_context.data == "test-data"

    def test_request_context_with_progress_meta(self):
        """Test RequestContext with progress metadata."""
        mock_session = Mock(spec=BaseSession)
        progress_meta = RequestParams.Meta(progressToken="progress-123")

        context = RequestContext(
            request_id="req-456",
            meta=progress_meta,
            session=mock_session,
            lifespan_context=None,
        )

        assert context.meta is not None
        assert context.meta.progressToken == "progress-123"

    def test_request_context_equality(self):
        """Test RequestContext equality comparison."""
        mock_session1 = Mock(spec=BaseSession)
        mock_session2 = Mock(spec=BaseSession)

        context1 = RequestContext(
            request_id="test-123",
            meta=None,
            session=mock_session1,
            lifespan_context="context",
        )

        context2 = RequestContext(
            request_id="test-123",
            meta=None,
            session=mock_session1,
            lifespan_context="context",
        )

        context3 = RequestContext(
            request_id="test-456",
            meta=None,
            session=mock_session1,
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
            session=mock_session2,
            lifespan_context="context",
        )
        assert context1 != context4

    def test_request_context_repr(self):
        """Test RequestContext string representation."""
        mock_session = Mock(spec=BaseSession)
        mock_session.__repr__ = Mock(return_value="<MockSession>")

        context = RequestContext(
            request_id="test-123",
            meta=None,
            session=mock_session,
            lifespan_context={"data": "test"},
        )

        repr_str = repr(context)
        assert "RequestContext" in repr_str
        assert "test-123" in repr_str
        assert "MockSession" in repr_str


class TestTypeVariables:
    """Test type variables defined in the module."""

    def test_session_type_var(self):
        """Test SessionT type variable."""

        # Create a custom session class
        class CustomSession(BaseSession):
            pass

        # Use in generic context
        def process_session(session: SessionT) -> SessionT:
            return session

        mock_session = Mock(spec=CustomSession)
        result = process_session(mock_session)
        assert result == mock_session

    def test_lifespan_context_type_var(self):
        """Test LifespanContextT type variable."""

        # Use in generic context
        def process_lifespan(context: LifespanContextT) -> LifespanContextT:
            return context

        # Test with different types
        str_context = "string-context"
        assert process_lifespan(str_context) == str_context

        dict_context = {"key": "value"}
        assert process_lifespan(dict_context) == dict_context

        class CustomContext:
            pass

        custom_context = CustomContext()
        assert process_lifespan(custom_context) == custom_context
