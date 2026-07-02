from typing import Any

from core.app.app_config.entities import EngramConfigEntity


class EngramConfigManager:
    @classmethod
    def convert(cls, config: dict[str, Any]) -> EngramConfigEntity | None:
        """
        Build the per-app Engram config entity from the stored model config.

        The ``api_key`` is passed through still-encrypted; it is decrypted only at the point of use
        (store/recall). Returns None when the app has no Engram config at all.
        """
        engram = config.get("engram")
        if not engram:
            return None
        return EngramConfigEntity(
            enabled=bool(engram.get("enabled", False)),
            api_key=engram.get("api_key") or None,
            endpoint=engram.get("endpoint") or None,
        )

    @classmethod
    def validate_and_set_defaults(cls, config: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """
        Validate and normalize the Engram feature config.

        Shape: ``{"enabled": bool, "api_key": str, "endpoint": str}``. The API key is kept as-is here
        (the console controller handles encryption / hidden-value preservation before persistence).
        """
        engram = config.get("engram")
        if not engram:
            config["engram"] = {"enabled": False, "api_key": "", "endpoint": ""}
            return config, ["engram"]

        if not isinstance(engram, dict):
            raise ValueError("engram must be of object type")

        enabled = engram.get("enabled", False)
        if not isinstance(enabled, bool):
            raise ValueError("engram.enabled must be of boolean type")

        api_key = engram.get("api_key") or ""
        if not isinstance(api_key, str):
            raise ValueError("engram.api_key must be of string type")

        endpoint = engram.get("endpoint") or ""
        if not isinstance(endpoint, str):
            raise ValueError("engram.endpoint must be of string type")

        config["engram"] = {"enabled": enabled, "api_key": api_key, "endpoint": endpoint}
        return config, ["engram"]
