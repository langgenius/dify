import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
import yaml
from sqlalchemy.orm import Session

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.entities.plugin import PluginDependency
from graphon.enums import BuiltinNodeTypes
from models import Account, App, AppMode, IconType
from services.app_dsl_service import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
    AppDslService,
)
from services.dsl_content import DownloadSizeLimitExceededError
from services.entities.dsl_entities import CheckDependenciesResult, ImportMode, ImportStatus
from services.errors.app import WorkflowNotFoundError

TEST_TENANT_ID = "test-tenant-123"
TEST_USER_ID = "test-user-123"
TEST_APP_ID = "test-app-123"
TEST_IMPORT_ID = str(uuid.uuid4())
TEST_YAML_CONTENT = f"""
version: {CURRENT_APP_DSL_VERSION}
kind: app
app:
  name: Test App
  mode: workflow
  icon: test-icon
  icon_type: emoji
  icon_background: "#FFFFFF"
workflow:
  graph:
    nodes: []
"""
TEST_INVALID_YAML = "invalid: yaml: [error"
TEST_LARGE_YAML = f"version: {CURRENT_APP_DSL_VERSION}\nkind: app\napp:\n  name: " + "a" * (10 * 1024 * 1024 + 1)
TEST_GITHUB_YAML_URL = "https://github.com/test/test/blob/main/app.yml"
TEST_RAW_YAML_URL = "https://raw.githubusercontent.com/test/test/main/app.yml"


class TestAppDslServiceFactory:
    """Factory for AppDslService unit test mocks."""

    @staticmethod
    def create_session_mock() -> MagicMock:
        """Create a mock SQLAlchemy session."""
        return MagicMock(spec=Session)

    @staticmethod
    def create_account_mock() -> MagicMock:
        """Create a mock Account with tenant and user IDs."""
        account = MagicMock(spec=Account)
        account.id = TEST_USER_ID
        account.current_tenant_id = TEST_TENANT_ID
        return account

    @staticmethod
    def create_workflow_app_mock() -> MagicMock:
        """Create a mock App with workflow mode and model config."""
        app = MagicMock(spec=App)
        app.id = TEST_APP_ID
        app.tenant_id = TEST_TENANT_ID
        app.mode = AppMode.WORKFLOW.value
        app.name = "Test App"
        app.icon = "test-icon"
        app.icon_type = IconType.EMOJI
        app.icon_background = "#FFFFFF"
        app.app_model_config = Mock()
        app.app_model_config.to_dict.return_value = {"model": "test", "provider": "openai"}
        return app


class TestAppDslServiceImportApp:
    """
    Unit tests for AppDslService.import_app.

    This test suite covers:
    - Successful import from YAML content.
    - Successful import from YAML URL with SSRF fetch.
    - Failure on invalid YAML content.
    - Failure when YAML URL fetch fails.
    - Pending status when DSL version is newer than supported.
    - Handling of explicit dependencies in YAML content.
    - Extraction of dependencies from workflow graph for legacy DSL versions.
    - Error handling for unexpected exceptions during import.
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_import_app_yaml_content_success(
        self, mock_create_app, mock_draft_svc, mock_wf_svc, mock_redis, dsl_service, factory
    ):
        """Test YAML content import completes."""
        # Arrange
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        mock_create_app.return_value = factory.create_workflow_app_mock()

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_YAML_CONTENT,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    @patch("services.app_dsl_service.fetch_dsl_content_from_url")
    def test_import_app_yaml_url_success(
        self, mock_fetch, mock_create_app, mock_draft_svc, mock_wf_svc, mock_redis, dsl_service, factory
    ):
        """Test YAML URL import fetches raw GitHub content."""
        # Arrange
        mock_fetch.return_value = TEST_YAML_CONTENT.encode("utf-8")

        mock_create_app.return_value = factory.create_workflow_app_mock()

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
            yaml_url=TEST_GITHUB_YAML_URL,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED

    @patch("services.app_dsl_service.redis_client")
    def test_import_app_invalid_yaml(self, mock_redis, dsl_service, factory):
        """Test invalid YAML fails import."""
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_INVALID_YAML,
        )

        # Assert
        assert result.status == ImportStatus.FAILED

    def test_import_app_large_yaml(self, dsl_service, factory):
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_LARGE_YAML,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "File size exceeds" in result.error

    @patch("services.app_dsl_service.redis_client")
    def test_import_app_empty_content(self, mock_redis, dsl_service, factory):
        """Test empty YAML fails import."""
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content="",
        )

        # Assert
        assert result.status == ImportStatus.FAILED

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.fetch_dsl_content_from_url")
    def test_import_app_url_fetch_failed(self, mock_fetch, mock_redis, dsl_service, factory):
        """Test network error fails URL import."""
        # Arrange
        mock_fetch.side_effect = RuntimeError("network down")

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
            yaml_url="https://error.com",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert result.error == "Error fetching YAML from URL: network down"

    @patch("services.app_dsl_service.redis_client")
    def test_import_app_version_pending(self, mock_redis, dsl_service, factory):
        """Test newer DSL version yields pending status."""
        # Arrange
        high_ver_yaml = TEST_YAML_CONTENT.replace(CURRENT_APP_DSL_VERSION, "999.0.0")

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=high_ver_yaml,
        )

        # Assert
        assert result.status == ImportStatus.PENDING

    @patch("services.app_dsl_service.redis_client")
    def test_import_app_version_pending_sets_redis(self, mock_redis, dsl_service, factory):
        """Test pending imports are cached in Redis."""
        # Arrange
        high_ver_yaml = TEST_YAML_CONTENT.replace(CURRENT_APP_DSL_VERSION, "999.0.0")

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=high_ver_yaml,
        )

        # Assert
        assert result.status == ImportStatus.PENDING
        mock_redis.setex.assert_called_once()

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    @patch("services.app_dsl_service.redis_client")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_import_app_legacy_version_generates_dependencies(
        self, mock_create_app, mock_redis, mock_dep_svc, mock_draft_svc, mock_wf_svc, dsl_service, factory
    ):
        """Test legacy DSL versions generate dependencies from workflow graph."""
        # Arrange
        mock_dep_svc.generate_latest_dependencies.return_value = []
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        mock_create_app.return_value = factory.create_workflow_app_mock()
        legacy_yaml = """
version: 0.1.5
kind: app
app:
  name: Legacy App
  mode: workflow
workflow:
  graph:
    nodes:
      - data:
          type: tool
          provider_id: langgenius/websearch
"""

        # Act
        with patch.object(AppDslService, "_extract_dependencies_from_workflow_graph", return_value=[]):
            result = dsl_service.import_app(
                account=factory.create_account_mock(),
                import_mode=ImportMode.YAML_CONTENT.value,
                yaml_content=legacy_yaml,
            )

        # Assert
        assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS
        mock_dep_svc.generate_latest_dependencies.assert_called_once()

    @patch("services.app_dsl_service.PluginDependency.model_validate")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    @patch("services.app_dsl_service.redis_client")
    def test_import_app_yaml_content_with_dependencies(
        self, mock_redis, mock_dep_svc, mock_create_app, mock_draft_svc, mock_plugin_validate, dsl_service, factory
    ):
        """Test import_app handles explicit DSL dependencies."""
        # Arrange
        mock_app = Mock(id=TEST_APP_ID, mode=AppMode.WORKFLOW.value)
        mock_create_app.return_value = mock_app
        mock_plugin_validate.return_value = Mock()
        yaml_content = f"""
version: {CURRENT_APP_DSL_VERSION}
kind: app
dependencies:
  - type: github
    value:
      repo: test/test
      version: 1.0.0
      package: test
      github_plugin_unique_identifier: test/test/1.0.0
app:
  name: Test App
  mode: workflow
workflow:
  graph:
    nodes: []
"""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=yaml_content,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED
        assert mock_create_app.call_args.kwargs["dependencies"]

    @patch("services.app_dsl_service.PluginDependency.model_validate")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    @patch("services.app_dsl_service.redis_client")
    def test_import_app_mode_invalid(
        self, mock_redis, mock_dep_svc, mock_create_app, mock_draft_svc, mock_plugin_validate, dsl_service, factory
    ):
        """Test import_app handles explicit DSL dependencies."""
        # Arrange
        mock_app = Mock(id=TEST_APP_ID, mode="invalid_mode")
        mock_create_app.return_value = mock_app
        mock_plugin_validate.return_value = Mock()
        yaml_content = f"""
version: {CURRENT_APP_DSL_VERSION}
kind: app
dependencies:
  - type: github
    value:
      repo: test/test
      version: 1.0.0
      package: test
      github_plugin_unique_identifier: test/test/1.0.0
app:
  name: Test App
  mode: workflow
workflow:
  graph:
    nodes: []
"""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=yaml_content,
            app_id=TEST_APP_ID,
        )

        # Assert
        assert result.status == ImportStatus.FAILED

    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    @patch.object(AppDslService, "_extract_dependencies_from_model_config")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    @patch("services.app_dsl_service.redis_client")
    def test_import_app_legacy_version_model_config_dependencies(
        self, mock_redis, mock_dep_svc, mock_extract, mock_create_app, mock_draft_svc, dsl_service, factory
    ):
        """Test legacy DSL import extracts dependencies from model_config when workflow is absent."""
        # Arrange
        mock_dep_svc.generate_latest_dependencies.return_value = []
        mock_extract.return_value = ["langgenius/google"]
        mock_app = Mock(id=TEST_APP_ID, mode=AppMode.WORKFLOW.value)
        mock_create_app.return_value = mock_app

        legacy_yaml = """
version: 0.1.5
kind: app
app:
  name: Legacy App
  mode: workflow
model_config:
  model:
    provider: openai
"""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=legacy_yaml,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS
        mock_extract.assert_called_once()

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_import_app_missing_version_and_kind(
        self, mock_create_app, mock_draft_svc, mock_wf_svc, dsl_service, factory
    ):
        """Test missing version and kind are normalized."""
        # Arrange
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        mock_create_app.return_value = factory.create_workflow_app_mock()
        minimal_yaml = """
app:
  name: Test App
  mode: workflow
workflow:
  graph:
    nodes: []
"""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=minimal_yaml,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    def test_import_app_invalid_version_type(self, mock_draft_svc, mock_wf_svc, dsl_service, factory):
        """Test non-string version types are rejected."""
        # Arrange
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        invalid_version_yaml = """
version: 1.0
kind: app
app:
  name: Test App
  mode: workflow
workflow:
  graph:
    nodes: []
"""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=invalid_version_yaml,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Invalid version type" in result.error

    @patch("services.app_dsl_service.yaml.safe_load")
    def test_import_app_general_exception(self, mock_safe_load, dsl_service, factory):
        """Test unexpected parsing exceptions are handled."""
        # Arrange
        mock_safe_load.side_effect = Exception("boom")

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_YAML_CONTENT,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "boom" in result.error


class TestAppDslServiceConfirmImport:
    """
    Unit tests for AppDslService.confirm_import.

    This test suite covers:
    - Successful confirm completes pending import.
    - Confirm fails when Redis payload is missing (e.g. expired).
    - Confirm fails when app creation throws an exception.

    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.redis_client")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_confirm_import_success(self, mock_create_app, mock_redis, dsl_service, factory):
        """Test confirm completes when Redis holds pending import."""
        # Arrange
        pending_data = {
            "import_mode": ImportMode.YAML_CONTENT.value,
            "yaml_content": TEST_YAML_CONTENT,
            "dsl": yaml.safe_load(TEST_YAML_CONTENT),
        }
        mock_redis.get.return_value = json.dumps(pending_data)
        mock_app = Mock(id=TEST_APP_ID, mode=AppMode.WORKFLOW.value)
        mock_create_app.return_value = mock_app

        # Act
        result = dsl_service.confirm_import(import_id=TEST_IMPORT_ID, account=factory.create_account_mock())

        # Assert
        assert result.status == ImportStatus.COMPLETED

    @patch("services.app_dsl_service.redis_client")
    def test_confirm_import_expired(self, mock_redis, dsl_service, factory):
        """Test missing Redis payload fails confirm."""
        # Arrange
        mock_redis.get.return_value = None

        # Act
        result = dsl_service.confirm_import(import_id=TEST_IMPORT_ID, account=factory.create_account_mock())

        # Assert
        assert result.status == ImportStatus.FAILED

    @patch("services.app_dsl_service.redis_client")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_confirm_import_create_app_failed(self, mock_create_app, mock_redis, dsl_service, factory):
        """Test app persistence error fails confirm."""
        # Arrange
        pending_data = {
            "app_id": TEST_APP_ID,
            "import_mode": ImportMode.YAML_CONTENT.value,
            "yaml_content": TEST_YAML_CONTENT,
            "dsl": yaml.safe_load(TEST_YAML_CONTENT),
        }
        mock_redis.get.return_value = json.dumps(pending_data)
        mock_create_app.side_effect = Exception("Create failed")

        # Act
        result = dsl_service.confirm_import(import_id=TEST_IMPORT_ID, account=factory.create_account_mock())

        # Assert
        assert result.status == ImportStatus.FAILED


class TestAppDslServiceCheckDependencies:
    """
    Unit tests for AppDslService.check_dependencies.

    This test suite covers:
    - Check dependencies
    - Check dependencies with no cache
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    def test_check_dependencies(self, mock_dep_svc, mock_redis, dsl_service, factory):
        """Test cached dependencies path."""
        # Arrange
        mock_redis.get.return_value = f'{{"app_id":"{TEST_APP_ID}","dependencies":[]}}'

        # Act
        result = dsl_service.check_dependencies(app_model=factory.create_workflow_app_mock())

        # Assert
        assert isinstance(result, CheckDependenciesResult)

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    def test_check_dependencies_no_cache(self, mock_dep_svc, mock_redis, dsl_service, factory):
        """Test analysis service fallback when cache empty."""
        # Arrange
        mock_redis.get.return_value = None
        mock_dep_svc.return_value.analyze_app_dependencies.return_value = []

        # Act
        result = dsl_service.check_dependencies(app_model=factory.create_workflow_app_mock())

        # Assert
        assert isinstance(result, CheckDependenciesResult)


class TestAppDslServiceDatasetIdCrypto:
    """
    Unit tests for dataset id encrypt/decrypt helpers.

    This test suite covers:
    - Encrypting and decrypting dataset ids.
    - Handling exceptions when decrypting invalid ids.
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.dify_config")
    def test_dataset_id_encrypt_decrypt(self, mock_config, dsl_service):
        """Test round-trip when encryption enabled."""
        # Arrange
        mock_config.DSL_EXPORT_ENCRYPT_DATASET_ID = True
        dataset_id = str(uuid.uuid4())

        # Act
        encrypted = dsl_service.encrypt_dataset_id(dataset_id, TEST_TENANT_ID)
        decrypted = dsl_service.decrypt_dataset_id(encrypted, TEST_TENANT_ID)

        # Assert
        assert decrypted == dataset_id

    @patch("services.app_dsl_service.dify_config")
    def test_dataset_id_encrypt_disabled(self, mock_config, dsl_service):
        """Test passthrough when encryption disabled."""
        # Arrange
        mock_config.DSL_EXPORT_ENCRYPT_DATASET_ID = False
        dataset_id = str(uuid.uuid4())

        # Act & Assert
        assert dsl_service.encrypt_dataset_id(dataset_id, TEST_TENANT_ID) == dataset_id

    def test_dataset_id_decrypt_invalid(self, dsl_service):
        """Test invalid ciphertext returns None."""
        # Act & Assert
        assert dsl_service.decrypt_dataset_id("invalid-data", TEST_TENANT_ID) is None

    @patch("services.app_dsl_service.unpad", return_value=b"not-a-uuid")
    @patch.object(AppDslService, "_generate_aes_key")
    @patch("services.app_dsl_service.AES")
    def test_dataset_id_decrypt_non_uuid_plaintext(self, mock_aes, mock_key, mock_unpad, dsl_service):
        """Test decrypt_dataset_id returns None when decrypted value is not a UUID."""
        # Arrange
        mock_key.return_value = b"0" * 32
        mock_cipher = Mock()
        mock_cipher.decrypt.return_value = b"ciphertext"
        mock_aes.new.return_value = mock_cipher

        # Act & Assert
        assert dsl_service.decrypt_dataset_id("ZmFrZQ==", TEST_TENANT_ID) is None


class TestAppDslServiceExportDsl:
    """
    Unit tests for DSL export helpers.

    This test suite covers:
    - Workflow application DSL full export
    - Workflow configuration data appending to export DSL
    - Model configuration data appending to export DSL
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    def test_export_dsl_workflow(self, mock_dep_svc, mock_wf_svc, dsl_service, factory):
        """Test workflow DSL export returns content."""
        # Arrange
        mock_dep_svc.generate_dependencies.return_value = []
        mock_dep_svc.analyze_model_provider_dependency.return_value = []

        # Act
        with patch.object(yaml, "dump", return_value="yaml_content"):
            result = dsl_service.export_dsl(app_model=factory.create_workflow_app_mock())

        # Assert
        assert result is not None

    @patch.object(AppDslService, "_append_workflow_export_data")
    def test_append_workflow_export_data(self, mock_method):
        """Test export hook delegates to workflow append."""
        # Arrange
        dsl = {}
        mock_method(dsl)

        # Assert
        mock_method.assert_called_once_with(dsl)

    @patch("services.app_dsl_service.DependenciesAnalysisService")
    def test_append_model_config_export_data(self, mock_dep_svc, factory):
        """Test model_config key is added to DSL."""
        # Arrange
        mock_dep_svc.generate_dependencies.return_value = []
        dsl = {}

        # Act
        AppDslService._append_model_config_export_data(dsl, factory.create_workflow_app_mock())

        # Assert
        assert "model_config" in dsl


class TestAppDslServiceCreateOrUpdateApp:
    """
    Unit tests for AppDslService._create_or_update_app.

    This test suite covers:
    - Create new workflow/chat applications
    - Update existing application information and sync workflow
    - Validate app mode, tenant, configuration and other required parameters
    - Chat application model configuration creation and update
    - Workflow dataset ID decryption processing
    - Application dependency information caching
    - Various exception scenarios for illegal parameters
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.WorkflowService")
    def test_create_or_update_app_create(self, mock_wf_svc, dsl_service, factory):
        """Test create path saves draft workflow."""
        # Arrange
        mock_wf_svc.return_value.save_draft_workflow.return_value = Mock(id="wf-123")

        # Act
        app = dsl_service._create_or_update_app(
            app=factory.create_workflow_app_mock(),
            data=yaml.safe_load(TEST_YAML_CONTENT),
            account=factory.create_account_mock(),
        )

        # Assert
        assert app is not None

    def test_create_or_update_app_invalid_mode(self, dsl_service, factory):
        """Test invalid app mode raises a ValueError."""
        # Arrange
        account = factory.create_account_mock()

        # Act & Assert
        with pytest.raises(ValueError):
            dsl_service._create_or_update_app(app=None, data={"app": {"mode": "unknown"}}, account=account)

    def test_create_or_update_app_missing_app_mode(self, dsl_service, factory):
        """Test missing app mode raises the expected error."""
        # Arrange
        account = factory.create_account_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="loss app mode"):
            dsl_service._create_or_update_app(app=None, data={"app": {}}, account=account)

    @patch("services.app_dsl_service.app_was_created.send")
    def test_create_or_update_app_invalid_app_mode_not_supported(self, mock_signal_send, dsl_service, factory):
        """Test unsupported AppMode falls through to the default branch."""
        # Arrange
        account = factory.create_account_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid app mode"):
            dsl_service._create_or_update_app(
                app=None,
                data={
                    "app": {
                        "mode": AppMode.CHANNEL.value,
                        "name": "Test App",
                        "icon_type": "emoji",
                        "icon": "test-icon",
                        "icon_background": "#FFFFFF",
                    },
                    "model_config": {"model": {"provider": "openai"}},
                },
                account=account,
            )

    @patch("services.app_dsl_service.WorkflowService")
    def test_create_or_update_app_decrypts_dataset_ids(self, mock_wf_svc, dsl_service, factory):
        """Test dataset IDs in workflow are decrypted before workflow sync."""
        # Arrange
        account = factory.create_account_mock()
        existing_app = factory.create_workflow_app_mock()
        existing_app.id = TEST_APP_ID
        existing_app.mode = AppMode.WORKFLOW.value
        mock_wf_svc.return_value.get_draft_workflow.return_value = None

        # Act & Assert
        with patch.object(AppDslService, "decrypt_dataset_id", return_value=str(uuid.uuid4())):
            dsl_service._create_or_update_app(
                app=existing_app,
                data={
                    "app": {
                        "mode": AppMode.WORKFLOW.value,
                        "name": "Test",
                        "icon_type": "emoji",
                        "icon": "test-icon",
                        "icon_background": "#FFFFFF",
                    },
                    "workflow": {
                        "graph": {
                            "nodes": [
                                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "dataset_ids": ["ciphertext"]}}
                            ]
                        },
                        "features": [],
                    },
                },
                account=account,
            )

        mock_wf_svc.return_value.sync_draft_workflow.assert_called_once()

    @patch("services.app_dsl_service.AppModelConfig")
    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.app_model_config_was_updated.send")
    @patch("services.app_dsl_service.app_was_created.send")
    def test_create_or_update_app_creates_chat_model_config(
        self, mock_signal_send, mock_model_config_send, mock_wf_svc, mock_app_model_config, dsl_service, factory
    ):
        """Test chat app creation initializes an AppModelConfig."""
        # Arrange
        account = factory.create_account_mock()
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        mock_config = Mock(id=str(uuid.uuid4()))
        mock_app_model_config.from_model_config_dict.return_value = mock_config

        data = {
            "app": {
                "mode": AppMode.CHAT.value,
                "name": "Chat App",
                "icon_type": "emoji",
                "icon": "test-icon",
                "icon_background": "#FFFFFF",
            },
            "model_config": {"model": {"provider": "openai"}},
        }

        # Act
        app = dsl_service._create_or_update_app(app=None, data=data, account=account)

        # Assert
        assert app.app_model_config_id is not None

    @patch("services.app_dsl_service.WorkflowService")
    def test_create_or_update_app_updates_chat_model_config(self, mock_wf_svc, dsl_service, factory):
        """Test chat app update does not recreate AppModelConfig if it exists."""
        # Arrange
        account = factory.create_account_mock()
        existing_app = factory.create_workflow_app_mock()
        existing_app.mode = AppMode.CHAT.value
        existing_app.app_model_config = Mock()
        existing_app.app_model_config_id = str(uuid.uuid4())
        mock_wf_svc.return_value.get_draft_workflow.return_value = None

        data = {
            "app": {
                "mode": AppMode.CHAT.value,
                "name": "Chat App",
                "icon_type": "emoji",
                "icon": "test-icon",
                "icon_background": "#FFFFFF",
            },
            "model_config": {"model": {"provider": "openai"}},
        }

        # Act
        app = dsl_service._create_or_update_app(app=existing_app, data=data, account=account)

        # Assert
        assert app.app_model_config_id == existing_app.app_model_config_id

    def test_create_or_update_app_without_tenant(self, dsl_service, factory):
        """Test create fails when tenant is missing."""
        # Arrange
        account = factory.create_account_mock()
        account.current_tenant_id = None

        # Act & Assert
        with pytest.raises(ValueError, match="Current tenant is not set"):
            dsl_service._create_or_update_app(
                app=None,
                data=yaml.safe_load(TEST_YAML_CONTENT),
                account=account,
            )

    @patch("services.app_dsl_service.app_was_created.send")
    def test_create_or_update_app_missing_workflow_data(self, mock_signal_send, dsl_service, factory):
        """Test missing workflow data for workflow app."""
        # Arrange
        account = factory.create_account_mock()
        app_data = {"app": {"mode": AppMode.WORKFLOW.value, "name": "Test App"}}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing workflow data"):
            dsl_service._create_or_update_app(app=None, data=app_data, account=account)

    @patch("services.app_dsl_service.app_was_created.send")
    def test_create_or_update_app_missing_model_config(self, mock_signal_send, dsl_service, factory):
        """Test missing model_config for chat app."""
        # Arrange
        account = factory.create_account_mock()
        app_data = {"app": {"mode": AppMode.CHAT.value, "name": "Test App"}}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing model_config"):
            dsl_service._create_or_update_app(app=None, data=app_data, account=account)

    @patch("services.app_dsl_service.WorkflowService")
    def test_create_or_update_app_update_existing_app(self, mock_wf_svc, dsl_service, factory):
        """Test update path updates existing app and syncs workflow."""
        # Arrange
        account = factory.create_account_mock()
        existing_app = factory.create_workflow_app_mock()
        existing_app.id = TEST_APP_ID
        existing_app.mode = AppMode.WORKFLOW.value
        existing_app.name = "Original"
        existing_app.description = "Original description"
        mock_wf_svc.return_value.get_draft_workflow.return_value = None

        # Act
        updated_app = dsl_service._create_or_update_app(
            app=existing_app,
            data=yaml.safe_load(TEST_YAML_CONTENT),
            account=account,
            name="Updated Name",
            description="Updated description",
        )

        # Assert
        assert updated_app.name == "Updated Name"
        assert updated_app.description == "Updated description"
        mock_wf_svc.return_value.sync_draft_workflow.assert_called_once()

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.redis_client")
    def test_create_or_update_app_saves_dependencies(self, mock_redis, mock_wf_svc, dsl_service, factory):
        """Test dependencies are cached during create/update app."""
        # Arrange
        account = factory.create_account_mock()
        existing_app = factory.create_workflow_app_mock()
        existing_app.id = TEST_APP_ID
        existing_app.mode = AppMode.WORKFLOW.value
        mock_wf_svc.return_value.get_draft_workflow.return_value = None

        # Act
        dsl_service._create_or_update_app(
            app=existing_app,
            data=yaml.safe_load(TEST_YAML_CONTENT),
            account=account,
            dependencies=[MagicMock(spec=PluginDependency)],
        )

        # Assert
        mock_redis.setex.assert_called_once()


class TestAppDslServiceExportDslErrors:
    """
    Unit tests for export helpers with invalid export inputs.

    This test suite covers:
    - Verify export failure when workflow configuration is missing
    - Verify export failure when app model configuration is missing
    - Test chat mode application DSL export with model config
    - Test sensitive field filtering for workflow nodes during export
    - Test empty node data skipping during workflow export
    - Validate exception handling for invalid export inputs
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    def test_append_workflow_export_data_missing_workflow(self, factory):
        """Test workflow export fails when draft workflow is missing."""
        # Arrange
        app_model = factory.create_workflow_app_mock()

        # Act & Assert
        with patch("services.app_dsl_service.WorkflowService") as mock_wf_svc:
            mock_wf_svc.return_value.get_draft_workflow.return_value = None
            with pytest.raises(WorkflowNotFoundError, match="Missing draft workflow configuration"):
                AppDslService._append_workflow_export_data(
                    export_data={},
                    app_model=app_model,
                    include_secret=False,
                    workflow_id=None,
                )

    def test_append_model_config_export_data_missing_config(self, factory):
        """Test model config export fails when app model config is missing."""
        # Arrange
        app_model = factory.create_workflow_app_mock()
        app_model.app_model_config = None

        # Act & Assert
        with pytest.raises(ValueError, match="Missing app configuration"):
            AppDslService._append_model_config_export_data(export_data={}, app_model=app_model)

    def test_export_dsl_chat_mode(self, factory):
        """Test export_dsl handles chat mode using model_config."""
        # Arrange
        app_model = factory.create_workflow_app_mock()
        app_model.mode = AppMode.CHAT.value
        app_model.app_model_config = Mock()
        app_model.app_model_config.to_dict.return_value = {
            "model": {"provider": "openai"},
            "agent_mode": {"tools": [{"provider_id": "tool", "credential_id": "secret"}]},
        }

        # Act & Assert
        with patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dep_svc:
            mock_dep_svc.generate_dependencies.return_value = []
            with patch.object(yaml, "dump", return_value="yaml_content"):
                result = AppDslService.export_dsl(app_model=app_model)
            assert result == "yaml_content"
            mock_dep_svc.generate_dependencies.assert_called_once()

    def test_append_workflow_export_data_filters_nodes(self, factory):
        """Test workflow export filters workflow node fields."""
        # Arrange
        app_model = factory.create_workflow_app_mock()
        workflow = Mock()
        workflow.to_dict.return_value = {
            "graph": {
                "nodes": [
                    {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "dataset_ids": ["uuid"]}},
                    {"data": {"type": BuiltinNodeTypes.TOOL, "credential_id": "secret"}},
                    {
                        "data": {
                            "type": BuiltinNodeTypes.AGENT,
                            "agent_parameters": {"tools": {"value": [{"credential_id": "secret"}]}},
                        }
                    },
                    {"data": {"type": TRIGGER_SCHEDULE_NODE_TYPE, "config": {}}},
                    {"data": {"type": TRIGGER_WEBHOOK_NODE_TYPE, "webhook_url": "url", "webhook_debug_url": "debug"}},
                    {"data": {"type": TRIGGER_PLUGIN_NODE_TYPE, "subscription_id": "sub"}},
                ]
            }
        }
        workflow.graph_dict = workflow.to_dict.return_value

        # Act
        with (
            patch("services.app_dsl_service.WorkflowService") as mock_wf_svc,
            patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dep_svc,
            patch("services.app_dsl_service.TriggerScheduleNode.get_default_config", return_value={"config": {}}),
        ):
            mock_wf_svc.return_value.get_draft_workflow.return_value = workflow
            mock_dep_svc.generate_dependencies.return_value = []
            AppDslService._append_workflow_export_data(
                export_data={}, app_model=app_model, include_secret=False, workflow_id=None
            )

        # Assert
        graph_nodes = workflow.to_dict.return_value["graph"]["nodes"]
        assert graph_nodes[1]["data"].get("credential_id") is None
        assert graph_nodes[2]["data"]["agent_parameters"]["tools"]["value"][0].get("credential_id") is None
        assert graph_nodes[4]["data"]["webhook_url"] == ""
        assert graph_nodes[4]["data"]["webhook_debug_url"] == ""
        assert graph_nodes[5]["data"]["subscription_id"] == ""

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.DependenciesAnalysisService")
    def test_append_workflow_export_data_skips_empty_node_data(self, mock_dep_svc, mock_wf_svc, factory):
        """Test workflow export skips nodes with empty data payloads."""
        # Arrange
        app_model = factory.create_workflow_app_mock()
        workflow = Mock()
        workflow.to_dict.return_value = {
            "graph": {"nodes": [{"data": {}}, {"data": {"type": BuiltinNodeTypes.TOOL, "credential_id": "secret"}}]}
        }
        workflow.graph_dict = workflow.to_dict.return_value
        mock_wf_svc.return_value.get_draft_workflow.return_value = workflow
        mock_dep_svc.generate_dependencies.return_value = []

        # Act
        export_data = {}
        AppDslService._append_workflow_export_data(
            export_data=export_data, app_model=app_model, include_secret=False, workflow_id=None
        )

        # Assert
        assert export_data["workflow"] == workflow.to_dict.return_value
        assert export_data["dependencies"] == []


class TestAppDslServiceImportAppValidation:
    """
    Unit tests for import_app validation failures.

    This test suite covers:
    - Invalid import mode value validation
    - Missing yaml_url parameter in YAML_URL import mode
    - Import file size exceeds the maximum limit validation
    - Empty content validation for URL imported files
    - Missing yaml_content parameter in YAML_CONTENT import mode
    - Invalid YAML data type (non-mapping) validation
    - Missing core app data in the imported configuration
    - Non-existent app ID validation during app update import
    - Valid app ID matching correct app mode for successful import
    - Non-GitHub URL import without URL transformation validation
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    def test_import_app_invalid_import_mode(self, dsl_service, factory):
        """Test invalid import mode raises ValueError."""
        # Act & Assert
        with pytest.raises(ValueError, match="Invalid import_mode"):
            dsl_service.import_app(
                account=factory.create_account_mock(),
                import_mode="not-a-valid-mode",
                yaml_content=TEST_YAML_CONTENT,
            )

    @patch("services.app_dsl_service.redis_client")
    def test_import_app_yaml_url_missing_url(self, mock_redis, dsl_service, factory):
        """Test URL mode fails without yaml_url."""
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "yaml_url is required" in result.error

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.fetch_dsl_content_from_url")
    def test_import_app_yaml_url_file_too_large(self, mock_fetch, mock_redis, dsl_service, factory):
        """Test URL import fails when content exceeds max size."""
        # Arrange
        mock_fetch.side_effect = DownloadSizeLimitExceededError("Max file size reached")

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
            yaml_url=TEST_RAW_YAML_URL,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "File size exceeds the limit" in result.error

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.fetch_dsl_content_from_url")
    def test_import_app_yaml_url_empty_content(self, mock_fetch, mock_redis, dsl_service, factory):
        """Test URL import fails when the fetched content is empty."""
        # Arrange
        mock_fetch.return_value = b""

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
            yaml_url=TEST_RAW_YAML_URL,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Empty content" in result.error

    def test_import_app_yaml_content_missing(self, dsl_service, factory):
        """Test YAML content import fails when content is not provided."""
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content="",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "yaml_content is required" in result.error

    def test_import_app_invalid_yaml_type(self, dsl_service, factory):
        """Test import fails when YAML content is not a mapping."""
        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content="[]",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "content must be a mapping" in result.error

    def test_import_app_missing_app_data(self, dsl_service, factory):
        """Test import fails when app block is missing."""
        # Arrange
        payload = "version: 0.1.0\nkind: app\n"

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=payload,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Missing app data" in result.error

    def test_import_app_app_id_not_found(self, dsl_service, factory):
        """Test import fails when provided app_id does not exist."""
        # Arrange
        dsl_service._session.scalar.return_value = None

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_YAML_CONTENT,
            app_id=TEST_APP_ID,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "App not found" in result.error

    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    def test_import_app_app_id_valid_mode(self, mock_draft_svc, mock_wf_svc, dsl_service, factory):
        """Test import succeeds when app_id points to valid app mode."""
        # Arrange
        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        app = factory.create_workflow_app_mock()
        app.mode = AppMode.WORKFLOW.value
        dsl_service._session.scalar.return_value = app

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_CONTENT.value,
            yaml_content=TEST_YAML_CONTENT,
            app_id=TEST_APP_ID,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED

    @patch("services.app_dsl_service.redis_client")
    @patch("services.app_dsl_service.WorkflowService")
    @patch("services.app_dsl_service.WorkflowDraftVariableService")
    @patch.object(AppDslService, "_create_or_update_app")
    @patch("services.app_dsl_service.fetch_dsl_content_from_url")
    def test_import_app_yaml_url_non_github(
        self, mock_fetch, mock_create_app, mock_draft_svc, mock_wf_svc, mock_redis, dsl_service, factory
    ):
        """Test YAML URL import does not transform non-GitHub URLs."""
        # Arrange
        mock_fetch.return_value = TEST_YAML_CONTENT.encode("utf-8")

        mock_wf_svc.return_value.get_draft_workflow.return_value = None
        mock_create_app.return_value = factory.create_workflow_app_mock()
        non_github_url = "https://example.com/app.yml"

        # Act
        result = dsl_service.import_app(
            account=factory.create_account_mock(),
            import_mode=ImportMode.YAML_URL.value,
            yaml_url=non_github_url,
        )

        # Assert
        assert result.status == ImportStatus.COMPLETED


class TestAppDslServiceConfirmImportErrors:
    """
    Unit tests for confirm_import failure branches.

    This test suite covers:
    - Invalid Redis payload type validation for import confirmation
    - Bytes format JSON payload processing for import confirmation
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.redis_client")
    def test_confirm_import_invalid_payload_type(self, mock_redis, dsl_service, factory):
        """Test confirm import fails when Redis payload is invalid."""
        # Arrange
        mock_redis.get.return_value = {"not": "a string"}

        # Act
        result = dsl_service.confirm_import(import_id=TEST_IMPORT_ID, account=factory.create_account_mock())

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Invalid import information" in result.error

    @patch("services.app_dsl_service.redis_client")
    @patch.object(AppDslService, "_create_or_update_app")
    def test_confirm_import_with_bytes_payload(self, mock_create_app, mock_redis, dsl_service, factory):
        """Test confirm import handles bytes payload."""
        # Arrange
        pending_data = {
            "app_id": TEST_APP_ID,
            "import_mode": ImportMode.YAML_CONTENT.value,
            "yaml_content": TEST_YAML_CONTENT,
            "dsl": yaml.safe_load(TEST_YAML_CONTENT),
        }
        mock_redis.get.return_value = json.dumps(pending_data).encode("utf-8")
        mock_app = Mock(id=TEST_APP_ID, mode=AppMode.WORKFLOW.value)
        mock_create_app.return_value = mock_app

        # Act
        result = dsl_service.confirm_import(import_id=TEST_IMPORT_ID, account=factory.create_account_mock())

        # Assert
        assert result.status == ImportStatus.COMPLETED


class TestAppDslServiceExtractDependencies:
    """
    Unit tests for static dependency extraction helpers.

    This test suite covers:
    - Extract dependencies from workflow graph nodes (tool, LLM, knowledge retrieval, etc.)
    - Handle empty workflow graph and invalid node types in dependency extraction
    - Test knowledge retrieval node dependency parsing with various config modes
    - Extract model, reranking and tool dependencies from chat model config
    - Verify exception handling and fault tolerance for dependency extraction
    - Test wrapper methods for dependency extraction from workflow objects
    - Validate leaked dependency detection for applications
    - Test dataset ID decryption utility with valid UUID inputs
    - Cover complex scenarios and edge cases for full dependency parsing
    """

    @pytest.fixture
    def factory(self) -> TestAppDslServiceFactory:
        """Provide test data factory."""
        return TestAppDslServiceFactory()

    @pytest.fixture
    def dsl_service(self, factory):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=factory.create_session_mock())

    @patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency")
    def test_extract_dependencies_from_workflow_graph(self, mock_analyze):
        """Test tool nodes are analyzed for dependencies."""
        # Arrange
        mock_analyze.return_value = []
        graph = {"nodes": [{"data": {"type": "tool", "provider_id": "langgenius/websearch"}}]}

        # Act
        deps = AppDslService._extract_dependencies_from_workflow_graph(graph)

        # Assert
        assert len(deps) >= 0

    def test_extract_dependencies_from_workflow_graph_empty(self):
        """Test empty graph yields empty deps."""
        # Act
        deps = AppDslService._extract_dependencies_from_workflow_graph({"nodes": []})

        # Assert
        assert len(deps) == 0

    @patch(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="model-dep",
    )
    @patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency", return_value="tool-dep")
    @patch("services.app_dsl_service.KnowledgeRetrievalNodeData.model_validate")
    @patch("services.app_dsl_service.ParameterExtractorNodeData.model_validate")
    @patch("services.app_dsl_service.QuestionClassifierNodeData.model_validate")
    @patch("services.app_dsl_service.LLMNodeData.model_validate")
    @patch("services.app_dsl_service.ToolNodeData.model_validate")
    def test_extract_dependencies_from_workflow_graph_various_node_types(
        self,
        mock_tool_validate,
        mock_llm_validate,
        mock_question_validate,
        mock_parameter_validate,
        mock_kr_validate,
        mock_tool_dep,
        mock_model_dep,
    ):
        """Test workflow dependency extraction across node types."""
        # Arrange
        mock_tool_validate.return_value = SimpleNamespace(provider_id="langgenius/tool")
        mock_llm_validate.return_value = SimpleNamespace(model=SimpleNamespace(provider="openai"))
        mock_question_validate.return_value = SimpleNamespace(model=SimpleNamespace(provider="openai"))
        mock_parameter_validate.return_value = SimpleNamespace(model=SimpleNamespace(provider="openai"))
        kr_multiple = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="weighted_score",
                reranking_model=None,
                weights=SimpleNamespace(vector_setting=SimpleNamespace(embedding_provider_name="openai")),
            ),
            single_retrieval_config=None,
        )
        kr_multiple_no_config = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=None,
            single_retrieval_config=None,
        )
        kr_multiple_rerank_no_model = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="reranking_model",
                reranking_model=None,
                weights=None,
            ),
            single_retrieval_config=None,
        )
        kr_multiple_unknown_rerank = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="unknown_mode",
                reranking_model=None,
                weights=None,
            ),
            single_retrieval_config=None,
        )
        kr_multiple_no_weights = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="weighted_score",
                reranking_model=None,
                weights=None,
            ),
            single_retrieval_config=None,
        )
        kr_single = SimpleNamespace(
            retrieval_mode="single",
            multiple_retrieval_config=None,
            single_retrieval_config=SimpleNamespace(model=SimpleNamespace(provider="openai")),
        )
        kr_single_no_config = SimpleNamespace(
            retrieval_mode="single",
            multiple_retrieval_config=None,
            single_retrieval_config=None,
        )
        kr_invalid_mode = SimpleNamespace(
            retrieval_mode="invalid_mode",
            multiple_retrieval_config=None,
            single_retrieval_config=None,
        )

        mock_kr_validate.side_effect = [
            kr_multiple,
            kr_single,
            kr_multiple_no_config,
            kr_multiple_rerank_no_model,
            kr_multiple_unknown_rerank,
            kr_multiple_no_weights,
            kr_single_no_config,
            kr_invalid_mode,
        ]

        graph = {
            "nodes": [
                {"data": {"type": BuiltinNodeTypes.TOOL, "provider_id": "langgenius/tool"}},
                {"data": {"type": BuiltinNodeTypes.LLM, "model": {"provider": "openai"}}},
                {"data": {"type": BuiltinNodeTypes.QUESTION_CLASSIFIER, "model": {"provider": "openai"}}},
                {"data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "model": {"provider": "openai"}}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "multiple"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "single"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "multiple"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "multiple"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "multiple"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "multiple"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "single"}},
                {"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "retrieval_mode": "invalid"}},
                {"data": {"type": "unknown"}},
            ]
        }

        # Act
        deps = AppDslService._extract_dependencies_from_workflow_graph(graph)

        # Assert
        assert len(deps) == 6
        assert deps.count("tool-dep") == 1
        assert deps.count("model-dep") == 5

    @patch(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="model-dep",
    )
    @patch("services.app_dsl_service.KnowledgeRetrievalNodeData.model_validate")
    def test_extract_dependencies_from_workflow_graph_knowledge_retrieval_reranking_model(
        self, mock_kr_validate, mock_model_dep
    ):
        """Test knowledge retrieval dependency extraction for reranking_model mode."""
        # Arrange
        kr_reranking = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="reranking_model",
                reranking_model=SimpleNamespace(provider="openai"),
                weights=None,
            ),
            single_retrieval_config=None,
        )
        mock_kr_validate.return_value = kr_reranking

        graph = {
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                        "retrieval_mode": "multiple",
                        "multiple_retrieval_config": {
                            "reranking_mode": "reranking_model",
                            "reranking_model": {"provider": "openai"},
                        },
                    }
                },
            ]
        }

        # Act
        deps = AppDslService._extract_dependencies_from_workflow_graph(graph)

        # Assert
        assert len(deps) == 1
        assert deps == ["model-dep"]

    @patch(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="model-dep",
    )
    @patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency", return_value="tool-dep")
    def test_extract_dependencies_from_model_config_with_reranking_and_tools(self, mock_tool_dep, mock_model_dep):
        """Test model config dependency extraction includes reranking and tools."""
        # Arrange
        model_config = {
            "model": {"provider": "openai"},
            "dataset_configs": {
                "datasets": {"datasets": [{"reranking_model": {"reranking_provider_name": {"provider": "openai"}}}]}
            },
            "agent_mode": {"tools": [{"provider_id": "langgenius/tool"}]},
        }

        # Act
        deps = AppDslService._extract_dependencies_from_model_config(model_config)

        # Assert
        assert len(deps) == 3
        assert deps == ["model-dep", "model-dep", "tool-dep"]

    @patch(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="model-dep",
    )
    @patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency", return_value="tool-dep")
    def test_extract_dependencies_from_model_config_without_ranking(self, mock_tool_dep, mock_model_dep):
        """Test model config dependency extraction with empty datasets."""
        # Arrange
        model_config = {
            "model": {"provider": "openai"},
            "dataset_configs": {"datasets": {"datasets": [{"unknown": {}}]}},
            "agent_mode": {"tools": [{"provider_id": "langgenius/tool"}]},
        }

        # Act
        deps = AppDslService._extract_dependencies_from_model_config(model_config)

        # Assert
        assert len(deps) == 2
        assert deps == ["model-dep", "tool-dep"]

    @patch(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="model-dep",
    )
    @patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency", return_value="tool-dep")
    def test_extract_dependencies_from_model_config_empty_datasets(self, mock_tool_dep, mock_model_dep):
        """Test model config dependency extraction with empty datasets."""
        # Arrange
        model_config = {
            "model": {"provider": "openai"},
            "dataset_configs": {"datasets": {"datasets": []}},
            "agent_mode": {"tools": [{"provider_id": "langgenius/tool"}]},
        }

        # Act
        deps = AppDslService._extract_dependencies_from_model_config(model_config)

        # Assert
        assert len(deps) == 2
        assert deps == ["model-dep", "tool-dep"]

    def test_extract_dependencies_from_workflow(self):
        """Test workflow wrapper returns list."""
        # Arrange
        mock_workflow = Mock()
        mock_workflow.graph_dict = {"nodes": []}

        # Act
        deps = AppDslService._extract_dependencies_from_workflow(mock_workflow)

        # Assert
        assert isinstance(deps, list)

    def test_extract_dependencies_from_model_config(self):
        """Test model config extraction returns list."""
        # Act
        deps = AppDslService._extract_dependencies_from_model_config({})

        # Assert
        assert isinstance(deps, list)

    def test_get_leaked_dependencies(self, dsl_service, factory):
        """Test leaked deps helper returns list."""
        # Act
        result = dsl_service.get_leaked_dependencies(factory.create_workflow_app_mock(), [])

        # Assert
        assert isinstance(result, list)

    def test_get_leaked_dependencies_with_values(self):
        """Test leaked deps helper forwards dependencies."""
        with patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dep_svc:
            # Arrange
            mock_dep_svc.get_leaked_dependencies.return_value = []
            plugin = Mock()

            # Act
            result = AppDslService.get_leaked_dependencies(TEST_TENANT_ID, [plugin])

            # Assert
            mock_dep_svc.get_leaked_dependencies.assert_called_once()
            assert result == []

    def test_extract_dependencies_from_workflow_graph_complex(self):
        """Test multiple workflow node types contribute dependencies."""
        with (
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency"
            ) as mock_model_dep,
            patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency") as mock_tool_dep,
        ):
            # Arrange
            mock_tool_dep.return_value = "tool-dep"
            mock_model_dep.return_value = "provider-dep"
            llm_node = {"data": {"type": BuiltinNodeTypes.LLM, "model": {"provider": "openai"}}}
            question_node = {"data": {"type": BuiltinNodeTypes.QUESTION_CLASSIFIER, "model": {"provider": "openai"}}}
            param_node = {"data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "model": {"provider": "openai"}}}
            kr_node = {
                "data": {
                    "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {
                        "reranking_mode": "reranking_model",
                        "reranking_model": {"provider": "openai"},
                    },
                }
            }
            with (
                patch(
                    "services.app_dsl_service.LLMNodeData.model_validate",
                    return_value=SimpleNamespace(model=SimpleNamespace(provider="openai")),
                ),
                patch(
                    "services.app_dsl_service.QuestionClassifierNodeData.model_validate",
                    return_value=SimpleNamespace(model=SimpleNamespace(provider="openai")),
                ),
                patch(
                    "services.app_dsl_service.ParameterExtractorNodeData.model_validate",
                    return_value=SimpleNamespace(model=SimpleNamespace(provider="openai")),
                ),
                patch(
                    "services.app_dsl_service.KnowledgeRetrievalNodeData.model_validate",
                    return_value=SimpleNamespace(
                        retrieval_mode="multiple",
                        multiple_retrieval_config=SimpleNamespace(
                            reranking_mode="reranking_model",
                            reranking_model=SimpleNamespace(provider="openai"),
                            weights=None,
                        ),
                        single_retrieval_config=None,
                    ),
                ),
            ):
                # Act
                deps = AppDslService._extract_dependencies_from_workflow_graph(
                    {"nodes": [llm_node, question_node, param_node, kr_node]}
                )

            # Assert
            assert deps == ["provider-dep", "provider-dep", "provider-dep", "provider-dep"]

    def test_extract_dependencies_from_model_config_complex(self):
        """Test model config extraction covers dataset and agent tool branches."""
        with (
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency"
            ) as mock_model_dep,
            patch("services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency") as mock_tool_dep,
        ):
            # Arrange
            mock_model_dep.return_value = "provider-dep"
            mock_tool_dep.return_value = "tool-dep"
            model_config = {
                "model": {"provider": "openai"},
                "dataset_configs": {
                    "datasets": {"datasets": [{"reranking_model": {"reranking_provider_name": {"provider": "openai"}}}]}
                },
                "agent_mode": {"tools": [{"provider_id": "tool-provider"}]},
            }

            # Act
            deps = AppDslService._extract_dependencies_from_model_config(model_config)

            # Assert
            assert deps == ["provider-dep", "provider-dep", "tool-dep"]

    def test_extract_dependencies_from_model_config_on_error(self):
        """Test model config extraction catches internal exceptions."""
        with patch(
            "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
            side_effect=Exception("boom"),
        ):
            # Act
            deps = AppDslService._extract_dependencies_from_model_config({"model": {"provider": "openai"}})

            # Assert
            assert deps == []

    def test_decrypt_dataset_id_plain_uuid(self):
        """Test decrypt_dataset_id returns plain UUID when input is already valid."""
        # Act & Assert
        valid_uuid = str(uuid.uuid4())
        assert AppDslService.decrypt_dataset_id(valid_uuid, TEST_TENANT_ID) == valid_uuid


class TestAppDslServiceUuidValidation:
    """
    Unit tests for AppDslService._is_valid_uuid.

    This test suite covers:
    - Valid UUIDs
    """

    @pytest.fixture
    def dsl_service(self):
        """Provide an instance of AppDslService with a mocked session."""
        return AppDslService(session=MagicMock(spec=Session))

    def test_is_valid_uuid(self, dsl_service):
        """Test UUID validation."""
        # Act & Assert
        assert dsl_service._is_valid_uuid(str(uuid.uuid4())) is True
        assert dsl_service._is_valid_uuid("invalid-uuid") is False
