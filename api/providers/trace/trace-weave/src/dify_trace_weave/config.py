import configparser
import os
from pathlib import Path
from typing import Any, override
from urllib.parse import urlsplit

from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class WeaveConfig(BaseTracingConfig):
    """
    Model class for Weave tracing config.
    """

    api_key: str
    entity: str | None = None
    project: str
    endpoint: str = "https://trace.wandb.ai"
    host: str | None = None

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        config = cls.model_validate(provider_config)
        host = config.host or os.environ.get("WANDB_BASE_URL")
        if not host:
            settings_file = configparser.ConfigParser()
            config_dir = Path(os.environ.get("WANDB_CONFIG_DIR") or Path.home() / ".config" / "wandb")
            settings_file.read([config_dir / "settings", Path.cwd() / "wandb" / "settings"])
            host = settings_file.get("default", "base_url", fallback="https://api.wandb.ai")
        host = host.rstrip("/")
        public_host = os.environ.get("WANDB_PUBLIC_BASE_URL", "").rstrip("/") or host
        endpoint = config.endpoint.rstrip("/")
        if endpoint == "https://trace.wandb.ai":
            endpoint = os.environ.get("WF_TRACE_SERVER_URL") or (
                f"{public_host}/traces" if public_host != "https://api.wandb.ai" else endpoint
            )
        entity = config.entity
        if not entity and "/" not in config.project:
            entity = os.environ.get("WANDB_ENTITY")
        verify = os.environ.get("WEAVE_INSECURE_DISABLE_SSL", "").lower() != "true"
        certificate = os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR")
        account_certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
        return {
            "disabled": os.environ.get("WEAVE_DISABLED", "").lower() in {"yes", "true", "1", "on"},
            # Numeric text keeps even the SDK's accepted non-finite values JSON-safe.
            "request_timeout": str(float(os.environ.get("WEAVE_HTTP_TIMEOUT") or 30)),
            "host": host,
            "endpoint": endpoint,
            "entity": entity,
            "project_host": "https://wandb.ai" if public_host == "https://api.wandb.ai" else public_host,
            "verify": verify,
            "tls": read_tls_files({"certificate": certificate}, allow_ca_directory=True)
            if verify and urlsplit(endpoint).scheme == "https"
            else {},
            "account_tls": read_tls_files({"certificate": account_certificate}, allow_ca_directory=True)
            if urlsplit(host).scheme == "https"
            else {},
        }

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # Weave only allows HTTPS for endpoint
        return validate_url_with_path(v, "https://trace.wandb.ai", allowed_schemes=("https",))

    @field_validator("host")
    @classmethod
    def host_validator(cls, v, info: ValidationInfo):
        if v is not None and v.strip() != "":
            return validate_url_with_path(v, v, allowed_schemes=("https", "http"))
        return v
