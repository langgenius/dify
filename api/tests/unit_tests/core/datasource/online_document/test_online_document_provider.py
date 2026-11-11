import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin, DatasourceProviderType
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_document.online_document_provider import OnlineDocumentDatasourcePluginProviderController
from tests.helpers.unit.core.datasource.factories import datasource_entity, provider_entity


class TestOnlineDocumentDatasourcePluginProviderController:
    @pytest.fixture
    def entity(self) -> DatasourceProviderEntityWithPlugin:
        entity = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        entity.datasources = []
        entity.identity.icon = "test-icon"
        return entity

    def test_init_and_provider_type(self, entity: DatasourceProviderEntityWithPlugin) -> None:
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity,
            plugin_id="plugin-id",
            plugin_unique_identifier="plugin-uid",
            tenant_id="tenant-id",
        )

        assert controller.entity is entity
        assert controller.plugin_id == "plugin-id"
        assert controller.plugin_unique_identifier == "plugin-uid"
        assert controller.tenant_id == "tenant-id"
        assert controller.provider_type == DatasourceProviderType.ONLINE_DOCUMENT

    def test_get_datasource(self, entity: DatasourceProviderEntityWithPlugin) -> None:
        source = datasource_entity("notion")
        entity.datasources = [source]
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity,
            plugin_id="plugin-id",
            plugin_unique_identifier="plugin-uid",
            tenant_id="tenant-id",
        )

        result = controller.get_datasource("notion")

        assert isinstance(result, OnlineDocumentDatasourcePlugin)
        assert result.entity is source
        assert isinstance(result.runtime, DatasourceRuntime)
        assert result.runtime.tenant_id == "tenant-id"
        assert result.tenant_id == "tenant-id"
        assert result.icon == "test-icon"
        assert result.plugin_unique_identifier == "plugin-uid"

    def test_get_datasource_rejects_unknown_name(self, entity: DatasourceProviderEntityWithPlugin) -> None:
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity,
            plugin_id="plugin-id",
            plugin_unique_identifier="plugin-uid",
            tenant_id="tenant-id",
        )

        with pytest.raises(ValueError, match="Datasource with name missing not found"):
            controller.get_datasource("missing")
