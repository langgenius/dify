from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.workspace.endpoint import (
    DeprecatedEndpointCreateApi,
    DeprecatedEndpointDeleteApi,
    DeprecatedEndpointUpdateApi,
    EndpointCollectionApi,
    EndpointDisableApi,
    EndpointEnableApi,
    EndpointItemApi,
    EndpointListApi,
    EndpointListForSinglePluginApi,
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
class TestEndpointCollectionApi:
    def test_create_success(self, app: Flask):
        api = EndpointCollectionApi()
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

    def test_create_permission_denied(self, app: Flask):
        api = EndpointCollectionApi()
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

    def test_create_validation_error(self, app: Flask):
        api = EndpointCollectionApi()
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
class TestDeprecatedEndpointCreateApi:
    def test_create_success(self, app: Flask):
        api = DeprecatedEndpointCreateApi()
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


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointListApi:
    def test_list_success(self, app: Flask):
        api = EndpointListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.endpoint.EndpointService.list_endpoints", return_value=[{"id": "e1"}]),
        ):
            result = method(api)

        assert "endpoints" in result
        assert len(result["endpoints"]) == 1

    def test_list_invalid_query(self, app: Flask):
        api = EndpointListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=0&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointListForSinglePluginApi:
    def test_list_for_plugin_success(self, app: Flask):
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

    def test_list_for_plugin_missing_param(self, app: Flask):
        api = EndpointListForSinglePluginApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointItemApi:
    def test_delete_success(self, app: Flask):
        api = EndpointItemApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/", method="DELETE"),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.delete_endpoint",
                return_value=True,
            ) as mock_delete,
        ):
            result = method(api, "e1")

        assert result["success"] is True
        mock_delete.assert_called_once_with(tenant_id="t1", user_id="u1", endpoint_id="e1")

    def test_delete_service_failure(self, app: Flask):
        api = EndpointItemApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/", method="DELETE"),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=False),
        ):
            result = method(api, "e1")

        assert result["success"] is False

    def test_update_success(self, app: Flask):
        api = EndpointItemApi()
        method = unwrap(api.patch)

        payload = {
            "name": "new-name",
            "settings": {"x": 1},
        }

        with (
            app.test_request_context("/", method="PATCH", json=payload),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.update_endpoint",
                return_value=True,
            ) as mock_update,
        ):
            result = method(api, "e1")

        assert result["success"] is True
        mock_update.assert_called_once_with(
            tenant_id="t1",
            user_id="u1",
            endpoint_id="e1",
            name="new-name",
            settings={"x": 1},
        )

    def test_update_validation_error(self, app: Flask):
        api = EndpointItemApi()
        method = unwrap(api.patch)

        payload = {"settings": {}}

        with (
            app.test_request_context("/", method="PATCH", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api, "e1")

    def test_update_service_failure(self, app: Flask):
        api = EndpointItemApi()
        method = unwrap(api.patch)

        payload = {
            "name": "n",
            "settings": {},
        }

        with (
            app.test_request_context("/", method="PATCH", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=False),
        ):
            result = method(api, "e1")

        assert result["success"] is False


@pytest.mark.usefixtures("patch_current_account")
class TestDeprecatedEndpointDeleteApi:
    def test_delete_success(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_delete_invalid_payload(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_delete_service_failure(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False


@pytest.mark.usefixtures("patch_current_account")
class TestDeprecatedEndpointUpdateApi:
    def test_update_success(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
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

    def test_update_validation_error(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1", "settings": {}}

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_update_service_failure(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
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


class TestEndpointRouteMetadata:
    def test_legacy_write_routes_are_marked_deprecated(self):
        assert DeprecatedEndpointCreateApi.post.__apidoc__["deprecated"] is True
        assert DeprecatedEndpointDeleteApi.post.__apidoc__["deprecated"] is True
        assert DeprecatedEndpointUpdateApi.post.__apidoc__["deprecated"] is True
        assert EndpointCollectionApi.post.__apidoc__.get("deprecated") is not True
        assert EndpointItemApi.delete.__apidoc__.get("deprecated") is not True
        assert EndpointItemApi.patch.__apidoc__.get("deprecated") is not True

    def test_canonical_and_legacy_write_routes_are_registered(self):
        route_map = {
            resource.__name__: urls
            for resource, urls, _route_doc, _kwargs in console_ns.resources
            if resource.__name__
            in {
                "EndpointCollectionApi",
                "EndpointItemApi",
                "DeprecatedEndpointCreateApi",
                "DeprecatedEndpointDeleteApi",
                "DeprecatedEndpointUpdateApi",
            }
        }

        assert route_map["EndpointCollectionApi"] == ("/workspaces/current/endpoints",)
        assert route_map["EndpointItemApi"] == ("/workspaces/current/endpoints/<string:id>",)
        assert route_map["DeprecatedEndpointCreateApi"] == ("/workspaces/current/endpoints/create",)
        assert route_map["DeprecatedEndpointDeleteApi"] == ("/workspaces/current/endpoints/delete",)
        assert route_map["DeprecatedEndpointUpdateApi"] == ("/workspaces/current/endpoints/update",)


@pytest.mark.usefixtures("patch_current_account")
class TestEndpointEnableApi:
    def test_enable_success(self, app: Flask):
        api = EndpointEnableApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.enable_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_enable_invalid_payload(self, app: Flask):
        api = EndpointEnableApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)

    def test_enable_service_failure(self, app: Flask):
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
    def test_disable_success(self, app: Flask):
        api = EndpointDisableApi()
        method = unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.disable_endpoint", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_disable_invalid_payload(self, app: Flask):
        api = EndpointDisableApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api)
