from pytest_mock import MockerFixture

from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler


def test_return_retriever_resource_info_publishes_event(mocker: MockerFixture) -> None:
    mock_queue_manager = mocker.Mock()
    handler = DatasetIndexToolCallbackHandler(mock_queue_manager)
    mocker.patch("services.knowledge.retrieval.adapters.resource_events.QueueRetrieverResourcesEvent")
    resources = [mocker.Mock()]

    handler.return_retriever_resource_info(resources)

    mock_queue_manager.publish.assert_called_once()
