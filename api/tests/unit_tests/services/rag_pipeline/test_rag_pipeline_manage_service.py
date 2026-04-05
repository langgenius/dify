from types import SimpleNamespace

from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService


def test_list_rag_pipeline_datasources_marks_authorized(mocker) -> None:
    datasource_1 = SimpleNamespace(provider="notion", plugin_id="plugin-1", is_authorized=False)
    datasource_2 = SimpleNamespace(provider="jina", plugin_id="plugin-2", is_authorized=False)

    manager_cls = mocker.patch("services.rag_pipeline.rag_pipeline_manage_service.PluginDatasourceManager")
    manager_cls.return_value.fetch_datasource_providers.return_value = [datasource_1, datasource_2]

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
