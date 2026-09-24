import inspect
from unittest.mock import patch

import pytest
from werkzeug.exceptions import BadRequest, NotFound, ServiceUnavailable

from controllers.inner_api.knowledge_fs.texts import KnowledgeFSTextApi

PAYLOAD = {
    "operation": "get",
    "scope": {
        "tenant_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0001",
        "knowledge_space_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0002",
        "index_version": "fts-v1",
    },
    "ids": ["018f0d60-7a49-7cc2-9c1b-5b36f18f0004"],
}


def test_text_controller_rejects_unauthenticated_requests(app):
    with app.test_request_context(json=PAYLOAD):
        with pytest.raises(NotFound):
            KnowledgeFSTextApi().post()


def test_text_controller_validates_before_opening_backend(app):
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json={**PAYLOAD, "endpoint": "http://untrusted"}),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
    ):
        with pytest.raises(BadRequest):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_text_controller_hides_provider_credentials(app):
    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.texts.configured_text_client",
            side_effect=RuntimeError("private-api-key"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert "private-api-key" not in str(error.value)
        assert error.value.__suppress_context__


def test_text_controller_serializes_successful_response(app):
    handler = KnowledgeFSTextApi()
    result = {"points": [], "matches": [{"id": PAYLOAD["ids"][0], "score": 0.75}]}
    with (
        app.test_request_context(json=PAYLOAD),
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client"),
        patch("controllers.inner_api.knowledge_fs.texts.execute_text_request", return_value=result),
    ):
        assert inspect.unwrap(handler.post)(handler) == result


def test_text_controller_accepts_only_configured_inner_key(app, config_overrides):
    config_overrides(PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    with (
        patch("controllers.inner_api.knowledge_fs.texts.configured_text_client") as client,
        patch(
            "controllers.inner_api.knowledge_fs.texts.execute_text_request",
            return_value={"points": [], "matches": []},
        ),
    ):
        for key in [None, "wrong-key"]:
            with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": key} if key else {}):
                with pytest.raises(NotFound):
                    KnowledgeFSTextApi().post()
        client.assert_not_called()
        with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": "trusted-key"}):
            assert KnowledgeFSTextApi().post() == {"points": [], "matches": []}
            client.assert_called_once_with(PAYLOAD["scope"]["tenant_id"], allow_create=False)


def test_text_controller_reports_pending_index_without_leaking_credentials(app):
    from services.knowledge_fs.text_store import TextIndexPendingError

    handler = KnowledgeFSTextApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.texts.configured_text_client",
            side_effect=TextIndexPendingError("secret"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert error.value.retry_after == 5
        assert "secret" not in str(error.value)
