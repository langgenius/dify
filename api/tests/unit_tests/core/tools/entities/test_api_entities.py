"""
Unit tests for ToolProviderApiEntity workflow_app_id field.

This test suite covers:
- ToolProviderApiEntity workflow_app_id field creation and default value
- ToolProviderApiEntity.to_dict() method behavior with workflow_app_id
"""

from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType


class TestToolProviderApiEntityWorkflowAppId:
    """Test suite for ToolProviderApiEntity workflow_app_id field."""

    def test_workflow_app_id_field_default_none(self):
        """Test that workflow_app_id defaults to None when not provided."""
        entity = ToolProviderApiEntity(
            id="test_id",
            author="test_author",
            name="test_name",
            description=I18nObject(en_US="Test description"),
            icon="test_icon",
            label=I18nObject(en_US="Test label"),
            type=ToolProviderType.WORKFLOW,
        )

        assert entity.workflow_app_id is None

    def test_to_dict_includes_workflow_app_id_when_workflow_type_and_has_value(self):
        """Test that to_dict() includes workflow_app_id when type is WORKFLOW and value is set."""
        workflow_app_id = "app_123"
        entity = ToolProviderApiEntity(
            id="test_id",
            author="test_author",
            name="test_name",
            description=I18nObject(en_US="Test description"),
            icon="test_icon",
            label=I18nObject(en_US="Test label"),
            type=ToolProviderType.WORKFLOW,
            workflow_app_id=workflow_app_id,
        )

        result = entity.to_dict()

        assert "workflow_app_id" in result
        assert result["workflow_app_id"] == workflow_app_id

    def test_to_dict_excludes_workflow_app_id_when_workflow_type_and_none(self):
        """Test that to_dict() excludes workflow_app_id when type is WORKFLOW but value is None."""
        entity = ToolProviderApiEntity(
            id="test_id",
            author="test_author",
            name="test_name",
            description=I18nObject(en_US="Test description"),
            icon="test_icon",
            label=I18nObject(en_US="Test label"),
            type=ToolProviderType.WORKFLOW,
            workflow_app_id=None,
        )

        result = entity.to_dict()

        assert "workflow_app_id" not in result

    def test_to_dict_excludes_workflow_app_id_when_not_workflow_type(self):
        """Test that to_dict() excludes workflow_app_id when type is not WORKFLOW."""
        workflow_app_id = "app_123"
        entity = ToolProviderApiEntity(
            id="test_id",
            author="test_author",
            name="test_name",
            description=I18nObject(en_US="Test description"),
            icon="test_icon",
            label=I18nObject(en_US="Test label"),
            type=ToolProviderType.BUILT_IN,
            workflow_app_id=workflow_app_id,
        )

        result = entity.to_dict()

        assert "workflow_app_id" not in result

    def test_to_dict_includes_workflow_app_id_for_workflow_type_with_empty_string(self):
        """Test that to_dict() excludes workflow_app_id when value is empty string (falsy)."""
        entity = ToolProviderApiEntity(
            id="test_id",
            author="test_author",
            name="test_name",
            description=I18nObject(en_US="Test description"),
            icon="test_icon",
            label=I18nObject(en_US="Test label"),
            type=ToolProviderType.WORKFLOW,
            workflow_app_id="",
        )

        result = entity.to_dict()

        assert "workflow_app_id" not in result
