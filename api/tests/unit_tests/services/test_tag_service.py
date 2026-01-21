"""
Comprehensive unit tests for TagService.

This test suite provides complete coverage of tag management operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

The TagService is responsible for managing tags that can be associated with
datasets (knowledge bases) and applications. Tags enable users to organize,
categorize, and filter their content effectively.

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


# ============================================================================
# IMPORTS
# ============================================================================

from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from werkzeug.exceptions import NotFound

from models.dataset import Dataset
from models.model import App, Tag, TagBinding
from services.tag_service import TagService

# ============================================================================
# TEST DATA FACTORY
# ============================================================================


class TagServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    tag-related operations. This factory ensures all test data follows the
    same structure and reduces code duplication across tests.

    The factory pattern is used here to:
    - Ensure consistent test data creation
    - Reduce boilerplate code in individual tests
    - Make tests more maintainable and readable
    - Centralize mock object configuration
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

        This method creates a mock Tag instance with all required attributes
        set to sensible defaults. Additional attributes can be passed via
        kwargs to customize the mock for specific test scenarios.

        Args:
            tag_id: Unique identifier for the tag
            name: Tag name (e.g., "Frontend", "Backend", "Data Science")
            tag_type: Type of tag ('app' or 'knowledge')
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock
                (e.g., created_by, created_at, etc.)

        Returns:
            Mock Tag object with specified attributes

        Example:
            >>> tag = factory.create_tag_mock(
            ...     tag_id="tag-456",
            ...     name="Machine Learning",
            ...     tag_type="knowledge"
            ... )
        """
        # Create a mock that matches the Tag model interface
        tag = create_autospec(Tag, instance=True)

        # Set core attributes
        tag.id = tag_id
        tag.name = name
        tag.type = tag_type
        tag.tenant_id = tenant_id

        # Set default optional attributes
        tag.created_by = kwargs.pop("created_by", "user-123")
        tag.created_at = kwargs.pop("created_at", datetime(2023, 1, 1, 0, 0, 0, tzinfo=UTC))

        # Apply any additional attributes from kwargs
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

        TagBindings represent the many-to-many relationship between tags
        and resources (datasets or apps). This method creates a mock
        binding with the necessary attributes.

        Args:
            binding_id: Unique identifier for the binding
            tag_id: Associated tag identifier
            target_id: Associated target (app/dataset) identifier
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock
                (e.g., created_by, etc.)

        Returns:
            Mock TagBinding object with specified attributes

        Example:
            >>> binding = factory.create_tag_binding_mock(
            ...     tag_id="tag-456",
            ...     target_id="dataset-789",
            ...     tenant_id="tenant-123"
            ... )
        """
        # Create a mock that matches the TagBinding model interface
        binding = create_autospec(TagBinding, instance=True)

        # Set core attributes
        binding.id = binding_id
        binding.tag_id = tag_id
        binding.target_id = target_id
        binding.tenant_id = tenant_id

        # Set default optional attributes
        binding.created_by = kwargs.pop("created_by", "user-123")

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(binding, key, value)

        return binding

    @staticmethod
    def create_app_mock(app_id: str = "app-123", tenant_id: str = "tenant-123", **kwargs) -> Mock:
        """
        Create a mock App object.

        This method creates a mock App instance for testing tag bindings
        to applications. Apps are one of the two target types that tags
        can be bound to (the other being datasets/knowledge bases).

        Args:
            app_id: Unique identifier for the app
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock App object with specified attributes

        Example:
            >>> app = factory.create_app_mock(
            ...     app_id="app-456",
            ...     name="My Chat App"
            ... )
        """
        # Create a mock that matches the App model interface
        app = create_autospec(App, instance=True)

        # Set core attributes
        app.id = app_id
        app.tenant_id = tenant_id
        app.name = kwargs.get("name", "Test App")

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(app, key, value)

        return app

    @staticmethod
    def create_dataset_mock(dataset_id: str = "dataset-123", tenant_id: str = "tenant-123", **kwargs) -> Mock:
        """
        Create a mock Dataset object.

        This method creates a mock Dataset instance for testing tag bindings
        to knowledge bases. Datasets (knowledge bases) are one of the two
        target types that tags can be bound to (the other being apps).

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Dataset object with specified attributes

        Example:
            >>> dataset = factory.create_dataset_mock(
            ...     dataset_id="dataset-456",
            ...     name="My Knowledge Base"
            ... )
        """
        # Create a mock that matches the Dataset model interface
        dataset = create_autospec(Dataset, instance=True)

        # Set core attributes
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.name = kwargs.pop("name", "Test Dataset")

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(dataset, key, value)

        return dataset


# ============================================================================
# PYTEST FIXTURES
# ============================================================================


@pytest.fixture
def factory():
    """
    Provide the test data factory to all tests.

    This fixture makes the TagServiceTestDataFactory available to all test
    methods, allowing them to create consistent mock objects easily.

    Returns:
        TagServiceTestDataFactory class
    """
    return TagServiceTestDataFactory


# ============================================================================
# TAG RETRIEVAL TESTS
# ============================================================================


class TestTagServiceRetrieval:
    """
    Test tag retrieval operations.

    This test class covers all methods related to retrieving and querying
    tags from the system. These operations are read-only and do not modify
    the database state.

    Methods tested:
    - get_tags: Retrieve tags with optional keyword filtering
    - get_target_ids_by_tag_ids: Get target IDs (datasets/apps) by tag IDs
    - get_tag_by_tag_name: Find tags by exact name match
    - get_tags_by_target_id: Get all tags bound to a specific target
    """

    @patch("services.tag_service.db.session")
    def test_get_tags_with_binding_counts(self, mock_db_session, factory):
        """
        Test retrieving tags with their binding counts.

        This test verifies that the get_tags method correctly retrieves
        a list of tags along with the count of how many resources
        (datasets/apps) are bound to each tag.

        The method should:
        - Query tags filtered by type and tenant
        - Include binding counts via a LEFT OUTER JOIN
        - Return results ordered by creation date (newest first)

        Expected behavior:
        - Returns a list of tuples containing (id, type, name, binding_count)
        - Each tag includes its binding count
        - Results are ordered by creation date descending
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"
        tag_type = "app"

        # Mock query results: tuples of (tag_id, type, name, binding_count)
        # This simulates the SQL query result with aggregated binding counts
        mock_results = [
            ("tag-1", "app", "Frontend", 5),  # Frontend tag with 5 bindings
            ("tag-2", "app", "Backend", 3),  # Backend tag with 3 bindings
            ("tag-3", "app", "API", 0),  # API tag with no bindings
        ]

        # Configure mock database session and query chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query  # LEFT OUTER JOIN with TagBinding
        mock_query.where.return_value = mock_query  # WHERE clause for filtering
        mock_query.group_by.return_value = mock_query  # GROUP BY for aggregation
        mock_query.order_by.return_value = mock_query  # ORDER BY for sorting
        mock_query.all.return_value = mock_results  # Final result

        # Act
        # Execute the method under test
        results = TagService.get_tags(tag_type=tag_type, current_tenant_id=tenant_id)

        # Assert
        # Verify the results match expectations
        assert len(results) == 3, "Should return 3 tags"

        # Verify each tag's data structure
        assert results[0] == ("tag-1", "app", "Frontend", 5), "First tag should match"
        assert results[1] == ("tag-2", "app", "Backend", 3), "Second tag should match"
        assert results[2] == ("tag-3", "app", "API", 0), "Third tag should match"

        # Verify database query was called
        mock_db_session.query.assert_called_once()

    @patch("services.tag_service.db.session")
    def test_get_tags_with_keyword_filter(self, mock_db_session, factory):
        """
        Test retrieving tags filtered by keyword (case-insensitive).

        This test verifies that the get_tags method correctly filters tags
        by keyword when a keyword parameter is provided. The filtering
        should be case-insensitive and support partial matches.

        The method should:
        - Apply an additional WHERE clause when keyword is provided
        - Use ILIKE for case-insensitive pattern matching
        - Support partial matches (e.g., "data" matches "Database" and "Data Science")

        Expected behavior:
        - Returns only tags whose names contain the keyword
        - Matching is case-insensitive
        - Partial matches are supported
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"
        tag_type = "knowledge"
        keyword = "data"

        # Mock query results filtered by keyword
        mock_results = [
            ("tag-1", "knowledge", "Database", 2),
            ("tag-2", "knowledge", "Data Science", 4),
        ]

        # Configure mock database session and query chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = mock_results

        # Act
        # Execute the method with keyword filter
        results = TagService.get_tags(tag_type=tag_type, current_tenant_id=tenant_id, keyword=keyword)

        # Assert
        # Verify filtered results
        assert len(results) == 2, "Should return 2 matching tags"

        # Verify keyword filter was applied
        # The where() method should be called at least twice:
        # 1. Initial WHERE clause for type and tenant
        # 2. Additional WHERE clause for keyword filtering
        assert mock_query.where.call_count >= 2, "Keyword filter should add WHERE clause"

    @patch("services.tag_service.db.session")
    def test_get_target_ids_by_tag_ids(self, mock_db_session, factory):
        """
        Test retrieving target IDs by tag IDs.

        This test verifies that the get_target_ids_by_tag_ids method correctly
        retrieves all target IDs (dataset/app IDs) that are bound to the
        specified tags. This is useful for filtering datasets or apps by tags.

        The method should:
        - First validate and filter tags by type and tenant
        - Then find all bindings for those tags
        - Return the target IDs from those bindings

        Expected behavior:
        - Returns a list of target IDs (strings)
        - Only includes targets bound to valid tags
        - Respects tenant and type filtering
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"
        tag_type = "app"
        tag_ids = ["tag-1", "tag-2"]

        # Create mock tag objects
        tags = [
            factory.create_tag_mock(tag_id="tag-1", tenant_id=tenant_id, tag_type=tag_type),
            factory.create_tag_mock(tag_id="tag-2", tenant_id=tenant_id, tag_type=tag_type),
        ]

        # Mock target IDs that are bound to these tags
        target_ids = ["app-1", "app-2", "app-3"]

        # Mock tag query (first scalars call)
        mock_scalars_tags = MagicMock()
        mock_scalars_tags.all.return_value = tags

        # Mock binding query (second scalars call)
        mock_scalars_bindings = MagicMock()
        mock_scalars_bindings.all.return_value = target_ids

        # Configure side_effect to return different mocks for each scalars() call
        mock_db_session.scalars.side_effect = [mock_scalars_tags, mock_scalars_bindings]

        # Act
        # Execute the method under test
        results = TagService.get_target_ids_by_tag_ids(tag_type=tag_type, current_tenant_id=tenant_id, tag_ids=tag_ids)

        # Assert
        # Verify results match expected target IDs
        assert results == target_ids, "Should return all target IDs bound to tags"

        # Verify both queries were executed
        assert mock_db_session.scalars.call_count == 2, "Should execute tag query and binding query"

    @patch("services.tag_service.db.session")
    def test_get_target_ids_with_empty_tag_ids(self, mock_db_session, factory):
        """
        Test that empty tag_ids returns empty list.

        This test verifies the edge case handling when an empty list of
        tag IDs is provided. The method should return early without
        executing any database queries.

        Expected behavior:
        - Returns empty list immediately
        - Does not execute any database queries
        - Handles empty input gracefully
        """
        # Arrange
        # Set up test parameters with empty tag IDs
        tenant_id = "tenant-123"
        tag_type = "app"

        # Act
        # Execute the method with empty tag IDs list
        results = TagService.get_target_ids_by_tag_ids(tag_type=tag_type, current_tenant_id=tenant_id, tag_ids=[])

        # Assert
        # Verify empty result and no database queries
        assert results == [], "Should return empty list for empty input"
        mock_db_session.scalars.assert_not_called(), "Should not query database for empty input"

    @patch("services.tag_service.db.session")
    def test_get_tag_by_tag_name(self, mock_db_session, factory):
        """
        Test retrieving tags by name.

        This test verifies that the get_tag_by_tag_name method correctly
        finds tags by their exact name. This is used for duplicate name
        checking and tag lookup operations.

        The method should:
        - Perform exact name matching (case-sensitive)
        - Filter by type and tenant
        - Return a list of matching tags (usually 0 or 1)

        Expected behavior:
        - Returns list of tags with matching name
        - Respects type and tenant filtering
        - Returns empty list if no matches found
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"
        tag_type = "app"
        tag_name = "Production"

        # Create mock tag with matching name
        tags = [factory.create_tag_mock(name=tag_name, tag_type=tag_type, tenant_id=tenant_id)]

        # Configure mock database session
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = tags
        mock_db_session.scalars.return_value = mock_scalars

        # Act
        # Execute the method under test
        results = TagService.get_tag_by_tag_name(tag_type=tag_type, current_tenant_id=tenant_id, tag_name=tag_name)

        # Assert
        # Verify tag was found
        assert len(results) == 1, "Should find exactly one tag"
        assert results[0].name == tag_name, "Tag name should match"

    @patch("services.tag_service.db.session")
    def test_get_tag_by_tag_name_returns_empty_for_missing_params(self, mock_db_session, factory):
        """
        Test that missing tag_type or tag_name returns empty list.

        This test verifies the input validation for the get_tag_by_tag_name
        method. When either tag_type or tag_name is empty or missing,
        the method should return early without querying the database.

        Expected behavior:
        - Returns empty list for empty tag_type
        - Returns empty list for empty tag_name
        - Does not execute database queries for invalid input
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"

        # Act & Assert
        # Test with empty tag_type
        assert TagService.get_tag_by_tag_name("", tenant_id, "name") == [], "Should return empty for empty type"

        # Test with empty tag_name
        assert TagService.get_tag_by_tag_name("app", tenant_id, "") == [], "Should return empty for empty name"

        # Verify no database queries were executed
        mock_db_session.scalars.assert_not_called(), "Should not query database for invalid input"

    @patch("services.tag_service.db.session")
    def test_get_tags_by_target_id(self, mock_db_session, factory):
        """
        Test retrieving tags associated with a specific target.

        This test verifies that the get_tags_by_target_id method correctly
        retrieves all tags that are bound to a specific target (dataset or app).
        This is useful for displaying tags associated with a resource.

        The method should:
        - Join Tag and TagBinding tables
        - Filter by target_id, tenant, and type
        - Return all tags bound to the target

        Expected behavior:
        - Returns list of Tag objects bound to the target
        - Respects tenant and type filtering
        - Returns empty list if no tags are bound
        """
        # Arrange
        # Set up test parameters
        tenant_id = "tenant-123"
        tag_type = "app"
        target_id = "app-123"

        # Create mock tags that are bound to the target
        tags = [
            factory.create_tag_mock(tag_id="tag-1", name="Frontend"),
            factory.create_tag_mock(tag_id="tag-2", name="Production"),
        ]

        # Configure mock database session and query chain
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.join.return_value = mock_query  # JOIN with TagBinding
        mock_query.where.return_value = mock_query  # WHERE clause for filtering
        mock_query.all.return_value = tags  # Final result

        # Act
        # Execute the method under test
        results = TagService.get_tags_by_target_id(tag_type=tag_type, current_tenant_id=tenant_id, target_id=target_id)

        # Assert
        # Verify tags were retrieved
        assert len(results) == 2, "Should return 2 tags bound to target"

        # Verify tag names
        assert results[0].name == "Frontend", "First tag name should match"
        assert results[1].name == "Production", "Second tag name should match"


# ============================================================================
# TAG CRUD OPERATIONS TESTS
# ============================================================================


class TestTagServiceCRUD:
    """
    Test tag CRUD operations.

    This test class covers all Create, Read, Update, and Delete operations
    for tags. These operations modify the database state and require proper
    transaction handling and validation.

    Methods tested:
    - save_tags: Create new tags
    - update_tags: Update existing tag names
    - delete_tag: Delete tags and cascade delete bindings
    - get_tag_binding_count: Get count of bindings for a tag
    """

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    @patch("services.tag_service.uuid.uuid4")
    def test_save_tags(self, mock_uuid, mock_db_session, mock_get_tag_by_name, mock_current_user, factory):
        """
        Test creating a new tag.

        This test verifies that the save_tags method correctly creates a new
        tag in the database with all required attributes. The method should
        validate uniqueness, generate a UUID, and persist the tag.

        The method should:
        - Check for duplicate tag names (via get_tag_by_tag_name)
        - Generate a unique UUID for the tag ID
        - Set user and tenant information from current_user
        - Persist the tag to the database
        - Commit the transaction

        Expected behavior:
        - Creates tag with correct attributes
        - Assigns UUID to tag ID
        - Sets created_by from current_user
        - Sets tenant_id from current_user
        - Commits to database
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock UUID generation
        mock_uuid.return_value = "new-tag-id"

        # Mock no existing tag (duplicate check passes)
        mock_get_tag_by_name.return_value = []

        # Prepare tag creation arguments
        args = {"name": "New Tag", "type": "app"}

        # Act
        # Execute the method under test
        result = TagService.save_tags(args)

        # Assert
        # Verify tag was added to database session
        mock_db_session.add.assert_called_once(), "Should add tag to session"

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once(), "Should commit transaction"

        # Verify tag attributes
        added_tag = mock_db_session.add.call_args[0][0]
        assert added_tag.name == "New Tag", "Tag name should match"
        assert added_tag.type == "app", "Tag type should match"
        assert added_tag.created_by == "user-123", "Created by should match current user"
        assert added_tag.tenant_id == "tenant-123", "Tenant ID should match current tenant"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    def test_save_tags_raises_error_for_duplicate_name(self, mock_get_tag_by_name, mock_current_user, factory):
        """
        Test that creating a tag with duplicate name raises ValueError.

        This test verifies that the save_tags method correctly prevents
        duplicate tag names within the same tenant and type. Tag names
        must be unique per tenant and type combination.

        Expected behavior:
        - Raises ValueError when duplicate name is detected
        - Error message indicates "Tag name already exists"
        - Does not create the tag
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock existing tag with same name (duplicate detected)
        existing_tag = factory.create_tag_mock(name="Existing Tag")
        mock_get_tag_by_name.return_value = [existing_tag]

        # Prepare tag creation arguments with duplicate name
        args = {"name": "Existing Tag", "type": "app"}

        # Act & Assert
        # Verify ValueError is raised for duplicate name
        with pytest.raises(ValueError, match="Tag name already exists"):
            TagService.save_tags(args)

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    def test_update_tags(self, mock_db_session, mock_get_tag_by_name, mock_current_user, factory):
        """
        Test updating a tag name.

        This test verifies that the update_tags method correctly updates
        an existing tag's name while preserving other attributes. The method
        should validate uniqueness of the new name and ensure the tag exists.

        The method should:
        - Check for duplicate tag names (excluding the current tag)
        - Find the tag by ID
        - Update the tag name
        - Commit the transaction

        Expected behavior:
        - Updates tag name successfully
        - Preserves other tag attributes
        - Commits to database
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock no duplicate name (update check passes)
        mock_get_tag_by_name.return_value = []

        # Create mock tag to be updated
        tag = factory.create_tag_mock(tag_id="tag-123", name="Old Name")

        # Configure mock database session to return the tag
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = tag

        # Prepare update arguments
        args = {"name": "New Name", "type": "app"}

        # Act
        # Execute the method under test
        result = TagService.update_tags(args, tag_id="tag-123")

        # Assert
        # Verify tag name was updated
        assert tag.name == "New Name", "Tag name should be updated"

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once(), "Should commit transaction"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.get_tag_by_tag_name")
    @patch("services.tag_service.db.session")
    def test_update_tags_raises_error_for_duplicate_name(
        self, mock_db_session, mock_get_tag_by_name, mock_current_user, factory
    ):
        """
        Test that updating to a duplicate name raises ValueError.

        This test verifies that the update_tags method correctly prevents
        updating a tag to a name that already exists for another tag
        within the same tenant and type.

        Expected behavior:
        - Raises ValueError when duplicate name is detected
        - Error message indicates "Tag name already exists"
        - Does not update the tag
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock existing tag with the duplicate name
        existing_tag = factory.create_tag_mock(name="Duplicate Name")
        mock_get_tag_by_name.return_value = [existing_tag]

        # Prepare update arguments with duplicate name
        args = {"name": "Duplicate Name", "type": "app"}

        # Act & Assert
        # Verify ValueError is raised for duplicate name
        with pytest.raises(ValueError, match="Tag name already exists"):
            TagService.update_tags(args, tag_id="tag-123")

    @patch("services.tag_service.db.session")
    def test_update_tags_raises_not_found_for_missing_tag(self, mock_db_session, factory):
        """
        Test that updating a non-existent tag raises NotFound.

        This test verifies that the update_tags method correctly handles
        the case when attempting to update a tag that does not exist.
        This prevents silent failures and provides clear error feedback.

        Expected behavior:
        - Raises NotFound exception
        - Error message indicates "Tag not found"
        - Does not attempt to update or commit
        """
        # Arrange
        # Configure mock database session to return None (tag not found)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Mock duplicate check and current_user
        with patch("services.tag_service.TagService.get_tag_by_tag_name", return_value=[]):
            with patch("services.tag_service.current_user") as mock_user:
                mock_user.current_tenant_id = "tenant-123"
                args = {"name": "New Name", "type": "app"}

                # Act & Assert
                # Verify NotFound is raised for non-existent tag
                with pytest.raises(NotFound, match="Tag not found"):
                    TagService.update_tags(args, tag_id="nonexistent")

    @patch("services.tag_service.db.session")
    def test_get_tag_binding_count(self, mock_db_session, factory):
        """
        Test getting the count of bindings for a tag.

        This test verifies that the get_tag_binding_count method correctly
        counts how many resources (datasets/apps) are bound to a specific tag.
        This is useful for displaying tag usage statistics.

        The method should:
        - Query TagBinding table filtered by tag_id
        - Return the count of matching bindings

        Expected behavior:
        - Returns integer count of bindings
        - Returns 0 for tags with no bindings
        """
        # Arrange
        # Set up test parameters
        tag_id = "tag-123"
        expected_count = 5

        # Configure mock database session
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.count.return_value = expected_count

        # Act
        # Execute the method under test
        result = TagService.get_tag_binding_count(tag_id)

        # Assert
        # Verify count matches expectation
        assert result == expected_count, "Binding count should match"

    @patch("services.tag_service.db.session")
    def test_delete_tag(self, mock_db_session, factory):
        """
        Test deleting a tag and its bindings.

        This test verifies that the delete_tag method correctly deletes
        a tag along with all its associated bindings (cascade delete).
        This ensures data integrity and prevents orphaned bindings.

        The method should:
        - Find the tag by ID
        - Delete the tag
        - Find all bindings for the tag
        - Delete all bindings (cascade delete)
        - Commit the transaction

        Expected behavior:
        - Deletes tag from database
        - Deletes all associated bindings
        - Commits transaction
        """
        # Arrange
        # Set up test parameters
        tag_id = "tag-123"

        # Create mock tag to be deleted
        tag = factory.create_tag_mock(tag_id=tag_id)

        # Create mock bindings that will be cascade deleted
        bindings = [factory.create_tag_binding_mock(binding_id=f"binding-{i}", tag_id=tag_id) for i in range(3)]

        # Configure mock database session for tag query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = tag

        # Configure mock database session for bindings query
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = bindings
        mock_db_session.scalars.return_value = mock_scalars

        # Act
        # Execute the method under test
        TagService.delete_tag(tag_id)

        # Assert
        # Verify tag and bindings were deleted
        mock_db_session.delete.assert_called(), "Should call delete method"

        # Verify delete was called 4 times (1 tag + 3 bindings)
        assert mock_db_session.delete.call_count == 4, "Should delete tag and all bindings"

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once(), "Should commit transaction"

    @patch("services.tag_service.db.session")
    def test_delete_tag_raises_not_found(self, mock_db_session, factory):
        """
        Test that deleting a non-existent tag raises NotFound.

        This test verifies that the delete_tag method correctly handles
        the case when attempting to delete a tag that does not exist.
        This prevents silent failures and provides clear error feedback.

        Expected behavior:
        - Raises NotFound exception
        - Error message indicates "Tag not found"
        - Does not attempt to delete or commit
        """
        # Arrange
        # Configure mock database session to return None (tag not found)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act & Assert
        # Verify NotFound is raised for non-existent tag
        with pytest.raises(NotFound, match="Tag not found"):
            TagService.delete_tag("nonexistent")


# ============================================================================
# TAG BINDING OPERATIONS TESTS
# ============================================================================


class TestTagServiceBindings:
    """
    Test tag binding operations.

    This test class covers all operations related to binding tags to
    resources (datasets and apps). Tag bindings create the many-to-many
    relationship between tags and resources.

    Methods tested:
    - save_tag_binding: Create bindings between tags and targets
    - delete_tag_binding: Remove bindings between tags and targets
    - check_target_exists: Validate target (dataset/app) existence
    """

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_save_tag_binding(self, mock_db_session, mock_check_target, mock_current_user, factory):
        """
        Test creating tag bindings.

        This test verifies that the save_tag_binding method correctly
        creates bindings between tags and a target resource (dataset or app).
        The method supports batch binding of multiple tags to a single target.

        The method should:
        - Validate target exists (via check_target_exists)
        - Check for existing bindings to avoid duplicates
        - Create new bindings for tags that aren't already bound
        - Commit the transaction

        Expected behavior:
        - Validates target exists
        - Creates bindings for each tag in tag_ids
        - Skips tags that are already bound (idempotent)
        - Commits transaction
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"

        # Configure mock database session (no existing bindings)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # No existing bindings

        # Prepare binding arguments (batch binding)
        args = {"type": "app", "target_id": "app-123", "tag_ids": ["tag-1", "tag-2"]}

        # Act
        # Execute the method under test
        TagService.save_tag_binding(args)

        # Assert
        # Verify target existence was checked
        mock_check_target.assert_called_once_with("app", "app-123"), "Should validate target exists"

        # Verify bindings were created (2 bindings for 2 tags)
        assert mock_db_session.add.call_count == 2, "Should create 2 bindings"

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once(), "Should commit transaction"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_save_tag_binding_is_idempotent(self, mock_db_session, mock_check_target, mock_current_user, factory):
        """
        Test that saving duplicate bindings is idempotent.

        This test verifies that the save_tag_binding method correctly handles
        the case when attempting to create a binding that already exists.
        The method should skip existing bindings and not create duplicates,
        making the operation idempotent.

        Expected behavior:
        - Checks for existing bindings
        - Skips tags that are already bound
        - Does not create duplicate bindings
        - Still commits transaction
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.id = "user-123"
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock existing binding (duplicate detected)
        existing_binding = factory.create_tag_binding_mock()
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = existing_binding  # Binding already exists

        # Prepare binding arguments
        args = {"type": "app", "target_id": "app-123", "tag_ids": ["tag-1"]}

        # Act
        # Execute the method under test
        TagService.save_tag_binding(args)

        # Assert
        # Verify no new binding was added (idempotent)
        mock_db_session.add.assert_not_called(), "Should not create duplicate binding"

    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_delete_tag_binding(self, mock_db_session, mock_check_target, factory):
        """
        Test deleting a tag binding.

        This test verifies that the delete_tag_binding method correctly
        removes a binding between a tag and a target resource. This
        operation should be safe even if the binding doesn't exist.

        The method should:
        - Validate target exists (via check_target_exists)
        - Find the binding by tag_id and target_id
        - Delete the binding if it exists
        - Commit the transaction

        Expected behavior:
        - Validates target exists
        - Deletes the binding
        - Commits transaction
        """
        # Arrange
        # Create mock binding to be deleted
        binding = factory.create_tag_binding_mock()

        # Configure mock database session
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = binding

        # Prepare delete arguments
        args = {"type": "app", "target_id": "app-123", "tag_id": "tag-1"}

        # Act
        # Execute the method under test
        TagService.delete_tag_binding(args)

        # Assert
        # Verify target existence was checked
        mock_check_target.assert_called_once_with("app", "app-123"), "Should validate target exists"

        # Verify binding was deleted
        mock_db_session.delete.assert_called_once_with(binding), "Should delete the binding"

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once(), "Should commit transaction"

    @patch("services.tag_service.TagService.check_target_exists")
    @patch("services.tag_service.db.session")
    def test_delete_tag_binding_does_nothing_if_not_exists(self, mock_db_session, mock_check_target, factory):
        """
        Test that deleting a non-existent binding is a no-op.

        This test verifies that the delete_tag_binding method correctly
        handles the case when attempting to delete a binding that doesn't
        exist. The method should not raise an error and should not commit
        if there's nothing to delete.

        Expected behavior:
        - Validates target exists
        - Does not raise error for non-existent binding
        - Does not call delete or commit if binding doesn't exist
        """
        # Arrange
        # Configure mock database session (binding not found)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # Binding doesn't exist

        # Prepare delete arguments
        args = {"type": "app", "target_id": "app-123", "tag_id": "tag-1"}

        # Act
        # Execute the method under test
        TagService.delete_tag_binding(args)

        # Assert
        # Verify no delete operation was attempted
        mock_db_session.delete.assert_not_called(), "Should not delete if binding doesn't exist"

        # Verify no commit was made (nothing changed)
        mock_db_session.commit.assert_not_called(), "Should not commit if nothing to delete"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_for_dataset(self, mock_db_session, mock_current_user, factory):
        """
        Test validating that a dataset target exists.

        This test verifies that the check_target_exists method correctly
        validates the existence of a dataset (knowledge base) when the
        target type is "knowledge". This validation ensures bindings
        are only created for valid resources.

        The method should:
        - Query Dataset table filtered by tenant and ID
        - Raise NotFound if dataset doesn't exist
        - Return normally if dataset exists

        Expected behavior:
        - No exception raised when dataset exists
        - Database query is executed
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Create mock dataset
        dataset = factory.create_dataset_mock()

        # Configure mock database session
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = dataset  # Dataset exists

        # Act
        # Execute the method under test
        TagService.check_target_exists("knowledge", "dataset-123")

        # Assert
        # Verify no exception was raised and query was executed
        mock_db_session.query.assert_called_once(), "Should query database for dataset"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_for_app(self, mock_db_session, mock_current_user, factory):
        """
        Test validating that an app target exists.

        This test verifies that the check_target_exists method correctly
        validates the existence of an application when the target type is
        "app". This validation ensures bindings are only created for valid
        resources.

        The method should:
        - Query App table filtered by tenant and ID
        - Raise NotFound if app doesn't exist
        - Return normally if app exists

        Expected behavior:
        - No exception raised when app exists
        - Database query is executed
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Create mock app
        app = factory.create_app_mock()

        # Configure mock database session
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = app  # App exists

        # Act
        # Execute the method under test
        TagService.check_target_exists("app", "app-123")

        # Assert
        # Verify no exception was raised and query was executed
        mock_db_session.query.assert_called_once(), "Should query database for app"

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_raises_not_found_for_missing_dataset(
        self, mock_db_session, mock_current_user, factory
    ):
        """
        Test that missing dataset raises NotFound.

        This test verifies that the check_target_exists method correctly
        raises a NotFound exception when attempting to validate a dataset
        that doesn't exist. This prevents creating bindings for invalid
        resources.

        Expected behavior:
        - Raises NotFound exception
        - Error message indicates "Dataset not found"
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Configure mock database session (dataset not found)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # Dataset doesn't exist

        # Act & Assert
        # Verify NotFound is raised for non-existent dataset
        with pytest.raises(NotFound, match="Dataset not found"):
            TagService.check_target_exists("knowledge", "nonexistent")

    @patch("services.tag_service.current_user")
    @patch("services.tag_service.db.session")
    def test_check_target_exists_raises_not_found_for_missing_app(self, mock_db_session, mock_current_user, factory):
        """
        Test that missing app raises NotFound.

        This test verifies that the check_target_exists method correctly
        raises a NotFound exception when attempting to validate an app
        that doesn't exist. This prevents creating bindings for invalid
        resources.

        Expected behavior:
        - Raises NotFound exception
        - Error message indicates "App not found"
        """
        # Arrange
        # Configure mock current_user
        mock_current_user.current_tenant_id = "tenant-123"

        # Configure mock database session (app not found)
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # App doesn't exist

        # Act & Assert
        # Verify NotFound is raised for non-existent app
        with pytest.raises(NotFound, match="App not found"):
            TagService.check_target_exists("app", "nonexistent")

    def test_check_target_exists_raises_not_found_for_invalid_type(self, factory):
        """
        Test that invalid binding type raises NotFound.

        This test verifies that the check_target_exists method correctly
        raises a NotFound exception when an invalid target type is provided.
        Only "knowledge" (for datasets) and "app" are valid target types.

        Expected behavior:
        - Raises NotFound exception
        - Error message indicates "Invalid binding type"
        """
        # Act & Assert
        # Verify NotFound is raised for invalid target type
        with pytest.raises(NotFound, match="Invalid binding type"):
            TagService.check_target_exists("invalid_type", "target-123")
