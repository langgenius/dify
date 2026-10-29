"""Real datasource entities shared by provider and plugin tests."""

from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceIdentity,
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderIdentity,
    DatasourceProviderType,
)
from core.tools.entities.common_entities import I18nObject


def datasource_entity(name: str) -> DatasourceEntity:
    return DatasourceEntity(
        identity=DatasourceIdentity(
            author="test",
            name=name,
            label=I18nObject(en_US=name),
            provider="test-provider",
        ),
        description=I18nObject(en_US="Test datasource"),
    )


def provider_entity(provider_type: DatasourceProviderType) -> DatasourceProviderEntityWithPlugin:
    return DatasourceProviderEntityWithPlugin(
        identity=DatasourceProviderIdentity(
            author="test",
            name="test-provider",
            description=I18nObject(en_US="Test provider"),
            icon="icon.svg",
            label=I18nObject(en_US="Test"),
        ),
        provider_type=provider_type,
    )
