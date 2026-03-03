"""Unit tests for services.app_dsl_service."""

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
import yaml

from core.plugin.entities.plugin import PluginDependency
from models.model import AppMode, IconType
from services.app_dsl_service import (
    CURRENT_DSL_VERSION,
    IMPORT_INFO_REDIS_KEY_PREFIX,
    AppDslService,
    ImportMode,
    ImportStatus,
    PendingData,
    _check_version_compatibility,
)


@pytest.fixture
def service() -> AppDslService:
    """Provide AppDslService with a mocked session."""
    return AppDslService(session=MagicMock())


@pytest.fixture
def account() -> SimpleNamespace:
    """Create account-like object with tenant context."""
    return SimpleNamespace(id="acc-1", current_tenant_id="tenant-1")


def _build_yaml_content(version: str = CURRENT_DSL_VERSION, mode: str = AppMode.CHAT.value) -> str:
    return yaml.dump(
        {
            "version": version,
            "kind": "app",
            "app": {"name": "Demo", "mode": mode, "icon_type": "emoji", "icon": "🤖"},
            "model_config": {"model": {"provider": "openai"}},
        }
    )


class TestVersionCompatibility:
    """Test suite for _check_version_compatibility."""

    @pytest.mark.parametrize(
        ("imported_version", "expected_status"),
        [
            ("invalid_version", ImportStatus.FAILED),
            ("999.0.0", ImportStatus.PENDING),
            ("0.1.0", ImportStatus.COMPLETED_WITH_WARNINGS),
            (CURRENT_DSL_VERSION, ImportStatus.COMPLETED),
        ],
    )
    def test_check_version_compatibility_should_return_expected_status(
        self,
        imported_version: str,
        expected_status: ImportStatus,
    ) -> None:
        """Test version compatibility classification across version patterns."""
        # Arrange

        # Act
        result = _check_version_compatibility(imported_version)

        # Assert
        assert result == expected_status

    def test_check_version_compatibility_should_return_pending_for_lower_major_version(self) -> None:
        """Test lower major version becomes pending when current major is patched higher."""
        # Arrange
        with patch("services.app_dsl_service.CURRENT_DSL_VERSION", "1.0.0"):
            # Act
            result = _check_version_compatibility("0.9.0")

            # Assert
            assert result == ImportStatus.PENDING


class TestImportApp:
    """Test suite for import_app."""

    def test_import_app_should_raise_when_import_mode_invalid(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test invalid import mode raises ValueError."""
        # Arrange

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid import_mode"):
            service.import_app(account=account, import_mode="unknown")

    def test_import_app_should_fail_when_yaml_url_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test yaml-url mode fails without yaml_url."""
        # Arrange

        # Act
        result = service.import_app(account=account, import_mode=ImportMode.YAML_URL)

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "yaml_url is required" in result.error

    def test_import_app_should_fail_when_yaml_content_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test yaml-content mode fails without yaml_content."""
        # Arrange

        # Act
        result = service.import_app(account=account, import_mode=ImportMode.YAML_CONTENT)

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "yaml_content is required" in result.error

    def test_import_app_should_fail_when_fetching_yaml_url_errors(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test URL fetch errors are wrapped into failed import result."""
        # Arrange
        with patch("services.app_dsl_service.ssrf_proxy.get", side_effect=RuntimeError("network")):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_URL,
                yaml_url="https://example.com/app.yml",
            )

            # Assert
            assert result.status == ImportStatus.FAILED
            assert "Error fetching YAML from URL" in result.error

    def test_import_app_should_fail_when_url_content_empty(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test empty URL content is rejected."""
        # Arrange
        response = MagicMock()
        response.content = b""
        response.raise_for_status.return_value = None

        with patch("services.app_dsl_service.ssrf_proxy.get", return_value=response):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_URL,
                yaml_url="https://example.com/app.yml",
            )

            # Assert
            assert result.status == ImportStatus.FAILED
            assert result.error == "Empty content from url"

    def test_import_app_should_fail_when_url_content_exceeds_max_size(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test URL content larger than max size is rejected."""
        # Arrange
        response = MagicMock()
        response.content = b"x" * (10 * 1024 * 1024 + 1)
        response.raise_for_status.return_value = None

        with patch("services.app_dsl_service.ssrf_proxy.get", return_value=response):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_URL,
                yaml_url="https://example.com/app.yml",
            )

            # Assert
            assert result.status == ImportStatus.FAILED
            assert "File size exceeds" in result.error

    def test_import_app_should_fail_when_yaml_is_not_mapping(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test non-mapping YAML content fails validation."""
        # Arrange

        # Act
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content="- item1\n- item2\n",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "content must be a mapping" in result.error

    def test_import_app_should_fail_when_app_data_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test YAML without app section returns failure."""
        # Arrange
        yaml_content = yaml.dump({"version": CURRENT_DSL_VERSION, "kind": "app"})

        # Act
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Missing app data" in result.error

    def test_import_app_should_fail_when_app_to_overwrite_not_found(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test overwrite import fails when app_id does not exist."""
        # Arrange
        yaml_content = _build_yaml_content(mode=AppMode.WORKFLOW.value)
        service._session.scalar.return_value = None

        # Act
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
            app_id="missing-app",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert result.error == "App not found"

    def test_import_app_should_fail_when_overwriting_unsupported_mode(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test overwrite import fails for non-workflow/non-advanced-chat apps."""
        # Arrange
        yaml_content = _build_yaml_content(mode=AppMode.WORKFLOW.value)
        service._session.scalar.return_value = SimpleNamespace(mode=AppMode.CHAT)

        # Act
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
            app_id="app-1",
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Only workflow or advanced chat" in result.error

    def test_import_app_should_return_pending_and_store_data_for_newer_version(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test newer DSL versions store pending import metadata in Redis."""
        # Arrange
        yaml_content = _build_yaml_content(version="99.0.0", mode=AppMode.WORKFLOW.value)

        with patch("services.app_dsl_service.redis_client") as mock_redis:
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                name="Override Name",
            )

            # Assert
            assert result.status == ImportStatus.PENDING
            assert result.imported_dsl_version == "99.0.0"
            mock_redis.setex.assert_called_once()

    def test_import_app_should_create_app_with_explicit_dependencies(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test dependencies list from YAML is validated and passed to app creation."""
        # Arrange
        yaml_content = yaml.dump(
            {
                "version": CURRENT_DSL_VERSION,
                "kind": "app",
                "app": {"name": "Demo", "mode": AppMode.CHAT.value},
                "model_config": {"model": {"provider": "openai"}},
                "dependencies": [{"plugin_unique_identifier": "x/y:1.0.0"}],
            }
        )
        created_app = SimpleNamespace(id="app-1", mode=AppMode.CHAT)

        with (
            patch.object(service, "_create_or_update_app", return_value=created_app) as mock_create,
            patch(
                "services.app_dsl_service.PluginDependency.model_validate",
                return_value=SimpleNamespace(plugin_unique_identifier="x/y:1.0.0"),
            ),
            patch("services.app_dsl_service.WorkflowDraftVariableService") as mock_draft_srv,
        ):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
            )

            # Assert
            assert result.status == ImportStatus.COMPLETED
            assert result.app_id == "app-1"
            mock_create.assert_called_once()
            mock_draft_srv.return_value.delete_workflow_variables.assert_called_once_with(app_id="app-1")

    def test_import_app_should_generate_dependencies_from_workflow_for_legacy_versions(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test legacy workflow DSL uses graph extraction for dependency generation."""
        # Arrange
        yaml_content = yaml.dump(
            {
                "version": "0.1.0",
                "kind": "app",
                "app": {"name": "Demo", "mode": AppMode.WORKFLOW.value},
                "workflow": {"graph": {"nodes": []}},
            }
        )
        created_app = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW)

        with (
            patch.object(service, "_extract_dependencies_from_workflow_graph", return_value=["a/b"]),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.generate_latest_dependencies",
                return_value=[SimpleNamespace(plugin_unique_identifier="a/b:1.0.0")],
            ),
            patch.object(service, "_create_or_update_app", return_value=created_app),
            patch("services.app_dsl_service.WorkflowDraftVariableService"),
        ):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
            )

            # Assert
            assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS

    def test_import_app_should_generate_dependencies_from_model_config_for_legacy_versions(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test legacy non-workflow DSL uses model config dependency extraction."""
        # Arrange
        yaml_content = yaml.dump(
            {
                "version": "0.1.0",
                "kind": "app",
                "app": {"name": "Demo", "mode": AppMode.CHAT.value},
                "model_config": {"model": {"provider": "openai"}},
            }
        )
        created_app = SimpleNamespace(id="app-1", mode=AppMode.CHAT)

        with (
            patch.object(service, "_extract_dependencies_from_model_config", return_value=["a/b"]),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.generate_latest_dependencies",
                return_value=[SimpleNamespace(plugin_unique_identifier="a/b:1.0.0")],
            ),
            patch.object(service, "_create_or_update_app", return_value=created_app),
            patch("services.app_dsl_service.WorkflowDraftVariableService"),
        ):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
            )

            # Assert
            assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS

    def test_import_app_should_fail_on_yaml_error(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test YAML parser errors are returned as failed import."""
        # Arrange
        with patch("services.app_dsl_service.yaml.safe_load", side_effect=yaml.YAMLError("bad-yaml")):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content="not: valid: yaml",
            )

            # Assert
            assert result.status == ImportStatus.FAILED
            assert "Invalid YAML format" in result.error

    def test_import_app_should_fail_when_version_type_invalid(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test non-string version type is rejected."""
        # Arrange
        yaml_content = yaml.dump(
            {
                "version": 1.2,
                "kind": "app",
                "app": {"name": "Demo", "mode": AppMode.CHAT.value},
            }
        )

        # Act
        result = service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
        )

        # Assert
        assert result.status == ImportStatus.FAILED
        assert "Invalid version type" in result.error

    def test_import_app_should_default_missing_version_and_kind(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test missing version/kind are defaulted and import proceeds."""
        # Arrange
        yaml_content = yaml.dump(
            {
                "app": {"name": "Demo", "mode": AppMode.CHAT.value},
                "model_config": {"model": {"provider": "openai"}},
            }
        )
        created_app = SimpleNamespace(id="app-1", mode=AppMode.CHAT)

        with (
            patch.object(service, "_create_or_update_app", return_value=created_app),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.generate_latest_dependencies",
                return_value=[],
            ),
            patch("services.app_dsl_service.WorkflowDraftVariableService"),
        ):
            # Act
            result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
            )

            # Assert
            assert result.status == ImportStatus.COMPLETED_WITH_WARNINGS


class TestConfirmImport:
    """Test suite for confirm_import."""

    def test_confirm_import_should_fail_when_pending_data_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test confirm_import fails when Redis pending data is missing."""
        # Arrange
        with patch("services.app_dsl_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            # Act
            result = service.confirm_import(import_id="import-1", account=account)

            # Assert
            assert result.status == ImportStatus.FAILED
            assert "expired" in result.error

    def test_confirm_import_should_fail_when_pending_data_type_invalid(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test confirm_import rejects non-string/bytes pending data."""
        # Arrange
        with patch("services.app_dsl_service.redis_client") as mock_redis:
            mock_redis.get.return_value = 12345

            # Act
            result = service.confirm_import(import_id="import-1", account=account)

            # Assert
            assert result.status == ImportStatus.FAILED
            assert result.error == "Invalid import information"

    def test_confirm_import_should_create_app_and_cleanup_pending_data(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test confirm_import loads pending payload, creates app, and deletes Redis key."""
        # Arrange
        import_id = "import-1"
        pending = PendingData(
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_build_yaml_content(),
            name="Name",
            app_id=None,
        )
        created_app = SimpleNamespace(id="app-1", mode=AppMode.CHAT)

        with (
            patch("services.app_dsl_service.redis_client") as mock_redis,
            patch.object(service, "_create_or_update_app", return_value=created_app) as mock_create,
        ):
            mock_redis.get.return_value = pending.model_dump_json()

            # Act
            result = service.confirm_import(import_id=import_id, account=account)

            # Assert
            assert result.status == ImportStatus.COMPLETED
            assert result.app_id == "app-1"
            mock_create.assert_called_once()
            mock_redis.delete.assert_called_once_with(f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}")

    def test_confirm_import_should_lookup_existing_app_when_pending_has_app_id(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test confirm_import loads existing app when pending payload contains app_id."""
        # Arrange
        import_id = "import-2"
        pending = PendingData(
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_build_yaml_content(mode=AppMode.WORKFLOW.value),
            name="Name",
            app_id="app-2",
        )
        existing_app = SimpleNamespace(id="app-2", mode=AppMode.WORKFLOW)
        updated_app = SimpleNamespace(id="app-2", mode=AppMode.WORKFLOW)
        service._session.scalar.return_value = existing_app

        with (
            patch("services.app_dsl_service.redis_client") as mock_redis,
            patch.object(service, "_create_or_update_app", return_value=updated_app) as mock_create,
        ):
            mock_redis.get.return_value = pending.model_dump_json()

            # Act
            result = service.confirm_import(import_id=import_id, account=account)

            # Assert
            assert result.status == ImportStatus.COMPLETED
            assert result.app_id == "app-2"
            mock_create.assert_called_once()

    def test_confirm_import_should_fail_when_exception_raised(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test confirm_import wraps runtime errors into failed status."""
        # Arrange
        with (
            patch("services.app_dsl_service.redis_client") as mock_redis,
            patch(
                "services.app_dsl_service.PendingData.model_validate_json",
                side_effect=RuntimeError("bad payload"),
            ),
        ):
            mock_redis.get.return_value = "{}"

            # Act
            result = service.confirm_import(import_id="import-1", account=account)

            # Assert
            assert result.status == ImportStatus.FAILED
            assert "bad payload" in result.error


class TestDependencyChecks:
    """Test suite for dependency check methods."""

    def test_check_dependencies_should_return_empty_when_no_pending_data(self, service: AppDslService) -> None:
        """Test check_dependencies returns empty result when cache key is absent."""
        # Arrange
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        with patch("services.app_dsl_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            # Act
            result = service.check_dependencies(app_model=app_model)

            # Assert
            assert result.leaked_dependencies == []

    def test_check_dependencies_should_return_leaked_dependencies(self, service: AppDslService) -> None:
        """Test check_dependencies resolves pending payload and delegates leak detection."""
        # Arrange
        dependency = PluginDependency.model_validate(
            {"type": "package", "value": {"plugin_unique_identifier": "a/b", "version": "1.0.0"}}
        )
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        pending_data = SimpleNamespace(dependencies=[dependency])

        with (
            patch("services.app_dsl_service.redis_client") as mock_redis,
            patch(
                "services.app_dsl_service.CheckDependenciesPendingData.model_validate_json",
                return_value=pending_data,
            ),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.get_leaked_dependencies",
                return_value=[dependency],
            ) as mock_get_leaked,
        ):
            mock_redis.get.return_value = '{"dependencies": []}'

            # Act
            result = service.check_dependencies(app_model=app_model)

            # Assert
            assert len(result.leaked_dependencies) == 1
            mock_get_leaked.assert_called_once()


class TestCreateOrUpdateApp:
    """Test suite for _create_or_update_app."""

    def test_create_or_update_app_should_raise_when_app_mode_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test missing app.mode raises ValueError."""
        # Arrange
        data = {"app": {}}

        # Act & Assert
        with pytest.raises(ValueError, match="loss app mode"):
            service._create_or_update_app(app=None, data=data, account=account)

    def test_create_or_update_app_should_raise_when_tenant_missing_for_new_app(self, service: AppDslService) -> None:
        """Test new app creation requires current tenant id."""
        # Arrange
        data = {"app": {"mode": AppMode.CHAT.value}}
        account = SimpleNamespace(id="acc-1", current_tenant_id=None)

        # Act & Assert
        with pytest.raises(ValueError, match="Current tenant is not set"):
            service._create_or_update_app(app=None, data=data, account=account)

    def test_create_or_update_app_should_raise_when_workflow_data_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test workflow modes require workflow data."""
        # Arrange
        data = {"app": {"mode": AppMode.WORKFLOW.value}}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing workflow data"):
            service._create_or_update_app(app=None, data=data, account=account)

    def test_create_or_update_app_should_create_workflow_app_and_sync_draft(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test workflow app creation decrypts dataset ids and syncs draft workflow."""
        # Arrange
        data = {
            "app": {
                "mode": AppMode.WORKFLOW.value,
                "name": "Workflow",
                "description": "desc",
                "icon_type": IconType.IMAGE,
                "icon": "icon",
                "icon_background": "#fff",
            },
            "workflow": {
                "graph": {
                    "nodes": [
                        {
                            "data": {
                                "type": "knowledge-retrieval",
                                "dataset_ids": ["encrypted-1", "encrypted-2"],
                            }
                        }
                    ]
                },
                "features": {"f": 1},
                "environment_variables": [{"name": "env"}],
                "conversation_variables": [{"name": "conv"}],
            },
        }
        dependencies = [
            PluginDependency.model_validate(
                {"type": "package", "value": {"plugin_unique_identifier": "a/b", "version": "1.0.0"}}
            )
        ]
        workflow_service = MagicMock()
        workflow_service.get_draft_workflow.return_value = SimpleNamespace(unique_hash="hash")
        pending_dep_obj = MagicMock()
        pending_dep_obj.model_dump_json.return_value = '{"dependencies": []}'

        with (
            patch("services.app_dsl_service.redis_client") as mock_redis,
            patch("services.app_dsl_service.WorkflowService", return_value=workflow_service),
            patch(
                "services.app_dsl_service.variable_factory.build_environment_variable_from_mapping",
                side_effect=lambda x: x,
            ),
            patch(
                "services.app_dsl_service.variable_factory.build_conversation_variable_from_mapping",
                side_effect=lambda x: x,
            ),
            patch.object(service, "decrypt_dataset_id", side_effect=["dataset-1", None]),
            patch("services.app_dsl_service.CheckDependenciesPendingData", return_value=pending_dep_obj),
            patch("services.app_dsl_service.app_was_created") as mock_created_event,
        ):
            # Act
            app = service._create_or_update_app(
                app=None,
                data=data,
                account=account,
                dependencies=dependencies,
            )

            # Assert
            assert app.tenant_id == "tenant-1"
            assert app.mode == AppMode.WORKFLOW.value
            workflow_service.sync_draft_workflow.assert_called_once()
            sync_kwargs = workflow_service.sync_draft_workflow.call_args.kwargs
            assert sync_kwargs["graph"]["nodes"][0]["data"]["dataset_ids"] == ["dataset-1"]
            mock_redis.setex.assert_called_once()
            mock_created_event.send.assert_called_once()

    def test_create_or_update_app_should_update_existing_app(
        self, service: AppDslService, account: SimpleNamespace
    ) -> None:
        """Test existing app is updated in-place with provided app overrides."""
        # Arrange
        app = SimpleNamespace(
            id="app-1",
            name="old",
            description="old",
            icon_type="emoji",
            icon="x",
            icon_background="#000",
            mode=AppMode.CHAT.value,
            app_model_config=SimpleNamespace(id="cfg-1"),
        )
        data = {
            "app": {"mode": AppMode.CHAT.value, "name": "new", "description": "new desc"},
            "model_config": {"model": {}},
        }

        with patch("services.app_dsl_service.naive_utc_now", return_value="now"):
            # Act
            result = service._create_or_update_app(
                app=app,
                data=data,
                account=account,
                icon_type="invalid-icon-type",
            )

            # Assert
            assert result is app
            assert app.name == "new"
            assert app.icon_type == IconType.EMOJI
            assert app.updated_at == "now"

    def test_create_or_update_app_should_use_none_unique_hash_when_draft_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test workflow sync uses None unique_hash when no current draft is present."""
        # Arrange
        data = {
            "app": {"mode": AppMode.WORKFLOW.value},
            "workflow": {
                "graph": {"nodes": []},
                "features": {},
                "environment_variables": [],
                "conversation_variables": [],
            },
        }
        workflow_service = MagicMock()
        workflow_service.get_draft_workflow.return_value = None

        with (
            patch("services.app_dsl_service.WorkflowService", return_value=workflow_service),
            patch("services.app_dsl_service.app_was_created"),
        ):
            # Act
            app = service._create_or_update_app(app=None, data=data, account=account)

            # Assert
            sync_kwargs = workflow_service.sync_draft_workflow.call_args.kwargs
            assert sync_kwargs["unique_hash"] is None
            assert app.mode == AppMode.WORKFLOW.value

    def test_create_or_update_app_should_raise_when_model_config_missing_for_chat_modes(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test chat modes require model_config in payload."""
        # Arrange
        data = {"app": {"mode": AppMode.CHAT.value}}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing model_config"):
            service._create_or_update_app(app=None, data=data, account=account)

    def test_create_or_update_app_should_create_app_model_config_when_missing(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test chat app creation initializes app model config when absent."""
        # Arrange
        data = {"app": {"mode": AppMode.CHAT.value}, "model_config": {"model": {"provider": "openai"}}}
        model_config_instance = MagicMock()
        model_config_instance.from_model_config_dict.return_value = model_config_instance

        with (
            patch("services.app_dsl_service.AppModelConfig", return_value=model_config_instance),
            patch("services.app_dsl_service.app_model_config_was_updated") as mock_updated_event,
            patch("services.app_dsl_service.app_was_created"),
        ):
            # Act
            app = service._create_or_update_app(app=None, data=data, account=account)

            # Assert
            assert app.app_model_config_id == model_config_instance.id
            service._session.add.assert_any_call(model_config_instance)
            mock_updated_event.send.assert_called_once_with(app, app_model_config=model_config_instance)

    def test_create_or_update_app_should_raise_for_unsupported_app_mode(
        self,
        service: AppDslService,
        account: SimpleNamespace,
    ) -> None:
        """Test unsupported app modes raise ValueError."""
        # Arrange
        data = {"app": {"mode": AppMode.CHANNEL.value}}

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid app mode"):
            service._create_or_update_app(app=None, data=data, account=account)


class TestExportAndDependencies:
    """Test suite for export and dependency extraction methods."""

    def test_export_dsl_should_delegate_to_workflow_export_for_workflow_modes(self) -> None:
        """Test export_dsl delegates to workflow exporter for workflow apps."""
        # Arrange
        app_model = SimpleNamespace(
            mode=AppMode.WORKFLOW.value,
            name="App",
            icon_type="emoji",
            icon_background="#fff",
            description="desc",
            use_icon_as_answer_icon=False,
            tenant_id="tenant-1",
        )

        with patch.object(AppDslService, "_append_workflow_export_data") as mock_append_workflow:
            # Act
            payload = AppDslService.export_dsl(app_model)

            # Assert
            assert "kind: app" in payload
            mock_append_workflow.assert_called_once()

    def test_export_dsl_should_delegate_to_model_config_export_for_chat_modes(self) -> None:
        """Test export_dsl delegates to model config exporter for chat apps."""
        # Arrange
        app_model = SimpleNamespace(
            mode=AppMode.CHAT.value,
            name="App",
            icon_type="emoji",
            icon_background="#fff",
            description="desc",
            use_icon_as_answer_icon=False,
            tenant_id="tenant-1",
        )

        with patch.object(AppDslService, "_append_model_config_export_data") as mock_append_model_config:
            # Act
            payload = AppDslService.export_dsl(app_model)

            # Assert
            assert "kind: app" in payload
            mock_append_model_config.assert_called_once()

    def test_append_workflow_export_data_should_raise_when_draft_workflow_missing(self) -> None:
        """Test workflow export requires draft workflow."""
        # Arrange
        app_model = SimpleNamespace(tenant_id="tenant-1")

        with patch("services.app_dsl_service.WorkflowService") as mock_workflow_service:
            mock_workflow_service.return_value.get_draft_workflow.return_value = None

            # Act & Assert
            with pytest.raises(ValueError, match="Missing draft workflow"):
                AppDslService._append_workflow_export_data(export_data={}, app_model=app_model, include_secret=False)

    def test_append_workflow_export_data_should_transform_nodes_and_append_dependencies(self) -> None:
        """Test workflow export filters workspace-specific fields and appends dependencies."""
        # Arrange
        app_model = SimpleNamespace(tenant_id="tenant-1")
        workflow_dict = {
            "graph": {
                "nodes": [
                    {"data": {"type": "knowledge-retrieval", "dataset_ids": ["id-1"]}},
                    {"data": {"type": "tool", "credential_id": "cred-1"}},
                    {
                        "data": {
                            "type": "agent",
                            "agent_parameters": {"tools": {"value": [{"credential_id": "cred-2", "tool_name": "x"}]}},
                        }
                    },
                    {"data": {"type": "trigger-schedule", "config": {"x": 1}}},
                    {"data": {"type": "trigger-webhook", "webhook_url": "u", "webhook_debug_url": "d"}},
                    {"data": {"type": "trigger-plugin", "subscription_id": "sub-1"}},
                    {"data": {}},
                ]
            }
        }
        workflow = SimpleNamespace(to_dict=lambda include_secret: workflow_dict)

        export_data: dict = {}

        with (
            patch("services.app_dsl_service.WorkflowService") as mock_workflow_service,
            patch.object(AppDslService, "encrypt_dataset_id", return_value="encrypted-id"),
            patch.object(AppDslService, "_extract_dependencies_from_workflow", return_value=["a/b"]),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.generate_dependencies",
                return_value=[SimpleNamespace(model_dump=lambda: {"plugin_unique_identifier": "a/b:1.0.0"})],
            ),
            patch("services.app_dsl_service.TriggerScheduleNode.get_default_config", return_value={"config": {"d": 1}}),
        ):
            mock_workflow_service.return_value.get_draft_workflow.return_value = workflow

            # Act
            AppDslService._append_workflow_export_data(
                export_data=export_data,
                app_model=app_model,
                include_secret=False,
            )

            # Assert
            nodes = export_data["workflow"]["graph"]["nodes"]
            assert nodes[0]["data"]["dataset_ids"] == ["encrypted-id"]
            assert "credential_id" not in nodes[1]["data"]
            assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]
            assert nodes[3]["data"]["config"] == {"d": 1}
            assert nodes[4]["data"]["webhook_url"] == ""
            assert nodes[5]["data"]["subscription_id"] == ""
            assert export_data["dependencies"] == [{"plugin_unique_identifier": "a/b:1.0.0"}]

    def test_append_model_config_export_data_should_raise_when_model_config_missing(self) -> None:
        """Test model-config export requires app model config."""
        # Arrange
        app_model = SimpleNamespace(app_model_config=None)

        # Act & Assert
        with pytest.raises(ValueError, match="Missing app configuration"):
            AppDslService._append_model_config_export_data({}, app_model)

    def test_append_model_config_export_data_should_filter_credentials_and_append_dependencies(self) -> None:
        """Test model-config export strips credential ids and writes dependencies."""
        # Arrange
        model_config_payload = {"agent_mode": {"tools": [{"provider_id": "p1", "credential_id": "cred"}]}}
        app_model_config = SimpleNamespace(to_dict=lambda: model_config_payload)
        app_model = SimpleNamespace(app_model_config=app_model_config, tenant_id="tenant-1")
        export_data: dict = {}

        with (
            patch.object(AppDslService, "_extract_dependencies_from_model_config", return_value=["a/b"]),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.generate_dependencies",
                return_value=[SimpleNamespace(model_dump=lambda: {"plugin_unique_identifier": "a/b:1.0.0"})],
            ),
        ):
            # Act
            AppDslService._append_model_config_export_data(export_data, app_model)

            # Assert
            assert "credential_id" not in export_data["model_config"]["agent_mode"]["tools"][0]
            assert export_data["dependencies"] == [{"plugin_unique_identifier": "a/b:1.0.0"}]

    def test_extract_dependencies_from_workflow_should_delegate_to_graph_extractor(self) -> None:
        """Test workflow dependency extraction delegates to graph extractor."""
        # Arrange
        workflow = SimpleNamespace(graph_dict={"nodes": []})

        with patch.object(AppDslService, "_extract_dependencies_from_workflow_graph", return_value=["a/b"]):
            # Act
            result = AppDslService._extract_dependencies_from_workflow(workflow)

            # Assert
            assert result == ["a/b"]

    def test_extract_dependencies_from_workflow_graph_should_extract_all_supported_node_types(self) -> None:
        """Test graph dependency extraction handles tool, model, classifier, extractor and retrieval nodes."""
        # Arrange
        graph = {
            "nodes": [
                {"data": {"type": "tool"}},
                {"data": {"type": "llm"}},
                {"data": {"type": "question-classifier"}},
                {"data": {"type": "parameter-extractor"}},
                {"data": {"type": "knowledge-retrieval"}},
                {"data": {"type": "knowledge-retrieval"}},
                {"data": {"type": "knowledge-retrieval"}},
                {"data": {"type": "unknown"}},
            ]
        }

        retrieval_multiple_rerank = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="reranking_model",
                reranking_model=SimpleNamespace(provider="rerank-provider"),
                weights=None,
            ),
        )
        retrieval_multiple_weighted = SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="weighted_score",
                reranking_model=None,
                weights=SimpleNamespace(vector_setting=SimpleNamespace(embedding_provider_name="embed-provider")),
            ),
        )
        retrieval_single = SimpleNamespace(
            retrieval_mode="single",
            multiple_retrieval_config=None,
            single_retrieval_config=SimpleNamespace(model=SimpleNamespace(provider="single-provider")),
        )

        with (
            patch(
                "services.app_dsl_service.ToolNodeData.model_validate",
                return_value=SimpleNamespace(provider_id="tool-provider"),
            ),
            patch(
                "services.app_dsl_service.LLMNodeData.model_validate",
                return_value=SimpleNamespace(model=SimpleNamespace(provider="llm-provider")),
            ),
            patch(
                "services.app_dsl_service.QuestionClassifierNodeData.model_validate",
                return_value=SimpleNamespace(model=SimpleNamespace(provider="qc-provider")),
            ),
            patch(
                "services.app_dsl_service.ParameterExtractorNodeData.model_validate",
                return_value=SimpleNamespace(model=SimpleNamespace(provider="pe-provider")),
            ),
            patch(
                "services.app_dsl_service.KnowledgeRetrievalNodeData.model_validate",
                side_effect=[retrieval_multiple_rerank, retrieval_multiple_weighted, retrieval_single],
            ),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
                side_effect=lambda provider_id: f"tool::{provider_id}",
            ),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
                side_effect=lambda provider: f"model::{provider}",
            ),
        ):
            # Act
            result = AppDslService._extract_dependencies_from_workflow_graph(graph)

            # Assert
            assert result == [
                "tool::tool-provider",
                "model::llm-provider",
                "model::qc-provider",
                "model::pe-provider",
                "model::rerank-provider",
                "model::embed-provider",
                "model::single-provider",
            ]

    def test_extract_dependencies_from_workflow_graph_should_log_and_continue_on_node_error(self) -> None:
        """Test extraction errors on individual nodes are logged and do not abort processing."""
        # Arrange
        graph = {"nodes": [{"data": {"type": "tool"}}, {"data": {"type": "tool"}}]}

        with (
            patch(
                "services.app_dsl_service.ToolNodeData.model_validate",
                side_effect=[RuntimeError("bad"), SimpleNamespace(provider_id="ok")],
            ),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
                return_value="tool::ok",
            ),
            patch("services.app_dsl_service.logger") as mock_logger,
        ):
            # Act
            result = AppDslService._extract_dependencies_from_workflow_graph(graph)

            # Assert
            assert result == ["tool::ok"]
            mock_logger.exception.assert_called_once()

    def test_extract_dependencies_from_model_config_should_extract_model_dataset_and_tools(self) -> None:
        """Test model-config dependency extraction includes model, reranking and tool providers."""
        # Arrange
        model_config = {
            "model": {"provider": "model-provider"},
            "dataset_configs": {
                "datasets": {
                    "datasets": [{"reranking_model": {"reranking_provider_name": {"provider": "rerank-provider"}}}]
                }
            },
            "agent_mode": {"tools": [{"provider_id": "tool-provider"}]},
        }

        with (
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
                side_effect=lambda provider: f"model::{provider}",
            ),
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
                side_effect=lambda provider_id: f"tool::{provider_id}",
            ),
        ):
            # Act
            result = AppDslService._extract_dependencies_from_model_config(model_config)

            # Assert
            assert result == ["model::model-provider", "model::rerank-provider", "tool::tool-provider"]

    def test_extract_dependencies_from_model_config_should_log_on_exception(self) -> None:
        """Test model-config extraction logs exceptions and returns collected dependencies."""
        # Arrange
        model_config = {"model": {"provider": "model-provider"}}

        with (
            patch(
                "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
                side_effect=RuntimeError("boom"),
            ),
            patch("services.app_dsl_service.logger") as mock_logger,
        ):
            # Act
            result = AppDslService._extract_dependencies_from_model_config(model_config)

            # Assert
            assert result == []
            mock_logger.exception.assert_called_once()

    def test_get_leaked_dependencies_should_return_empty_when_no_dependencies(self) -> None:
        """Test get_leaked_dependencies returns empty list for empty input."""
        # Arrange

        # Act
        result = AppDslService.get_leaked_dependencies("tenant-1", [])

        # Assert
        assert result == []

    def test_get_leaked_dependencies_should_delegate_when_dependencies_exist(self) -> None:
        """Test get_leaked_dependencies delegates to dependency analysis service."""
        # Arrange
        dependencies = [SimpleNamespace(plugin_unique_identifier="a/b:1.0.0")]
        with patch(
            "services.app_dsl_service.DependenciesAnalysisService.get_leaked_dependencies",
            return_value=dependencies,
        ) as mock_get_leaked:
            # Act
            result = AppDslService.get_leaked_dependencies("tenant-1", dependencies)

            # Assert
            assert result == dependencies
            mock_get_leaked.assert_called_once_with(tenant_id="tenant-1", dependencies=dependencies)


class TestDatasetIdCrypto:
    """Test suite for dataset id encryption and decryption helpers."""

    def test_generate_aes_key_should_be_deterministic(self) -> None:
        """Test AES key generation is deterministic for same tenant id."""
        # Arrange

        # Act
        key1 = AppDslService._generate_aes_key("tenant-1")
        key2 = AppDslService._generate_aes_key("tenant-1")

        # Assert
        assert key1 == key2
        assert len(key1) == 32

    def test_encrypt_dataset_id_should_return_plain_text_when_encryption_disabled(self) -> None:
        """Test encryption helper returns plain id when feature flag is disabled."""
        # Arrange
        with patch("services.app_dsl_service.dify_config", new=SimpleNamespace(DSL_EXPORT_ENCRYPT_DATASET_ID=False)):
            # Act
            result = AppDslService.encrypt_dataset_id("dataset-id", "tenant-1")

            # Assert
            assert result == "dataset-id"

    def test_encrypt_and_decrypt_dataset_id_should_roundtrip_when_encryption_enabled(self) -> None:
        """Test encrypted dataset id can be decrypted back to original UUID."""
        # Arrange
        dataset_id = str(uuid4())
        with patch("services.app_dsl_service.dify_config", new=SimpleNamespace(DSL_EXPORT_ENCRYPT_DATASET_ID=True)):
            # Act
            encrypted = AppDslService.encrypt_dataset_id(dataset_id, "tenant-1")
            decrypted = AppDslService.decrypt_dataset_id(encrypted, "tenant-1")

            # Assert
            assert encrypted != dataset_id
            assert decrypted == dataset_id

    def test_decrypt_dataset_id_should_return_plain_uuid_without_decryption(self) -> None:
        """Test plain UUID input is returned directly."""
        # Arrange
        dataset_id = str(uuid4())

        # Act
        result = AppDslService.decrypt_dataset_id(dataset_id, "tenant-1")

        # Assert
        assert result == dataset_id

    def test_decrypt_dataset_id_should_return_none_for_invalid_data(self) -> None:
        """Test invalid ciphertext returns None."""
        # Arrange

        # Act
        result = AppDslService.decrypt_dataset_id("not-valid-base64", "tenant-1")

        # Assert
        assert result is None

    def test_decrypt_dataset_id_should_return_none_when_decrypted_text_not_uuid(self) -> None:
        """Test decrypt helper returns None when decrypted payload is not UUID."""
        # Arrange
        with (
            patch.object(AppDslService, "_generate_aes_key", return_value=b"0" * 32),
            patch("services.app_dsl_service.AES.new") as mock_aes,
            patch("services.app_dsl_service.unpad", return_value=b"not-a-uuid"),
        ):
            cipher = MagicMock()
            cipher.decrypt.return_value = b"x"
            mock_aes.return_value = cipher
            encrypted = base64.b64encode(b"payload").decode()

            # Act
            result = AppDslService.decrypt_dataset_id(encrypted, "tenant-1")

            # Assert
            assert result is None

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("550e8400-e29b-41d4-a716-446655440000", True),
            ("not-a-uuid", False),
            ("", False),
        ],
    )
    def test_is_valid_uuid_should_match_expected_result(self, value: str, expected: bool) -> None:
        """Test UUID validator returns expected booleans for valid and invalid inputs."""
        # Arrange

        # Act
        result = AppDslService._is_valid_uuid(value)

        # Assert
        assert result is expected
