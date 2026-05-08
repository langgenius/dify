import pytest
from pytest_mock import MockerFixture

from core.plugin.impl.endpoint import PluginEndpointClient
from core.plugin.impl.exc import PluginDaemonInternalServerError


class TestPluginEndpointClientImpl:
    def test_create_endpoint(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=True)

        result = client.create_endpoint("tenant-1", "user-1", "org/plugin:1", "endpoint-a", {"k": "v"})

        assert result is True
        assert request_mock.call_count == 1
        args = request_mock.call_args.args
        kwargs = request_mock.call_args.kwargs
        assert args[:3] == ("POST", "plugin/tenant-1/endpoint/setup", bool)
        assert kwargs["data"]["plugin_unique_identifier"] == "org/plugin:1"

    def test_list_endpoints(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=["endpoint"])

        result = client.list_endpoints("tenant-1", "user-1", 2, 20)

        assert result == ["endpoint"]
        assert request_mock.call_args.args[1] == "plugin/tenant-1/endpoint/list"
        assert request_mock.call_args.kwargs["params"] == {"page": 2, "page_size": 20}

    def test_list_endpoints_for_single_plugin(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=["endpoint"])

        result = client.list_endpoints_for_single_plugin("tenant-1", "user-1", "org/plugin", 1, 10)

        assert result == ["endpoint"]
        assert request_mock.call_args.args[1] == "plugin/tenant-1/endpoint/list/plugin"
        assert request_mock.call_args.kwargs["params"] == {"plugin_id": "org/plugin", "page": 1, "page_size": 10}

    def test_update_endpoint(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=True)

        result = client.update_endpoint("tenant-1", "user-1", "endpoint-1", "renamed", {"x": 1})

        assert result is True
        assert request_mock.call_args.args[:3] == ("POST", "plugin/tenant-1/endpoint/update", bool)

    def test_enable_and_disable_endpoint(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=True)

        assert client.enable_endpoint("tenant-1", "user-1", "endpoint-1") is True
        assert client.disable_endpoint("tenant-1", "user-1", "endpoint-1") is True

        calls = request_mock.call_args_list
        assert calls[0].args[1] == "plugin/tenant-1/endpoint/enable"
        assert calls[1].args[1] == "plugin/tenant-1/endpoint/disable"

    def test_delete_endpoint_idempotent_and_re_raise(self, mocker: MockerFixture):
        client = PluginEndpointClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response")

        request_mock.side_effect = PluginDaemonInternalServerError("record not found")
        assert client.delete_endpoint("tenant-1", "user-1", "endpoint-1") is True

        request_mock.side_effect = PluginDaemonInternalServerError("permission denied")
        with pytest.raises(PluginDaemonInternalServerError) as exc_info:
            client.delete_endpoint("tenant-1", "user-1", "endpoint-1")
        assert "permission denied" in exc_info.value.description
