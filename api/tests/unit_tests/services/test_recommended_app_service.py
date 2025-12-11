"""
Comprehensive unit tests for RecommendedAppService.

This test suite provides complete coverage of recommended app operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Get Recommended Apps and Categories (TestRecommendedAppServiceGetApps)
Tests fetching recommended apps with categories:
- Successful retrieval with recommended apps
- Fallback to builtin when no recommended apps
- Different language support
- Factory mode selection (remote, builtin, db)
- Empty result handling

### 2. Get Recommend App Detail (TestRecommendedAppServiceGetDetail)
Tests fetching individual app details:
- Successful app detail retrieval
- Different factory modes
- App not found scenarios
- Language-specific details

## Testing Approach

- **Mocking Strategy**: All external dependencies (dify_config, RecommendAppRetrievalFactory)
  are mocked for fast, isolated unit tests
- **Factory Pattern**: Tests verify correct factory selection based on mode
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and factory method calls

## Key Concepts

**Factory Modes:**
- remote: Fetch from remote API
- builtin: Use built-in templates
- db: Fetch from database

**Fallback Logic:**
- If remote/db returns no apps, fallback to builtin en-US templates
- Ensures users always see some recommended apps
"""

from unittest.mock import MagicMock, patch

import pytest

from services.recommended_app_service import RecommendedAppService


class RecommendedAppServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    recommended app operations.
    """

    @staticmethod
    def create_recommended_apps_response(
        recommended_apps: list[dict] | None = None,
        categories: list[str] | None = None,
    ) -> dict:
        """
        Create a mock response for recommended apps.

        Args:
            recommended_apps: List of recommended app dictionaries
            categories: List of category names

        Returns:
            Dictionary with recommended_apps and categories
        """
        if recommended_apps is None:
            recommended_apps = [
                {
                    "id": "app-1",
                    "name": "Test App 1",
                    "description": "Test description 1",
                    "category": "productivity",
                },
                {
                    "id": "app-2",
                    "name": "Test App 2",
                    "description": "Test description 2",
                    "category": "communication",
                },
            ]
        if categories is None:
            categories = ["productivity", "communication", "utilities"]

        return {
            "recommended_apps": recommended_apps,
            "categories": categories,
        }

    @staticmethod
    def create_app_detail_response(
        app_id: str = "app-123",
        name: str = "Test App",
        description: str = "Test description",
        **kwargs,
    ) -> dict:
        """
        Create a mock response for app detail.

        Args:
            app_id: App identifier
            name: App name
            description: App description
            **kwargs: Additional fields

        Returns:
            Dictionary with app details
        """
        detail = {
            "id": app_id,
            "name": name,
            "description": description,
            "category": kwargs.get("category", "productivity"),
            "icon": kwargs.get("icon", "🚀"),
            "model_config": kwargs.get("model_config", {}),
        }
        detail.update(kwargs)
        return detail


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return RecommendedAppServiceTestDataFactory


class TestRecommendedAppServiceGetApps:
    """Test get_recommended_apps_and_categories operations."""

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommended_apps_success_with_apps(self, mock_config, mock_factory_class, factory):
        """Test successful retrieval of recommended apps when apps are returned."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"

        expected_response = factory.create_recommended_apps_response()

        # Mock factory and retrieval instance
        mock_retrieval_instance = MagicMock()
        mock_retrieval_instance.get_recommended_apps_and_categories.return_value = expected_response

        mock_factory = MagicMock()
        mock_factory.return_value = mock_retrieval_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        # Act
        result = RecommendedAppService.get_recommended_apps_and_categories("en-US")

        # Assert
        assert result == expected_response
        assert len(result["recommended_apps"]) == 2
        assert len(result["categories"]) == 3
        mock_factory_class.get_recommend_app_factory.assert_called_once_with("remote")
        mock_retrieval_instance.get_recommended_apps_and_categories.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommended_apps_fallback_to_builtin_when_empty(self, mock_config, mock_factory_class, factory):
        """Test fallback to builtin when no recommended apps are returned."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"

        # Remote returns empty recommended_apps
        empty_response = {"recommended_apps": [], "categories": []}

        # Builtin fallback response
        builtin_response = factory.create_recommended_apps_response(
            recommended_apps=[{"id": "builtin-1", "name": "Builtin App", "category": "default"}]
        )

        # Mock remote retrieval instance (returns empty)
        mock_remote_instance = MagicMock()
        mock_remote_instance.get_recommended_apps_and_categories.return_value = empty_response

        mock_remote_factory = MagicMock()
        mock_remote_factory.return_value = mock_remote_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_remote_factory

        # Mock builtin retrieval instance
        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        # Act
        result = RecommendedAppService.get_recommended_apps_and_categories("zh-CN")

        # Assert
        assert result == builtin_response
        assert len(result["recommended_apps"]) == 1
        assert result["recommended_apps"][0]["id"] == "builtin-1"
        # Verify fallback was called with en-US (hardcoded)
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommended_apps_fallback_when_none_recommended_apps(self, mock_config, mock_factory_class, factory):
        """Test fallback when recommended_apps key is None."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "db"

        # Response with None recommended_apps
        none_response = {"recommended_apps": None, "categories": ["test"]}

        # Builtin fallback response
        builtin_response = factory.create_recommended_apps_response()

        # Mock db retrieval instance (returns None)
        mock_db_instance = MagicMock()
        mock_db_instance.get_recommended_apps_and_categories.return_value = none_response

        mock_db_factory = MagicMock()
        mock_db_factory.return_value = mock_db_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_db_factory

        # Mock builtin retrieval instance
        mock_builtin_instance = MagicMock()
        mock_builtin_instance.fetch_recommended_apps_from_builtin.return_value = builtin_response
        mock_factory_class.get_buildin_recommend_app_retrieval.return_value = mock_builtin_instance

        # Act
        result = RecommendedAppService.get_recommended_apps_and_categories("en-US")

        # Assert
        assert result == builtin_response
        mock_builtin_instance.fetch_recommended_apps_from_builtin.assert_called_once()

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommended_apps_with_different_languages(self, mock_config, mock_factory_class, factory):
        """Test retrieval with different language codes."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "builtin"

        languages = ["en-US", "zh-CN", "ja-JP", "fr-FR"]

        for language in languages:
            # Create language-specific response
            lang_response = factory.create_recommended_apps_response(
                recommended_apps=[{"id": f"app-{language}", "name": f"App {language}", "category": "test"}]
            )

            # Mock retrieval instance
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = lang_response

            mock_factory = MagicMock()
            mock_factory.return_value = mock_instance
            mock_factory_class.get_recommend_app_factory.return_value = mock_factory

            # Act
            result = RecommendedAppService.get_recommended_apps_and_categories(language)

            # Assert
            assert result["recommended_apps"][0]["id"] == f"app-{language}"
            mock_instance.get_recommended_apps_and_categories.assert_called_with(language)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommended_apps_uses_correct_factory_mode(self, mock_config, mock_factory_class, factory):
        """Test that correct factory is selected based on mode."""
        # Arrange
        modes = ["remote", "builtin", "db"]

        for mode in modes:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode

            response = factory.create_recommended_apps_response()

            # Mock retrieval instance
            mock_instance = MagicMock()
            mock_instance.get_recommended_apps_and_categories.return_value = response

            mock_factory = MagicMock()
            mock_factory.return_value = mock_instance
            mock_factory_class.get_recommend_app_factory.return_value = mock_factory

            # Act
            RecommendedAppService.get_recommended_apps_and_categories("en-US")

            # Assert
            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)


class TestRecommendedAppServiceGetDetail:
    """Test get_recommend_app_detail operations."""

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommend_app_detail_success(self, mock_config, mock_factory_class, factory):
        """Test successful retrieval of app detail."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        app_id = "app-123"

        expected_detail = factory.create_app_detail_response(
            app_id=app_id,
            name="Productivity App",
            description="A great productivity app",
            category="productivity",
        )

        # Mock retrieval instance
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = expected_detail

        mock_factory = MagicMock()
        mock_factory.return_value = mock_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        # Act
        result = RecommendedAppService.get_recommend_app_detail(app_id)

        # Assert
        assert result == expected_detail
        assert result["id"] == app_id
        assert result["name"] == "Productivity App"
        mock_instance.get_recommend_app_detail.assert_called_once_with(app_id)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommend_app_detail_with_different_modes(self, mock_config, mock_factory_class, factory):
        """Test app detail retrieval with different factory modes."""
        # Arrange
        modes = ["remote", "builtin", "db"]
        app_id = "test-app"

        for mode in modes:
            mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = mode

            detail = factory.create_app_detail_response(app_id=app_id, name=f"App from {mode}")

            # Mock retrieval instance
            mock_instance = MagicMock()
            mock_instance.get_recommend_app_detail.return_value = detail

            mock_factory = MagicMock()
            mock_factory.return_value = mock_instance
            mock_factory_class.get_recommend_app_factory.return_value = mock_factory

            # Act
            result = RecommendedAppService.get_recommend_app_detail(app_id)

            # Assert
            assert result["name"] == f"App from {mode}"
            mock_factory_class.get_recommend_app_factory.assert_called_with(mode)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommend_app_detail_returns_none_when_not_found(self, mock_config, mock_factory_class, factory):
        """Test that None is returned when app is not found."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        app_id = "nonexistent-app"

        # Mock retrieval instance returning None
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = None

        mock_factory = MagicMock()
        mock_factory.return_value = mock_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        # Act
        result = RecommendedAppService.get_recommend_app_detail(app_id)

        # Assert
        assert result is None
        mock_instance.get_recommend_app_detail.assert_called_once_with(app_id)

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommend_app_detail_returns_empty_dict(self, mock_config, mock_factory_class, factory):
        """Test handling of empty dict response."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "builtin"
        app_id = "app-empty"

        # Mock retrieval instance returning empty dict
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = {}

        mock_factory = MagicMock()
        mock_factory.return_value = mock_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        # Act
        result = RecommendedAppService.get_recommend_app_detail(app_id)

        # Assert
        assert result == {}

    @patch("services.recommended_app_service.RecommendAppRetrievalFactory")
    @patch("services.recommended_app_service.dify_config")
    def test_get_recommend_app_detail_with_complex_model_config(self, mock_config, mock_factory_class, factory):
        """Test app detail with complex model configuration."""
        # Arrange
        mock_config.HOSTED_FETCH_APP_TEMPLATES_MODE = "remote"
        app_id = "complex-app"

        complex_model_config = {
            "provider": "openai",
            "model": "gpt-4",
            "parameters": {
                "temperature": 0.7,
                "max_tokens": 2000,
                "top_p": 1.0,
            },
        }

        expected_detail = factory.create_app_detail_response(
            app_id=app_id,
            name="Complex App",
            model_config=complex_model_config,
            workflows=["workflow-1", "workflow-2"],
            tools=["tool-1", "tool-2", "tool-3"],
        )

        # Mock retrieval instance
        mock_instance = MagicMock()
        mock_instance.get_recommend_app_detail.return_value = expected_detail

        mock_factory = MagicMock()
        mock_factory.return_value = mock_instance
        mock_factory_class.get_recommend_app_factory.return_value = mock_factory

        # Act
        result = RecommendedAppService.get_recommend_app_detail(app_id)

        # Assert
        assert result["model_config"] == complex_model_config
        assert len(result["workflows"]) == 2
        assert len(result["tools"]) == 3
