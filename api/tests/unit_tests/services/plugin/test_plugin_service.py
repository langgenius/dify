import json
from unittest.mock import MagicMock, patch

MODULE = "services.plugin.plugin_service"


def _make_workflow(workflow_id: str, graph: dict):
    from models.workflow import Workflow

    workflow = Workflow()
    workflow.id = workflow_id
    workflow.tenant_id = "tenant-1"
    workflow.graph = json.dumps(graph)
    return workflow


class TestFetchLatestPluginVersion:
    def test_skips_marketplace_fetch_when_disabled(self) -> None:
        """Cache misses stay None; marketplace is never called when disabled."""
        with (
            patch(f"{MODULE}.dify_config") as mock_cfg,
            patch(f"{MODULE}.redis_client") as mock_redis,
            patch(f"{MODULE}.marketplace") as mock_marketplace,
        ):
            mock_cfg.MARKETPLACE_ENABLED = False
            mock_redis.get.return_value = None  # all cache misses

            from services.plugin.plugin_service import PluginService

            result = PluginService.fetch_latest_plugin_version(["langgenius/openai", "langgenius/anthropic"])

        mock_marketplace.batch_fetch_plugin_manifests.assert_not_called()
        assert result == {"langgenius/openai": None, "langgenius/anthropic": None}

    def test_calls_marketplace_fetch_when_enabled(self) -> None:
        """Cache misses trigger marketplace fetch when enabled."""
        manifest = MagicMock()
        manifest.plugin_id = "langgenius/openai"
        manifest.latest_version = "1.0.0"
        manifest.latest_package_identifier = "langgenius/openai:1.0.0@abc"
        manifest.status = "active"
        manifest.deprecated_reason = ""
        manifest.alternative_plugin_id = ""

        with (
            patch(f"{MODULE}.dify_config") as mock_cfg,
            patch(f"{MODULE}.redis_client") as mock_redis,
            patch(f"{MODULE}.marketplace") as mock_marketplace,
        ):
            mock_cfg.MARKETPLACE_ENABLED = True
            mock_redis.get.return_value = None
            mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

            from services.plugin.plugin_service import PluginService

            result = PluginService.fetch_latest_plugin_version(["langgenius/openai"])

        # The list arg is mutated by remove() after the call, so check call count + result.
        mock_marketplace.batch_fetch_plugin_manifests.assert_called_once()
        assert result["langgenius/openai"] is not None
        assert result["langgenius/openai"].version == "1.0.0"


class TestWorkflowPluginIdentifierMigration:
    def test_replace_plugin_unique_identifier_updates_nested_exact_matches(self) -> None:
        from services.plugin.plugin_service import PluginService

        old_identifier = "langgenius/md_exporter:2.1.0@old"
        new_identifier = "langgenius/md_exporter:3.6.9@new"
        graph = {
            "nodes": [
                {
                    "data": {
                        "type": "tool",
                        "plugin_unique_identifier": old_identifier,
                        "provider_name": "md_exporter",
                        "nested": [{"plugin_unique_identifier": old_identifier}],
                    }
                },
                {
                    "data": {
                        "type": "tool",
                        "plugin_unique_identifier": "langgenius/other:1.0.0@hash",
                        "note": old_identifier,
                    }
                },
            ]
        }

        replacements = PluginService._replace_plugin_unique_identifier(graph, old_identifier, new_identifier)

        assert replacements == 2
        assert graph["nodes"][0]["data"]["plugin_unique_identifier"] == new_identifier
        assert graph["nodes"][0]["data"]["nested"][0]["plugin_unique_identifier"] == new_identifier
        assert graph["nodes"][1]["data"]["plugin_unique_identifier"] == "langgenius/other:1.0.0@hash"
        assert graph["nodes"][1]["data"]["note"] == old_identifier

    def test_migrate_workflow_plugin_unique_identifier_commits_changed_workflows_only(self) -> None:
        from services.plugin.plugin_service import PluginService

        old_identifier = "langgenius/md_exporter:2.1.0@old"
        new_identifier = "langgenius/md_exporter:3.6.9@new"
        matching_workflow = _make_workflow(
            "workflow-1",
            {
                "nodes": [
                    {
                        "data": {
                            "type": "tool",
                            "plugin_unique_identifier": old_identifier,
                        }
                    }
                ]
            },
        )
        false_positive_workflow = _make_workflow(
            "workflow-2",
            {
                "nodes": [
                    {
                        "data": {
                            "type": "llm",
                            "prompt": old_identifier,
                        }
                    }
                ]
            },
        )

        with patch(f"{MODULE}.db.session") as session:
            session.scalars.return_value.all.return_value = [matching_workflow, false_positive_workflow]

            updated_count = PluginService._migrate_workflow_plugin_unique_identifier(
                "tenant-1", old_identifier, new_identifier
            )

        assert updated_count == 1
        assert json.loads(matching_workflow.graph)["nodes"][0]["data"]["plugin_unique_identifier"] == new_identifier
        assert json.loads(false_positive_workflow.graph)["nodes"][0]["data"]["prompt"] == old_identifier
        session.commit.assert_called_once()


class TestUpgradePluginMigratesWorkflowReferences:
    def test_marketplace_upgrade_migrates_workflow_references(self, mock_installer, mock_features) -> None:
        from services.plugin.plugin_service import PluginService

        response = MagicMock()
        mock_installer.upgrade_plugin.return_value = response
        mock_installer.fetch_plugin_manifest.return_value = MagicMock()

        with (
            patch(f"{MODULE}.dify_config") as mock_cfg,
            patch(f"{MODULE}.marketplace.record_install_plugin_event"),
            patch.object(PluginService, "_migrate_workflow_plugin_unique_identifier") as migrate,
        ):
            mock_cfg.MARKETPLACE_ENABLED = True

            result = PluginService.upgrade_plugin_with_marketplace("tenant-1", "plugin:1.0.0@old", "plugin:2.0.0@new")

        assert result is response
        migrate.assert_called_once_with("tenant-1", "plugin:1.0.0@old", "plugin:2.0.0@new")

    def test_github_upgrade_migrates_workflow_references(self, mock_installer, mock_features) -> None:
        from services.plugin.plugin_service import PluginService

        response = MagicMock()
        mock_installer.upgrade_plugin.return_value = response

        with patch.object(PluginService, "_migrate_workflow_plugin_unique_identifier") as migrate:
            result = PluginService.upgrade_plugin_with_github(
                "tenant-1", "plugin:1.0.0@old", "plugin:2.0.0@new", "acme/plugin", "2.0.0", "plugin.difypkg"
            )

        assert result is response
        migrate.assert_called_once_with("tenant-1", "plugin:1.0.0@old", "plugin:2.0.0@new")
