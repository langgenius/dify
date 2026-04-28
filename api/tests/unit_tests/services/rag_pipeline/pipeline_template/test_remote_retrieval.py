import pytest

from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType
from services.rag_pipeline.pipeline_template.remote.remote_retrieval import RemotePipelineTemplateRetrieval


def test_get_pipeline_templates_fallbacks_to_database_on_error(mocker) -> None:
    fetch_mock = mocker.patch.object(
        RemotePipelineTemplateRetrieval,
        "fetch_pipeline_templates_from_dify_official",
        side_effect=RuntimeError("boom"),
    )
    fallback_mock = mocker.patch.object(
        DatabasePipelineTemplateRetrieval,
        "fetch_pipeline_templates_from_db",
        return_value={"pipeline_templates": [{"id": "db-1"}]},
    )
    retrieval = RemotePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US")

    assert retrieval.get_type() == PipelineTemplateType.REMOTE
    assert result == {"pipeline_templates": [{"id": "db-1"}]}
    fetch_mock.assert_called_once_with("en-US")
    fallback_mock.assert_called_once_with("en-US")


def test_get_pipeline_template_detail_fallbacks_to_database_on_error(mocker) -> None:
    fetch_mock = mocker.patch.object(
        RemotePipelineTemplateRetrieval,
        "fetch_pipeline_template_detail_from_dify_official",
        side_effect=RuntimeError("boom"),
    )
    fallback_mock = mocker.patch.object(
        DatabasePipelineTemplateRetrieval,
        "fetch_pipeline_template_detail_from_db",
        return_value={"id": "db-1"},
    )
    retrieval = RemotePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("tpl-1")

    assert result == {"id": "db-1"}
    fetch_mock.assert_called_once_with("tpl-1")
    fallback_mock.assert_called_once_with("tpl-1")


def test_fetch_pipeline_templates_from_dify_official(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.pipeline_template.remote.remote_retrieval"
        ".dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN",
        "https://example.com",
    )

    success_response = mocker.Mock(status_code=200)
    success_response.json.return_value = {"pipeline_templates": [{"id": "remote-1"}]}

    failed_response = mocker.Mock(status_code=500)

    http_get_mock = mocker.patch(
        "services.rag_pipeline.pipeline_template.remote.remote_retrieval.httpx.get",
        side_effect=[success_response, failed_response],
    )

    success_result = RemotePipelineTemplateRetrieval.fetch_pipeline_templates_from_dify_official("en-US")

    with pytest.raises(ValueError):
        RemotePipelineTemplateRetrieval.fetch_pipeline_templates_from_dify_official("en-US")

    assert success_result == {"pipeline_templates": [{"id": "remote-1"}]}
    assert http_get_mock.call_count == 2


def test_fetch_pipeline_template_detail_from_dify_official(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.pipeline_template.remote.remote_retrieval"
        ".dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN",
        "https://example.com",
    )

    success_response = mocker.Mock(status_code=200)
    success_response.json.return_value = {"id": "remote-1", "name": "Remote Template"}

    failed_response = mocker.Mock(status_code=404)
    failed_response.text = "Not Found"

    http_get_mock = mocker.patch(
        "services.rag_pipeline.pipeline_template.remote.remote_retrieval.httpx.get",
        side_effect=[success_response, failed_response],
    )

    success_result = RemotePipelineTemplateRetrieval.fetch_pipeline_template_detail_from_dify_official("remote-1")
    with pytest.raises(ValueError):
        RemotePipelineTemplateRetrieval.fetch_pipeline_template_detail_from_dify_official("missing")

    assert success_result == {"id": "remote-1", "name": "Remote Template"}
    assert http_get_mock.call_count == 2
