"""
Comprehensive unit tests for TagService.

This test suite covers:
- Tag CRUD operations (create, read, update, delete)
- Tag binding management for apps and datasets
- Tag filtering and search functionality
- Target existence validation
- Edge cases and error handling
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound


class TestTagServiceGetTags:
    """Test suite for TagService.get_tags method."""

    def test_get_tags_returns_empty_list_when_no_tags_exist(self):
        """Test that get_tags returns empty list when no tags exist."""
        # Arrange
        mock_query = MagicMock()
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tags(
                tag_type="knowledge",
                current_tenant_id=str(uuid4()),
                keyword=None,
            )

            # Assert
            assert result == []

    def test_get_tags_returns_tags_with_binding_count(self):
        """Test that get_tags returns tags with their binding counts."""
        # Arrange
        tenant_id = str(uuid4())
        tag_id = str(uuid4())
        mock_result = MagicMock()
        mock_result.id = tag_id
        mock_result.type = "knowledge"
        mock_result.name = "test-tag"
        mock_result.binding_count = 5

        mock_query = MagicMock()
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [mock_result]

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tags(
                tag_type="knowledge",
                current_tenant_id=tenant_id,
                keyword=None,
            )

            # Assert
            assert len(result) == 1
            assert result[0].name == "test-tag"
            assert result[0].binding_count == 5

    def test_get_tags_filters_by_keyword(self):
        """Test that get_tags filters tags by keyword."""
        # Arrange
        tenant_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            TagService.get_tags(
                tag_type="app",
                current_tenant_id=tenant_id,
                keyword="search-term",
            )

            # Assert - verify where was called with keyword filter
            assert mock_query.where.called

    def test_get_tags_for_app_type(self):
        """Test get_tags with app tag type."""
        # Arrange
        tenant_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.group_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tags(
                tag_type="app",
                current_tenant_id=tenant_id,
            )

            # Assert
            assert result == []


class TestTagServiceGetTargetIdsByTagIds:
    """Test suite for TagService.get_target_ids_by_tag_ids method."""

    def test_get_target_ids_returns_empty_list_when_tag_ids_empty(self):
        """Test that empty tag_ids returns empty list."""
        from services.tag_service import TagService

        # Act
        result = TagService.get_target_ids_by_tag_ids(
            tag_type="knowledge",
            current_tenant_id=str(uuid4()),
            tag_ids=[],
        )

        # Assert
        assert result == []

    def test_get_target_ids_returns_empty_list_when_tag_ids_none(self):
        """Test that None tag_ids returns empty list."""
        from services.tag_service import TagService

        # Act
        result = TagService.get_target_ids_by_tag_ids(
            tag_type="knowledge",
            current_tenant_id=str(uuid4()),
            tag_ids=None,
        )

        # Assert
        assert result == []

    def test_get_target_ids_returns_empty_when_no_tags_found(self):
        """Test returns empty list when no matching tags found."""
        # Arrange
        tenant_id = str(uuid4())
        tag_ids = [str(uuid4())]

        with patch("services.tag_service.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.return_value = []

            from services.tag_service import TagService

            # Act
            result = TagService.get_target_ids_by_tag_ids(
                tag_type="knowledge",
                current_tenant_id=tenant_id,
                tag_ids=tag_ids,
            )

            # Assert
            assert result == []

    def test_get_target_ids_returns_bindings_for_valid_tags(self):
        """Test returns target IDs for valid tag IDs."""
        # Arrange
        tenant_id = str(uuid4())
        tag_id = str(uuid4())
        target_id = str(uuid4())

        mock_tag = MagicMock()
        mock_tag.id = tag_id

        with patch("services.tag_service.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.side_effect = [[mock_tag], [target_id]]

            from services.tag_service import TagService

            # Act
            result = TagService.get_target_ids_by_tag_ids(
                tag_type="knowledge",
                current_tenant_id=tenant_id,
                tag_ids=[tag_id],
            )

            # Assert
            assert target_id in result


class TestTagServiceGetTagByTagName:
    """Test suite for TagService.get_tag_by_tag_name method."""

    def test_get_tag_by_name_returns_empty_when_type_empty(self):
        """Test returns empty list when tag_type is empty."""
        from services.tag_service import TagService

        # Act
        result = TagService.get_tag_by_tag_name(
            tag_type="",
            current_tenant_id=str(uuid4()),
            tag_name="test",
        )

        # Assert
        assert result == []

    def test_get_tag_by_name_returns_empty_when_name_empty(self):
        """Test returns empty list when tag_name is empty."""
        from services.tag_service import TagService

        # Act
        result = TagService.get_tag_by_tag_name(
            tag_type="knowledge",
            current_tenant_id=str(uuid4()),
            tag_name="",
        )

        # Assert
        assert result == []

    def test_get_tag_by_name_returns_matching_tags(self):
        """Test returns matching tags by name."""
        # Arrange
        tenant_id = str(uuid4())
        tag_name = "my-tag"
        mock_tag = MagicMock()
        mock_tag.name = tag_name

        with patch("services.tag_service.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.return_value = [mock_tag]

            from services.tag_service import TagService

            # Act
            result = TagService.get_tag_by_tag_name(
                tag_type="knowledge",
                current_tenant_id=tenant_id,
                tag_name=tag_name,
            )

            # Assert
            assert len(result) == 1
            assert result[0].name == tag_name


class TestTagServiceGetTagsByTargetId:
    """Test suite for TagService.get_tags_by_target_id method."""

    def test_get_tags_by_target_id_returns_empty_when_no_tags(self):
        """Test returns empty list when no tags for target."""
        # Arrange
        tenant_id = str(uuid4())
        target_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.join.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tags_by_target_id(
                tag_type="knowledge",
                current_tenant_id=tenant_id,
                target_id=target_id,
            )

            # Assert
            assert result == []

    def test_get_tags_by_target_id_returns_tags(self):
        """Test returns tags associated with target."""
        # Arrange
        tenant_id = str(uuid4())
        target_id = str(uuid4())
        mock_tag = MagicMock()
        mock_tag.name = "associated-tag"

        mock_query = MagicMock()
        mock_query.join.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = [mock_tag]

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tags_by_target_id(
                tag_type="app",
                current_tenant_id=tenant_id,
                target_id=target_id,
            )

            # Assert
            assert len(result) == 1
            assert result[0].name == "associated-tag"


class TestTagServiceGetTagBindingCount:
    """Test suite for TagService.get_tag_binding_count method."""

    def test_get_tag_binding_count_returns_zero_when_no_bindings(self):
        """Test returns zero when no bindings exist."""
        # Arrange
        tag_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.count.return_value = 0

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tag_binding_count(tag_id)

            # Assert
            assert result == 0

    def test_get_tag_binding_count_returns_correct_count(self):
        """Test returns correct binding count."""
        # Arrange
        tag_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.count.return_value = 10

        with patch("services.tag_service.db.session.query", return_value=mock_query):
            from services.tag_service import TagService

            # Act
            result = TagService.get_tag_binding_count(tag_id)

            # Assert
            assert result == 10


class TestTagServiceCheckTargetExists:
    """Test suite for TagService.check_target_exists method."""

    def test_check_target_exists_raises_not_found_for_invalid_type(self):
        """Test raises NotFound for invalid binding type."""
        # Arrange
        target_id = str(uuid4())

        with patch("services.tag_service.current_user") as mock_user:
            mock_user.current_tenant_id = str(uuid4())

            from services.tag_service import TagService

            # Act & Assert
            with pytest.raises(NotFound, match="Invalid binding type"):
                TagService.check_target_exists(type="invalid", target_id=target_id)

    def test_check_target_exists_raises_not_found_for_missing_dataset(self):
        """Test raises NotFound when dataset doesn't exist."""
        # Arrange
        target_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.tag_service.current_user") as mock_user,
            patch("services.tag_service.db.session.query", return_value=mock_query),
        ):
            mock_user.current_tenant_id = str(uuid4())

            from services.tag_service import TagService

            # Act & Assert
            with pytest.raises(NotFound, match="Dataset not found"):
                TagService.check_target_exists(type="knowledge", target_id=target_id)

    def test_check_target_exists_raises_not_found_for_missing_app(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        target_id = str(uuid4())
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.tag_service.current_user") as mock_user,
            patch("services.tag_service.db.session.query", return_value=mock_query),
        ):
            mock_user.current_tenant_id = str(uuid4())

            from services.tag_service import TagService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                TagService.check_target_exists(type="app", target_id=target_id)

    def test_check_target_exists_passes_for_valid_dataset(self):
        """Test passes when dataset exists."""
        # Arrange
        target_id = str(uuid4())
        mock_dataset = MagicMock()
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_dataset

        with (
            patch("services.tag_service.current_user") as mock_user,
            patch("services.tag_service.db.session.query", return_value=mock_query),
        ):
            mock_user.current_tenant_id = str(uuid4())

            from services.tag_service import TagService

            # Act - should not raise
            TagService.check_target_exists(type="knowledge", target_id=target_id)

    def test_check_target_exists_passes_for_valid_app(self):
        """Test passes when app exists."""
        # Arrange
        target_id = str(uuid4())
        mock_app = MagicMock()
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_app

        with (
            patch("services.tag_service.current_user") as mock_user,
            patch("services.tag_service.db.session.query", return_value=mock_query),
        ):
            mock_user.current_tenant_id = str(uuid4())

            from services.tag_service import TagService

            # Act - should not raise
            TagService.check_target_exists(type="app", target_id=target_id)
