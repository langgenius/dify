import uuid
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.datasets.hit_testing import HitTestingApi
from controllers.console.datasets.hit_testing_base import HitTestingPayload


def unwrap(func):
    """Recursively unwrap decorated functions."""
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_hit_testing")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def dataset_id():
    return uuid.uuid4()


@pytest.fixture
def dataset():
    return MagicMock(id="dataset-1")


@pytest.fixture(autouse=True)
def bypass_decorators(mocker):
    """Bypass all decorators on the API method."""
    mocker.patch(
        "controllers.console.datasets.hit_testing.setup_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.login_required",
        return_value=lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.account_initialization_required",
        return_value=lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.cloud_edition_billing_rate_limit_check",
        return_value=lambda *_: (lambda f: f),
    )


class TestHitTestingApi:
    def test_hit_testing_success(self, app, dataset, dataset_id):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "what is vector search",
            "top_k": 3,
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingPayload,
                "model_validate",
                return_value=MagicMock(model_dump=lambda **_: payload),
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
            ),
            patch.object(
                HitTestingApi,
                "perform_hit_testing",
                return_value={"query": "what is vector search", "records": []},
            ),
        ):
            result = method(api, dataset_id)

        assert "query" in result
        assert "records" in result
        assert result["records"] == []

    def test_hit_testing_dataset_not_found(self, app, dataset_id):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "test",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                side_effect=NotFound("Dataset not found"),
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, dataset_id)

    def test_hit_testing_invalid_args(self, app, dataset, dataset_id):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingPayload,
                "model_validate",
                return_value=MagicMock(model_dump=lambda **_: payload),
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
                side_effect=ValueError("Invalid parameters"),
            ),
        ):
            with pytest.raises(ValueError, match="Invalid parameters"):
                method(api, dataset_id)
