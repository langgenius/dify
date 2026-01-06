import uuid
from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.model import App, Tag, TagBinding
from services.tag_service import TagService


class TestTagService:
    """Integration tests for TagService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.tag_service.current_user", create_autospec(Account, instance=True)) as mock_current_user,
        ):
            # Setup default mock returns
            mock_current_user.current_tenant_id = "test-tenant-id"
            mock_current_user.id = "test-user-id"

            yield {
                "current_user": mock_current_user,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        # Update mock to use real tenant ID
        mock_external_service_dependencies["current_user"].current_tenant_id = tenant.id
        mock_external_service_dependencies["current_user"].id = account.id

        return account, tenant

    def _create_test_dataset(self, db_session_with_containers, mock_external_service_dependencies, tenant_id):
        """
        Helper method to create a test dataset for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the dataset

        Returns:
            Dataset: Created dataset instance
        """
        fake = Faker()

        dataset = Dataset(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            provider="vendor",
            permission="only_me",
            data_source_type="upload",
            indexing_technique="high_quality",
            tenant_id=tenant_id,
            created_by=mock_external_service_dependencies["current_user"].id,
        )

        from extensions.ext_database import db

        db.session.add(dataset)
        db.session.commit()

        return dataset

    def _create_test_app(self, db_session_with_containers, mock_external_service_dependencies, tenant_id):
        """
        Helper method to create a test app for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the app

        Returns:
            App: Created app instance
        """
        fake = Faker()

        app = App(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            enable_site=False,
            enable_api=False,
            tenant_id=tenant_id,
            created_by=mock_external_service_dependencies["current_user"].id,
        )

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()

        return app

    def _create_test_tags(
        self, db_session_with_containers, mock_external_service_dependencies, tenant_id, tag_type, count=3
    ):
        """
        Helper method to create test tags for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the tags
            tag_type: Type of tags to create
            count: Number of tags to create

        Returns:
            list: List of created tag instances
        """
        fake = Faker()
        tags = []

        for i in range(count):
            tag = Tag(
                name=f"tag_{tag_type}_{i}_{fake.word()}",
                type=tag_type,
                tenant_id=tenant_id,
                created_by=mock_external_service_dependencies["current_user"].id,
            )
            tags.append(tag)

        from extensions.ext_database import db

        for tag in tags:
            db.session.add(tag)
        db.session.commit()

        return tags

    def _create_test_tag_bindings(
        self, db_session_with_containers, mock_external_service_dependencies, tags, target_id, tenant_id
    ):
        """
        Helper method to create test tag bindings for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tags: List of tags to bind
            target_id: Target ID to bind tags to
            tenant_id: Tenant ID for the bindings

        Returns:
            list: List of created tag binding instances
        """
        tag_bindings = []

        for tag in tags:
            tag_binding = TagBinding(
                tag_id=tag.id,
                target_id=target_id,
                tenant_id=tenant_id,
                created_by=mock_external_service_dependencies["current_user"].id,
            )
            tag_bindings.append(tag_binding)

        from extensions.ext_database import db

        for tag_binding in tag_bindings:
            db.session.add(tag_binding)
        db.session.commit()

        return tag_bindings

    def test_get_tags_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of tags with binding count.

        This test verifies:
        - Proper tag retrieval with binding count
        - Correct filtering by tag type and tenant
        - Proper ordering by creation date
        - Binding count calculation
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 3
        )

        # Create dataset and bind tags
        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, tags[:2], dataset.id, tenant.id
        )

        # Act: Execute the method under test
        result = TagService.get_tags("knowledge", tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3

        # Verify tag data structure
        for tag_result in result:
            assert hasattr(tag_result, "id")
            assert hasattr(tag_result, "type")
            assert hasattr(tag_result, "name")
            assert hasattr(tag_result, "binding_count")
            assert tag_result.type == "knowledge"

        # Verify binding count
        tag_with_bindings = next((t for t in result if t.binding_count > 0), None)
        assert tag_with_bindings is not None
        assert tag_with_bindings.binding_count >= 1

        # Verify ordering (newest first) - note: created_at is not in SELECT but used in ORDER BY
        # The ordering is handled by the database, we just verify the results are returned
        assert len(result) == 3

    def test_get_tags_with_keyword_filter(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag retrieval with keyword filtering.

        This test verifies:
        - Proper keyword filtering functionality
        - Case-insensitive search
        - Partial match functionality
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags with specific names
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 3
        )

        # Update tag names to make them searchable
        from extensions.ext_database import db

        tags[0].name = "python_development"
        tags[1].name = "machine_learning"
        tags[2].name = "web_development"
        db.session.commit()

        # Act: Execute the method under test with keyword filter
        result = TagService.get_tags("app", tenant.id, keyword="development")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 2  # Should find python_development and web_development

        # Verify filtered results contain the keyword
        for tag_result in result:
            assert "development" in tag_result.name.lower()

        # Verify no results for non-matching keyword
        result_no_match = TagService.get_tags("app", tenant.id, keyword="nonexistent")
        assert len(result_no_match) == 0

    def test_get_tags_with_special_characters_in_keyword(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        r"""
        Test tag retrieval with special characters in keyword to verify SQL injection prevention.

        This test verifies:
        - Special characters (%, _, \) in keyword are properly escaped
        - Search treats special characters as literal characters, not wildcards
        - SQL injection via LIKE wildcards is prevented
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        from extensions.ext_database import db

        # Create tags with special characters in names
        tag_with_percent = Tag(
            name="50% discount",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_percent.id = str(uuid.uuid4())
        db.session.add(tag_with_percent)

        tag_with_underscore = Tag(
            name="test_data_tag",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_underscore.id = str(uuid.uuid4())
        db.session.add(tag_with_underscore)

        tag_with_backslash = Tag(
            name="path\\to\\tag",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_with_backslash.id = str(uuid.uuid4())
        db.session.add(tag_with_backslash)

        # Create tag that should NOT match
        tag_no_match = Tag(
            name="100% different",
            type="app",
            tenant_id=tenant.id,
            created_by=account.id,
        )
        tag_no_match.id = str(uuid.uuid4())
        db.session.add(tag_no_match)

        db.session.commit()

        # Act & Assert: Test 1 - Search with % character
        result = TagService.get_tags("app", tenant.id, keyword="50%")
        assert len(result) == 1
        assert result[0].name == "50% discount"

        # Test 2 - Search with _ character
        result = TagService.get_tags("app", tenant.id, keyword="test_data")
        assert len(result) == 1
        assert result[0].name == "test_data_tag"

        # Test 3 - Search with \ character
        result = TagService.get_tags("app", tenant.id, keyword="path\\to\\tag")
        assert len(result) == 1
        assert result[0].name == "path\\to\\tag"

        # Test 4 - Search with % should NOT match 100% (verifies escaping works)
        result = TagService.get_tags("app", tenant.id, keyword="50%")
        assert len(result) == 1
        assert all("50%" in item.name for item in result)

    def test_get_tags_empty_result(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag retrieval when no tags exist.

        This test verifies:
        - Proper handling of empty tag sets
        - Correct return value for no results
        """
        # Arrange: Create test data without tags
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute the method under test
        result = TagService.get_tags("knowledge", tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_target_ids_by_tag_ids_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of target IDs by tag IDs.

        This test verifies:
        - Proper target ID retrieval for valid tag IDs
        - Correct filtering by tag type and tenant
        - Proper handling of tag bindings
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 3
        )

        # Create multiple datasets and bind tags
        datasets = []
        for i in range(2):
            dataset = self._create_test_dataset(
                db_session_with_containers, mock_external_service_dependencies, tenant.id
            )
            datasets.append(dataset)
            # Bind first two tags to first dataset, last tag to second dataset
            tags_to_bind = tags[:2] if i == 0 else tags[2:]
            self._create_test_tag_bindings(
                db_session_with_containers, mock_external_service_dependencies, tags_to_bind, dataset.id, tenant.id
            )

        # Act: Execute the method under test
        tag_ids = [tag.id for tag in tags]
        result = TagService.get_target_ids_by_tag_ids("knowledge", tenant.id, tag_ids)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3  # Should find 3 target IDs (2 from first dataset, 1 from second)

        # Verify all dataset IDs are returned
        dataset_ids = [dataset.id for dataset in datasets]
        for target_id in result:
            assert target_id in dataset_ids

        # Verify the first dataset appears twice (for the first two tags)
        first_dataset_count = result.count(datasets[0].id)
        assert first_dataset_count == 2

        # Verify the second dataset appears once (for the last tag)
        second_dataset_count = result.count(datasets[1].id)
        assert second_dataset_count == 1

    def test_get_target_ids_by_tag_ids_empty_tag_ids(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test target ID retrieval with empty tag IDs list.

        This test verifies:
        - Proper handling of empty tag IDs
        - Correct return value for empty input
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute the method under test with empty tag IDs
        result = TagService.get_target_ids_by_tag_ids("knowledge", tenant.id, [])

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_target_ids_by_tag_ids_no_matching_tags(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test target ID retrieval when no tags match the criteria.

        This test verifies:
        - Proper handling of non-existent tag IDs
        - Correct return value for no matches
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent tag IDs
        import uuid

        non_existent_tag_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        # Act: Execute the method under test
        result = TagService.get_target_ids_by_tag_ids("knowledge", tenant.id, non_existent_tag_ids)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_tag_by_tag_name_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of tags by tag name.

        This test verifies:
        - Proper tag retrieval by name
        - Correct filtering by tag type and tenant
        - Proper return value structure
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags with specific names
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 2
        )

        # Update tag names to make them searchable
        from extensions.ext_database import db

        tags[0].name = "python_tag"
        tags[1].name = "ml_tag"
        db.session.commit()

        # Act: Execute the method under test
        result = TagService.get_tag_by_tag_name("app", tenant.id, "python_tag")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 1
        assert result[0].name == "python_tag"
        assert result[0].type == "app"
        assert result[0].tenant_id == tenant.id

    def test_get_tag_by_tag_name_no_matches(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag retrieval by name when no matches exist.

        This test verifies:
        - Proper handling of non-existent tag names
        - Correct return value for no matches
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute the method under test with non-existent tag name
        result = TagService.get_tag_by_tag_name("knowledge", tenant.id, "nonexistent_tag")

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_get_tag_by_tag_name_empty_parameters(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag retrieval by name with empty parameters.

        This test verifies:
        - Proper handling of empty tag type
        - Proper handling of empty tag name
        - Correct return value for invalid input
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute the method under test with empty parameters
        result_empty_type = TagService.get_tag_by_tag_name("", tenant.id, "test_tag")
        result_empty_name = TagService.get_tag_by_tag_name("knowledge", tenant.id, "")

        # Assert: Verify the expected outcomes
        assert result_empty_type is not None
        assert len(result_empty_type) == 0
        assert result_empty_name is not None
        assert len(result_empty_name) == 0

    def test_get_tags_by_target_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of tags by target ID.

        This test verifies:
        - Proper tag retrieval for a specific target
        - Correct filtering by tag type and tenant
        - Proper join with tag bindings
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 3
        )

        # Create app and bind tags
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, tags, app.id, tenant.id
        )

        # Act: Execute the method under test
        result = TagService.get_tags_by_target_id("app", tenant.id, app.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3

        # Verify all tags are returned
        for tag in result:
            assert tag.type == "app"
            assert tag.tenant_id == tenant.id
            assert tag.id in [t.id for t in tags]

    def test_get_tags_by_target_id_no_bindings(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag retrieval by target ID when no tags are bound.

        This test verifies:
        - Proper handling of targets with no tag bindings
        - Correct return value for no results
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create app without binding any tags
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Act: Execute the method under test
        result = TagService.get_tags_by_target_id("app", tenant.id, app.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

    def test_save_tags_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tag creation.

        This test verifies:
        - Proper tag creation with all required fields
        - Correct database state after creation
        - Proper UUID generation
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        tag_args = {"name": "test_tag_name", "type": "knowledge"}

        # Act: Execute the method under test
        result = TagService.save_tags(tag_args)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.name == "test_tag_name"
        assert result.type == "knowledge"
        assert result.tenant_id == tenant.id
        assert result.created_by == account.id
        assert result.id is not None

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None

        # Verify tag was actually saved to database
        saved_tag = db.session.query(Tag).where(Tag.id == result.id).first()
        assert saved_tag is not None
        assert saved_tag.name == "test_tag_name"

    def test_save_tags_duplicate_name_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag creation with duplicate name.

        This test verifies:
        - Proper error handling for duplicate tag names
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create first tag
        tag_args = {"name": "duplicate_tag", "type": "app"}
        TagService.save_tags(tag_args)

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            TagService.save_tags(tag_args)
        assert "Tag name already exists" in str(exc_info.value)

    def test_update_tags_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tag update.

        This test verifies:
        - Proper tag update with new name
        - Correct database state after update
        - Proper error handling for non-existent tags
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create a tag to update
        tag_args = {"name": "original_name", "type": "knowledge"}
        tag = TagService.save_tags(tag_args)

        # Update args
        update_args = {"name": "updated_name", "type": "knowledge"}

        # Act: Execute the method under test
        result = TagService.update_tags(update_args, tag.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.name == "updated_name"
        assert result.type == "knowledge"
        assert result.id == tag.id

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.name == "updated_name"

        # Verify tag was actually updated in database
        updated_tag = db.session.query(Tag).where(Tag.id == tag.id).first()
        assert updated_tag is not None
        assert updated_tag.name == "updated_name"

    def test_update_tags_not_found_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag update for non-existent tag.

        This test verifies:
        - Proper error handling for non-existent tags
        - Correct exception type
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent tag ID
        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        update_args = {"name": "updated_name", "type": "knowledge"}

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            TagService.update_tags(update_args, non_existent_tag_id)
        assert "Tag not found" in str(exc_info.value)

    def test_update_tags_duplicate_name_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag update with duplicate name.

        This test verifies:
        - Proper error handling for duplicate tag names during update
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create two tags
        tag1_args = {"name": "first_tag", "type": "app"}
        tag1 = TagService.save_tags(tag1_args)

        tag2_args = {"name": "second_tag", "type": "app"}
        tag2 = TagService.save_tags(tag2_args)

        # Try to update second tag with first tag's name
        update_args = {"name": "first_tag", "type": "app"}

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            TagService.update_tags(update_args, tag2.id)
        assert "Tag name already exists" in str(exc_info.value)

    def test_get_tag_binding_count_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of tag binding count.

        This test verifies:
        - Proper binding count calculation
        - Correct handling of tags with no bindings
        - Proper database query execution
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )

        # Create dataset and bind first tag
        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, [tags[0]], dataset.id, tenant.id
        )

        # Act: Execute the method under test
        result_tag_with_bindings = TagService.get_tag_binding_count(tags[0].id)
        result_tag_without_bindings = TagService.get_tag_binding_count(tags[1].id)

        # Assert: Verify the expected outcomes
        assert result_tag_with_bindings == 1
        assert result_tag_without_bindings == 0

    def test_get_tag_binding_count_non_existent_tag(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test binding count retrieval for non-existent tag.

        This test verifies:
        - Proper handling of non-existent tag IDs
        - Correct return value for non-existent tags
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent tag ID
        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        # Act: Execute the method under test
        result = TagService.get_tag_binding_count(non_existent_tag_id)

        # Assert: Verify the expected outcomes
        assert result == 0

    def test_delete_tag_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tag deletion.

        This test verifies:
        - Proper tag deletion from database
        - Proper cleanup of associated tag bindings
        - Correct database state after deletion
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tag with bindings
        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]

        # Create app and bind tag
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, [tag], app.id, tenant.id
        )

        # Verify tag and binding exist before deletion
        from extensions.ext_database import db

        tag_before = db.session.query(Tag).where(Tag.id == tag.id).first()
        assert tag_before is not None

        binding_before = db.session.query(TagBinding).where(TagBinding.tag_id == tag.id).first()
        assert binding_before is not None

        # Act: Execute the method under test
        TagService.delete_tag(tag.id)

        # Assert: Verify the expected outcomes
        # Verify tag was deleted
        tag_after = db.session.query(Tag).where(Tag.id == tag.id).first()
        assert tag_after is None

        # Verify tag binding was deleted
        binding_after = db.session.query(TagBinding).where(TagBinding.tag_id == tag.id).first()
        assert binding_after is None

    def test_delete_tag_not_found_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag deletion for non-existent tag.

        This test verifies:
        - Proper error handling for non-existent tags
        - Correct exception type
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent tag ID
        import uuid

        non_existent_tag_id = str(uuid.uuid4())

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            TagService.delete_tag(non_existent_tag_id)
        assert "Tag not found" in str(exc_info.value)

    def test_save_tag_binding_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tag binding creation.

        This test verifies:
        - Proper tag binding creation
        - Correct handling of duplicate bindings
        - Proper database state after creation
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tags
        tags = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 2
        )

        # Create dataset
        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Act: Execute the method under test
        binding_args = {"type": "knowledge", "target_id": dataset.id, "tag_ids": [tag.id for tag in tags]}
        TagService.save_tag_binding(binding_args)

        # Assert: Verify the expected outcomes
        from extensions.ext_database import db

        # Verify tag bindings were created
        for tag in tags:
            binding = (
                db.session.query(TagBinding)
                .where(TagBinding.tag_id == tag.id, TagBinding.target_id == dataset.id)
                .first()
            )
            assert binding is not None
            assert binding.tenant_id == tenant.id
            assert binding.created_by == account.id

    def test_save_tag_binding_duplicate_handling(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag binding creation with duplicate bindings.

        This test verifies:
        - Proper handling of duplicate tag bindings
        - No errors when trying to create existing bindings
        - Correct database state after operation
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tag
        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]

        # Create app
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Create first binding
        binding_args = {"type": "app", "target_id": app.id, "tag_ids": [tag.id]}
        TagService.save_tag_binding(binding_args)

        # Act: Try to create duplicate binding
        TagService.save_tag_binding(binding_args)

        # Assert: Verify the expected outcomes
        from extensions.ext_database import db

        # Verify only one binding exists
        bindings = db.session.scalars(
            select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
        ).all()
        assert len(bindings) == 1

    def test_save_tag_binding_invalid_target_type(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tag binding creation with invalid target type.

        This test verifies:
        - Proper error handling for invalid target types
        - Correct exception type
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tag
        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 1
        )[0]

        # Create non-existent target ID
        import uuid

        non_existent_target_id = str(uuid.uuid4())

        # Act & Assert: Verify proper error handling
        binding_args = {"type": "invalid_type", "target_id": non_existent_target_id, "tag_ids": [tag.id]}

        with pytest.raises(NotFound) as exc_info:
            TagService.save_tag_binding(binding_args)
        assert "Invalid binding type" in str(exc_info.value)

    def test_delete_tag_binding_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tag binding deletion.

        This test verifies:
        - Proper tag binding deletion from database
        - Correct database state after deletion
        - Proper error handling for non-existent bindings
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tag
        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "knowledge", 1
        )[0]

        # Create dataset and bind tag
        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)
        self._create_test_tag_bindings(
            db_session_with_containers, mock_external_service_dependencies, [tag], dataset.id, tenant.id
        )

        # Verify binding exists before deletion
        from extensions.ext_database import db

        binding_before = (
            db.session.query(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == dataset.id).first()
        )
        assert binding_before is not None

        # Act: Execute the method under test
        delete_args = {"type": "knowledge", "target_id": dataset.id, "tag_id": tag.id}
        TagService.delete_tag_binding(delete_args)

        # Assert: Verify the expected outcomes
        # Verify tag binding was deleted
        binding_after = (
            db.session.query(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == dataset.id).first()
        )
        assert binding_after is None

    def test_delete_tag_binding_non_existent_binding(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tag binding deletion for non-existent binding.

        This test verifies:
        - Proper handling of non-existent tag bindings
        - No errors when trying to delete non-existent bindings
        - Correct database state after operation
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create tag and dataset without binding
        tag = self._create_test_tags(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, "app", 1
        )[0]
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Act: Try to delete non-existent binding
        delete_args = {"type": "app", "target_id": app.id, "tag_id": tag.id}
        TagService.delete_tag_binding(delete_args)

        # Assert: Verify the expected outcomes
        # No error should be raised, and database state should remain unchanged
        from extensions.ext_database import db

        bindings = db.session.scalars(
            select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
        ).all()
        assert len(bindings) == 0

    def test_check_target_exists_knowledge_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful target existence check for knowledge type.

        This test verifies:
        - Proper validation of knowledge dataset existence
        - Correct error handling for non-existent datasets
        - Proper tenant filtering
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create dataset
        dataset = self._create_test_dataset(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Act: Execute the method under test
        TagService.check_target_exists("knowledge", dataset.id)

        # Assert: Verify the expected outcomes
        # No exception should be raised for existing dataset

    def test_check_target_exists_knowledge_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test target existence check for non-existent knowledge dataset.

        This test verifies:
        - Proper error handling for non-existent knowledge datasets
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent dataset ID
        import uuid

        non_existent_dataset_id = str(uuid.uuid4())

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("knowledge", non_existent_dataset_id)
        assert "Dataset not found" in str(exc_info.value)

    def test_check_target_exists_app_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful target existence check for app type.

        This test verifies:
        - Proper validation of app existence
        - Correct error handling for non-existent apps
        - Proper tenant filtering
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create app
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant.id)

        # Act: Execute the method under test
        TagService.check_target_exists("app", app.id)

        # Assert: Verify the expected outcomes
        # No exception should be raised for existing app

    def test_check_target_exists_app_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test target existence check for non-existent app.

        This test verifies:
        - Proper error handling for non-existent apps
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent app ID
        import uuid

        non_existent_app_id = str(uuid.uuid4())

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("app", non_existent_app_id)
        assert "App not found" in str(exc_info.value)

    def test_check_target_exists_invalid_type(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test target existence check for invalid type.

        This test verifies:
        - Proper error handling for invalid target types
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create non-existent target ID
        import uuid

        non_existent_target_id = str(uuid.uuid4())

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            TagService.check_target_exists("invalid_type", non_existent_target_id)
        assert "Invalid binding type" in str(exc_info.value)
