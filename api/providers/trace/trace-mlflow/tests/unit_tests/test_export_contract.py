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


def make_provider_config(provider: str, secret: str = "tenant-secret") -> dict[str, str]:
    return {
        "mlflow": {
            "username": "user",
            "password": secret,
            "experiment_id": "1",
            "tracking_uri": "https://mlflow.example",
        },
        "databricks": {"personal_access_token": secret, "experiment_id": "1", "host": "https://databricks.example"},
    }[provider]


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_export_complete_tree_with_repeatable_ids(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, str, RequestArguments]] = []

    def request(method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((method, url, kwargs))
        if "credentials-for-data-upload" in url:
            return httpx.Response(
                200,
                json={
                    "credential_info": {
                        "signed_uri": "https://storage.example/traces.json?signature=upload-only",
                        "type": "AWS_PRESIGNED_URL",
                        "headers": [],
                    }
                },
            )
        if method == "GET":
            return httpx.Response(404, json={})
        if kwargs.get("headers", {}).get("Content-Type") == "application/x-protobuf":
            return httpx.Response(200, content=b"")
        return httpx.Response(200, json={})

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    assert_provider_exports_complete_tree_with_repeatable_ids(provider, make_provider_config(provider), requests)


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
        provider, make_provider_config(provider), monkeypatch
    )
