"""Unit tests for services.api_based_extension_service."""

from unittest.mock import MagicMock, patch

import pytest

from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService


@pytest.fixture
def extension_data() -> APIBasedExtension:
    """Create a mutable extension object for service tests."""
    extension = APIBasedExtension(
        tenant_id="tenant-1",
        name="My Extension",
        api_endpoint="https://example.com/api",
        api_key="plain-key",
    )
    # Keep empty id by default so validation follows the "new extension" branch.
    extension.id = ""
    return extension


class TestAPIBasedExtensionService:
    """Test suite for APIBasedExtensionService."""

    def test_get_all_by_tenant_id_should_return_decrypted_extensions(self) -> None:
        """Test extension list is decrypted before returning."""
        # Arrange
        extension1 = APIBasedExtension(
            tenant_id="tenant-1",
            name="Extension 1",
            api_endpoint="https://example.com/1",
            api_key="enc-1",
        )
        extension2 = APIBasedExtension(
            tenant_id="tenant-1",
            name="Extension 2",
            api_endpoint="https://example.com/2",
            api_key="enc-2",
        )

        with (
            patch("services.api_based_extension_service.db") as mock_db,
            patch("services.api_based_extension_service.decrypt_token") as mock_decrypt,
        ):
            query = MagicMock()
            query.filter_by.return_value = query
            query.order_by.return_value = query
            query.all.return_value = [extension1, extension2]
            mock_db.session.query.return_value = query
            mock_decrypt.side_effect = ["plain-1", "plain-2"]

            # Act
            result = APIBasedExtensionService.get_all_by_tenant_id("tenant-1")

            # Assert
            assert result == [extension1, extension2]
            assert extension1.api_key == "plain-1"
            assert extension2.api_key == "plain-2"

    def test_save_should_validate_encrypt_and_persist(self, extension_data: APIBasedExtension) -> None:
        """Test save validates input, encrypts api key, and commits."""
        # Arrange
        with (
            patch.object(APIBasedExtensionService, "_validation") as mock_validation,
            patch("services.api_based_extension_service.encrypt_token", return_value="enc-key") as mock_encrypt,
            patch("services.api_based_extension_service.db") as mock_db,
        ):
            # Act
            result = APIBasedExtensionService.save(extension_data)

            # Assert
            assert result is extension_data
            assert extension_data.api_key == "enc-key"
            mock_validation.assert_called_once_with(extension_data)
            mock_encrypt.assert_called_once_with("tenant-1", "plain-key")
            mock_db.session.add.assert_called_once_with(extension_data)
            mock_db.session.commit.assert_called_once()

    def test_delete_should_remove_extension_and_commit(self, extension_data: APIBasedExtension) -> None:
        """Test delete removes extension and commits transaction."""
        # Arrange
        with patch("services.api_based_extension_service.db") as mock_db:
            # Act
            APIBasedExtensionService.delete(extension_data)

            # Assert
            mock_db.session.delete.assert_called_once_with(extension_data)
            mock_db.session.commit.assert_called_once()

    def test_get_with_tenant_id_should_raise_when_not_found(self) -> None:
        """Test get_with_tenant_id raises when extension does not exist."""
        # Arrange
        with patch("services.api_based_extension_service.db") as mock_db:
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="not found"):
                APIBasedExtensionService.get_with_tenant_id("tenant-1", "ext-1")

    def test_get_with_tenant_id_should_return_decrypted_extension(self) -> None:
        """Test get_with_tenant_id decrypts and returns extension."""
        # Arrange
        extension = APIBasedExtension(
            tenant_id="tenant-1",
            name="Extension",
            api_endpoint="https://example.com",
            api_key="enc-key",
        )

        with (
            patch("services.api_based_extension_service.db") as mock_db,
            patch("services.api_based_extension_service.decrypt_token", return_value="plain-key") as mock_decrypt,
        ):
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = extension
            mock_db.session.query.return_value = query

            # Act
            result = APIBasedExtensionService.get_with_tenant_id("tenant-1", "ext-1")

            # Assert
            assert result is extension
            assert result.api_key == "plain-key"
            mock_decrypt.assert_called_once_with("tenant-1", "enc-key")

    def test_validation_should_raise_when_name_empty(self, extension_data: APIBasedExtension) -> None:
        """Test validation rejects empty name."""
        # Arrange
        extension_data.name = ""

        # Act & Assert
        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService._validation(extension_data)

    def test_validation_should_raise_when_new_name_is_duplicated(self, extension_data: APIBasedExtension) -> None:
        """Test validation rejects duplicated name for new extension."""
        # Arrange
        extension_data.id = ""

        with patch("services.api_based_extension_service.db") as mock_db:
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = object()
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="already existed"):
                APIBasedExtensionService._validation(extension_data)

    def test_validation_should_raise_when_existing_name_is_duplicated(self, extension_data: APIBasedExtension) -> None:
        """Test validation rejects duplicated name for existing extension."""
        # Arrange
        extension_data.id = "ext-1"

        with patch("services.api_based_extension_service.db") as mock_db:
            query = MagicMock()
            query.filter_by.return_value = query
            query.where.return_value = query
            query.first.return_value = object()
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="already existed"):
                APIBasedExtensionService._validation(extension_data)

    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("api_endpoint", "", "api_endpoint must not be empty"),
            ("api_key", "", "api_key must not be empty"),
        ],
    )
    def test_validation_should_raise_when_required_field_missing(
        self,
        extension_data: APIBasedExtension,
        field: str,
        value: str,
        message: str,
    ) -> None:
        """Test validation rejects missing required fields."""
        # Arrange
        setattr(extension_data, field, value)

        with patch("services.api_based_extension_service.db") as mock_db:
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match=message):
                APIBasedExtensionService._validation(extension_data)

    def test_validation_should_raise_when_api_key_too_short(self, extension_data: APIBasedExtension) -> None:
        """Test validation rejects short api keys."""
        # Arrange
        extension_data.api_key = "1234"

        with patch("services.api_based_extension_service.db") as mock_db:
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="at least 5"):
                APIBasedExtensionService._validation(extension_data)

    def test_validation_should_call_ping_when_data_is_valid(self, extension_data: APIBasedExtension) -> None:
        """Test validation delegates endpoint verification for valid payloads."""
        # Arrange
        with (
            patch("services.api_based_extension_service.db") as mock_db,
            patch.object(APIBasedExtensionService, "_ping_connection") as mock_ping,
        ):
            query = MagicMock()
            query.filter_by.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act
            APIBasedExtensionService._validation(extension_data)

            # Assert
            mock_ping.assert_called_once_with(extension_data)

    def test_ping_connection_should_succeed_on_pong_response(self, extension_data: APIBasedExtension) -> None:
        """Test ping connection succeeds when endpoint returns pong."""
        # Arrange
        with patch("services.api_based_extension_service.APIBasedExtensionRequestor") as mock_requestor:
            client = mock_requestor.return_value
            client.request.return_value = {"result": "pong"}

            # Act
            APIBasedExtensionService._ping_connection(extension_data)

            # Assert
            client.request.assert_called_once()

    def test_ping_connection_should_raise_when_response_not_pong(self, extension_data: APIBasedExtension) -> None:
        """Test ping connection wraps non-pong responses into connection error."""
        # Arrange
        with patch("services.api_based_extension_service.APIBasedExtensionRequestor") as mock_requestor:
            client = mock_requestor.return_value
            client.request.return_value = {"result": "unexpected"}

            # Act & Assert
            with pytest.raises(ValueError, match="connection error"):
                APIBasedExtensionService._ping_connection(extension_data)

    def test_ping_connection_should_raise_when_requestor_errors(self, extension_data: APIBasedExtension) -> None:
        """Test ping connection wraps request exceptions."""
        # Arrange
        with patch("services.api_based_extension_service.APIBasedExtensionRequestor") as mock_requestor:
            mock_requestor.side_effect = RuntimeError("network down")

            # Act & Assert
            with pytest.raises(ValueError, match="connection error"):
                APIBasedExtensionService._ping_connection(extension_data)
