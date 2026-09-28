from collections.abc import Mapping

from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import PluginDynamicSelectOptionsResponse
from core.plugin.impl.dynamic_select import DynamicSelectClient


def _fetch(
    client: DynamicSelectClient,
    *,
    parameter_values: Mapping[str, str] | None = None,
) -> PluginDynamicSelectOptionsResponse:
    return client.fetch_dynamic_select_options(
        "tenant-1",
        "user-1",
        "org/plugin",
        "google",
        "search",
        {"api_key": "secret"},
        "api-key",
        "region",
        parameter_values=parameter_values,
    )


def test_fetch_dynamic_select_options_includes_parameter_values(mocker: MockerFixture) -> None:
    client = DynamicSelectClient()
    response = mocker.Mock()
    stream = mocker.patch.object(
        client,
        "_request_with_plugin_daemon_response_stream",
        return_value=iter([response]),
    )

    assert _fetch(client, parameter_values={"region": "us"}) is response

    payload = stream.call_args.kwargs["data"]["data"]
    assert payload["provider"] == "google"
    assert payload["parameter"] == "region"
    assert payload["parameter_values"] == {"region": "us"}
    assert stream.call_args.args[1] == "plugin/tenant-1/dispatch/dynamic_select/fetch_parameter_options"


def test_fetch_dynamic_select_options_omits_empty_parameter_values(mocker: MockerFixture) -> None:
    client = DynamicSelectClient()
    stream = mocker.patch.object(
        client,
        "_request_with_plugin_daemon_response_stream",
        return_value=iter([mocker.Mock()]),
    )

    _fetch(client, parameter_values={})

    assert "parameter_values" not in stream.call_args.kwargs["data"]["data"]
