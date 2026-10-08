import pytest
from pytest_mock import MockerFixture

from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler


@pytest.fixture
def mock_queue_manager(mocker: MockerFixture):
    return mocker.Mock()


@pytest.fixture
def handler(mock_queue_manager):
    return DatasetIndexToolCallbackHandler(mock_queue_manager)


class TestReturnRetrieverResourceInfo:
    def test_publish_called(self, handler: DatasetIndexToolCallbackHandler, mock_queue_manager, mocker: MockerFixture):
        mock_event = mocker.patch("services.knowledge.retrieval.adapters.resource_events.QueueRetrieverResourcesEvent")
        resources = [mocker.Mock()]

        handler.return_retriever_resource_info(resources)

        mock_queue_manager.publish.assert_called_once()
