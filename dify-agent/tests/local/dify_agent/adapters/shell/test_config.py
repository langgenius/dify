"""Tests for deployment-selected runtime backend settings."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dify_agent.runtime_backend.profile import RuntimeBackendSettings


class TestLocalValidation:
    def test_valid_url_passes(self) -> None:
        settings = RuntimeBackendSettings(
            runtime_backend="local",
            local_sandbox_endpoint="http://shellctl.example.com",
        )
        assert settings.local_sandbox_endpoint == "http://shellctl.example.com"

    def test_https_url_passes(self) -> None:
        settings = RuntimeBackendSettings(
            runtime_backend="local",
            local_sandbox_endpoint="https://shellctl.internal:8443/v1",
        )
        assert settings.local_sandbox_endpoint == "https://shellctl.internal:8443/v1"

    def test_missing_entrypoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="local_sandbox_endpoint is required"):
            RuntimeBackendSettings(runtime_backend="local", local_sandbox_endpoint=None)

    def test_blank_entrypoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="local_sandbox_endpoint is required"):
            RuntimeBackendSettings(runtime_backend="local", local_sandbox_endpoint="   ")

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            RuntimeBackendSettings(runtime_backend="local", local_sandbox_endpoint="not-a-url")

    def test_ftp_scheme_rejected(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            RuntimeBackendSettings(runtime_backend="local", local_sandbox_endpoint="ftp://host/path")


class TestEnterpriseValidation:
    def test_valid_url_passes(self) -> None:
        settings = RuntimeBackendSettings(
            runtime_backend="enterprise",
            enterprise_sandbox_gateway_endpoint="http://gateway.internal:9000",
        )
        assert settings.enterprise_sandbox_gateway_endpoint == "http://gateway.internal:9000"

    def test_https_url_passes(self) -> None:
        settings = RuntimeBackendSettings(
            runtime_backend="enterprise",
            enterprise_sandbox_gateway_endpoint="https://gateway.prod.example.com/api",
        )
        assert settings.enterprise_sandbox_gateway_endpoint == "https://gateway.prod.example.com/api"

    def test_missing_endpoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="enterprise_sandbox_gateway_endpoint is required"):
            RuntimeBackendSettings(runtime_backend="enterprise", enterprise_sandbox_gateway_endpoint=None)

    def test_blank_endpoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="enterprise_sandbox_gateway_endpoint is required"):
            RuntimeBackendSettings(runtime_backend="enterprise", enterprise_sandbox_gateway_endpoint="")

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            RuntimeBackendSettings(
                runtime_backend="enterprise",
                enterprise_sandbox_gateway_endpoint="just-a-hostname",
            )

    def test_ftp_scheme_rejected(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            RuntimeBackendSettings(
                runtime_backend="enterprise",
                enterprise_sandbox_gateway_endpoint="ftp://gateway/path",
            )
