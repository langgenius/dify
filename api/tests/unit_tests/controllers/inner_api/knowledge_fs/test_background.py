import inspect
from collections.abc import Callable
from unittest.mock import patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge, ServiceUnavailable

from controllers.inner_api.knowledge_fs.background import KnowledgeFSBackgroundHealthApi, KnowledgeFSBackgroundJobApi

JOB = {
    "id": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    "type": "document.compile",
    "payload": {"attemptId": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02"},
}


def test_publication_returns_202_only_after_broker_accepts(app: Flask) -> None:
    handler = KnowledgeFSBackgroundJobApi()
    with (
        app.test_request_context(json=JOB),
        patch("controllers.inner_api.knowledge_fs.background.publish_background_job") as publish,
    ):
        response = inspect.unwrap(handler.post)(handler)
    assert response.status_code == 202
    assert response.get_data() == b""
    publish.assert_called_once()


def test_publication_failure_is_retryable_and_does_not_report_success(app: Flask) -> None:
    handler = KnowledgeFSBackgroundJobApi()
    with (
        app.test_request_context(json=JOB),
        patch(
            "controllers.inner_api.knowledge_fs.background.publish_background_job",
            side_effect=RuntimeError("broker unavailable"),
        ),
    ):
        with pytest.raises(ServiceUnavailable):
            inspect.unwrap(handler.post)(handler)


def test_unknown_fields_never_reach_the_broker(app: Flask) -> None:
    handler = KnowledgeFSBackgroundJobApi()
    with (
        app.test_request_context(json={**JOB, "command": "anything"}),
        patch("controllers.inner_api.knowledge_fs.background.publish_background_job") as publish,
    ):
        with pytest.raises(BadRequest):
            inspect.unwrap(handler.post)(handler)
        publish.assert_not_called()


def test_publisher_readiness_is_closed_before_rollout(config_overrides: Callable[..., None]) -> None:
    handler = KnowledgeFSBackgroundHealthApi()
    config_overrides(KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=False)
    with pytest.raises(ServiceUnavailable):
        inspect.unwrap(handler.get)(handler)
    config_overrides(KNOWLEDGE_FS_BACKGROUND_WORKER_ENABLED=True)
    with patch("controllers.inner_api.knowledge_fs.background.check_background_publisher_ready"):
        assert inspect.unwrap(handler.get)(handler).status_code == 204


def test_oversized_locator_is_rejected_before_json_parsing(app: Flask) -> None:
    handler = KnowledgeFSBackgroundJobApi()
    with app.test_request_context(json={"body": "x" * 17000}):
        with pytest.raises(RequestEntityTooLarge):
            inspect.unwrap(handler.post)(handler)


def test_broker_outage_is_not_reported_as_ready() -> None:
    handler = KnowledgeFSBackgroundHealthApi()
    with patch(
        "controllers.inner_api.knowledge_fs.background.check_background_publisher_ready", side_effect=OSError("offline")
    ):
        with pytest.raises(ServiceUnavailable):
            inspect.unwrap(handler.get)(handler)
