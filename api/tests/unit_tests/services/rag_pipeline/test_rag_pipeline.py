from pytest_mock import MockerFixture

from services.rag_pipeline.rag_pipeline import RagPipelineService


def _make_service() -> RagPipelineService:
    return RagPipelineService.__new__(RagPipelineService)


def test_fetch_recommended_plugin_manifests_returns_empty_when_disabled(
    mocker: MockerFixture,
) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline.dify_config.MARKETPLACE_ENABLED", False)
    batch_fetch = mocker.patch("services.rag_pipeline.rag_pipeline.marketplace.batch_fetch_plugin_by_ids")

    service = _make_service()
    result = service._fetch_recommended_plugin_manifests(["langgenius/openai"])

    assert result == []
    batch_fetch.assert_not_called()


def test_fetch_recommended_plugin_manifests_returns_data_when_enabled(
    mocker: MockerFixture,
) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline.dify_config.MARKETPLACE_ENABLED", True)
    expected = [{"plugin_id": "langgenius/openai", "name": "OpenAI"}]
    mocker.patch(
        "services.rag_pipeline.rag_pipeline.marketplace.batch_fetch_plugin_by_ids",
        return_value=expected,
    )

    service = _make_service()
    result = service._fetch_recommended_plugin_manifests(["langgenius/openai"])

    assert result == expected
