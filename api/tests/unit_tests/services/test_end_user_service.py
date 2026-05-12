from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, DefaultEndUserSessionID, EndUser
from services.end_user_service import EndUserService

TEST_TENANT_ID = "test_tenant"
TEST_APP_ID = "test_app"
TEST_USER_SESSION = "test_user"
TEST_END_USER_ID = "123"
TEST_INVALID_USER_ID = "xxx"


class TestEndUserServiceFactory:
    """Factory class for creating mock objects for EndUserService unit tests."""

    @staticmethod
    def create_app_mock(tenant_id: str = TEST_TENANT_ID, app_id: str = TEST_APP_ID) -> MagicMock:
        """Create a mock App instance."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        return app

    @staticmethod
    def create_end_user_mock(
        user_id: str = TEST_END_USER_ID,
        tenant_id: str = TEST_TENANT_ID,
        app_id: str = TEST_APP_ID,
        session_id: str = TEST_USER_SESSION,
        invoke_from: InvokeFrom = InvokeFrom.WEB_APP,
    ) -> EndUser:
        """Create a real EndUser mock instance with correct attributes."""
        end_user = EndUser()
        end_user.id = user_id
        end_user.tenant_id = tenant_id
        end_user.app_id = app_id
        end_user.session_id = session_id
        end_user.type = invoke_from
        return end_user


class TestEndUserServiceGetById:
    """
    Unit tests for EndUserService.get_end_user_by_id method.

    This test suite covers:
    - Successful retrieval of an existing end user by ID
    - Handling of non-existent end user ID
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_end_user_by_id_success(self, mock_sessionmaker, mock_db, factory):
        """Test get_end_user_by_id returns existing user successfully."""
        # Arrange
        mock_db.session.scalar.return_value = factory.create_end_user_mock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_end_user_by_id(
            tenant_id=TEST_TENANT_ID, app_id=TEST_APP_ID, end_user_id=TEST_END_USER_ID
        )

        # Assert
        assert result is not None
        assert result.id == TEST_END_USER_ID
        mock_db.session.scalar.assert_called_once()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_end_user_by_id_not_found(self, mock_sessionmaker, mock_db):
        """Test get_end_user_by_id returns None when user does not exist."""
        # Arrange
        mock_db.session.scalar.return_value = None
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_end_user_by_id(
            tenant_id=TEST_TENANT_ID, app_id=TEST_APP_ID, end_user_id=TEST_INVALID_USER_ID
        )

        # Assert
        assert result is None
        mock_db.session.scalar.assert_called_once()


class TestEndUserServiceGetOrCreate:
    """
    Unit tests for EndUserService.get_or_create_end_user method.

    This test suite covers:
    - Creation of a new end user when one does not exist
    - Handling of None session ID by using default anonymous session ID
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_or_create_end_user_create(self, mock_sessionmaker, mock_db, factory):
        """Test get_or_create_end_user creates new user when not exists."""
        # Arrange
        mock_db.session.scalar.return_value = None
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_or_create_end_user(factory.create_app_mock(), TEST_USER_SESSION)

        # Assert
        assert result is not None
        assert result.tenant_id == TEST_TENANT_ID
        mock_db.session.add.assert_called_once()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_or_create_end_user_anonymous(self, mock_sessionmaker, mock_db, factory):
        """Test get_or_create_end_user uses default anonymous session ID for None session."""
        # Arrange
        mock_db.session.scalar.return_value = None
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_or_create_end_user(factory.create_app_mock(), None)

        # Assert
        assert result.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        mock_db.session.add.assert_called_once()


class TestEndUserServiceGetOrCreateByType:
    """
    Unit tests for EndUserService.get_or_create_end_user_by_type method.

    This test suite covers:
    - Retrieval of existing end user with matching type
    - Updating of end user type when session matches but type differs
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_or_create_end_user_by_type_get(self, mock_sessionmaker, mock_db, factory):
        """Test get_or_create_end_user_by_type returns existing user with matching type."""
        # Arrange
        mock_db.session.scalar.return_value = factory.create_end_user_mock(invoke_from=InvokeFrom.WEB_APP)
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            InvokeFrom.WEB_APP, TEST_TENANT_ID, TEST_APP_ID, TEST_USER_SESSION
        )

        # Assert
        assert result is not None
        assert result.type == InvokeFrom.WEB_APP

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_get_or_create_end_user_by_type_update(self, mock_sessionmaker, mock_db, factory):
        """Test get_or_create_end_user_by_type updates user type when session matches."""
        # Arrange
        mock_db.session.scalar.return_value = factory.create_end_user_mock(invoke_from=InvokeFrom.SERVICE_API)
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            InvokeFrom.WEB_APP, TEST_TENANT_ID, TEST_APP_ID, TEST_USER_SESSION
        )

        # Assert
        assert result.type == InvokeFrom.WEB_APP


class TestEndUserServiceCreateBatch:
    """
    Unit tests for EndUserService.create_end_user_batch method.

    This test suite covers:
    - Creation of multiple end users in batch
    - Handling of empty user ID list
    - Deduplication of duplicate user IDs
    - Use of default session ID for None session
    - Handling of existing users and population of result correctly
    - Handling of all users existing with missing_app_ids None/empty
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_normal(self, mock_sessionmaker, mock_db):
        """Test create_end_user_batch creates distinct users successfully."""
        # Arrange
        user_ids = ["a1", "a2"]
        mock_db.session.scalars.return_value.all.return_value = []
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(
            InvokeFrom.SERVICE_API, TEST_TENANT_ID, user_ids, TEST_USER_SESSION
        )

        # Assert
        assert len(result) == 2
        mock_db.session.add_all.assert_called_once()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_empty(self, mock_sessionmaker, mock_db):
        """Test create_end_user_batch returns empty dict for empty user ID list."""
        # Arrange
        mock_db.session.scalars.return_value.all.return_value = []
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(InvokeFrom.SERVICE_API, TEST_TENANT_ID, [], TEST_USER_SESSION)

        # Assert
        assert result == {}
        mock_db.session.add_all.assert_not_called()

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_duplicate(self, mock_sessionmaker, mock_db):
        """Test create_end_user_batch deduplicates duplicate user IDs."""
        # Arrange
        user_ids = ["a1", "a1", "a2"]
        mock_db.session.scalars.return_value.all.return_value = []
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(
            InvokeFrom.SERVICE_API, TEST_TENANT_ID, user_ids, TEST_USER_SESSION
        )

        # Assert
        assert len(result) == 2

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_anonymous(self, mock_sessionmaker, mock_db):
        """Test create_end_user_batch uses default session ID for None session."""
        # Arrange
        user_ids = ["a1"]
        mock_db.session.scalars.return_value.all.return_value = []
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(InvokeFrom.SERVICE_API, TEST_TENANT_ID, user_ids, None)

        # Assert
        assert result["a1"].session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_existing_users(self, mock_sessionmaker, mock_db, factory):
        """Test create_end_user_batch handles existing users and populates result correctly (coverage fix)."""
        # Arrange: mock existing users to cover the missing code branch
        existing_user = factory.create_end_user_mock(user_id="a1", app_id="a1")
        mock_db.session.scalars.return_value.all.return_value = [existing_user, existing_user]
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(
            InvokeFrom.SERVICE_API, TEST_TENANT_ID, ["a1", "a2"], TEST_USER_SESSION
        )

        # Assert
        assert result["a1"] == existing_user
        assert "a2" in result

    @patch("services.end_user_service.db")
    @patch("services.end_user_service.sessionmaker")
    def test_create_end_user_batch_all_existing_missing_none(self, mock_sessionmaker, mock_db, factory):
        """Test create_end_user_batch with all users existing (missing_app_ids is None/empty, full coverage)."""
        # Arrange
        existing_users = [
            factory.create_end_user_mock(user_id="a1", app_id="a1"),
            factory.create_end_user_mock(user_id="a2", app_id="a2"),
        ]
        mock_db.session.scalars.return_value.all.return_value = existing_users
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_db.session

        # Act
        result = EndUserService.create_end_user_batch(
            InvokeFrom.SERVICE_API, TEST_TENANT_ID, ["a1", "a2"], TEST_USER_SESSION
        )

        # Assert
        assert len(result) == 2
        assert result["a1"] == existing_users[0]
        assert result["a2"] == existing_users[1]
        mock_db.session.add_all.assert_not_called()
