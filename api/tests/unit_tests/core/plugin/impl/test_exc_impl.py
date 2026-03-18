import json

from core.plugin.impl import exc as exc_module
from core.plugin.impl.exc import PluginDaemonError, PluginInvokeError


class TestPluginImplExceptions:
    def test_plugin_daemon_error_str_contains_request_id(self, mocker):
        mocker.patch("core.plugin.impl.exc.get_request_id", return_value="req-123")
        error = PluginDaemonError("bad")

        assert str(error) == "req_id: req-123 PluginDaemonError: bad"

    def test_plugin_invoke_error_with_json_payload(self):
        err = PluginInvokeError(json.dumps({"error_type": "RateLimit", "message": "too many"}))

        assert err.get_error_type() == "RateLimit"
        assert err.get_error_message() == "too many"
        friendly = err.to_user_friendly_error("test-plugin")
        assert "test-plugin" in friendly
        assert "RateLimit" in friendly
        assert "too many" in friendly

    def test_plugin_invoke_error_invalid_json_and_fallback(self, mocker):
        err = PluginInvokeError("plain text")

        assert err._get_error_object() == {}
        assert err.get_error_type() == "unknown"
        assert err.get_error_message() == "unknown"

        mocker.patch.object(PluginInvokeError, "_get_error_object", side_effect=RuntimeError("boom"))
        err2 = PluginInvokeError("plain text")
        assert err2.get_error_message() == "plain text"

    def test_plugin_invoke_error_get_error_object_handles_adapter_exception(self, mocker):
        adapter = mocker.patch.object(exc_module, "TypeAdapter")
        adapter.return_value.validate_json.side_effect = RuntimeError("invalid")

        err = PluginInvokeError("not-json")

        assert err._get_error_object() == {}
