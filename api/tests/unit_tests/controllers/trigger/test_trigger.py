"""Invalid trigger capabilities fail through the real Flask route before dependencies are accessed."""

from http import HTTPStatus

import pytest
from flask import Flask

from controllers.trigger.trigger import trigger_endpoint


@pytest.mark.parametrize("endpoint_id", ["not-a-uuid", "123e4567-e89b-12d3-a456-426614174000"])
def test_invalid_endpoint_preserves_json_error_contract(endpoint_id: str) -> None:
    app = Flask(__name__)
    app.add_url_rule("/triggers/plugin/<string:endpoint_id>", view_func=trigger_endpoint, methods=["POST"])

    response = app.test_client().post(f"/triggers/plugin/{endpoint_id}", json={})

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.data == b'{"error":"Endpoint not found"}'
    assert response.mimetype == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
