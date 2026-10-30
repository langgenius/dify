from collections.abc import Generator
from unittest.mock import MagicMock

from pytest_mock import MockerFixture

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import WebsiteCrawlMessage, WebSiteInfo, WebSiteInfoDetail
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from tests.helpers.unit.core.datasource.factories import datasource_entity


def _messages() -> Generator[WebsiteCrawlMessage]:
    yield WebsiteCrawlMessage(result=WebSiteInfo(status="running", web_info_list=[]))
    yield WebsiteCrawlMessage(
        result=WebSiteInfo(
            status="completed",
            web_info_list=[
                WebSiteInfoDetail(
                    source_url="https://example.com",
                    content="Example",
                    title="Example",
                    description="Example page",
                )
            ],
        )
    )


def test_get_website_crawl_delegates_to_plugin_manager(mocker: MockerFixture) -> None:
    manager = MagicMock()
    manager.get_website_crawl.return_value = _messages()
    manager_type = mocker.patch(
        "core.datasource.website_crawl.website_crawl_plugin.PluginDatasourceManager",
        return_value=manager,
    )
    source = datasource_entity("website")
    runtime = DatasourceRuntime(tenant_id="tenant-id")
    runtime.credentials = {"api_key": "secret"}
    plugin = WebsiteCrawlDatasourcePlugin(
        entity=source,
        runtime=runtime,
        tenant_id="tenant-id",
        icon="icon.svg",
        plugin_unique_identifier="plugin-uid",
    )

    result = list(
        plugin.get_website_crawl(
            user_id="user-id",
            datasource_parameters={"url": "https://example.com"},
            provider_type="firecrawl",
        )
    )

    manager_type.assert_called_once_with(plugin_unique_identifier="plugin-uid")
    manager.get_website_crawl.assert_called_once_with(
        tenant_id="tenant-id",
        user_id="user-id",
        datasource_provider=source.identity.provider,
        datasource_name="website",
        credentials={"api_key": "secret"},
        datasource_parameters={"url": "https://example.com"},
        provider_type="firecrawl",
    )
    assert result[0].result.status == "running"
    assert result[1].result.web_info_list == [
        WebSiteInfoDetail(
            source_url="https://example.com",
            content="Example",
            title="Example",
            description="Example page",
        )
    ]


def test_datasource_provider_type() -> None:
    plugin = WebsiteCrawlDatasourcePlugin(
        entity=datasource_entity("website"),
        runtime=DatasourceRuntime(tenant_id="tenant-id"),
        tenant_id="tenant-id",
        icon="icon.svg",
        plugin_unique_identifier="plugin-uid",
    )

    assert plugin.datasource_provider_type() == "website_crawl"
