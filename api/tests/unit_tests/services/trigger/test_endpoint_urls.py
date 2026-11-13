"""Trigger URL formatting keeps published webhook and plugin endpoints stable."""

from collections.abc import Callable

import pytest
from yarl import URL

from models.utils import trigger_endpoint


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("plugin", "https://example.test/prefix/triggers/plugin/endpoint-1"),
        ("webhook", "https://example.test/prefix/triggers/webhook/endpoint-1"),
        ("debug", "https://example.test/prefix/triggers/webhook-debug/endpoint-1"),
    ],
)
def test_trigger_urls(kind: str, expected: str) -> None:
    previous = trigger_endpoint.base_url
    trigger_endpoint.base_url = URL("https://example.test/prefix")
    try:
        result = (
            trigger_endpoint.generate_plugin_trigger_endpoint_url("endpoint-1")
            if kind == "plugin"
            else trigger_endpoint.generate_webhook_trigger_endpoint("endpoint-1", debug=kind == "debug")
        )
    finally:
        trigger_endpoint.base_url = previous
    assert result == expected


@pytest.mark.parametrize(("filename", "query_value"), [("icon.svg", "icon.svg"), (None, "None")])
def test_trigger_icon_query_keeps_legacy_format(
    filename: str | None, query_value: str, config_overrides: Callable[..., None]
) -> None:
    config_overrides(CONSOLE_API_URL="https://console.example.test")

    assert trigger_endpoint.generate_trigger_plugin_icon_url("workspace-1", filename) == (
        "https://console.example.test/console/api/workspaces/current/plugin/icon"
        f"?tenant_id=workspace-1&filename={query_value}"
    )
