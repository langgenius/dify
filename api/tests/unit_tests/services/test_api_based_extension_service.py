"""
Comprehensive unit tests for services/api_based_extension_service.py

Covers:
- APIBasedExtensionService.get_all_by_tenant_id
- APIBasedExtensionService.save
- APIBasedExtensionService.delete
- APIBasedExtensionService.get_with_tenant_id
- APIBasedExtensionService._validation  (new record & existing record branches)
- APIBasedExtensionService._ping_connection (pong success, wrong response, exception)
"""

from unittest.mock import MagicMock, patch

import pytest

from services.api_based_extension_service import APIBasedExtensionService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_extension(
    *,
    id_: str | None = None,
    tenant_id: str = "tenant-001",
    name: str = "my-ext",
    api_endpoint: str = "https://example.com/hook",
    api_key: str = "secret-key-123",
) -> MagicMock:
    """Return a lightweight mock that mimics APIBasedExtension."""
    ext = MagicMock()
    ext.id = id_
    ext.tenant_id = tenant_id
    ext.name = name
    ext.api_endpoint = api_endpoint
    ext.api_key = api_key
    return ext


# ---------------------------------------------------------------------------
# Tests: get_all_by_tenant_id
# ---------------------------------------------------------------------------


class TestGetAllByTenantId:
    """Tests for APIBasedExtensionService.get_all_by_tenant_id."""

    @patch("services.api_based_extension_service.decrypt_token", return_value="decrypted-key")
    @patch("services.api_based_extension_service.db")
    def test_returns_extensions_with_decrypted_keys(self, mock_db, mock_decrypt):
        """Each api_key is decrypted and the list is returned."""
        ext1 = _make_extension(id_="id-1", api_key="enc-key-1")
        ext2 = _make_extension(id_="id-2", api_key="enc-key-2")

        mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.all.return_value = [
            ext1,
            ext2,
        ]

        result = APIBasedExtensionService.get_all_by_tenant_id("tenant-001")

        assert result == [ext1, ext2]
        assert ext1.api_key == "decrypted-key"
        assert ext2.api_key == "decrypted-key"
        assert mock_decrypt.call_count == 2

    @patch("services.api_based_extension_service.decrypt_token", return_value="decrypted-key")
    @patch("services.api_based_extension_service.db")
    def test_returns_empty_list_when_no_extensions(self, mock_db, mock_decrypt):
        """Returns an empty list gracefully when no records exist."""
        mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.all.return_value = []

        result = APIBasedExtensionService.get_all_by_tenant_id("tenant-001")

        assert result == []
        mock_decrypt.assert_not_called()

    @patch("services.api_based_extension_service.decrypt_token", return_value="decrypted-key")
    @patch("services.api_based_extension_service.db")
    def test_calls_query_with_correct_tenant_id(self, mock_db, mock_decrypt):
        """Verifies the DB is queried with the supplied tenant_id."""
        mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.all.return_value = []

        APIBasedExtensionService.get_all_by_tenant_id("tenant-xyz")

        mock_db.session.query.return_value.filter_by.assert_called_once_with(tenant_id="tenant-xyz")


# ---------------------------------------------------------------------------
# Tests: save
# ---------------------------------------------------------------------------


class TestSave:
    """Tests for APIBasedExtensionService.save."""

    @patch("services.api_based_extension_service.encrypt_token", return_value="encrypted-key")
    @patch("services.api_based_extension_service.db")
    @patch.object(APIBasedExtensionService, "_validation")
    def test_save_new_record_encrypts_key_and_commits(self, mock_validation, mock_db, mock_encrypt):
        """Happy path: validation passes, key is encrypted, record is added and committed."""
        ext = _make_extension(id_=None, api_key="plain-key-123")

        result = APIBasedExtensionService.save(ext)

        mock_validation.assert_called_once_with(ext)
        mock_encrypt.assert_called_once_with(ext.tenant_id, "plain-key-123")
        assert ext.api_key == "encrypted-key"
        mock_db.session.add.assert_called_once_with(ext)
        mock_db.session.commit.assert_called_once()
        assert result is ext

    @patch("services.api_based_extension_service.encrypt_token", return_value="encrypted-key")
    @patch("services.api_based_extension_service.db")
    @patch.object(APIBasedExtensionService, "_validation", side_effect=ValueError("name must not be empty"))
    def test_save_raises_when_validation_fails(self, mock_validation, mock_db, mock_encrypt):
        """If _validation raises, save should propagate the error without touching the DB."""
        ext = _make_extension(name="")

        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService.save(ext)

        mock_db.session.add.assert_not_called()
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: delete
# ---------------------------------------------------------------------------


class TestDelete:
    """Tests for APIBasedExtensionService.delete."""

    @patch("services.api_based_extension_service.db")
    def test_delete_removes_record_and_commits(self, mock_db):
        """delete() must call session.delete with the extension and then commit."""
        ext = _make_extension(id_="delete-me")

        APIBasedExtensionService.delete(ext)

        mock_db.session.delete.assert_called_once_with(ext)
        mock_db.session.commit.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: get_with_tenant_id
# ---------------------------------------------------------------------------


class TestGetWithTenantId:
    """Tests for APIBasedExtensionService.get_with_tenant_id."""

    @patch("services.api_based_extension_service.decrypt_token", return_value="decrypted-key")
    @patch("services.api_based_extension_service.db")
    def test_returns_extension_with_decrypted_key(self, mock_db, mock_decrypt):
        """Found extension has its api_key decrypted before being returned."""
        ext = _make_extension(id_="ext-123", api_key="enc-key")

        (mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value) = ext

        result = APIBasedExtensionService.get_with_tenant_id("tenant-001", "ext-123")

        assert result is ext
        assert ext.api_key == "decrypted-key"
        mock_decrypt.assert_called_once_with(ext.tenant_id, "enc-key")

    @patch("services.api_based_extension_service.db")
    def test_raises_value_error_when_not_found(self, mock_db):
        """Raises ValueError when no matching extension exists."""
        (mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value) = None

        with pytest.raises(ValueError, match="API based extension is not found"):
            APIBasedExtensionService.get_with_tenant_id("tenant-001", "non-existent")

    @patch("services.api_based_extension_service.decrypt_token", return_value="decrypted-key")
    @patch("services.api_based_extension_service.db")
    def test_queries_with_correct_tenant_and_extension_id(self, mock_db, mock_decrypt):
        """Verifies both tenant_id and extension id are used in the query."""
        ext = _make_extension(id_="ext-abc")
        chain = mock_db.session.query.return_value
        chain.filter_by.return_value.filter_by.return_value.first.return_value = ext

        APIBasedExtensionService.get_with_tenant_id("tenant-002", "ext-abc")

        # First filter_by call uses tenant_id
        chain.filter_by.assert_called_once_with(tenant_id="tenant-002")
        # Second filter_by call uses id
        chain.filter_by.return_value.filter_by.assert_called_once_with(id="ext-abc")


# ---------------------------------------------------------------------------
# Tests: _validation (new record — id is falsy)
# ---------------------------------------------------------------------------


class TestValidationNewRecord:
    """Tests for _validation() with a brand-new record (no id)."""

    def _build_mock_db(self, name_exists: bool = False):
        mock_db = MagicMock()
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = (
            MagicMock() if name_exists else None
        )
        return mock_db

    @patch.object(APIBasedExtensionService, "_ping_connection")
    @patch("services.api_based_extension_service.db")
    def test_valid_new_extension_passes(self, mock_db, mock_ping):
        """A new record with all valid fields should pass without exceptions."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, name="valid-ext", api_key="longenoughkey")

        # Should not raise
        APIBasedExtensionService._validation(ext)
        mock_ping.assert_called_once_with(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_name_is_empty(self, mock_db):
        """Empty name raises ValueError."""
        ext = _make_extension(id_=None, name="")
        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_name_is_none(self, mock_db):
        """None name raises ValueError."""
        ext = _make_extension(id_=None, name=None)
        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_name_already_exists_for_new_record(self, mock_db):
        """A new record whose name already exists raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = (
            MagicMock()
        )
        ext = _make_extension(id_=None, name="duplicate-name")

        with pytest.raises(ValueError, match="name must be unique, it is already existed"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_endpoint_is_empty(self, mock_db):
        """Empty api_endpoint raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_endpoint="")

        with pytest.raises(ValueError, match="api_endpoint must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_endpoint_is_none(self, mock_db):
        """None api_endpoint raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_endpoint=None)

        with pytest.raises(ValueError, match="api_endpoint must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_key_is_empty(self, mock_db):
        """Empty api_key raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_key="")

        with pytest.raises(ValueError, match="api_key must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_key_is_none(self, mock_db):
        """None api_key raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_key=None)

        with pytest.raises(ValueError, match="api_key must not be empty"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_key_too_short(self, mock_db):
        """api_key shorter than 5 characters raises ValueError."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_key="abc")

        with pytest.raises(ValueError, match="api_key must be at least 5 characters"):
            APIBasedExtensionService._validation(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_api_key_exactly_four_chars(self, mock_db):
        """api_key with exactly 4 characters raises ValueError (boundary condition)."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_key="1234")

        with pytest.raises(ValueError, match="api_key must be at least 5 characters"):
            APIBasedExtensionService._validation(ext)

    @patch.object(APIBasedExtensionService, "_ping_connection")
    @patch("services.api_based_extension_service.db")
    def test_api_key_exactly_five_chars_is_accepted(self, mock_db, mock_ping):
        """api_key with exactly 5 characters should pass (boundary condition)."""
        mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.first.return_value = None
        ext = _make_extension(id_=None, api_key="12345")

        # Should not raise
        APIBasedExtensionService._validation(ext)


# ---------------------------------------------------------------------------
# Tests: _validation (existing record — id is truthy)
# ---------------------------------------------------------------------------


class TestValidationExistingRecord:
    """Tests for _validation() with an existing record (id is set)."""

    @patch.object(APIBasedExtensionService, "_ping_connection")
    @patch("services.api_based_extension_service.db")
    def test_valid_existing_extension_passes(self, mock_db, mock_ping):
        """An existing record whose name is unique (excluding self) should pass."""
        # .where(...).first() → None means no *other* record has that name
        (
            mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.where.return_value.first.return_value
        ) = None
        ext = _make_extension(id_="existing-id", name="unique-name", api_key="longenoughkey")

        # Should not raise
        APIBasedExtensionService._validation(ext)
        mock_ping.assert_called_once_with(ext)

    @patch("services.api_based_extension_service.db")
    def test_raises_if_existing_record_name_conflicts_with_another(self, mock_db):
        """Existing record cannot use a name already owned by a different record."""
        (
            mock_db.session.query.return_value.filter_by.return_value.filter_by.return_value.where.return_value.first.return_value
        ) = MagicMock()
        ext = _make_extension(id_="existing-id", name="taken-name")

        with pytest.raises(ValueError, match="name must be unique, it is already existed"):
            APIBasedExtensionService._validation(ext)


# ---------------------------------------------------------------------------
# Tests: _ping_connection
# ---------------------------------------------------------------------------


class TestPingConnection:
    """Tests for APIBasedExtensionService._ping_connection."""

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_successful_ping_returns_pong(self, mock_requestor_class):
        """When the endpoint returns {"result": "pong"}, no exception is raised."""
        mock_client = MagicMock()
        mock_client.request.return_value = {"result": "pong"}
        mock_requestor_class.return_value = mock_client

        ext = _make_extension(api_endpoint="https://ok.example.com", api_key="secret-key")
        # Should not raise
        APIBasedExtensionService._ping_connection(ext)

        mock_requestor_class.assert_called_once_with(ext.api_endpoint, ext.api_key)

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_wrong_ping_response_raises_value_error(self, mock_requestor_class):
        """When the response is not {"result": "pong"}, a ValueError is raised."""
        mock_client = MagicMock()
        mock_client.request.return_value = {"result": "error"}
        mock_requestor_class.return_value = mock_client

        ext = _make_extension()
        with pytest.raises(ValueError, match="connection error"):
            APIBasedExtensionService._ping_connection(ext)

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_network_exception_wraps_in_value_error(self, mock_requestor_class):
        """Any exception raised during request is wrapped in a ValueError."""
        mock_client = MagicMock()
        mock_client.request.side_effect = ConnectionError("network failure")
        mock_requestor_class.return_value = mock_client

        ext = _make_extension()
        with pytest.raises(ValueError, match="connection error: network failure"):
            APIBasedExtensionService._ping_connection(ext)

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_requestor_constructor_exception_wraps_in_value_error(self, mock_requestor_class):
        """Exception raised by the requestor constructor itself is wrapped."""
        mock_requestor_class.side_effect = RuntimeError("bad config")

        ext = _make_extension()
        with pytest.raises(ValueError, match="connection error: bad config"):
            APIBasedExtensionService._ping_connection(ext)

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_missing_result_key_raises_value_error(self, mock_requestor_class):
        """A response dict without a 'result' key does not equal 'pong' → raises."""
        mock_client = MagicMock()
        mock_client.request.return_value = {}  # no 'result' key
        mock_requestor_class.return_value = mock_client

        ext = _make_extension()
        with pytest.raises(ValueError, match="connection error"):
            APIBasedExtensionService._ping_connection(ext)

    @patch("services.api_based_extension_service.APIBasedExtensionRequestor")
    def test_uses_ping_extension_point(self, mock_requestor_class):
        """The PING extension point is passed to the client.request call."""
        from models.api_based_extension import APIBasedExtensionPoint

        mock_client = MagicMock()
        mock_client.request.return_value = {"result": "pong"}
        mock_requestor_class.return_value = mock_client

        ext = _make_extension()
        APIBasedExtensionService._ping_connection(ext)

        call_kwargs = mock_client.request.call_args
        assert call_kwargs.kwargs["point"] == APIBasedExtensionPoint.PING
        assert call_kwargs.kwargs["params"] == {}
