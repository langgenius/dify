import inspect
from datetime import UTC, datetime
from unittest.mock import patch

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
from core.plugin.entities.endpoint import EndpointEntityWithInstance
from core.plugin.impl.exc import PluginPermissionDeniedError


def _endpoint_entity() -> EndpointEntityWithInstance:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return EndpointEntityWithInstance(
        id="e1",
        created_at=now,
        updated_at=now,
        tenant_id="t1",
        plugin_id="p1",
        settings={
            "secret": "value",
            "enabled": True,
            "ids": ["a", "b"],
            "nested": {"limit": 3},
        },
        expired_at=now,
        name="endpoint",
        enabled=True,
        url="https://example.test/hook-1",
        hook_id="hook-1",
    )


class TestEndpointCollectionApi:
    def test_create_success(self, app: Flask):
        api = EndpointCollectionApi()
        method = inspect.unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "plugin-1",
            "name": "endpoint",
            "settings": {"a": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.create_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True

    def test_create_permission_denied(self, app: Flask):
        api = EndpointCollectionApi()
        method = inspect.unwrap(api.post)

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
                method(api, "t1", "u1")

    def test_create_validation_error(self, app: Flask):
        api = EndpointCollectionApi()
        method = inspect.unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "p1",
            "name": "",
            "settings": {},
        }

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")


class TestDeprecatedEndpointCreateApi:
    def test_create_success(self, app: Flask):
        api = DeprecatedEndpointCreateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "plugin-1",
            "name": "endpoint",
            "settings": {"a": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.create_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True


class TestEndpointListApi:
    def test_list_success(self, app: Flask):
        api = EndpointListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.list_endpoints",
                return_value=[_endpoint_entity()],
            ),
        ):
            result = method(api, "t1", "u1")

        assert result["endpoints"] == [
            {
                "id": "e1",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
                "settings": {
                    "secret": "value",
                    "enabled": True,
                    "ids": ["a", "b"],
                    "nested": {"limit": 3},
                },
                "tenant_id": "t1",
                "plugin_id": "p1",
                "expired_at": "2026-01-01T00:00:00Z",
                "declaration": {"settings": [], "endpoints": []},
                "name": "endpoint",
                "enabled": True,
                "url": "https://example.test/hook-1",
                "hook_id": "hook-1",
            }
        ]

    def test_list_invalid_query(self, app: Flask):
        api = EndpointListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?page=0&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")


class TestEndpointListForSinglePluginApi:
    def test_list_for_plugin_success(self, app: Flask):
        api = EndpointListForSinglePluginApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10&plugin_id=p1"),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.list_endpoints_for_single_plugin",
                return_value=[_endpoint_entity()],
            ),
        ):
            result = method(api, "t1", "u1")

        assert result["endpoints"][0]["id"] == "e1"
        assert result["endpoints"][0]["settings"]["nested"] == {"limit": 3}

    def test_list_for_plugin_missing_param(self, app: Flask):
        api = EndpointListForSinglePluginApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")


class TestEndpointItemApi:
    def test_delete_success(self, app: Flask):
        api = EndpointItemApi()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/", method="DELETE"),
            patch(
                "controllers.console.workspace.endpoint.EndpointService.delete_endpoint",
                return_value=True,
            ) as mock_delete,
        ):
            result = method(api, "t1", "u1", "e1")

        assert result["success"] is True
        mock_delete.assert_called_once_with(tenant_id="t1", user_id="u1", endpoint_id="e1")

    def test_delete_service_failure(self, app: Flask):
        api = EndpointItemApi()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/", method="DELETE"),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=False),
        ):
            result = method(api, "t1", "u1", "e1")

        assert result["success"] is False

    def test_update_success(self, app: Flask):
        api = EndpointItemApi()
        method = inspect.unwrap(api.patch)

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
            result = method(api, "t1", "u1", "e1")

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
        method = inspect.unwrap(api.patch)

        payload = {"settings": {}}

        with (
            app.test_request_context("/", method="PATCH", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1", "e1")

    def test_update_service_failure(self, app: Flask):
        api = EndpointItemApi()
        method = inspect.unwrap(api.patch)

        payload = {
            "name": "n",
            "settings": {},
        }

        with (
            app.test_request_context("/", method="PATCH", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=False),
        ):
            result = method(api, "t1", "u1", "e1")

        assert result["success"] is False


class TestDeprecatedEndpointDeleteApi:
    def test_delete_success(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True

    def test_delete_invalid_payload(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = inspect.unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")

    def test_delete_service_failure(self, app: Flask):
        api = DeprecatedEndpointDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.delete_endpoint", return_value=False),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is False


class TestDeprecatedEndpointUpdateApi:
    def test_update_success(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "endpoint_id": "e1",
            "name": "new-name",
            "settings": {"x": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True

    def test_update_validation_error(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1", "settings": {}}

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")

    def test_update_service_failure(self, app: Flask):
        api = DeprecatedEndpointUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "endpoint_id": "e1",
            "name": "n",
            "settings": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.update_endpoint", return_value=False),
        ):
            result = method(api, "t1", "u1")

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


class TestEndpointEnableApi:
    def test_enable_success(self, app: Flask):
        api = EndpointEnableApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.enable_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True

    def test_enable_invalid_payload(self, app: Flask):
        api = EndpointEnableApi()
        method = inspect.unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")

    def test_enable_service_failure(self, app: Flask):
        api = EndpointEnableApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.enable_endpoint", return_value=False),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is False


class TestEndpointDisableApi:
    def test_disable_success(self, app: Flask):
        api = EndpointDisableApi()
        method = inspect.unwrap(api.post)

        payload = {"endpoint_id": "e1"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.endpoint.EndpointService.disable_endpoint", return_value=True),
        ):
            result = method(api, "t1", "u1")

        assert result["success"] is True

    def test_disable_invalid_payload(self, app: Flask):
        api = EndpointDisableApi()
        method = inspect.unwrap(api.post)

        with (
            app.test_request_context("/", json={}),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", "u1")
