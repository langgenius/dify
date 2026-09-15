"""Provider-owned configuration and export protocol contracts."""

from typing import Unpack

import httpx
import pytest

from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets,
    assert_provider_exports_complete_tree_with_repeatable_ids,
    isolate_deployment_settings,  # noqa: F401
)


def make_provider_config(secret: str = "tenant-secret") -> dict[str, str]:
    return {"api_key": secret, "entity": "entity", "project": "project", "endpoint": "https://weave.example"}


def test_export_complete_tree_with_repeatable_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, str, RequestArguments]] = []

    def request(method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((method, url, kwargs))
        return httpx.Response(200, json={"data": {"project": {"name": "project"}}})

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    assert_provider_exports_complete_tree_with_repeatable_ids("weave", make_provider_config(), requests)


def test_credentials_round_trip_without_exposing_or_replacing_saved_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
        "weave", make_provider_config(), monkeypatch
    )
