import configparser
import os
from pathlib import Path
from typing import Any, override
from urllib.parse import urlsplit

from pydantic import TypeAdapter, ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class OpikConfig(BaseTracingConfig):
    """
    Model class for Opik tracing config.
    """

    api_key: str | None = None
    project: str | None = None
    workspace: str | None = None
    url: str = "https://www.comet.com/opik/api/"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        config = cls.model_validate(provider_config)
        settings_file = configparser.ConfigParser()
        config_path = os.environ.get("OPIK_CONFIG_PATH")
        settings_file.read(Path(config_path).expanduser() if config_path is not None else Path.home() / ".opik.config")
        defaults = dict(settings_file.items("opik")) if settings_file.has_section("opik") else {}
        settings: dict[str, Any] = {}
        for field, sdk_field, default in (
            ("api_key", "api_key", None),
            ("workspace", "workspace", "default"),
            ("project", "project_name", "Default Project"),
        ):
            saved = getattr(config, field)
            if saved is None:
                settings[field] = os.environ.get(f"OPIK_{sdk_field.upper()}", defaults.get(sdk_field, default))
        verify = TypeAdapter(bool).validate_python(
            os.environ.get("OPIK_CHECK_TLS_CERTIFICATE", defaults.get("check_tls_certificate", True))
        )
        certificate = os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR")
        settings.update(
            verify=verify,
            tls=read_tls_files({"certificate": certificate}, allow_ca_directory=True)
            if verify and urlsplit(config.url).scheme == "https"
            else {},
        )
        return settings

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "Default Project")

    @field_validator("url")
    @classmethod
    def url_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://www.comet.com/opik/api/", required_suffix="/api/")
