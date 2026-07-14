"""Tests for ShellAdapterSettings provider-based field validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dify_agent.adapters.shell.config import ShellAdapterSettings


class TestShellctlValidation:
    def test_valid_url_passes(self) -> None:
        settings = ShellAdapterSettings(
            shell_provider="shellctl",
            shellctl_entrypoint="http://shellctl.example.com",
        )
        assert settings.shellctl_entrypoint == "http://shellctl.example.com"

    def test_https_url_passes(self) -> None:
        settings = ShellAdapterSettings(
            shell_provider="shellctl",
            shellctl_entrypoint="https://shellctl.internal:8443/v1",
        )
        assert settings.shellctl_entrypoint == "https://shellctl.internal:8443/v1"

    def test_missing_entrypoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="shellctl_entrypoint is required"):
            ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint=None)

    def test_blank_entrypoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="shellctl_entrypoint is required"):
            ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint="   ")

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint="not-a-url")

    def test_ftp_scheme_rejected(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint="ftp://host/path")


class TestEnterpriseValidation:
    def test_valid_url_passes(self) -> None:
        settings = ShellAdapterSettings(
            shell_provider="enterprise",
            enterprise_sandbox_gateway_endpoint="http://gateway.internal:9000",
        )
        assert settings.enterprise_sandbox_gateway_endpoint == "http://gateway.internal:9000"

    def test_https_url_passes(self) -> None:
        settings = ShellAdapterSettings(
            shell_provider="enterprise",
            enterprise_sandbox_gateway_endpoint="https://gateway.prod.example.com/api",
        )
        assert settings.enterprise_sandbox_gateway_endpoint == "https://gateway.prod.example.com/api"

    def test_missing_endpoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="enterprise_sandbox_gateway_endpoint is required"):
            ShellAdapterSettings(shell_provider="enterprise", enterprise_sandbox_gateway_endpoint=None)

    def test_blank_endpoint_raises(self) -> None:
        with pytest.raises(ValidationError, match="enterprise_sandbox_gateway_endpoint is required"):
            ShellAdapterSettings(shell_provider="enterprise", enterprise_sandbox_gateway_endpoint="")

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            ShellAdapterSettings(
                shell_provider="enterprise",
                enterprise_sandbox_gateway_endpoint="just-a-hostname",
            )

    def test_ftp_scheme_rejected(self) -> None:
        with pytest.raises(ValidationError, match="must be a valid http\\(s\\) URL"):
            ShellAdapterSettings(
                shell_provider="enterprise",
                enterprise_sandbox_gateway_endpoint="ftp://gateway/path",
            )
