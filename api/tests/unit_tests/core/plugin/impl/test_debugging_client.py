from types import SimpleNamespace

from pytest_mock import MockerFixture

from core.plugin.impl.debugging import PluginDebuggingClient


class TestPluginDebuggingClient:
    def test_get_debugging_key(self, mocker: MockerFixture):
        client = PluginDebuggingClient()
        request_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response",
            return_value=SimpleNamespace(key="debug-key"),
        )

        result = client.get_debugging_key("tenant-1")

        assert result == "debug-key"
        request_mock.assert_called_once()
        args = request_mock.call_args.args
        assert args[0] == "POST"
        assert args[1] == "plugin/tenant-1/debugging/key"
