from types import SimpleNamespace

from pytest_mock import MockerFixture

from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService


def _datasource(
    provider: str,
    plugin_id: str,
    *,
    credentials_schema: list[object] | None = None,
    oauth_schema: object | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        provider=provider,
        plugin_id=plugin_id,
        is_authorized=False,
        declaration=SimpleNamespace(
            credentials_schema=credentials_schema if credentials_schema is not None else [object()],
            oauth_schema=oauth_schema,
        ),
    )


def test_list_rag_pipeline_datasources_marks_authorized(mocker: MockerFixture) -> None:
    datasource_1 = _datasource("notion", "plugin-1")
    datasource_2 = _datasource("jina", "plugin-2")

    manager_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.PluginDatasourceManager")
    manager_cls.return_value.fetch_datasource_providers.return_value = [
        datasource_1,
        datasource_2,
    ]

    provider_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.DatasourceProviderService")
    provider_instance = provider_cls.return_value
    provider_instance.get_datasource_credentials.side_effect = [
        {"access_token": "token"},
        None,
    ]

    result = RagPipelineManageService.list_rag_pipeline_datasources("tenant-1")

    assert result == [datasource_1, datasource_2]
    assert datasource_1.is_authorized is True
    assert datasource_2.is_authorized is False


def test_list_rag_pipeline_datasources_marks_credential_free_providers_authorized(
    mocker: MockerFixture,
) -> None:
    local_file = _datasource("local_file", "plugin-0", credentials_schema=[])
    notion = _datasource("notion", "plugin-1")

    manager_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.PluginDatasourceManager")
    manager_cls.return_value.fetch_datasource_providers.return_value = [
        local_file,
        notion,
    ]

    provider_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.DatasourceProviderService")
    provider_instance = provider_cls.return_value
    provider_instance.get_datasource_credentials.return_value = None

    result = RagPipelineManageService.list_rag_pipeline_datasources("tenant-1")

    assert result == [local_file, notion]
    assert local_file.is_authorized is True
    assert notion.is_authorized is False
    provider_instance.get_datasource_credentials.assert_called_once_with(
        tenant_id="tenant-1", provider="notion", plugin_id="plugin-1"
    )


def test_oauth_only_provider_still_requires_authorization(
    mocker: MockerFixture,
) -> None:
    oauth_only = _datasource("notion_oauth", "plugin-2", credentials_schema=[], oauth_schema=object())

    manager_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.PluginDatasourceManager")
    manager_cls.return_value.fetch_datasource_providers.return_value = [oauth_only]

    provider_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.DatasourceProviderService")
    provider_instance = provider_cls.return_value
    provider_instance.get_datasource_credentials.return_value = None

    result = RagPipelineManageService.list_rag_pipeline_datasources("tenant-1")

    assert result == [oauth_only]
    assert oauth_only.is_authorized is False
    # the guard must not skip the credential lookup for OAuth-only providers
    provider_instance.get_datasource_credentials.assert_called_once_with(
        tenant_id="tenant-1", provider="notion_oauth", plugin_id="plugin-2"
    )
