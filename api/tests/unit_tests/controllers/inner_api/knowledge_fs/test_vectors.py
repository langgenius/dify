import inspect
from contextlib import nullcontext
from unittest.mock import patch

import pytest
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, ServiceUnavailable

from controllers.inner_api.knowledge_fs.vectors import KnowledgeFSVectorApi
from services.vector_space_admission_service import VectorSpaceAdmissionError

PAYLOAD = {
    "operation": "get",
    "scope": {
        "tenant_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0001",
        "knowledge_space_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0002",
        "vector_space_id": "embedding-v1",
        "kind": "dense",
        "dimension": 2,
    },
    "ids": ["018f0d60-7a49-7cc2-9c1b-5b36f18f0004"],
}


def test_vector_controller_rejects_unauthenticated_requests(app):
    with app.test_request_context(json=PAYLOAD):
        with pytest.raises(NotFound):
            KnowledgeFSVectorApi().post()


def test_vector_controller_validates_before_opening_backend(app):
    handler = KnowledgeFSVectorApi()
    with (
        app.test_request_context(json={**PAYLOAD, "endpoint": "http://untrusted"}),
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client") as client,
    ):
        with pytest.raises(BadRequest):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_vector_controller_hides_provider_credentials(app):
    handler = KnowledgeFSVectorApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.vectors.configured_vector_client",
            side_effect=RuntimeError("private-api-key"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert "private-api-key" not in str(error.value)
        assert error.value.__suppress_context__


def test_vector_controller_serializes_successful_response(app):
    handler = KnowledgeFSVectorApi()
    result = {"points": [], "matches": [{"id": PAYLOAD["ids"][0], "score": 0.75}]}
    with (
        app.test_request_context(json=PAYLOAD),
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client"),
        patch("controllers.inner_api.knowledge_fs.vectors.execute_vector_request", return_value=result),
    ):
        assert inspect.unwrap(handler.post)(handler) == result


def test_vector_controller_accepts_only_configured_inner_key(app, config_overrides):
    config_overrides(PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    with (
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client") as client,
        patch(
            "controllers.inner_api.knowledge_fs.vectors.execute_vector_request",
            return_value={"points": [], "matches": []},
        ),
    ):
        for key in [None, "wrong-key"]:
            with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": key} if key else {}):
                with pytest.raises(NotFound):
                    KnowledgeFSVectorApi().post()
        client.assert_not_called()
        with app.test_request_context(json=PAYLOAD, headers={"X-Inner-Api-Key": "trusted-key"}):
            assert KnowledgeFSVectorApi().post() == {"points": [], "matches": []}
            client.assert_called_once_with(PAYLOAD["scope"]["tenant_id"], allow_create=False)


def test_vector_controller_reports_quota_failure(app):
    handler = KnowledgeFSVectorApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client"),
        patch(
            "controllers.inner_api.knowledge_fs.vectors.execute_vector_request",
            side_effect=VectorSpaceAdmissionError("vector quota exceeded"),
        ),
    ):
        with pytest.raises(Forbidden, match="vector quota exceeded"):
            inspect.unwrap(handler.post)(handler)


@pytest.mark.parametrize("operation", ["get", "search", "delete", "upsert"])
def test_only_admitted_writes_can_provision(app, operation):
    handler = KnowledgeFSVectorApi()
    payload = {**PAYLOAD, "operation": operation}
    if operation == "search":
        payload["query_vector"] = [1, 0]
    if operation == "upsert":
        payload.pop("ids")
        payload["points"] = [
            {"id": PAYLOAD["ids"][0], "generation_id": PAYLOAD["ids"][0], "content_hash": "a" * 64, "vector": [1, 0]}
        ]
    with (
        app.test_request_context(json=payload),
        patch("controllers.inner_api.knowledge_fs.vectors.admit_vector_request") as admit,
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client") as client,
        patch(
            "controllers.inner_api.knowledge_fs.vectors.execute_vector_request",
            return_value={"points": [], "matches": []},
        ) as execute,
    ):

        def open_client(*_args, **_kwargs):
            admit.assert_called_once()
            return nullcontext(object())

        client.side_effect = open_client
        inspect.unwrap(handler.post)(handler)
        assert client.call_args.kwargs["allow_create"] is (operation == "upsert")
        assert execute.call_args.kwargs["check_admission"] is False


def test_quota_rejection_cannot_allocate_a_cluster(app):
    handler = KnowledgeFSVectorApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.vectors.admit_vector_request",
            side_effect=VectorSpaceAdmissionError("quota"),
        ),
        patch("controllers.inner_api.knowledge_fs.vectors.configured_vector_client") as client,
    ):
        with pytest.raises(Forbidden):
            inspect.unwrap(handler.post)(handler)
        client.assert_not_called()


def test_pending_cluster_returns_explicit_retry_after_without_secrets(app):
    from services.tidb_binding_service import TidbBindingPendingError

    handler = KnowledgeFSVectorApi()
    with (
        app.test_request_context(json=PAYLOAD),
        patch(
            "controllers.inner_api.knowledge_fs.vectors.configured_vector_client",
            side_effect=TidbBindingPendingError("private endpoint"),
        ),
    ):
        with pytest.raises(ServiceUnavailable) as error:
            inspect.unwrap(handler.post)(handler)
        assert ("Retry-After", "5") in error.value.get_headers()
        assert "private" not in str(error.value)


def test_http_pending_response_preserves_retry_after_header(config_overrides):
    from flask import Flask
    from flask_restx import Api

    from services.tidb_binding_service import TidbBindingPendingError

    config_overrides(PLUGIN_DAEMON_KEY="enabled", INNER_API_KEY_FOR_PLUGIN="trusted-key")
    http_app = Flask(__name__)
    Api(http_app).add_resource(KnowledgeFSVectorApi, "/vectors")
    with patch(
        "controllers.inner_api.knowledge_fs.vectors.configured_vector_client",
        side_effect=TidbBindingPendingError("private endpoint"),
    ):
        response = http_app.test_client().post("/vectors", json=PAYLOAD, headers={"X-Inner-Api-Key": "trusted-key"})
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    assert "private" not in response.get_data(as_text=True)
