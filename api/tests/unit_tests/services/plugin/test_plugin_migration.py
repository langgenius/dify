from pytest_mock import MockerFixture

from services.plugin.plugin_migration import PluginMigration


def test_fetch_plugin_unique_identifier_returns_none_when_disabled(mocker: MockerFixture) -> None:
    mocker.patch("services.plugin.plugin_migration.dify_config.MARKETPLACE_ENABLED", False)
    batch_fetch = mocker.patch("services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests")

    result = PluginMigration._fetch_plugin_unique_identifier("langgenius/openai")

    assert result is None
    batch_fetch.assert_not_called()


def test_fetch_plugin_unique_identifier_calls_marketplace_when_enabled(mocker: MockerFixture) -> None:
    mocker.patch("services.plugin.plugin_migration.dify_config.MARKETPLACE_ENABLED", True)
    manifest = mocker.MagicMock()
    manifest.latest_package_identifier = "langgenius/openai:1.0.0@abc"
    mocker.patch(
        "services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests",
        return_value=[manifest],
    )

    result = PluginMigration._fetch_plugin_unique_identifier("langgenius/openai")

    assert result == "langgenius/openai:1.0.0@abc"
