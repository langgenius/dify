"""
Comprehensive unit tests for TagService.

This test suite provides complete coverage of tag management operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Tag Retrieval (TestTagServiceRetrieval)
Tests tag listing and filtering:
- Get tags with binding counts
- Filter tags by keyword (case-insensitive)
- Get tags by target ID (apps/datasets)
- Get tags by tag name
- Get target IDs by tag IDs
- Empty results handling

### 2. Tag CRUD Operations (TestTagServiceCRUD)
Tests tag creation, update, and deletion:
- Create new tags
- Prevent duplicate tag names
- Update tag names
- Update with duplicate name validation
- Delete tags and cascade delete bindings
- Get tag binding counts
- NotFound error handling

### 3. Tag Binding Operations (TestTagServiceBindings)
Tests tag-to-resource associations:
- Save tag bindings (apps/datasets)
- Prevent duplicate bindings (idempotent)
- Delete tag bindings
- Check target exists validation
- Batch binding operations

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, current_user) are mocked
  for fast, isolated unit tests
- **Factory Pattern**: TagServiceTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, method calls)

## Key Concepts

**Tag Types:**
- knowledge: Tags for datasets/knowledge bases
- app: Tags for applications

**Tag Bindings:**
- Many-to-many relationship between tags and resources
- Each binding links a tag to a specific app or dataset
- Bindings are tenant-scoped for multi-tenancy

**Validation:**
- Tag names must be unique within tenant and type
- Target resources must exist before binding
- Cascade deletion of bindings when tag is deleted
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from werkzeug.exceptions import NotFound

from models.dataset import Dataset
from models.model import App, Tag, TagBinding
from services.tag_service import TagService


class TagServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    tag-related operations.
    """

    @staticmethod
    def create_tag_mock(
        tag_id: str = "tag-123",
        name: str = "Test Tag",
        tag_type: str = "app",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Tag object.

        Args:
            tag_id: Unique identifier for the tag
            name: Tag name
            tag_type: Type of tag ('app' or 'knowledge')
            tenant_id: Tenant identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Tag object with specified attributes
        """
        tag = create_autospec(Tag, instance=True)
        tag.id = tag_id
        tag.name = name
        tag.type = tag_type
        tag.tenant_id = tenant_id
        tag.created_by = kwargs.get("created_by", "user-123")
        tag.created_at = kwargs.get("created_at", datetime.now(UTC))
        for key, value in kwargs.items():
            setattr(tag, key, value)
        return tag

    @staticmethod
    def create_tag_binding_mock(
        binding_id: str = "binding-123",
        tag_id: str = "tag-123",
        target_id: str = "target-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock TagBinding object.

        Args:
            binding_id: Unique identifier for the binding
            tag_id: Associated tag identifier
            target_id: Associated target (app/dataset) identifier
            tenant_id: Tenant identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock TagBinding object with specified attributes
        """
        binding = create_autospec(TagBinding, instance=True)
        binding.id = binding_id
        binding.tag_id = tag_id
        binding.target_id = target_id
        binding.tenant_id = tenant_id
        binding.created_by = kwargs.get("created_by", "user-123")
        for key, value in kwargs.items():
            setattr(binding, key, value)
        return binding

    @staticmethod
    def create_app_mock(app_id: str = "app-123", tenant_id: str = "tenant-123", **kwargs) -> Mock:
        """Create a mock App object."""
        app = create_autospec(App, instance=True)
        app.id = app_id
        app.tenant_id = tenant_id
        app.name = kwargs.get("name", "Test App")
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_dataset_mock(dataset_id: str = "dataset-123", tenant_id: str = "tenant-123", **kwargs) -> Mock:
        """Create a mock Dataset object."""
        dataset = create_autospec(Dataset, instance=True)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.name = kwargs.get("name", "Test Dataset")
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return TagServiceTestDataFactory


class TestTagServiceRetrieval:
    """Test tag retrieval operations."""

    @patch("services.tag_service.db.session")
    def test_get_tags_with_binding_counts(self, mock_db_session, factory):
        """Test retrieving tags with their binding counts."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "app"

        # Mock query results: (tag_id, type, name, binding_count)
        mock_results = [
            ("tag-1", "app", "Frontend", 5),
            ("tag-2", "app", "Backend", 3),
            ("tag-3", "app", "API", 0),
        ]

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = mock_results

        # Act
        results = TagService.get_tags(tag_type=tag_type, current_tenant_id=tenant_id)

        # Assert
        assert len(results) == 3
        assert results[0] == ("tag-1", "app", "Frontend", 5)
        assert results[1] == ("tag-2", "app", "Backend", 3)
        assert results[2] == ("tag-3", "app", "API", 0)
        mock_db_session.query.assert_called_once()

    @patch("services.tag_service.db.session")
    def test_get_tags_with_keyword_filter(self, mock_db_session, factory):
        """Test retrieving tags filtered by keyword (case-insensitive)."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "knowledge"
        keyword = "data"

        mock_results = [
            ("tag-1", "knowledge", "Database", 2),
            ("tag-2", "knowledge", "Data Science", 4),
        ]

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = mock_results

        # Act
        results = TagService.get_tags(tag_type=tag_type, current_tenant_id=tenant_id, keyword=keyword)

        # Assert
        assert len(results) == 2
        # Verify keyword filter was applied
        assert mock_query.where.call_count >= 2  # Initial where + keyword where

    @patch("services.tag_service.db.session")
    def test_get_target_ids_by_tag_ids(self, mock_db_session, factory):
        """Test retrieving target IDs by tag IDs."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "app"
        tag_ids = ["tag-1", "tag-2"]

        tags = [
            factory.create_tag_mock(tag_id="tag-1", tenant_id=tenant_id, tag_type=tag_type),
            factory.create_tag_mock(tag_id="tag-2", tenant_id=tenant_id, tag_type=tag_type),
        ]

        target_ids = ["app-1", "app-2", "app-3"]

        # Mock tag query
        mock_scalars_tags = MagicMock()
        mock_scalars_tags.all.return_value = tags

        # Mock binding query
        mock_scalars_bindings = MagicMock()
        mock_scalars_bindings.all.return_value = target_ids

        mock_db_session.scalars.side_effect = [mock_scalars_tags, mock_scalars_bindings]

        # Act
        results = TagService.get_target_ids_by_tag_ids(tag_type=tag_type, current_tenant_id=tenant_id, tag_ids=tag_ids)

        # Assert
        assert results == target_ids
        assert mock_db_session.scalars.call_count == 2

    @patch("services.tag_service.db.session")
    def test_get_target_ids_with_empty_tag_ids(self, mock_db_session, factory):
        """Test that empty tag_ids returns empty list."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "app"

        # Act
        results = TagService.get_target_ids_by_tag_ids(tag_type=tag_type, current_tenant_id=tenant_id, tag_ids=[])

        # Assert
        assert results == []
        mock_db_session.scalars.assert_not_called()

    @patch("services.tag_service.db.session")
    def test_get_tag_by_tag_name(self, mock_db_session, factory):
        """Test retrieving tags by name."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "app"
        tag_name = "Production"

        tags = [factory.create_tag_mock(name=tag_name, tag_type=tag_type, tenant_id=tenant_id)]

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = tags
        mock_db_session.scalars.return_value = mock_scalars

        # Act
        results = TagService.get_tag_by_tag_name(tag_type=tag_type, current_tenant_id=tenant_id, tag_name=tag_name)

        # Assert
        assert len(results) == 1
        assert results[0].name == tag_name

    @patch("services.tag_service.db.session")
    def test_get_tag_by_tag_name_returns_empty_for_missing_params(self, mock_db_session, factory):
        """Test that missing tag_type or tag_name returns empty list."""
        # Arrange
        tenant_id = "tenant-123"

        # Act & Assert
        assert TagService.get_tag_by_tag_name("", tenant_id, "name") == []
        assert TagService.get_tag_by_tag_name("app", tenant_id, "") == []
        mock_db_session.scalars.assert_not_called()

    @patch("services.tag_service.db.session")
    def test_get_tags_by_target_id(self, mock_db_session, factory):
        """Test retrieving tags associated with a specific target."""
        # Arrange
        tenant_id = "tenant-123"
        tag_type = "app"
        target_id = "app-123"

        tags = [
            factory.create_tag_mock(tag_id="tag-1", name="Frontend"),
            factory.create_tag_mock(tag_id="tag-2", name="Production"),
        ]

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = tags

        # Act
        results = TagService.get_tags_by_target_id(tag_type=tag_type, current_tenant_id=tenant_id, target_id=target_id)

        # Assert
        assert len(results) == 2
        assert results[0].name == "Frontend"
        assert results[1].name == "Production"


class TestTagServiceCRUD:
    """Test tag CRUD operations."""

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    @patch("services.tag_service.uuid.uuid4")
    def test_save_tags(self, mock_uuid, mock_db_session, mock_get_tag_by_name, mock_current_user, factory):
        """Test creating a new tag."""
        # Arrange
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"
        mock_uuid.return_value = "new-tag-id"
        mock_get_tag_by_name.return_value = []  # No existing tag

        args = {"name": "New Tag", "type": "app"}

        # Act
        result = TagService.save_tags(args)

        # Assert
        mock_db_session.add.assert_called_once()
        mock_db_session.commit.assert_called_once()
        added_tag = mock_db_session.add.call_args[0][0]
        assert added_tag.name == "New Tag"
        assert added_tag.type == "app"
        assert added_tag.created_by == "user-123"
        assert added_tag.tenant_id == "tenant-123"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    def test_save_tags_raises_error_for_duplicate_name(self, mock_get_tag_by_name, mock_current_user, factory):
        """Test that creating a tag with duplicate name raises ValueError."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"
        existing_tag = factory.create_tag_mock(name="Existing Tag")
        mock_get_tag_by_name.return_value = [existing_tag]

        args = {"name": "Existing Tag", "type": "app"}

        # Act & Assert
        with pytest.raises(ValueError, match="Tag name already exists"):
            TagService.save_tags(args)

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    def test_update_tags(self, mock_db_session, mock_get_tag_by_name, mock_current_user, factory):
        """Test updating a tag name."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"
        mock_get_tag_by_name.return_value = []  # No duplicate

        tag = factory.create_tag_mock(tag_id="tag-123", name="Old Name")
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = tag

        args = {"name": "New Name", "type": "app"}

        # Act
        result = TagService.update_tags(args, tag_id="tag-123")

        # Assert
        assert tag.name == "New Name"
        mock_db_session.commit.assert_called_once()

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    def test_update_tags_raises_error_for_duplicate_name(
        self, mock_db_session, mock_get_tag_by_name, mock_current_user, factory
    ):
        """Test that updating to a duplicate name raises ValueError."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"
        existing_tag = factory.create_tag_mock(name="Duplicate Name")
        mock_get_tag_by_name.return_value = [existing_tag]

        args = {"name": "Duplicate Name", "type": "app"}

        # Act & Assert
        with pytest.raises(ValueError, match="Tag name already exists"):
            TagService.update_tags(args, tag_id="tag-123")

    @patch("services.tag_service.db.session")
    def test_update_tags_raises_not_found_for_missing_tag(self, mock_db_session, factory):
        """Test that updating a non-existent tag raises NotFound."""
        # Arrange
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with patch("services.tag_service.TagService.get_tag_by_tag_name", return_value=[]):
            with patch("services.tag_service.current_user") as mock_user:
                mock_user.current_tenant_id = "tenant-123"
                args = {"name": "New Name", "type": "app"}

                # Act & Assert
                with pytest.raises(NotFound, match="Tag not found"):
                    TagService.update_tags(args, tag_id="nonexistent")

    @patch("services.tag_service.db.session")
    def test_get_tag_binding_count(self, mock_db_session, factory):
        """Test getting the count of bindings for a tag."""
        # Arrange
        tag_id = "tag-123"
        expected_count = 5

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.count.return_value = expected_count

        # Act
        result = TagService.get_tag_binding_count(tag_id)

        # Assert
        assert result == expected_count

    @patch("services.tag_service.db.session")
    def test_delete_tag(self, mock_db_session, factory):
        """Test deleting a tag and its bindings."""
        # Arrange
        tag_id = "tag-123"
        tag = factory.create_tag_mock(tag_id=tag_id)
        bindings = [factory.create_tag_binding_mock(binding_id=f"binding-{i}", tag_id=tag_id) for i in range(3)]

        # Mock tag query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = tag

        # Mock bindings query
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = bindings
        mock_db_session.scalars.return_value = mock_scalars

        # Act
        TagService.delete_tag(tag_id)

        # Assert
        mock_db_session.delete.assert_called()
        assert mock_db_session.delete.call_count == 4  # 1 tag + 3 bindings
        mock_db_session.commit.assert_called_once()

    @patch("services.tag_service.db.session")
    def test_delete_tag_raises_not_found(self, mock_db_session, factory):
        """Test that deleting a non-existent tag raises NotFound."""
        # Arrange
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        with pytest.raises(NotFound, match="Tag not found"):
            TagService.delete_tag("nonexistent")


class TestTagServiceBindings:
    """Test tag binding operations."""

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_save_tag_binding(self, mock_db_session, mock_check_target, mock_current_user, factory):
        """Test creating tag bindings."""
        # Arrange
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock no existing bindings
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        args = {"type": "app", "target_id": "app-123", "tag_ids": ["tag-1", "tag-2"]}

        # Act
        TagService.save_tag_binding(args)

        # Assert
        mock_check_target.assert_called_once_with("app", "app-123")
        assert mock_db_session.add.call_count == 2  # 2 bindings
        mock_db_session.commit.assert_called_once()

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_save_tag_binding_is_idempotent(self, mock_db_session, mock_check_target, mock_current_user, factory):
        """Test that saving duplicate bindings is idempotent."""
        # Arrange
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock existing binding
        existing_binding = factory.create_tag_binding_mock()
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = existing_binding

        args = {"type": "app", "target_id": "app-123", "tag_ids": ["tag-1"]}

        # Act
        TagService.save_tag_binding(args)

        # Assert
        mock_db_session.add.assert_not_called()  # No new binding added

    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_delete_tag_binding(self, mock_db_session, mock_check_target, factory):
        """Test deleting a tag binding."""
        # Arrange
        binding = factory.create_tag_binding_mock()
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = binding

        args = {"type": "app", "target_id": "app-123", "tag_id": "tag-1"}

        # Act
        TagService.delete_tag_binding(args)

        # Assert
        mock_check_target.assert_called_once_with("app", "app-123")
        mock_db_session.delete.assert_called_once_with(binding)
        mock_db_session.commit.assert_called_once()

    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_delete_tag_binding_does_nothing_if_not_exists(self, mock_db_session, mock_check_target, factory):
        """Test that deleting a non-existent binding is a no-op."""
        # Arrange
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        args = {"type": "app", "target_id": "app-123", "tag_id": "tag-1"}

        # Act
        TagService.delete_tag_binding(args)

        # Assert
        mock_db_session.delete.assert_not_called()
        mock_db_session.commit.assert_not_called()

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_for_dataset(self, mock_db_session, mock_current_user, factory):
        """Test validating that a dataset target exists."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"
        dataset = factory.create_dataset_mock()

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = dataset

        # Act
        TagService.check_target_exists("knowledge", "dataset-123")

        # Assert - no exception raised
        mock_db_session.query.assert_called_once()

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_for_app(self, mock_db_session, mock_current_user, factory):
        """Test validating that an app target exists."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"
        app = factory.create_app_mock()

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = app

        # Act
        TagService.check_target_exists("app", "app-123")

        # Assert - no exception raised
        mock_db_session.query.assert_called_once()

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_raises_not_found_for_missing_dataset(
        self, mock_db_session, mock_current_user, factory
    ):
        """Test that missing dataset raises NotFound."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        with pytest.raises(NotFound, match="Dataset not found"):
            TagService.check_target_exists("knowledge", "nonexistent")

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_raises_not_found_for_missing_app(self, mock_db_session, mock_current_user, factory):
        """Test that missing app raises NotFound."""
        # Arrange
        mock_current_user.current_tenant_id = "tenant-123"

        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        with pytest.raises(NotFound, match="App not found"):
            TagService.check_target_exists("app", "nonexistent")

    def test_check_target_exists_raises_not_found_for_invalid_type(self, factory):
        """Test that invalid binding type raises NotFound."""
        # Act & Assert
        with pytest.raises(NotFound, match="Invalid binding type"):
            TagService.check_target_exists("invalid_type", "target-123")
