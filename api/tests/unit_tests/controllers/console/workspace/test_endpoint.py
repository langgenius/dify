from unittest.mock import MagicMock, patch

import pytest

from controllers.console.workspace.endpoint import (
    EndpointCreateApi,
    EndpointDeleteApi,
    EndpointDisableApi,
    EndpointEnableApi,
    EndpointListApi,
    EndpointListForSinglePluginApi,
    EndpointUpdateApi,
)
from core.plugin.impl.exc import PluginPermissionDeniedError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def user_and_tenant():
    return MagicMock(id="u1"), "t1"


@pytest.fixture
def patch_current_account(user_and_tenant):
    with patch(
        "controllers.console.workspace.endpoint.current_account_with_tenant",
        return_value=user_and_tenant,
    ):
        yield


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointCreateApi:
    def test_create_success(self, app):
        api = EndpointCreateApi()
        method = unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "plugin-1",
            "name": "endpoint",
            "settings": {"a": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.create_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_create_permission_denied(self, app):
        api = EndpointCreateApi()
        method = unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "plugin-1",
            "name": "endpoint",
            "settings": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.create_endpoint",
                side_effect=PluginPermissionDeniedError("denied"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_create_validation_error(self, app):
        api = EndpointCreateApi()
        method = unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "p1",
            "name": "",
            "settings": {},
        }

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointListApi:
    def test_list_success(self, app):
        api = EndpointListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.endpoint.EndpointService.list_endpoints", return_value=[{"id": "e1"}]),
        ):
            result = method(api)

        assert "endpoints" in result
        assert len(result["endpoints"]) == 1

    def test_list_invalid_query(self, app):
        api = EndpointListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=0&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointListForSinglePluginApi:
    def test_list_for_plugin_success(self, app):
        api = EndpointListForSinglePluginApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10&plugin_id=p1"),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.list_endpoints_for_single_plugin",
                return_value=[{"id": "e1"}],
            ),
        ):
            result = method(api)

        assert "endpoints" in result

    def test_list_for_plugin_missing_param(self, app):
        api = EndpointListForSinglePluginApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointDeleteApi:
    def test_delete_success(self, app):
        api = EndpointDeleteApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_delete_invalid_payload(self, app):
        api = EndpointDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_delete_service_failure(self, app):
        api = EndpointDeleteApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointUpdateApi:
    def test_update_success(self, app):
        api = EndpointUpdateApi()
        method = unwrap(api.post)

        payload = {
            "endpoint_id": "e1",
            "name": "new-name",
            "settings": {"x": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_update_validation_error(self, app):
        api = EndpointUpdateApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1", "settings": {}}

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_update_service_failure(self, app):
        api = EndpointUpdateApi()
        method = unwrap(api.post)

        payload = {
            "endpoint_id": "e1",
            "name": "n",
            "settings": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointEnableApi:
    def test_enable_success(self, app):
        api = EndpointEnableApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.enable_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_enable_invalid_payload(self, app):
        api = EndpointEnableApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_enable_service_failure(self, app):
        api = EndpointEnableApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.enable_endpoint", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointDisableApi:
    def test_disable_success(self, app):
        api = EndpointDisableApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.disable_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_disable_invalid_payload(self, app):
        api = EndpointDisableApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)
