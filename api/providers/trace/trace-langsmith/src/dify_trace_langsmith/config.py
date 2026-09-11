import json
import math
import os
from pathlib import Path
from typing import Any, override

from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class LangSmithConfig(BaseTracingConfig):
    """
    Model class for Langsmith tracing config.
    """

    api_key: str
    project: str
    endpoint: str = "https://api.smith.langchain.com"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        cls.model_validate(provider_config)
        sampling_rate = float(
            next(
                (
                    value
                    for prefix in ("LANGSMITH", "LANGCHAIN")
                    if (value := os.environ.get(f"{prefix}_TRACING_SAMPLING_RATE")) and value.strip()
                ),
                "1",
            )
        )
        if sampling_rate < 0 or sampling_rate > 1:
            raise ValueError("LangSmith tracing sampling rate must be between 0 and 1")
        workspace_id = next(
            (
                value
                for prefix in ("LANGSMITH", "LANGCHAIN")
                if (value := os.environ.get(f"{prefix}_WORKSPACE_ID")) and value.strip()
            ),
            None,
        )
        if workspace_id is None:
            path = Path(os.environ.get("LANGSMITH_CONFIG_FILE") or Path.home() / ".langsmith" / "config.json")
            try:
                profile_config = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                profile_config = {}
            if isinstance(profile_config, dict) and isinstance(profiles := profile_config.get("profiles"), dict):
                profile_name = os.environ.get("LANGSMITH_PROFILE") or profile_config.get("current_profile") or "default"
                profile = profiles.get(profile_name) if isinstance(profile_name, str) else None
                if isinstance(profile, dict) and isinstance(profile.get("workspace_id"), str):
                    workspace_id = profile["workspace_id"]
        certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
        return {
            # The SDK accepts NaN, whose sampling comparisons always drop. Keep the snapshot JSON-safe.
            "sampling_rate": 0.0 if math.isnan(sampling_rate) else sampling_rate,
            **{
                name.lower(): next(
                    (
                        value
                        for prefix in ("LANGSMITH", "LANGCHAIN")
                        if (value := os.environ.get(f"{prefix}_{name}")) and value.strip()
                    ),
                    None,
                )
                == "true"
                for name in ("HIDE_INPUTS", "HIDE_OUTPUTS", "HIDE_METADATA")
            },
            "workspace_id": workspace_id.strip().strip('"').strip("'") if workspace_id else None,
            "tls": read_tls_files({"certificate": certificate}, allow_ca_directory=True),
        }

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # LangSmith only allows HTTPS; self-hosted deployments may sit under a path prefix
        return validate_url_with_path(v, "https://api.smith.langchain.com", allowed_schemes=("https",))
